/**
 * utils/pipeline.js
 * 
 * Shared Pipeline Module for Cheffy
 * V2.3 - Fixed property name mismatch causing NaN reconciliation factors
 * 
 * PURPOSE:
 * Extracts common orchestration logic from generate-full-plan.js and day.js
 * into a single source of truth. Both orchestrators become thin wrappers
 * that call into this shared module.
 * 
 * V2.1 CHANGES:
 * - Fixed property name mismatches (totals → dayTotals, kcal → calories alias)
 * 
 * V2.2 CHANGES (Minimum Viable Reliability):
 * - INV-001 is now BLOCKING: items with >20% deviation cause immediate throw
 * - Items with 5-20% deviation are FLAGGED (marked with _flagged: true)
 * - If >20% of items are flagged, entire response is blocked
 * - New alert emissions for flagged items and blocked responses
 * 
 * V2.3 CHANGES (Reconciliation NaN Fix):
 * - Added short property aliases (p, f, c) to computeItemMacros return object
 *   Required by reconcileNonProtein which expects mm.p, mm.f, mm.c
 * - Added defensive guards for undefined/NaN quantities after normalization
 * - Added defensive guards for undefined/NaN grams_as_sold after transforms
 * - Safe zero-macro returns with error codes prevent NaN propagation
 */

const crypto = require('crypto');
const { normalizeKey } = require('../scripts/normalize.js');
const { lookupIngredientNutrition } = require('../api/nutrition-search.js');
const { reconcileNonProtein, reconcileMealLevel } = require('./reconcileNonProtein.js');
const { validateDayPlan } = require('./validation.js');
const { toAsSold, normalizeToGramsOrMl } = require('./transforms.js');
const { resolveState } = require('./stateResolver.js');
const { validateLLMOutput } = require('./llmValidator.js');
const { 
  emitAlert, 
  ALERT_LEVELS,
  alertItemFlaggedInv001,
  alertResponseBlockedInv001
} = require('./alerting.js');
const { 
  checkMacroCalorieConsistency,
  createFlaggedMacros,
  assertPositiveQuantities, 
  assertReasonablePortions,
  assertReconciliationBounds,
  InvariantViolationError,
  INVARIANT_CONFIG,
  INVARIANT_SEVERITY
} = require('./invariants.js');

/**
 * Pipeline configuration defaults
 */
const DEFAULT_CONFIG = {
  reconciliationTolerancePct: 0.15,
  maxLLMRetries: 2,
  enableBlockingValidation: true,
  enableTracing: true,
  // V2.2: INV-001 blocking configuration
  enableInv001Blocking: true,
  inv001FlagThresholdPct: 5,      // Flag items with >5% deviation
  inv001BlockThresholdPct: 20,    // Block items with >20% deviation
  responseBlockThresholdPct: 20   // Block response if >20% items flagged
};

/**
 * Generates a unique trace ID for request correlation
 * @returns {string} UUID v4 trace ID
 */
function generateTraceId() {
  return crypto.randomUUID();
}

/**
 * Creates a traced logger function
 * 
 * @param {string} traceId - Trace ID to include in all logs
 * @param {string} component - Component name (default: 'pipeline')
 * @returns {Function} Logger function (level, message, data)
 */
function createTracedLogger(traceId, component = 'pipeline') {
  return function log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      traceId,
      component,
      level,
      message,
      ...data
    };
    
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warning') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
    
    return entry;
  };
}

/**
 * Normalizes item state using rule-based resolution
 * 
 * @param {Object} item - Item with potential stateHint from LLM
 * @param {Function} log - Traced logger function
 * @returns {Object} Item with normalized stateHint and _stateResolution metadata
 */
function normalizeItemState(item, log) {
  const { key, stateHint: llmStateHint, methodHint: llmMethodHint } = item;
  
  const resolution = resolveState(key);
  
  let finalState = resolution.state;
  let finalMethod = resolution.method;
  let stateSource = 'rule';
  
  if (llmStateHint && llmStateHint !== resolution.state) {
    log('info', 'LLM state hint overridden by rule resolution', {
      itemKey: key,
      llmState: llmStateHint,
      resolvedState: resolution.state,
      ruleId: resolution.ruleId,
      confidence: resolution.confidence
    });
    
    if (resolution.confidence === 'high') {
      emitAlert(ALERT_LEVELS.INFO, 'llm_state_disagreement', {
        itemKey: key,
        llmState: llmStateHint,
        resolvedState: resolution.state,
        ruleId: resolution.ruleId
      });
    }
  }
  
  if (llmMethodHint && resolution.method && llmMethodHint !== resolution.method) {
    log('debug', 'LLM method hint differs from rule resolution', {
      itemKey: key,
      llmMethod: llmMethodHint,
      resolvedMethod: resolution.method
    });
  }
  
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
 * V2.2: Computes macros for a single item with INV-001 blocking
 * 
 * @param {Object} item - Item object with key, qty_value, qty_unit, stateHint, methodHint
 * @param {Map} nutritionMap - Map of normalizedKey → nutritionData
 * @param {Function} log - Traced logger function
 * @param {Object} config - Pipeline configuration
 * @returns {Object} Macro data with potential _flagged property
 */
function computeItemMacros(item, nutritionMap, log, config = DEFAULT_CONFIG) {
  const normalizedKey = normalizeKey(item.key);
  
  // Step 1: Normalize quantity to grams or ml
  const normalized = normalizeToGramsOrMl(item, log);
  
  // V2.3 FIX: Defensive guard for undefined/NaN normalized value
  if (normalized.value === undefined || normalized.value === null || Number.isNaN(normalized.value)) {
    log('error', 'INV-002 PREFLIGHT: Invalid quantity after normalization', {
      itemKey: item.key,
      normalizedKey,
      qty_value: item.qty_value,
      qty_unit: item.qty_unit,
      normalized_value: normalized.value
    });
    emitAlert(ALERT_LEVELS.CRITICAL, 'quantity_normalization_failed', {
      itemKey: item.key,
      normalizedKey,
      qty_value: item.qty_value,
      qty_unit: item.qty_unit,
      normalized_value: normalized.value
    });
    // Return safe zero macros to prevent NaN propagation
    return {
      kcal: 0, protein: 0, fat: 0, carbs: 0,
      p: 0, f: 0, c: 0,  // Short aliases for reconciliation
      grams_as_sold: 0,
      confidence: 'none',
      error: 'QUANTITY_INVALID',
      _errorDetail: { qty_value: item.qty_value, normalized_value: normalized.value }
    };
  }
  
  // Step 2: Convert to as-sold weight
  const asSold = toAsSold(item, normalized.value, log);
  
  // V2.3 FIX: Defensive guard for undefined/NaN grams_as_sold
  if (asSold.grams_as_sold === undefined || asSold.grams_as_sold === null || Number.isNaN(asSold.grams_as_sold)) {
    log('error', 'INV-002 PREFLIGHT: Invalid grams_as_sold after transform', {
      itemKey: item.key,
      normalizedKey,
      normalized_value: normalized.value,
      grams_as_sold: asSold.grams_as_sold,
      stateHint: item.stateHint
    });
    emitAlert(ALERT_LEVELS.CRITICAL, 'grams_as_sold_invalid', {
      itemKey: item.key,
      normalizedKey,
      normalized_value: normalized.value,
      grams_as_sold: asSold.grams_as_sold
    });
    // Return safe zero macros to prevent NaN propagation
    return {
      kcal: 0, protein: 0, fat: 0, carbs: 0,
      p: 0, f: 0, c: 0,  // Short aliases for reconciliation
      grams_as_sold: 0,
      confidence: 'none',
      error: 'GRAMS_AS_SOLD_INVALID',
      _errorDetail: { normalized_value: normalized.value, grams_as_sold: asSold.grams_as_sold }
    };
  }
  
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
      kcal: 0, protein: 0, fat: 0, carbs: 0,
      p: 0, f: 0, c: 0,  // Short aliases for reconciliation
      grams_as_sold: asSold.grams_as_sold,
      confidence: 'none',
      error: 'NUTRITION_NOT_FOUND'
    };
  }
  
  // Step 4: Calculate macros based on as-sold grams
  const factor = asSold.grams_as_sold / 100;
  
  // Calculate macro values
  const proteinVal = Math.round(nutrition.protein * factor * 10) / 10;
  const fatVal = Math.round(nutrition.fat * factor * 10) / 10;
  const carbsVal = Math.round(nutrition.carbs * factor * 10) / 10;
  
  let macros = {
    kcal: Math.round(nutrition.calories * factor),
    // Long property names (for pipeline consumers)
    protein: proteinVal,
    fat: fatVal,
    carbs: carbsVal,
    // V2.3 FIX: Short aliases (required by reconcileNonProtein)
    p: proteinVal,
    f: fatVal,
    c: carbsVal,
    grams_as_sold: asSold.grams_as_sold,
    confidence: nutrition.confidence || 'medium',
    source: nutrition.source,
    isFallback: nutrition.isFallback || false
  };
  
  // Add confidence band if available
  if (asSold.grams_as_sold_min !== undefined) {
    const factorMin = asSold.grams_as_sold_min / 100;
    const factorMax = asSold.grams_as_sold_max / 100;
    macros.kcal_min = Math.round(nutrition.calories * factorMin);
    macros.kcal_max = Math.round(nutrition.calories * factorMax);
  }
  
  // V2.2: INV-001 Check with BLOCKING behavior
  if (config.enableInv001Blocking) {
    const consistencyCheck = checkMacroCalorieConsistency(
      macros,
      config.inv001FlagThresholdPct,
      config.inv001BlockThresholdPct
    );
    
    if (!consistencyCheck.valid) {
      if (consistencyCheck.severity === INVARIANT_SEVERITY.CRITICAL) {
        // >20% deviation: HARD FAIL immediately
        log('error', 'INV-001 BLOCKING: Macro-calorie inconsistency exceeds blocking threshold', {
          itemKey: item.key,
          reportedKcal: consistencyCheck.reported_kcal,
          expectedKcal: consistencyCheck.expected_kcal,
          deviationPct: consistencyCheck.deviation_pct,
          threshold: config.inv001BlockThresholdPct
        });
        
        // Emit critical alert
        alertItemFlaggedInv001(item.key, {
          expected_kcal: consistencyCheck.expected_kcal,
          reported_kcal: consistencyCheck.reported_kcal,
          deviation_pct: consistencyCheck.deviation_pct,
          severity: 'CRITICAL'
        }, { normalizedKey });
        
        // Throw immediately for >20% deviation
        throw new InvariantViolationError(
          'INV-001',
          `Item '${item.key}' has ${consistencyCheck.deviation_pct}% macro-kcal deviation (blocking threshold: ${config.inv001BlockThresholdPct}%)`,
          {
            itemKey: item.key,
            normalizedKey,
            reportedKcal: consistencyCheck.reported_kcal,
            expectedKcal: consistencyCheck.expected_kcal,
            deviationPct: consistencyCheck.deviation_pct,
            macros
          }
        );
      } else {
        // 5-20% deviation: FLAG item but continue
        log('warning', 'INV-001 WARNING: Macro-calorie inconsistency flagged', {
          itemKey: item.key,
          reportedKcal: consistencyCheck.reported_kcal,
          expectedKcal: consistencyCheck.expected_kcal,
          deviationPct: consistencyCheck.deviation_pct
        });
        
        // Emit warning alert
        alertItemFlaggedInv001(item.key, {
          expected_kcal: consistencyCheck.expected_kcal,
          reported_kcal: consistencyCheck.reported_kcal,
          deviation_pct: consistencyCheck.deviation_pct,
          severity: 'WARNING'
        }, { normalizedKey });
        
        // Flag the macros object
        macros = createFlaggedMacros(macros, consistencyCheck);
      }
    }
  }
  
  return macros;
}

/**
 * Creates a getItemMacros callback for reconciliation
 * 
 * @param {Map} nutritionMap - Map of normalizedKey → nutritionData
 * @param {Function} log - Traced logger function
 * @param {Object} config - Pipeline configuration
 * @returns {Function} getItemMacros callback
 */
function createGetItemMacrosCallback(nutritionMap, log, config = DEFAULT_CONFIG) {
  return function getItemMacros(item) {
    return computeItemMacros(item, nutritionMap, log, config);
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
 * 
 * @param {Object} dayPlan - Day plan object
 * @param {Function} getMacros - Callback to get macros
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Traced logger function
 * @returns {Object} { valid, critical, warnings, info }
 */
function runValidation(dayPlan, getMacros, config, log) {
  const result = validateDayPlan(dayPlan, getMacros);
  
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
 * @param {Function} retryFn - Function to call for retry
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
 * Returns BOTH 'kcal' and 'calories' for compatibility
 * 
 * @param {Array} meals - Array of meal objects
 * @param {Function} getItemMacros - Callback to compute item macros
 * @returns {Object} { kcal, calories, protein, fat, carbs }
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
  
  const kcalRounded = Math.round(totalKcal);
  
  return {
    kcal: kcalRounded,
    calories: kcalRounded,
    protein: Math.round(totalProtein * 10) / 10,
    fat: Math.round(totalFat * 10) / 10,
    carbs: Math.round(totalCarbs * 10) / 10
  };
}

/**
 * V2.2: Counts flagged items in meals array
 * 
 * @param {Array} meals - Array of meal objects
 * @param {Function} getItemMacros - Callback to compute item macros
 * @returns {{ flaggedCount: number, totalItems: number, flaggedRate: number }}
 */
function countFlaggedItems(meals, getItemMacros) {
  let flaggedCount = 0;
  let totalItems = 0;
  
  for (const meal of meals) {
    for (const item of meal.items) {
      totalItems++;
      const macros = getItemMacros(item);
      if (macros._flagged) {
        flaggedCount++;
      }
    }
  }
  
  const flaggedRate = totalItems > 0 ? (flaggedCount / totalItems) * 100 : 0;
  
  return { flaggedCount, totalItems, flaggedRate };
}

/**
 * Main pipeline execution function
 * V2.2: Now includes response-level blocking for flagged items
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
  const traceId = config.traceId || generateTraceId();
  const log = createTracedLogger(traceId, 'pipeline');
  
  log('info', 'Pipeline execution started', { traceId, targets });
  
  const debug = {
    traceId,
    stages: [],
    timings: {},
    inv001Stats: null  // V2.2: Track flagged items
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
    
    // Stage 5: Create macro callback (with INV-001 blocking)
    const getItemMacros = createGetItemMacrosCallback(nutritionMap, log, config);
    
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
    
    // V2.2: Stage 8.5 - Check for response-level blocking
    if (config.enableInv001Blocking) {
      const flaggedStats = countFlaggedItems(dailyResult.meals, getItemMacros);
      debug.inv001Stats = flaggedStats;
      
      log('info', 'INV-001 flagged items check', {
        flaggedCount: flaggedStats.flaggedCount,
        totalItems: flaggedStats.totalItems,
        flaggedRatePct: flaggedStats.flaggedRate.toFixed(2),
        threshold: config.responseBlockThresholdPct
      });
      
      if (flaggedStats.flaggedRate > config.responseBlockThresholdPct) {
        // BLOCK ENTIRE RESPONSE
        log('error', 'INV-001 RESPONSE BLOCKED: Too many items flagged', {
          flaggedCount: flaggedStats.flaggedCount,
          totalItems: flaggedStats.totalItems,
          flaggedRatePct: flaggedStats.flaggedRate.toFixed(2),
          threshold: config.responseBlockThresholdPct
        });
        
        // Emit critical alert
        alertResponseBlockedInv001(
          flaggedStats.flaggedCount,
          flaggedStats.totalItems,
          { traceId }
        );
        
        throw new InvariantViolationError(
          'INV-001-RESPONSE',
          `Response blocked: ${flaggedStats.flaggedRate.toFixed(1)}% of items have macro-kcal inconsistencies (threshold: ${config.responseBlockThresholdPct}%)`,
          {
            flaggedCount: flaggedStats.flaggedCount,
            totalItems: flaggedStats.totalItems,
            flaggedRatePct: flaggedStats.flaggedRate,
            threshold: config.responseBlockThresholdPct,
            traceId
          }
        );
      }
    }
    
    // Stage 9: Validation
    const startValidation = Date.now();
    const dayPlan = {
      meals: dailyResult.meals,
      dayTotals: dayTotals,
      targets: {
        kcal: targets.kcal,
        calories: targets.kcal,
        protein: targets.protein,
        fat: targets.fat,
        carbs: targets.carbs
      }
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
      dayTotals,
      inv001Stats: debug.inv001Stats
    });
    
    return {
      traceId,
      meals: dailyResult.meals,
      dayTotals,
      validation: validationResult,
      debug,
      data: {
        meals: dailyResult.meals,
        dayTotals,
        validation: validationResult
      },
      stats: {
        traceId,
        success: true,
        totalDuration: Object.values(debug.timings).reduce((a, b) => a + b, 0),
        stageDurations: debug.timings,
        inv001Stats: debug.inv001Stats
      }
    };
    
  } catch (error) {
    log('error', 'Pipeline execution failed', {
      traceId,
      error: error.message,
      isValidationError: error.isValidationError,
      isLLMValidationError: error.isLLMValidationError,
      isInvariantViolation: error.name === 'InvariantViolationError'
    });
    
    // Emit pipeline failure alert
    emitAlert(ALERT_LEVELS.CRITICAL, 'pipeline_failure', {
      traceId,
      error: error.message,
      invariantId: error.invariantId || null
    });
    
    throw error;
  }
}

module.exports = {
  // Main execution
  executePipeline,
  
  // Configuration
  DEFAULT_CONFIG,
  
  // Utility functions
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
  calculateDayTotals,
  countFlaggedItems  // V2.2: New export
};