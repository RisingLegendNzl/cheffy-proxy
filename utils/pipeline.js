/**
 * utils/pipeline.js
 * 
 * Shared Pipeline Module for Cheffy
 * 
 * PURPOSE:
 * Extracts common orchestration logic from generate-full-plan.js and day.js
 * into a single source of truth. Both orchestrators become thin wrappers
 * that call into this shared module.
 * 
 * PLAN REFERENCE: Step A1 - Create Shared Pipeline Module
 * 
 * ASSUMPTIONS:
 * - normalizeKey is exported from scripts/normalize.js
 * - lookupIngredientNutrition is exported from api/nutrition-search.js
 * - reconcileNonProtein and reconcileMealLevel are exported from utils/reconcileNonProtein.js
 * - validateDayPlan is exported from utils/validation.js
 * - toAsSold, normalizeToGramsOrMl are exported from utils/transforms.js
 * - resolveState is exported from utils/stateResolver.js (new file)
 * - validateLLMOutput is exported from utils/llmValidator.js (new file)
 * - emitAlert is exported from utils/alerting.js (new file)
 * - Trace storage uses @vercel/kv
 */

const { v4: uuidv4 } = require('uuid');
const { normalizeKey } = require('../scripts/normalize.js');
const { lookupIngredientNutrition } = require('../api/nutrition-search.js');
const { reconcileNonProtein, reconcileMealLevel } = require('./reconcileNonProtein.js');
const { validateDayPlan } = require('./validation.js');
const { toAsSold, normalizeToGramsOrMl } = require('./transforms.js');
const { resolveState } = require('./stateResolver.js');
const { validateLLMOutput } = require('./llmValidator.js');
const { emitAlert, ALERT_LEVELS } = require('./alerting.js');
const { 
  assertMacroCalorieConsistency, 
  assertPositiveQuantities, 
  assertReasonablePortions,
  assertReconciliationBounds 
} = require('./invariants.js');

/**
 * Pipeline configuration defaults
 */
const DEFAULT_CONFIG = {
  reconciliationTolerancePct: 0.15,
  maxLLMRetries: 2,
  enableBlockingValidation: true,
  enableTracing: true
};

/**
 * Generates a unique trace ID for request correlation
 * @returns {string} UUID v4 trace ID
 */
function generateTraceId() {
  return uuidv4();
}

/**
 * Creates a structured logger that includes trace ID in all log entries
 * @param {string} traceId - The trace ID for this request
 * @param {string} stage - Pipeline stage name
 * @returns {Function} Logger function
 */
function createTracedLogger(traceId, stage) {
  return function log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      traceId,
      stage,
      level,
      message,
      ...data
    };
    
    // Output structured log
    console.log(JSON.stringify(entry));
    
    return entry;
  };
}

/**
 * Normalizes state hint for a single item using the deterministic state resolver
 * Compares LLM-provided stateHint with rule-based resolution
 * 
 * @param {Object} item - Item object with key, stateHint, methodHint
 * @param {Function} log - Traced logger function
 * @returns {Object} Item with resolved state and method
 */
function normalizeItemState(item, log) {
  const { key, stateHint: llmStateHint, methodHint: llmMethodHint } = item;
  
  // Get deterministic resolution
  const resolution = resolveState(key);
  
  // Determine final state
  let finalState = resolution.state;
  let finalMethod = resolution.method;
  let stateSource = 'rule';
  
  // If LLM provided a state hint, compare with rule-based result
  if (llmStateHint && llmStateHint === resolution.state) {
    stateSource = 'llm_agreed';
    log('debug', 'LLM state hint matches rule resolution', {
      itemKey: key,
      state: finalState,
      ruleId: resolution.ruleId
    });
  } else if (llmStateHint && llmStateHint !== resolution.state) {
    // LLM disagrees - use rule-based result but log disagreement
    stateSource = 'rule_override';
    log('info', 'LLM state hint overridden by rule resolution', {
      itemKey: key,
      llmState: llmStateHint,
      resolvedState: resolution.state,
      ruleId: resolution.ruleId,
      confidence: resolution.confidence
    });
    
    // Emit alert for monitoring LLM compliance
    if (resolution.confidence === 'high') {
      emitAlert(ALERT_LEVELS.INFO, 'llm_state_disagreement', {
        itemKey: key,
        llmState: llmStateHint,
        resolvedState: resolution.state,
        ruleId: resolution.ruleId
      });
    }
  }
  
  // Handle method hint similarly
  if (llmMethodHint && resolution.method && llmMethodHint !== resolution.method) {
    log('debug', 'LLM method hint differs from rule resolution', {
      itemKey: key,
      llmMethod: llmMethodHint,
      resolvedMethod: resolution.method
    });
  }
  
  // Use LLM method if rule didn't specify one
  if (!resolution.method && llmMethodHint) {
    finalMethod = llmMethodHint;
  }
  
  return {
    ...item,
    stateHint: finalState,
    methodHint: finalMethod,
    _stateResolution: {
      source: stateSource,
      ruleId: resolution.ruleId,
      confidence: resolution.confidence,
      category: resolution.category
    }
  };
}

/**
 * Normalizes state hints for all items in a meals array
 * 
 * @param {Array} meals - Array of meal objects, each with items array
 * @param {Function} log - Traced logger function
 * @returns {Array} Meals with normalized state hints
 */
function normalizeAllItemStates(meals, log) {
  return meals.map(meal => ({
    ...meal,
    items: meal.items.map(item => normalizeItemState(item, log))
  }));
}

/**
 * Extracts unique ingredient keys from meals array
 * Deduplicates by normalized key
 * 
 * @param {Array} meals - Array of meal objects
 * @param {Function} log - Traced logger function
 * @returns {Array} Array of unique ingredient objects with normalizedKey
 */
function extractUniqueIngredients(meals, log) {
  const seen = new Map();
  
  for (const meal of meals) {
    for (const item of meal.items) {
      const normalizedKey = normalizeKey(item.key);
      
      if (!seen.has(normalizedKey)) {
        seen.set(normalizedKey, {
          originalKey: item.key,
          normalizedKey,
          stateHint: item.stateHint,
          methodHint: item.methodHint
        });
      }
    }
  }
  
  const ingredients = Array.from(seen.values());
  
  log('info', 'Extracted unique ingredients', {
    totalItems: meals.reduce((sum, m) => sum + m.items.length, 0),
    uniqueIngredients: ingredients.length
  });
  
  return ingredients;
}

/**
 * Fetches nutrition data for all unique ingredients
 * Uses lookupIngredientNutrition (HotPath → Canonical → Fallback)
 * 
 * @param {Array} ingredients - Array of ingredient objects with normalizedKey
 * @param {Function} log - Traced logger function
 * @returns {Map} Map of normalizedKey → nutritionData
 */
async function fetchNutritionForIngredients(ingredients, log) {
  const nutritionMap = new Map();
  let hotPathHits = 0;
  let canonicalHits = 0;
  let fallbackHits = 0;
  
  for (const ingredient of ingredients) {
    const nutrition = await lookupIngredientNutrition(ingredient.normalizedKey, log);
    
    nutritionMap.set(ingredient.normalizedKey, nutrition);
    
    // Track source for metrics
    if (nutrition.source === 'hotpath') hotPathHits++;
    else if (nutrition.source === 'canonical') canonicalHits++;
    else if (nutrition.isFallback) fallbackHits++;
  }
  
  const total = ingredients.length;
  const fallbackRate = total > 0 ? (fallbackHits / total) * 100 : 0;
  
  log('info', 'Nutrition lookup complete', {
    total,
    hotPathHits,
    canonicalHits,
    fallbackHits,
    fallbackRatePct: fallbackRate.toFixed(2)
  });
  
  // Alert if fallback rate exceeds threshold
  if (fallbackRate > 30) {
    emitAlert(ALERT_LEVELS.CRITICAL, 'high_fallback_rate', {
      fallbackRate,
      threshold: 30,
      total,
      fallbackHits
    });
  } else if (fallbackRate > 15) {
    emitAlert(ALERT_LEVELS.WARNING, 'elevated_fallback_rate', {
      fallbackRate,
      threshold: 15,
      total,
      fallbackHits
    });
  }
  
  return nutritionMap;
}

/**
 * Computes macros for a single item
 * Applies unit normalization, toAsSold transform, and nutrition lookup
 * 
 * @param {Object} item - Item object with key, qty_value, qty_unit, stateHint, methodHint
 * @param {Map} nutritionMap - Map of normalizedKey → nutritionData
 * @param {Function} log - Traced logger function
 * @returns {Object} Macro data { kcal, protein, fat, carbs, grams_as_sold, confidence }
 */
function computeItemMacros(item, nutritionMap, log) {
  const normalizedKey = normalizeKey(item.key);
  
  // Step 1: Normalize quantity to grams or ml
  const normalized = normalizeToGramsOrMl(item, log);
  
  // Step 2: Convert to as-sold weight
  const asSold = toAsSold(item, normalized.value, log);
  
  // Check for YIELD_UNMAPPED error
  if (asSold.error === 'YIELD_UNMAPPED') {
    log('error', 'Unmapped yield factor for cooked item', {
      itemKey: item.key,
      normalizedKey,
      stateHint: item.stateHint
    });
    emitAlert(ALERT_LEVELS.CRITICAL, 'yield_unmapped', {
      itemKey: item.key,
      normalizedKey,
      stateHint: item.stateHint
    });
  }
  
  // Step 3: Get nutrition data
  const nutrition = nutritionMap.get(normalizedKey);
  
  if (!nutrition) {
    log('error', 'Nutrition data not found for item', {
      itemKey: item.key,
      normalizedKey
    });
    return {
      kcal: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      grams_as_sold: asSold.grams_as_sold,
      confidence: 'none',
      error: 'NUTRITION_NOT_FOUND'
    };
  }
  
  // Step 4: Calculate macros based on as-sold grams
  const factor = asSold.grams_as_sold / 100; // Nutrition data is per 100g
  
  const macros = {
    kcal: Math.round(nutrition.calories * factor),
    protein: Math.round(nutrition.protein * factor * 10) / 10,
    fat: Math.round(nutrition.fat * factor * 10) / 10,
    carbs: Math.round(nutrition.carbs * factor * 10) / 10,
    grams_as_sold: asSold.grams_as_sold,
    confidence: nutrition.confidence || 'medium',
    source: nutrition.source,
    isFallback: nutrition.isFallback || false
  };
  
  // Add confidence band if available from toAsSold
  if (asSold.grams_as_sold_min !== undefined) {
    const factorMin = asSold.grams_as_sold_min / 100;
    const factorMax = asSold.grams_as_sold_max / 100;
    macros.kcal_min = Math.round(nutrition.calories * factorMin);
    macros.kcal_max = Math.round(nutrition.calories * factorMax);
  }
  
  // Validate macro consistency
  try {
    assertMacroCalorieConsistency(macros);
  } catch (err) {
    log('warning', 'Macro calorie consistency check failed', {
      itemKey: item.key,
      macros,
      error: err.message
    });
  }
  
  return macros;
}

/**
 * Creates a getItemMacros callback for reconciliation
 * 
 * @param {Map} nutritionMap - Map of normalizedKey → nutritionData
 * @param {Function} log - Traced logger function
 * @returns {Function} getItemMacros callback
 */
function createGetItemMacrosCallback(nutritionMap, log) {
  return function getItemMacros(item) {
    return computeItemMacros(item, nutritionMap, log);
  };
}

/**
 * Runs per-meal reconciliation to adjust calories
 * 
 * @param {Object} meal - Meal object with items array
 * @param {number} targetKcal - Target calories for this meal
 * @param {number} targetProtein - Target protein for this meal
 * @param {Function} getItemMacros - Callback to compute item macros
 * @param {number} tolerancePct - Tolerance percentage (default 0.15)
 * @param {Function} log - Traced logger function
 * @returns {Object} Reconciled meal
 */
function runMealReconciliation(meal, targetKcal, targetProtein, getItemMacros, tolerancePct, log) {
  const result = reconcileMealLevel({
    meal,
    targetKcal,
    targetProtein,
    getItemMacros,
    tolPct: tolerancePct
  });
  
  if (result.adjusted && result.factor !== null) {
    // Validate reconciliation bounds
    try {
      assertReconciliationBounds(result.factor);
    } catch (err) {
      log('warning', 'Reconciliation factor out of bounds', {
        mealType: meal.type,
        factor: result.factor,
        error: err.message
      });
      emitAlert(ALERT_LEVELS.WARNING, 'reconciliation_factor_bounds', {
        mealType: meal.type,
        factor: result.factor
      });
    }
    
    log('info', 'Meal reconciliation applied', {
      mealType: meal.type,
      factor: result.factor,
      adjusted: result.adjusted
    });
  }
  
  return result.meal;
}

/**
 * Runs daily reconciliation using reconcileNonProtein
 * 
 * @param {Array} meals - Array of meal objects for the day
 * @param {number} targetKcal - Daily calorie target
 * @param {number} targetProtein - Daily protein target
 * @param {Function} getItemMacros - Callback to compute item macros
 * @param {number} tolerancePct - Tolerance percentage
 * @param {Function} log - Traced logger function
 * @returns {Object} { meals, adjusted, factor }
 */
function runDailyReconciliation(meals, targetKcal, targetProtein, getItemMacros, tolerancePct, log) {
  const result = reconcileNonProtein({
    meals,
    targetKcal,
    getItemMacros,
    tolPct: tolerancePct,
    allowProteinScaling: false,
    targetProtein
  });
  
  if (result.adjusted && result.factor !== null) {
    try {
      assertReconciliationBounds(result.factor);
    } catch (err) {
      log('warning', 'Daily reconciliation factor out of bounds', {
        factor: result.factor,
        error: err.message
      });
      emitAlert(ALERT_LEVELS.WARNING, 'daily_reconciliation_bounds', {
        factor: result.factor
      });
    }
    
    log('info', 'Daily reconciliation applied', {
      factor: result.factor,
      adjusted: result.adjusted
    });
  }
  
  return result;
}

/**
 * Runs validation on a day plan
 * Returns validation result with critical/warning/info categories
 * 
 * @param {Object} dayPlan - Day plan object
 * @param {Function} getMacros - Callback to get macros
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Traced logger function
 * @returns {Object} { valid, critical, warnings, info }
 */
function runValidation(dayPlan, getMacros, config, log) {
  const result = validateDayPlan(dayPlan, getMacros);
  
  // Log validation issues
  if (result.critical && result.critical.length > 0) {
    log('error', 'Critical validation issues detected', {
      issues: result.critical
    });
    emitAlert(ALERT_LEVELS.CRITICAL, 'validation_critical', {
      issues: result.critical
    });
  }
  
  if (result.warnings && result.warnings.length > 0) {
    log('warning', 'Validation warnings detected', {
      issues: result.warnings
    });
  }
  
  // If blocking validation is enabled and there are critical issues, throw
  if (config.enableBlockingValidation && result.critical && result.critical.length > 0) {
    const error = new Error('Critical validation issues prevent plan delivery');
    error.validationResult = result;
    error.isValidationError = true;
    throw error;
  }
  
  return result;
}

/**
 * Validates LLM output with retry logic
 * 
 * @param {Object} output - Raw LLM output
 * @param {string} schemaName - Schema to validate against
 * @param {Function} retryFn - Function to call for retry (should return new LLM output)
 * @param {number} maxRetries - Maximum retry attempts
 * @param {Function} log - Traced logger function
 * @returns {Object} Validated and possibly corrected output
 */
async function validateLLMOutputWithRetry(output, schemaName, retryFn, maxRetries, log) {
  let currentOutput = output;
  let attempts = 0;
  
  while (attempts <= maxRetries) {
    const validation = validateLLMOutput(currentOutput, schemaName);
    
    if (validation.valid) {
      if (validation.corrections && validation.corrections.length > 0) {
        log('info', 'LLM output auto-corrected', {
          schemaName,
          corrections: validation.corrections
        });
      }
      return validation.correctedOutput || currentOutput;
    }
    
    // Validation failed
    log('warning', 'LLM output validation failed', {
      schemaName,
      attempt: attempts + 1,
      errors: validation.errors
    });
    
    if (attempts < maxRetries && retryFn) {
      attempts++;
      log('info', 'Retrying LLM call', { attempt: attempts });
      currentOutput = await retryFn();
    } else {
      // Max retries exceeded
      emitAlert(ALERT_LEVELS.WARNING, 'llm_validation_failed', {
        schemaName,
        attempts: attempts + 1,
        errors: validation.errors
      });
      
      const error = new Error(`LLM output validation failed after ${attempts + 1} attempts`);
      error.validationErrors = validation.errors;
      error.isLLMValidationError = true;
      throw error;
    }
  }
  
  return currentOutput;
}

/**
 * Calculates day totals from meals
 * 
 * @param {Array} meals - Array of meal objects
 * @param {Function} getItemMacros - Callback to compute item macros
 * @returns {Object} { kcal, protein, fat, carbs }
 */
function calculateDayTotals(meals, getItemMacros) {
  let totalKcal = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;
  
  for (const meal of meals) {
    for (const item of meal.items) {
      const macros = getItemMacros(item);
      totalKcal += macros.kcal || 0;
      totalProtein += macros.protein || 0;
      totalFat += macros.fat || 0;
      totalCarbs += macros.carbs || 0;
    }
  }
  
  return {
    kcal: Math.round(totalKcal),
    protein: Math.round(totalProtein * 10) / 10,
    fat: Math.round(totalFat * 10) / 10,
    carbs: Math.round(totalCarbs * 10) / 10
  };
}

/**
 * Main pipeline execution function
 * Orchestrates the full meal plan generation pipeline
 * 
 * @param {Object} params - Pipeline parameters
 * @param {Array} params.rawMeals - Raw meals from LLM
 * @param {Object} params.targets - { kcal, protein, fat, carbs }
 * @param {Function} params.llmRetryFn - Function to retry LLM call
 * @param {Object} params.config - Pipeline configuration overrides
 * @returns {Object} { traceId, meals, dayTotals, validation, debug }
 */
async function executePipeline(params) {
  const {
    rawMeals,
    targets,
    llmRetryFn,
    config: configOverrides = {}
  } = params;
  
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const traceId = generateTraceId();
  const log = createTracedLogger(traceId, 'pipeline');
  
  log('info', 'Pipeline execution started', { traceId, targets });
  
  const debug = {
    traceId,
    stages: [],
    timings: {}
  };
  
  try {
    // Stage 1: Validate LLM output
    const startValidateLLM = Date.now();
    const validatedMeals = await validateLLMOutputWithRetry(
      rawMeals,
      'MEALS_ARRAY',
      llmRetryFn,
      config.maxLLMRetries,
      log
    );
    debug.timings.validateLLM = Date.now() - startValidateLLM;
    debug.stages.push('llm_validation');
    
    // Stage 2: Normalize state hints
    const startNormalize = Date.now();
    const normalizedMeals = normalizeAllItemStates(validatedMeals, log);
    debug.timings.normalizeStates = Date.now() - startNormalize;
    debug.stages.push('state_normalization');
    
    // Stage 3: Extract unique ingredients
    const startExtract = Date.now();
    const ingredients = extractUniqueIngredients(normalizedMeals, log);
    debug.timings.extractIngredients = Date.now() - startExtract;
    debug.stages.push('ingredient_extraction');
    
    // Stage 4: Fetch nutrition
    const startNutrition = Date.now();
    const nutritionMap = await fetchNutritionForIngredients(ingredients, log);
    debug.timings.fetchNutrition = Date.now() - startNutrition;
    debug.stages.push('nutrition_fetch');
    
    // Stage 5: Create macro callback
    const getItemMacros = createGetItemMacrosCallback(nutritionMap, log);
    
    // Stage 6: Per-meal reconciliation
    const startMealRecon = Date.now();
    const mealTargetKcal = targets.kcal / normalizedMeals.length;
    const mealTargetProtein = targets.protein / normalizedMeals.length;
    
    const reconciledMeals = normalizedMeals.map(meal => 
      runMealReconciliation(
        meal,
        mealTargetKcal,
        mealTargetProtein,
        getItemMacros,
        config.reconciliationTolerancePct,
        log
      )
    );
    debug.timings.mealReconciliation = Date.now() - startMealRecon;
    debug.stages.push('meal_reconciliation');
    
    // Stage 7: Daily reconciliation
    const startDailyRecon = Date.now();
    const dailyResult = runDailyReconciliation(
      reconciledMeals,
      targets.kcal,
      targets.protein,
      getItemMacros,
      config.reconciliationTolerancePct,
      log
    );
    debug.timings.dailyReconciliation = Date.now() - startDailyRecon;
    debug.stages.push('daily_reconciliation');
    
    // Stage 8: Calculate final totals
    const dayTotals = calculateDayTotals(dailyResult.meals, getItemMacros);
    debug.stages.push('calculate_totals');
    
    // Stage 9: Validation
    const startValidation = Date.now();
    const dayPlan = {
      meals: dailyResult.meals,
      totals: dayTotals,
      targets
    };
    const validationResult = runValidation(dayPlan, getItemMacros, config, log);
    debug.timings.validation = Date.now() - startValidation;
    debug.stages.push('validation');
    
    // Validate item quantities
    for (const meal of dailyResult.meals) {
      for (const item of meal.items) {
        try {
          assertPositiveQuantities(item);
          assertReasonablePortions(item);
        } catch (err) {
          log('warning', 'Item constraint violation', {
            itemKey: item.key,
            error: err.message
          });
        }
      }
    }
    
    log('info', 'Pipeline execution completed', {
      traceId,
      totalTime: Object.values(debug.timings).reduce((a, b) => a + b, 0),
      dayTotals
    });
    
    return {
      traceId,
      meals: dailyResult.meals,
      dayTotals,
      validation: validationResult,
      debug
    };
    
  } catch (error) {
    log('error', 'Pipeline execution failed', {
      traceId,
      error: error.message,
      isValidationError: error.isValidationError,
      isLLMValidationError: error.isLLMValidationError
    });
    
    throw error;
  }
}

module.exports = {
  // Main execution
  executePipeline,
  
  // Configuration
  DEFAULT_CONFIG,
  
  // Utility functions (exported for orchestrators that need granular control)
  generateTraceId,
  createTracedLogger,
  normalizeItemState,
  normalizeAllItemStates,
  extractUniqueIngredients,
  fetchNutritionForIngredients,
  computeItemMacros,
  createGetItemMacrosCallback,
  runMealReconciliation,
  runDailyReconciliation,
  runValidation,
  validateLLMOutputWithRetry,
  calculateDayTotals
};