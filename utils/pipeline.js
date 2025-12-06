// utils/pipeline.js
/**
 * utils/pipeline.js
 * 
 * Shared Pipeline Module for Cheffy
 * V3.1 - Added entry guard to prevent "meals is not iterable" error
 * 
 * PURPOSE:
 * Extracts common orchestration logic from generate-full-plan.js and day.js
 * into a single source of truth. Both orchestrators become thin wrappers
 * that call into this shared module.
 * 
 * V3.1 CHANGES:
 * - Added entry guard for rawMeals validation
 * - Defensive guards for NaN quantity propagation
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
 * @param {string} traceId - Trace ID for correlation
 * @param {string} module - Module name for log prefix
 * @returns {Function} Logger function
 */
function createTracedLogger(traceId, module = 'pipeline') {
  return (level, message, data = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      traceId,
      module,
      level,
      message,
      ...data
    };
    
    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warning') {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  };
}

/**
 * Normalizes item state based on stateHint and methodHint
 * @param {Object} item - Meal item
 * @returns {Object} Item with normalized state
 */
function normalizeItemState(item) {
  const resolvedState = resolveState(item.stateHint, item.methodHint, item.key);
  return {
    ...item,
    _resolvedState: resolvedState,
    _originalStateHint: item.stateHint,
    _originalMethodHint: item.methodHint
  };
}

/**
 * Normalizes all item states in meals array
 * @param {Array} meals - Array of meals
 * @returns {Array} Meals with normalized item states
 */
function normalizeAllItemStates(meals) {
  return meals.map(meal => ({
    ...meal,
    items: meal.items.map(normalizeItemState)
  }));
}

/**
 * Extracts unique ingredient keys from meals
 * @param {Array} meals - Array of meals
 * @returns {Set} Set of unique ingredient keys
 */
function extractUniqueIngredients(meals) {
  const uniqueKeys = new Set();
  
  for (const meal of meals) {
    for (const item of meal.items) {
      const normalizedKey = normalizeKey(item.key);
      uniqueKeys.add(normalizedKey);
    }
  }
  
  return uniqueKeys;
}

/**
 * Fetches nutrition data for all unique ingredients
 * @param {Set} ingredientKeys - Set of ingredient keys
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Logger function
 * @param {Object} callbacks - SSE callbacks
 * @returns {Map} Map of ingredient key to nutrition data
 */
async function fetchNutritionForIngredients(ingredientKeys, config, log, callbacks = {}) {
  const nutritionMap = new Map();
  const { onIngredientFound, onIngredientFailed } = callbacks;
  
  const lookupPromises = Array.from(ingredientKeys).map(async (key) => {
    try {
      const nutrition = await lookupIngredientNutrition(key, config.store);
      
      if (nutrition) {
        nutritionMap.set(key, nutrition);
        log('debug', 'Nutrition found', { key, kcalPer100g: nutrition.kcal_per_100g });
        
        if (onIngredientFound) {
          onIngredientFound(key, {
            kcalPer100g: nutrition.kcal_per_100g,
            proteinPer100g: nutrition.protein_per_100g,
            source: nutrition.source
          });
        }
      } else {
        log('warning', 'Nutrition not found', { key });
        
        if (onIngredientFailed) {
          onIngredientFailed(key, 'Nutrition data not found in database');
        }
      }
    } catch (error) {
      log('error', 'Nutrition lookup failed', { key, error: error.message });
      
      if (onIngredientFailed) {
        onIngredientFailed(key, error.message);
      }
    }
  });
  
  await Promise.all(lookupPromises);
  
  return nutritionMap;
}

/**
 * Computes macros for a single item
 * V3.1: Added defensive guards for NaN quantity propagation
 * 
 * @param {Object} item - Meal item with qty_value, qty_unit, key
 * @param {Map} nutritionMap - Map of ingredient key to nutrition data
 * @param {Function} log - Logger function
 * @param {Object} callbacks - SSE callbacks
 * @returns {Object} Computed macros { kcal, protein, fat, carbs, _flagged, _source }
 */
function computeItemMacros(item, nutritionMap, log, callbacks = {}) {
  const { onIngredientFlagged, onInvariantWarning } = callbacks;
  const normalizedKey = normalizeKey(item.key);
  const nutrition = nutritionMap.get(normalizedKey);
  
  // V3.1: Defensive guard - validate qty_value before computation
  let safeQtyValue = item.qty_value;
  if (typeof safeQtyValue !== 'number' || isNaN(safeQtyValue)) {
    log('warning', 'Invalid qty_value detected, defaulting to 0', {
      key: item.key,
      originalValue: item.qty_value,
      type: typeof item.qty_value
    });
    safeQtyValue = 0;
  }
  
  if (safeQtyValue < 0) {
    log('warning', 'Negative qty_value detected, using absolute value', {
      key: item.key,
      originalValue: safeQtyValue
    });
    safeQtyValue = Math.abs(safeQtyValue);
  }
  
  if (!nutrition) {
    log('warning', 'No nutrition data for item', { key: item.key });
    return {
      kcal: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      _flagged: false,
      _source: 'missing'
    };
  }
  
  // Convert to grams for consistent calculation
  let gramsAsSold;
  try {
    const normalized = normalizeToGramsOrMl(safeQtyValue, item.qty_unit, item.key);
    gramsAsSold = toAsSold(normalized, item._resolvedState || item.stateHint, item.key);
  } catch (error) {
    log('warning', 'Unit conversion failed', { key: item.key, error: error.message });
    gramsAsSold = safeQtyValue; // Fallback to raw value
  }
  
  // V3.1: Guard against NaN in gramsAsSold
  if (typeof gramsAsSold !== 'number' || isNaN(gramsAsSold)) {
    log('warning', 'gramsAsSold is NaN after conversion', {
      key: item.key,
      qty_value: safeQtyValue,
      qty_unit: item.qty_unit,
      resolvedState: item._resolvedState
    });
    gramsAsSold = 0;
  }
  
  // Calculate macros based on per-100g values
  const factor = gramsAsSold / 100;
  
  const rawKcal = (nutrition.kcal_per_100g || 0) * factor;
  const rawProtein = (nutrition.protein_per_100g || 0) * factor;
  const rawFat = (nutrition.fat_per_100g || 0) * factor;
  const rawCarbs = (nutrition.carbs_per_100g || 0) * factor;
  
  // V3.1: Final NaN guard on computed values
  const kcal = isNaN(rawKcal) ? 0 : Math.round(rawKcal * 10) / 10;
  const protein = isNaN(rawProtein) ? 0 : Math.round(rawProtein * 100) / 100;
  const fat = isNaN(rawFat) ? 0 : Math.round(rawFat * 100) / 100;
  const carbs = isNaN(rawCarbs) ? 0 : Math.round(rawCarbs * 100) / 100;
  
  // INV-001: Check macro-calorie consistency
  const consistencyResult = checkMacroCalorieConsistency(
    { kcal, protein, fat, carbs },
    item.key,
    log
  );
  
  if (!consistencyResult.isConsistent) {
    log('warning', 'INV-001: Macro-calorie inconsistency detected', {
      key: item.key,
      reported: { kcal, protein, fat, carbs },
      computed: consistencyResult.computedKcal,
      deviation: consistencyResult.deviation
    });
    
    if (onIngredientFlagged) {
      onIngredientFlagged(item.key, {
        invariantId: 'INV-001',
        reportedKcal: kcal,
        computedKcal: consistencyResult.computedKcal,
        deviation: consistencyResult.deviation
      });
    }
    
    alertItemFlaggedInv001(item.key, {
      reported: { kcal, protein, fat, carbs },
      computed: consistencyResult.computedKcal,
      deviation: consistencyResult.deviation
    });
    
    return createFlaggedMacros(
      { kcal, protein, fat, carbs },
      consistencyResult,
      nutrition.source || 'lookup'
    );
  }
  
  return {
    kcal,
    protein,
    fat,
    carbs,
    _flagged: false,
    _source: nutrition.source || 'lookup',
    _gramsAsSold: gramsAsSold
  };
}

/**
 * Creates a callback function for getting item macros
 * @param {Map} nutritionMap - Map of ingredient key to nutrition data
 * @param {Map} macroCache - Cache for computed macros
 * @param {Function} log - Logger function
 * @param {Object} callbacks - SSE callbacks
 * @returns {Function} getItemMacros callback
 */
function createGetItemMacrosCallback(nutritionMap, macroCache, log, callbacks = {}) {
  return (item) => {
    const cacheKey = `${item.key}:${item.qty_value}:${item.qty_unit}:${item._resolvedState || item.stateHint}`;
    
    if (macroCache.has(cacheKey)) {
      return macroCache.get(cacheKey);
    }
    
    const macros = computeItemMacros(item, nutritionMap, log, callbacks);
    macroCache.set(cacheKey, macros);
    
    return macros;
  };
}

/**
 * Runs meal-level reconciliation
 * @param {Array} meals - Array of meals
 * @param {Object} targets - Daily targets { kcal, protein, fat, carbs }
 * @param {Function} getItemMacros - Callback to get item macros
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Logger function
 * @returns {Object} Reconciliation result
 */
function runMealReconciliation(meals, targets, getItemMacros, config, log) {
  const reconciled = [];
  
  for (const meal of meals) {
    const mealTarget = {
      kcal: targets.kcal / meals.length,
      protein: targets.protein / meals.length,
      fat: targets.fat / meals.length,
      carbs: targets.carbs / meals.length
    };
    
    try {
      const reconciledMeal = reconcileMealLevel(meal, mealTarget, getItemMacros, config);
      reconciled.push(reconciledMeal);
    } catch (error) {
      log('warning', 'Meal reconciliation failed', { mealName: meal.name, error: error.message });
      reconciled.push(meal); // Use original if reconciliation fails
    }
  }
  
  return { meals: reconciled };
}

/**
 * Runs daily-level reconciliation
 * @param {Array} meals - Array of meals
 * @param {Object} targets - Daily targets
 * @param {Function} getItemMacros - Callback to get item macros
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Logger function
 * @returns {Object} Reconciliation result
 */
function runDailyReconciliation(meals, targets, getItemMacros, config, log) {
  try {
    const result = reconcileNonProtein(meals, targets, getItemMacros, config);
    
    // Assert reconciliation bounds
    assertReconciliationBounds(result, targets, config.reconciliationTolerancePct);
    
    return result;
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      log('error', 'Reconciliation invariant violated', {
        invariantId: error.invariantId,
        message: error.message,
        context: error.context
      });
      throw error;
    }
    
    log('warning', 'Daily reconciliation failed', { error: error.message });
    return { meals };
  }
}

/**
 * Runs validation on day plan
 * @param {Object} dayPlan - Day plan with meals and dayTotals
 * @param {Function} getItemMacros - Callback to get item macros
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Logger function
 * @param {Object} callbacks - SSE callbacks
 * @returns {Object} Validation result
 */
function runValidation(dayPlan, getItemMacros, config, log, callbacks = {}) {
  const { onValidationWarning } = callbacks;
  
  try {
    const validationResult = validateDayPlan(dayPlan, getItemMacros, config);
    
    if (validationResult.warnings && validationResult.warnings.length > 0) {
      log('warning', 'Validation warnings', { warnings: validationResult.warnings });
      
      if (onValidationWarning) {
        onValidationWarning('Validation completed with warnings', {
          warnings: validationResult.warnings
        });
      }
    }
    
    return validationResult;
  } catch (error) {
    log('error', 'Validation failed', { error: error.message });
    
    if (config.enableBlockingValidation) {
      throw error;
    }
    
    return { valid: false, errors: [error.message], warnings: [] };
  }
}

/**
 * Validates LLM output with retry logic
 * @param {any} output - LLM output to validate
 * @param {string} schemaName - Schema name
 * @param {Function} retryFn - Function to retry LLM call
 * @param {number} maxRetries - Maximum retries
 * @param {Function} log - Logger function
 * @returns {Array} Validated and corrected output
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
 * @param {Array} meals - Array of processed meals
 * @param {Function} getItemMacros - Callback to get item macros
 * @returns {Object} Day totals { kcal, calories, protein, fat, carbs }
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
 * @param {Array} meals - Array of meals
 * @param {Function} getItemMacros - Callback to get item macros
 * @returns {Object} { flaggedCount, totalItems, flaggedRate }
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
 * V3.1: Added entry guard to prevent "meals is not iterable" error
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // V3.1: ENTRY GUARD - Prevent "meals is not iterable" error
  // ═══════════════════════════════════════════════════════════════════════════
  if (!Array.isArray(rawMeals)) {
    const errorMsg = `executePipeline requires rawMeals to be an array, got ${typeof rawMeals}`;
    log('error', 'Pipeline entry guard failed', {
      traceId,
      receivedType: typeof rawMeals,
      receivedValue: rawMeals === null ? 'null' : rawMeals === undefined ? 'undefined' : 'object',
      dayNumber: config.dayNumber
    });
    
    throw new InvariantViolationError(
      'INV-ENTRY',
      errorMsg,
      { 
        receivedType: typeof rawMeals,
        traceId,
        dayNumber: config.dayNumber 
      }
    );
  }
  
  if (rawMeals.length === 0) {
    const errorMsg = 'executePipeline received empty rawMeals array';
    log('error', 'Pipeline entry guard failed - empty array', { traceId, dayNumber: config.dayNumber });
    
    throw new InvariantViolationError(
      'INV-ENTRY',
      errorMsg,
      { traceId, dayNumber: config.dayNumber }
    );
  }
  // ═══════════════════════════════════════════════════════════════════════════
  
  log('info', 'Pipeline execution started', { traceId, targets, mealsCount: rawMeals.length });
  
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
    const normalizedMeals = normalizeAllItemStates(validatedMeals);
    debug.timings.normalize = Date.now() - startNormalize;
    debug.stages.push('state_normalization');
    
    // Stage 3: Extract unique ingredients
    const startExtract = Date.now();
    const uniqueIngredients = extractUniqueIngredients(normalizedMeals);
    debug.timings.extract = Date.now() - startExtract;
    debug.stages.push('ingredient_extraction');
    
    log('info', 'Unique ingredients extracted', { count: uniqueIngredients.size });
    
    // Stage 4: Fetch nutrition data
    const startNutrition = Date.now();
    const nutritionMap = await fetchNutritionForIngredients(
      uniqueIngredients,
      config,
      log,
      callbacks
    );
    debug.timings.nutrition = Date.now() - startNutrition;
    debug.stages.push('nutrition_lookup');
    
    log('info', 'Nutrition data fetched', { 
      found: nutritionMap.size, 
      total: uniqueIngredients.size 
    });
    
    // Stage 5: Create macro computation callback
    const macroCache = new Map();
    const getItemMacros = createGetItemMacrosCallback(nutritionMap, macroCache, log, callbacks);
    
    // Stage 6: Run meal-level reconciliation
    const startMealRecon = Date.now();
    const mealReconResult = runMealReconciliation(
      normalizedMeals,
      targets,
      getItemMacros,
      config,
      log
    );
    debug.timings.mealReconciliation = Date.now() - startMealRecon;
    debug.stages.push('meal_reconciliation');
    
    // Stage 7: Run daily reconciliation
    const startDailyRecon = Date.now();
    const dailyResult = runDailyReconciliation(
      mealReconResult.meals,
      targets,
      getItemMacros,
      config,
      log
    );
    debug.timings.dailyReconciliation = Date.now() - startDailyRecon;
    debug.stages.push('daily_reconciliation');
    
    // Stage 8: Calculate day totals
    const dayTotals = calculateDayTotals(dailyResult.meals, getItemMacros);
    
    // Stage 8b: Check INV-001 response-level blocking
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