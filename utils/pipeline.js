/**
 * utils/pipeline.js
 * 
 * Shared Pipeline Module for Cheffy
 * V3.0 - Added SSE callback support for real-time event streaming
 * 
 * PURPOSE:
 * Extracts common orchestration logic from generate-full-plan.js and day.js
 * into a single source of truth. Both orchestrators become thin wrappers
 * that call into this shared module.
 * 
 * V3.0 CHANGES:
 * - Added optional SSE callback parameters for real-time streaming
 * - onIngredientFound(key, data) - Called when ingredient lookup succeeds
 * - onIngredientFailed(key, reason) - Called when ingredient lookup fails
 * - onIngredientFlagged(key, violation) - Called when INV-001 flags an item
 * - onInvariantWarning(id, details) - Called for invariant warnings
 * - onValidationWarning(warnings) - Called for validation warnings
 * - Improved error context propagation
 * - Better integration with PipelineError class
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
  // INV-001 blocking configuration
  enableInv001Blocking: true,
  inv001FlagThresholdPct: 5,
  inv001BlockThresholdPct: 20,
  responseBlockThresholdPct: 20
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
 */
function normalizeItemState(item, log) {
  const { key, stateHint: llmStateHint, methodHint: llmMethodHint } = item;
  
  const resolution = resolveState(key);
  
  const finalState = resolution.state || llmStateHint || 'raw';
  const finalMethod = llmMethodHint || resolution.method || 'none';
  
  if (resolution.confidence === 'low' && log) {
    log('warning', 'Low confidence state resolution', {
      itemKey: key,
      resolvedState: finalState,
      llmHint: llmStateHint
    });
  }
  
  return {
    ...item,
    stateHint: finalState,
    methodHint: finalMethod,
    _stateResolution: {
      source: resolution.source,
      confidence: resolution.confidence,
      llmOverridden: llmStateHint && llmStateHint !== finalState
    }
  };
}

/**
 * Normalizes state hints for all items in all meals
 */
function normalizeAllItemStates(meals, log) {
  return meals.map(meal => ({
    ...meal,
    items: meal.items.map(item => normalizeItemState(item, log))
  }));
}

/**
 * Extracts unique ingredients from meals
 */
function extractUniqueIngredients(meals, log) {
  const seen = new Set();
  const ingredients = [];
  
  for (const meal of meals) {
    for (const item of meal.items) {
      const normalizedKey = normalizeKey(item.key);
      if (!seen.has(normalizedKey)) {
        seen.add(normalizedKey);
        ingredients.push({
          key: item.key,
          normalizedKey,
          stateHint: item.stateHint,
          methodHint: item.methodHint
        });
      }
    }
  }
  
  log('info', 'Extracted unique ingredients', { count: ingredients.length });
  return ingredients;
}

/**
 * Fetches nutrition data for all ingredients
 * V3.0: Added SSE callbacks for real-time updates
 */
async function fetchNutritionForIngredients(ingredients, log, callbacks = {}) {
  const nutritionMap = new Map();
  const { onIngredientFound, onIngredientFailed } = callbacks;
  
  let hotPathHits = 0;
  let canonicalHits = 0;
  let fallbackHits = 0;
  
  for (const ing of ingredients) {
    try {
      const result = await lookupIngredientNutrition(
        ing.key,
        ing.stateHint,
        ing.methodHint
      );
      
      if (result.source === 'hotpath') hotPathHits++;
      else if (result.source === 'canonical') canonicalHits++;
      else fallbackHits++;
      
      nutritionMap.set(ing.normalizedKey, result);
      
      // SSE callback for found ingredient
      if (onIngredientFound) {
        onIngredientFound(ing.key, {
          normalizedKey: ing.normalizedKey,
          nutrition: result,
          source: result.source
        });
      }
      
    } catch (err) {
      log('warning', 'Nutrition lookup failed', {
        itemKey: ing.key,
        error: err.message
      });
      
      // SSE callback for failed ingredient
      if (onIngredientFailed) {
        onIngredientFailed(ing.key, err.message);
      }
      
      // Store error marker
      nutritionMap.set(ing.normalizedKey, {
        error: true,
        message: err.message,
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0
      });
    }
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
 * Computes macros for a single item with INV-001 blocking
 * V3.0: Added SSE callback for flagged items
 */
function computeItemMacros(item, nutritionMap, log, config = DEFAULT_CONFIG, callbacks = {}) {
  const normalizedKey = normalizeKey(item.key);
  const { onIngredientFlagged } = callbacks;
  
  // Step 1: Normalize quantity to grams or ml
  const normalized = normalizeToGramsOrMl(item, log);
  
  // Defensive guard for invalid normalized value
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
    return {
      kcal: 0, protein: 0, fat: 0, carbs: 0,
      p: 0, f: 0, c: 0,
      grams_as_sold: 0,
      confidence: 'none',
      error: 'QUANTITY_INVALID',
      _errorDetail: { qty_value: item.qty_value, qty_unit: item.qty_unit }
    };
  }
  
  // Step 2: Get nutrition data
  const nutrition = nutritionMap.get(normalizedKey);
  
  if (!nutrition || nutrition.error) {
    log('warning', 'No nutrition data for item', { itemKey: item.key, normalizedKey });
    return {
      kcal: 0, protein: 0, fat: 0, carbs: 0,
      p: 0, f: 0, c: 0,
      grams_as_sold: 0,
      confidence: 'none',
      error: 'NUTRITION_NOT_FOUND'
    };
  }
  
  // Step 3: Transform to as-sold grams
  const asSold = toAsSold(
    normalized.value,
    normalized.unit,
    item.stateHint,
    item.methodHint,
    normalizedKey,
    log
  );
  
  // Defensive guard for invalid grams_as_sold
  if (asSold.grams_as_sold === undefined || asSold.grams_as_sold === null || Number.isNaN(asSold.grams_as_sold)) {
    log('error', 'INV-002 PREFLIGHT: Invalid grams_as_sold after transform', {
      itemKey: item.key,
      normalizedKey,
      normalized_value: normalized.value,
      grams_as_sold: asSold.grams_as_sold
    });
    emitAlert(ALERT_LEVELS.CRITICAL, 'grams_as_sold_invalid', {
      itemKey: item.key,
      normalizedKey,
      normalized_value: normalized.value,
      grams_as_sold: asSold.grams_as_sold
    });
    return {
      kcal: 0, protein: 0, fat: 0, carbs: 0,
      p: 0, f: 0, c: 0,
      grams_as_sold: 0,
      confidence: 'none',
      error: 'GRAMS_AS_SOLD_INVALID'
    };
  }
  
  // Step 4: Calculate macros
  const factor = asSold.grams_as_sold / 100;
  
  const proteinVal = Math.round(nutrition.protein * factor * 10) / 10;
  const fatVal = Math.round(nutrition.fat * factor * 10) / 10;
  const carbsVal = Math.round(nutrition.carbs * factor * 10) / 10;
  
  let macros = {
    kcal: Math.round(nutrition.calories * factor),
    protein: proteinVal,
    fat: fatVal,
    carbs: carbsVal,
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
  
  // Step 5: INV-001 Check with BLOCKING behavior
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
        
        alertItemFlaggedInv001(item.key, {
          expected_kcal: consistencyCheck.expected_kcal,
          reported_kcal: consistencyCheck.reported_kcal,
          deviation_pct: consistencyCheck.deviation_pct,
          severity: 'CRITICAL'
        }, { normalizedKey });
        
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
        
        alertItemFlaggedInv001(item.key, {
          expected_kcal: consistencyCheck.expected_kcal,
          reported_kcal: consistencyCheck.reported_kcal,
          deviation_pct: consistencyCheck.deviation_pct,
          severity: 'WARNING'
        }, { normalizedKey });
        
        // SSE callback for flagged item
        if (onIngredientFlagged) {
          onIngredientFlagged(item.key, {
            expected_kcal: consistencyCheck.expected_kcal,
            reported_kcal: consistencyCheck.reported_kcal,
            deviation_pct: consistencyCheck.deviation_pct
          });
        }
        
        macros = createFlaggedMacros(macros, consistencyCheck);
      }
    }
  }
  
  return macros;
}

/**
 * Creates a getItemMacros callback for reconciliation
 */
function createGetItemMacrosCallback(nutritionMap, log, config = DEFAULT_CONFIG, callbacks = {}) {
  return function getItemMacros(item) {
    return computeItemMacros(item, nutritionMap, log, config, callbacks);
  };
}

/**
 * Runs per-meal reconciliation to adjust calories
 */
function runMealReconciliation(meal, targetKcal, targetProtein, getItemMacros, tolerancePct, log) {
  const result = reconcileMealLevel(
    meal,
    targetKcal,
    targetProtein,
    getItemMacros,
    tolerancePct
  );
  
  if (result.factorApplied !== 1.0) {
    log('info', 'Meal reconciliation applied', {
      mealName: meal.name,
      factor: result.factorApplied,
      originalKcal: result.originalKcal,
      adjustedKcal: result.adjustedKcal
    });
    
    try {
      assertReconciliationBounds(result.factorApplied);
    } catch (err) {
      log('warning', 'Reconciliation factor out of bounds', {
        mealName: meal.name,
        factor: result.factorApplied,
        error: err.message
      });
    }
  }
  
  return result.meal;
}

/**
 * Runs daily reconciliation across all meals
 */
function runDailyReconciliation(meals, targetKcal, targetProtein, getItemMacros, tolerancePct, log) {
  const result = reconcileNonProtein(
    meals,
    targetKcal,
    targetProtein,
    getItemMacros,
    tolerancePct
  );
  
  log('info', 'Daily reconciliation complete', {
    originalKcal: result.originalKcal,
    adjustedKcal: result.adjustedKcal,
    factorApplied: result.factorApplied
  });
  
  return result;
}

/**
 * Runs validation on a day plan
 * V3.0: Added SSE callback for warnings
 */
function runValidation(dayPlan, getMacros, config, log, callbacks = {}) {
  const result = validateDayPlan(dayPlan, getMacros);
  const { onValidationWarning } = callbacks;
  
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
    
    // SSE callback for warnings
    if (onValidationWarning) {
      onValidationWarning(result.warnings);
    }
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
      try {
        currentOutput = await retryFn();
      } catch (e) {
        log('error', 'LLM retry failed', { error: e.message });
      }
    }
    
    attempts++;
  }
  
  const error = new Error(`LLM output validation failed after ${maxRetries} retries`);
  error.isLLMValidationError = true;
  throw error;
}

/**
 * Calculates day totals from processed meals
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
    calories: Math.round(totalKcal),
    protein: Math.round(totalProtein * 10) / 10,
    fat: Math.round(totalFat * 10) / 10,
    carbs: Math.round(totalCarbs * 10) / 10
  };
}

/**
 * Counts flagged items for response-level blocking
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
 * V3.0: Added SSE callback support
 * 
 * @param {Object} params - Pipeline parameters
 * @param {Array} params.rawMeals - Raw meals from LLM
 * @param {Object} params.targets - { kcal, protein, fat, carbs }
 * @param {Function} params.llmRetryFn - Function to retry LLM call
 * @param {Object} params.config - Pipeline configuration overrides
 * @param {Function} params.onIngredientFound - SSE callback for found ingredients
 * @param {Function} params.onIngredientFailed - SSE callback for failed ingredients
 * @param {Function} params.onIngredientFlagged - SSE callback for flagged ingredients
 * @param {Function} params.onInvariantWarning - SSE callback for invariant warnings
 * @param {Function} params.onValidationWarning - SSE callback for validation warnings
 * @returns {Object} { traceId, meals, dayTotals, validation, debug }
 */
async function executePipeline(params) {
  const {
    rawMeals,
    targets,
    llmRetryFn,
    config: configOverrides = {},
    // SSE callbacks
    onIngredientFound = null,
    onIngredientFailed = null,
    onIngredientFlagged = null,
    onInvariantWarning = null,
    onValidationWarning = null
  } = params;
  
  const callbacks = {
    onIngredientFound,
    onIngredientFailed,
    onIngredientFlagged,
    onInvariantWarning,
    onValidationWarning
  };
  
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const traceId = config.traceId || generateTraceId();
  const log = createTracedLogger(traceId, 'pipeline');
  
  log('info', 'Pipeline execution started', { traceId, targets });
  
  const debug = {
    traceId,
    stages: [],
    timings: {},
    inv001Stats: null
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
    
    // Stage 4: Fetch nutrition (with SSE callbacks)
    const startNutrition = Date.now();
    const nutritionMap = await fetchNutritionForIngredients(ingredients, log, callbacks);
    debug.timings.fetchNutrition = Date.now() - startNutrition;
    debug.stages.push('nutrition_fetch');
    
    // Stage 5: Create macro callback (with SSE callbacks)
    const getItemMacros = createGetItemMacrosCallback(nutritionMap, log, config, callbacks);
    
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
    
    // Stage 8.5: Check for response-level blocking
    if (config.enableInv001Blocking) {
      const flaggedStats = countFlaggedItems(dailyResult.meals, getItemMacros);
      debug.inv001Stats = flaggedStats;
      
      log('info', 'INV-001 flagged items check', {
        flaggedCount: flaggedStats.flaggedCount,
        totalItems: flaggedStats.totalItems,
        flaggedRatePct: flaggedStats.flaggedRate.toFixed(2),
        threshold: config.responseBlockThresholdPct
      });
      
      // Emit warning if approaching threshold
      if (flaggedStats.flaggedRate > 10 && flaggedStats.flaggedRate <= config.responseBlockThresholdPct) {
        if (onInvariantWarning) {
          onInvariantWarning('INV-001-RESPONSE', {
            message: `${flaggedStats.flaggedRate.toFixed(1)}% of items flagged for macro inconsistency`,
            flaggedCount: flaggedStats.flaggedCount,
            totalItems: flaggedStats.totalItems,
            threshold: config.responseBlockThresholdPct
          });
        }
      }
      
      if (flaggedStats.flaggedRate > config.responseBlockThresholdPct) {
        log('error', 'INV-001 RESPONSE BLOCKED: Too many items flagged', {
          flaggedCount: flaggedStats.flaggedCount,
          totalItems: flaggedStats.totalItems,
          flaggedRatePct: flaggedStats.flaggedRate.toFixed(2),
          threshold: config.responseBlockThresholdPct
        });
        
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
    
    // Stage 9: Validation (with SSE callbacks)
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
    
    const validationResult = runValidation(dayPlan, getItemMacros, config, log, callbacks);
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
  countFlaggedItems
};