// utils/pipeline.js
/**
 * utils/pipeline.js
 * 
 * Shared Pipeline Module for Cheffy
 * V3.3.1 - Fixed log parameter for lookupIngredientNutrition
 * 
 * PURPOSE:
 * Extracts common orchestration logic from generate-full-plan.js and day.js
 * into a single source of truth. Both orchestrators become thin wrappers
 * that call into this shared module.
 * 
 * V3.3.1 CHANGES:
 * - CRITICAL FIX: Pass log function to lookupIngredientNutrition (was causing "log is not a function")
 * - Added createLogAdapter() to bridge pipeline log format (level, message, data) 
 *   with orchestrator format (message, level, module)
 * 
 * V3.3 CHANGES:
 * - CRITICAL FIX: computeItemMacros() now returns BOTH formats:
 *   {protein, fat, carbs} for frontend AND {p, f, c} for reconciliation
 * - Added enhanceItemsWithMacros() to attach computed macros to item objects
 * - Added sanitizeOutputMeals() to validate all items before return
 * - Added sanitizeNumber() helper to prevent NaN/undefined propagation
 * - Output validation ensures frontend receives complete data
 * 
 * V3.2 CHANGES:
 * - Added defensive guards in normalizeAllItemStates()
 * - Added defensive guards in extractUniqueIngredients()
 * - Added defensive guards in calculateDayTotals()
 * - Added defensive guards in countFlaggedItems()
 * - Added defensive guards in runMealReconciliation()
 * - Added defensive guards in runDailyReconciliation()
 * - Added validateMealStructure() helper function
 * - Added validateAllMealStructures() for pipeline entry
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

// ═══════════════════════════════════════════════════════════════════════════
// V3.3: SANITIZATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely converts a value to a valid number, defaulting to 0 if invalid
 * @param {any} value - Value to sanitize
 * @param {number} defaultValue - Default if invalid (default: 0)
 * @returns {number} Valid number
 */
function sanitizeNumber(value, defaultValue = 0) {
  if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

/**
 * Rounds a number to specified decimal places
 * @param {number} value - Value to round
 * @param {number} decimals - Decimal places (default: 1)
 * @returns {number} Rounded value
 */
function roundTo(value, decimals = 1) {
  const factor = Math.pow(10, decimals);
  return Math.round(sanitizeNumber(value) * factor) / factor;
}

// ═══════════════════════════════════════════════════════════════════════════
// V3.2: MEAL STRUCTURE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates that a meal object has the required structure
 * @param {any} meal - Meal object to validate
 * @returns {Object} { valid: boolean, reason: string }
 */
function validateMealStructure(meal) {
  if (!meal) {
    return { valid: false, reason: 'meal_is_null_or_undefined' };
  }
  
  if (typeof meal !== 'object') {
    return { valid: false, reason: `meal_is_not_object_got_${typeof meal}` };
  }
  
  if (!Array.isArray(meal.items)) {
    return { valid: false, reason: 'meal_items_is_not_array' };
  }
  
  if (meal.items.length === 0) {
    return { valid: false, reason: 'meal_items_is_empty_array' };
  }
  
  return { valid: true, reason: 'valid' };
}

/**
 * Validates all meals in array have required structure
 * @param {Array} meals - Array of meals to validate
 * @param {Function} log - Logger function
 * @returns {Object} { valid: boolean, invalidMeals: Array, validMeals: Array }
 */
function validateAllMealStructures(meals, log) {
  const invalidMeals = [];
  const validMeals = [];
  
  for (let i = 0; i < meals.length; i++) {
    const meal = meals[i];
    const validation = validateMealStructure(meal);
    
    if (validation.valid) {
      validMeals.push(meal);
    } else {
      invalidMeals.push({
        index: i,
        mealName: meal?.name || meal?.type || `meal_${i}`,
        reason: validation.reason
      });
      
      if (log) {
        log('warning', 'Invalid meal structure detected', {
          index: i,
          mealName: meal?.name || meal?.type || `meal_${i}`,
          reason: validation.reason,
          hasItems: 'items' in (meal || {}),
          itemsType: meal?.items === null ? 'null' : typeof meal?.items
        });
      }
    }
  }
  
  return {
    valid: invalidMeals.length === 0,
    invalidMeals,
    validMeals,
    totalMeals: meals.length,
    validCount: validMeals.length,
    invalidCount: invalidMeals.length
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalizes item state based on stateHint and methodHint
 * @param {Object} item - Meal item
 * @returns {Object} Item with normalized state
 */
function normalizeItemState(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  
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
 * V3.2: Added defensive guard for meal.items
 * 
 * @param {Array} meals - Array of meals
 * @param {Function} log - Optional logger function
 * @returns {Array} Meals with normalized item states
 */
function normalizeAllItemStates(meals, log = null) {
  if (!Array.isArray(meals)) {
    if (log) log('error', 'normalizeAllItemStates received non-array', { type: typeof meals });
    return [];
  }
  
  return meals.map((meal, index) => {
    if (!meal || typeof meal !== 'object') {
      if (log) log('warning', 'Skipping invalid meal object', { index, type: typeof meal });
      return meal;
    }
    
    if (!Array.isArray(meal.items)) {
      if (log) {
        log('warning', 'meal.items is not an array, defaulting to empty', {
          index,
          mealName: meal.name || meal.type || `meal_${index}`,
          itemsType: meal.items === null ? 'null' : typeof meal.items
        });
      }
      return {
        ...meal,
        items: []
      };
    }
    
    return {
      ...meal,
      items: meal.items.map((item, itemIndex) => {
        if (!item || typeof item !== 'object') {
          if (log) {
            log('warning', 'Skipping invalid item object', {
              mealIndex: index,
              itemIndex,
              type: typeof item
            });
          }
          return item;
        }
        return normalizeItemState(item);
      }).filter(item => item && typeof item === 'object')
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INGREDIENT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extracts unique ingredient keys from meals
 * V3.2: Added defensive guard for meal.items
 * 
 * @param {Array} meals - Array of meals
 * @param {Function} log - Optional logger function
 * @returns {Set} Set of unique ingredient keys
 */
function extractUniqueIngredients(meals, log = null) {
  const uniqueKeys = new Set();
  
  if (!Array.isArray(meals)) {
    if (log) log('error', 'extractUniqueIngredients received non-array', { type: typeof meals });
    return uniqueKeys;
  }
  
  for (let mealIndex = 0; mealIndex < meals.length; mealIndex++) {
    const meal = meals[mealIndex];
    
    if (!meal || typeof meal !== 'object') {
      if (log) log('warning', 'Skipping invalid meal in extractUniqueIngredients', { mealIndex });
      continue;
    }
    
    if (!Array.isArray(meal.items)) {
      if (log) {
        log('warning', 'meal.items not iterable in extractUniqueIngredients', {
          mealIndex,
          mealName: meal.name || meal.type || `meal_${mealIndex}`,
          itemsType: meal.items === null ? 'null' : typeof meal.items
        });
      }
      continue;
    }
    
    for (const item of meal.items) {
      if (!item || typeof item !== 'object' || !item.key) {
        continue;
      }
      const normalizedKey = normalizeKey(item.key);
      uniqueKeys.add(normalizedKey);
    }
  }
  
  return uniqueKeys;
}

// ═══════════════════════════════════════════════════════════════════════════
// NUTRITION FETCHING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a log adapter that works with both logging conventions:
 * - Pipeline format: (level, message, data)
 * - Orchestrator format: (message, level, module)
 * 
 * @param {Function} pipelineLog - Pipeline-style logger
 * @returns {Function} Adapter that works with orchestrator-style calls
 */
function createLogAdapter(pipelineLog) {
  return function adaptedLog(messageOrLevel, levelOrMessage, dataOrModule) {
    // Detect which format is being used
    const knownLevels = ['debug', 'info', 'warning', 'warn', 'error', 'INFO', 'WARN', 'ERROR', 'DEBUG'];
    
    if (knownLevels.includes(messageOrLevel)) {
      // Pipeline format: (level, message, data)
      pipelineLog(messageOrLevel, levelOrMessage, dataOrModule || {});
    } else if (knownLevels.includes(levelOrMessage)) {
      // Orchestrator format: (message, level, module)
      const level = levelOrMessage.toLowerCase();
      pipelineLog(level, messageOrLevel, { module: dataOrModule || 'nutrition' });
    } else {
      // Fallback: treat as info message
      pipelineLog('info', String(messageOrLevel), { context: levelOrMessage });
    }
  };
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
  
  // V3.3.1: Create log adapter for lookupIngredientNutrition which uses orchestrator format
  const nutritionLog = createLogAdapter(log);
  
  const lookupPromises = Array.from(ingredientKeys).map(async (key) => {
    try {
      // V3.3.1: Pass log adapter as third parameter
      const nutrition = await lookupIngredientNutrition(key, config.store, nutritionLog);
      
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

// ═══════════════════════════════════════════════════════════════════════════
// V3.3: MACRO COMPUTATION - DUAL FORMAT OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Computes macros for a single item
 * V3.3: Returns BOTH formats for compatibility:
 *   - {protein, fat, carbs} for frontend
 *   - {p, f, c} for reconciliation module
 * V3.1: Added defensive guards for NaN quantity propagation
 * 
 * @param {Object} item - Meal item with qty_value, qty_unit, key
 * @param {Map} nutritionMap - Map of ingredient key to nutrition data
 * @param {Function} log - Logger function
 * @param {Object} callbacks - SSE callbacks
 * @returns {Object} Computed macros with both formats
 */
function computeItemMacros(item, nutritionMap, log, callbacks = {}) {
  const { onIngredientFlagged, onInvariantWarning } = callbacks;
  
  // V3.3: Default return with both formats (all zeros)
  const defaultMacros = {
    kcal: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    // Aliases for reconciliation module
    p: 0,
    f: 0,
    c: 0,
    _flagged: false,
    _source: 'default'
  };
  
  if (!item || typeof item !== 'object') {
    log('warning', 'computeItemMacros received invalid item', { type: typeof item });
    return { ...defaultMacros, _source: 'invalid_item' };
  }
  
  const normalizedKey = normalizeKey(item.key || '');
  const nutrition = nutritionMap.get(normalizedKey);
  
  // V3.1: Sanitize qty_value
  let safeQtyValue = sanitizeNumber(item.qty_value, 0);
  
  // V3.3: Also check for 'qty' field (reconciliation uses this)
  if (safeQtyValue === 0) {
    safeQtyValue = sanitizeNumber(item.qty, 0);
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
    return { ...defaultMacros, _source: 'missing' };
  }
  
  // Convert to grams for consistent calculation
  let gramsAsSold;
  try {
    const normalized = normalizeToGramsOrMl(safeQtyValue, item.qty_unit || item.unit, item.key);
    gramsAsSold = toAsSold(normalized, item._resolvedState || item.stateHint, item.key);
  } catch (error) {
    log('warning', 'Unit conversion failed', { key: item.key, error: error.message });
    gramsAsSold = safeQtyValue;
  }
  
  // V3.1: Guard against NaN in gramsAsSold
  gramsAsSold = sanitizeNumber(gramsAsSold, 0);
  
  // Calculate macros based on per-100g values
  const factor = gramsAsSold / 100;
  
  const rawKcal = sanitizeNumber(nutrition.kcal_per_100g, 0) * factor;
  const rawProtein = sanitizeNumber(nutrition.protein_per_100g, 0) * factor;
  const rawFat = sanitizeNumber(nutrition.fat_per_100g, 0) * factor;
  const rawCarbs = sanitizeNumber(nutrition.carbs_per_100g, 0) * factor;
  
  // V3.3: Round and ensure valid numbers
  const kcal = roundTo(rawKcal, 1);
  const protein = roundTo(rawProtein, 2);
  const fat = roundTo(rawFat, 2);
  const carbs = roundTo(rawCarbs, 2);
  
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
    
    const flaggedMacros = createFlaggedMacros(
      { kcal, protein, fat, carbs },
      consistencyResult,
      nutrition.source || 'lookup'
    );
    
    // V3.3: Add aliases for reconciliation
    return {
      ...flaggedMacros,
      p: sanitizeNumber(flaggedMacros.protein, 0),
      f: sanitizeNumber(flaggedMacros.fat, 0),
      c: sanitizeNumber(flaggedMacros.carbs, 0),
      _gramsAsSold: gramsAsSold
    };
  }
  
  // V3.3: Return both formats
  return {
    kcal,
    protein,
    fat,
    carbs,
    // Aliases for reconciliation module (expects p, f, c)
    p: protein,
    f: fat,
    c: carbs,
    _flagged: false,
    _source: nutrition.source || 'lookup',
    _gramsAsSold: gramsAsSold
  };
}

/**
 * Creates a callback function for getting item macros
 * Uses caching to avoid recomputation
 * 
 * @param {Map} nutritionMap - Map of ingredient key to nutrition data
 * @param {Map} macroCache - Cache for computed macros
 * @param {Function} log - Logger function
 * @param {Object} callbacks - SSE callbacks
 * @returns {Function} getItemMacros callback
 */
function createGetItemMacrosCallback(nutritionMap, macroCache, log, callbacks = {}) {
  return (item) => {
    if (!item || typeof item !== 'object') {
      return {
        kcal: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        p: 0,
        f: 0,
        c: 0,
        _flagged: false,
        _source: 'invalid_item'
      };
    }
    
    const cacheKey = `${item.key || 'unknown'}:${item.qty_value || item.qty || 0}:${item.qty_unit || item.unit || 'g'}:${item._resolvedState || item.stateHint || 'raw'}`;
    
    if (macroCache.has(cacheKey)) {
      return macroCache.get(cacheKey);
    }
    
    const macros = computeItemMacros(item, nutritionMap, log, callbacks);
    macroCache.set(cacheKey, macros);
    
    return macros;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// V3.3: MACRO ENHANCEMENT - ATTACH MACROS TO ITEMS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhances all items in meals by attaching computed macros directly to each item.
 * This ensures the frontend receives items with kcal, protein, fat, carbs properties.
 * 
 * @param {Array} meals - Array of meals with items
 * @param {Function} getItemMacros - Callback to get macros for an item
 * @param {Function} log - Logger function
 * @returns {Array} Meals with macros attached to each item
 */
function enhanceItemsWithMacros(meals, getItemMacros, log) {
  if (!Array.isArray(meals)) {
    log('error', 'enhanceItemsWithMacros received non-array', { type: typeof meals });
    return [];
  }
  
  return meals.map((meal, mealIndex) => {
    if (!meal || typeof meal !== 'object') {
      log('warning', 'Skipping invalid meal in enhanceItemsWithMacros', { mealIndex });
      return meal;
    }
    
    if (!Array.isArray(meal.items)) {
      log('warning', 'meal.items not iterable in enhanceItemsWithMacros', {
        mealIndex,
        mealName: meal.name || meal.type || `meal_${mealIndex}`
      });
      return {
        ...meal,
        items: []
      };
    }
    
    const enhancedItems = meal.items.map((item, itemIndex) => {
      if (!item || typeof item !== 'object') {
        log('warning', 'Skipping invalid item in enhanceItemsWithMacros', {
          mealIndex,
          itemIndex
        });
        return null;
      }
      
      const macros = getItemMacros(item);
      
      // V3.3: Merge item with macros, ensuring frontend-required fields exist
      return {
        ...item,
        // Overwrite/add macro fields from computed values
        kcal: sanitizeNumber(macros.kcal, 0),
        protein: sanitizeNumber(macros.protein, 0),
        fat: sanitizeNumber(macros.fat, 0),
        carbs: sanitizeNumber(macros.carbs, 0),
        // Preserve internal fields
        _flagged: macros._flagged || false,
        _source: macros._source || 'unknown'
      };
    }).filter(item => item !== null);
    
    return {
      ...meal,
      items: enhancedItems
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// V3.3: OUTPUT SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates and sanitizes a single item, ensuring all required fields exist
 * @param {Object} item - Item to sanitize
 * @param {Function} log - Logger function
 * @returns {Object} Sanitized item
 */
function sanitizeItem(item, log) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  
  // Ensure required fields exist with valid values
  const sanitized = {
    ...item,
    key: item.key || 'unknown',
    qty_value: sanitizeNumber(item.qty_value || item.qty, 0),
    qty_unit: item.qty_unit || item.unit || 'g',
    kcal: sanitizeNumber(item.kcal, 0),
    protein: sanitizeNumber(item.protein, 0),
    fat: sanitizeNumber(item.fat, 0),
    carbs: sanitizeNumber(item.carbs, 0)
  };
  
  // Warn if macros are all zero (might indicate a problem)
  if (sanitized.kcal === 0 && sanitized.protein === 0 && sanitized.fat === 0 && sanitized.carbs === 0) {
    log('warning', 'Item has all-zero macros after sanitization', {
      key: sanitized.key,
      qty_value: sanitized.qty_value
    });
  }
  
  return sanitized;
}

/**
 * Sanitizes all meals and items, ensuring valid output for frontend
 * @param {Array} meals - Array of meals
 * @param {Function} log - Logger function
 * @returns {Object} { meals: Array, stats: Object }
 */
function sanitizeOutputMeals(meals, log) {
  const stats = {
    totalMeals: 0,
    totalItems: 0,
    itemsWithZeroMacros: 0,
    itemsRemoved: 0
  };
  
  if (!Array.isArray(meals)) {
    log('error', 'sanitizeOutputMeals received non-array', { type: typeof meals });
    return { meals: [], stats };
  }
  
  const sanitizedMeals = meals.map((meal, mealIndex) => {
    if (!meal || typeof meal !== 'object') {
      log('warning', 'Removing invalid meal in sanitizeOutputMeals', { mealIndex });
      return null;
    }
    
    stats.totalMeals++;
    
    if (!Array.isArray(meal.items)) {
      log('warning', 'Meal has no items array', {
        mealIndex,
        mealName: meal.name || meal.type
      });
      return {
        ...meal,
        name: meal.name || `Meal ${mealIndex + 1}`,
        type: meal.type || 'meal',
        items: []
      };
    }
    
    const sanitizedItems = meal.items
      .map(item => {
        const sanitized = sanitizeItem(item, log);
        if (sanitized) {
          stats.totalItems++;
          if (sanitized.kcal === 0 && sanitized.protein === 0) {
            stats.itemsWithZeroMacros++;
          }
        } else {
          stats.itemsRemoved++;
        }
        return sanitized;
      })
      .filter(item => item !== null);
    
    return {
      ...meal,
      name: meal.name || `Meal ${mealIndex + 1}`,
      type: meal.type || 'meal',
      items: sanitizedItems
    };
  }).filter(meal => meal !== null);
  
  log('info', 'Output sanitization complete', stats);
  
  return { meals: sanitizedMeals, stats };
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs meal-level reconciliation
 * V3.2: Added defensive guard for meal.items
 * 
 * @param {Array} meals - Array of meals
 * @param {Object} targets - Daily targets { kcal, protein, fat, carbs }
 * @param {Function} getItemMacros - Callback to get item macros
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Logger function
 * @returns {Object} Reconciliation result
 */
function runMealReconciliation(meals, targets, getItemMacros, config, log) {
  if (!Array.isArray(meals)) {
    log('error', 'runMealReconciliation received non-array meals', { type: typeof meals });
    return { meals: [] };
  }
  
  const reconciled = [];
  const validMealCount = meals.filter(m => m && Array.isArray(m?.items) && m.items.length > 0).length;
  
  for (let i = 0; i < meals.length; i++) {
    const meal = meals[i];
    
    if (!meal || typeof meal !== 'object') {
      log('warning', 'Skipping invalid meal in reconciliation', { index: i });
      continue;
    }
    
    if (!Array.isArray(meal.items)) {
      log('warning', 'meal.items not iterable in reconciliation, skipping', {
        index: i,
        mealName: meal.name || meal.type || `meal_${i}`,
        itemsType: meal.items === null ? 'null' : typeof meal.items
      });
      reconciled.push({
        ...meal,
        items: []
      });
      continue;
    }
    
    if (meal.items.length === 0) {
      log('warning', 'meal.items is empty array in reconciliation', {
        index: i,
        mealName: meal.name || meal.type || `meal_${i}`
      });
      reconciled.push(meal);
      continue;
    }
    
    const divisor = validMealCount > 0 ? validMealCount : 1;
    const mealTargetKcal = targets.kcal / divisor;
    const mealTargetProtein = targets.protein / divisor;
    
    try {
      const result = reconcileMealLevel({
        meal,
        targetKcal: mealTargetKcal,
        targetProtein: mealTargetProtein,
        getItemMacros,
        log,
        tolPct: (config.reconciliationTolerancePct || 0.15) * 100
      });
      
      reconciled.push(result.meal || meal);
    } catch (error) {
      log('warning', 'Meal reconciliation failed', { mealName: meal.name, error: error.message });
      reconciled.push(meal);
    }
  }
  
  return { meals: reconciled };
}

/**
 * Runs daily-level reconciliation
 * V3.2: Added defensive guard for meals array
 * 
 * @param {Array} meals - Array of meals
 * @param {Object} targets - Daily targets
 * @param {Function} getItemMacros - Callback to get item macros
 * @param {Object} config - Pipeline configuration
 * @param {Function} log - Logger function
 * @returns {Object} Reconciliation result
 */
function runDailyReconciliation(meals, targets, getItemMacros, config, log) {
  if (!Array.isArray(meals)) {
    log('error', 'runDailyReconciliation received non-array meals', { type: typeof meals });
    return { meals: [] };
  }
  
  const validMeals = meals.filter(meal => {
    if (!meal || typeof meal !== 'object') return false;
    if (!Array.isArray(meal.items)) return false;
    return true;
  });
  
  if (validMeals.length === 0) {
    log('warning', 'No valid meals for daily reconciliation');
    return { meals };
  }
  
  try {
    const result = reconcileNonProtein({
      meals: validMeals,
      targetKcal: targets.kcal,
      targetProtein: targets.protein,
      getItemMacros,
      tolPct: (config.reconciliationTolerancePct || 0.15) * 100,
      allowProteinScaling: config.allowProteinScaling || false,
      log
    });
    
    return { meals: result.meals || validMeals, adjusted: result.adjusted, factor: result.factor };
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

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// DAY TOTALS CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculates day totals from processed meals
 * V3.3: Uses sanitized item values directly when available
 * V3.2: Added defensive guard for meal.items
 * 
 * @param {Array} meals - Array of processed meals (with macros attached)
 * @param {Function} getItemMacros - Callback to get item macros (fallback)
 * @param {Function} log - Optional logger function
 * @returns {Object} Day totals { kcal, calories, protein, fat, carbs }
 */
function calculateDayTotals(meals, getItemMacros, log = null) {
  let totalKcal = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;
  
  if (!Array.isArray(meals)) {
    if (log) log('error', 'calculateDayTotals received non-array meals', { type: typeof meals });
    return {
      kcal: 0,
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0
    };
  }
  
  for (let mealIndex = 0; mealIndex < meals.length; mealIndex++) {
    const meal = meals[mealIndex];
    
    if (!meal || typeof meal !== 'object') {
      if (log) log('warning', 'Skipping invalid meal in calculateDayTotals', { mealIndex });
      continue;
    }
    
    if (!Array.isArray(meal.items)) {
      if (log) {
        log('warning', 'meal.items not iterable in calculateDayTotals', {
          mealIndex,
          mealName: meal.name || meal.type || `meal_${mealIndex}`,
          itemsType: meal.items === null ? 'null' : typeof meal.items
        });
      }
      continue;
    }
    
    for (const item of meal.items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      
      // V3.3: Prefer directly attached macros, fall back to callback
      if (typeof item.kcal === 'number' && !isNaN(item.kcal)) {
        totalKcal += sanitizeNumber(item.kcal, 0);
        totalProtein += sanitizeNumber(item.protein, 0);
        totalFat += sanitizeNumber(item.fat, 0);
        totalCarbs += sanitizeNumber(item.carbs, 0);
      } else {
        const macros = getItemMacros(item);
        totalKcal += sanitizeNumber(macros.kcal, 0);
        totalProtein += sanitizeNumber(macros.protein, 0);
        totalFat += sanitizeNumber(macros.fat, 0);
        totalCarbs += sanitizeNumber(macros.carbs, 0);
      }
    }
  }
  
  return {
    kcal: Math.round(totalKcal),
    calories: Math.round(totalKcal),
    protein: roundTo(totalProtein, 1),
    fat: roundTo(totalFat, 1),
    carbs: roundTo(totalCarbs, 1)
  };
}

/**
 * Counts flagged items for response-level blocking
 * V3.2: Added defensive guard for meal.items
 * 
 * @param {Array} meals - Array of meals
 * @param {Function} getItemMacros - Callback to get item macros
 * @param {Function} log - Optional logger function
 * @returns {Object} { flaggedCount, totalItems, flaggedRate }
 */
function countFlaggedItems(meals, getItemMacros, log = null) {
  let flaggedCount = 0;
  let totalItems = 0;
  
  if (!Array.isArray(meals)) {
    if (log) log('error', 'countFlaggedItems received non-array meals', { type: typeof meals });
    return { flaggedCount: 0, totalItems: 0, flaggedRate: 0 };
  }
  
  for (let mealIndex = 0; mealIndex < meals.length; mealIndex++) {
    const meal = meals[mealIndex];
    
    if (!meal || typeof meal !== 'object') {
      continue;
    }
    
    if (!Array.isArray(meal.items)) {
      if (log) {
        log('warning', 'meal.items not iterable in countFlaggedItems', {
          mealIndex,
          mealName: meal.name || meal.type || `meal_${mealIndex}`
        });
      }
      continue;
    }
    
    for (const item of meal.items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      
      totalItems++;
      
      // Check item directly first, then callback
      if (item._flagged) {
        flaggedCount++;
      } else {
        const macros = getItemMacros(item);
        if (macros._flagged) {
          flaggedCount++;
        }
      }
    }
  }
  
  const flaggedRate = totalItems > 0 ? (flaggedCount / totalItems) * 100 : 0;
  
  return { flaggedCount, totalItems, flaggedRate };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main pipeline execution function
 * V3.3: Added macro enhancement and output sanitization
 * V3.2: Added comprehensive meal structure validation
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
  // V3.2: MEAL STRUCTURE VALIDATION - Prevent "meal.items is not iterable"
  // ═══════════════════════════════════════════════════════════════════════════
  const structureValidation = validateAllMealStructures(rawMeals, log);
  
  if (!structureValidation.valid) {
    log('warning', 'Some meals have invalid structure', {
      totalMeals: structureValidation.totalMeals,
      validCount: structureValidation.validCount,
      invalidCount: structureValidation.invalidCount,
      invalidMeals: structureValidation.invalidMeals
    });
    
    if (onInvariantWarning) {
      onInvariantWarning('INV-STRUCTURE', {
        message: `${structureValidation.invalidCount} of ${structureValidation.totalMeals} meals have invalid structure`,
        invalidMeals: structureValidation.invalidMeals
      });
    }
    
    if (structureValidation.validCount === 0) {
      throw new InvariantViolationError(
        'INV-STRUCTURE',
        'All meals have invalid structure (missing or non-array items property)',
        {
          totalMeals: structureValidation.totalMeals,
          invalidMeals: structureValidation.invalidMeals,
          traceId,
          dayNumber: config.dayNumber
        }
      );
    }
  }
  // ═══════════════════════════════════════════════════════════════════════════
  
  log('info', 'Pipeline execution started', { 
    traceId, 
    targets, 
    mealsCount: rawMeals.length,
    validMealsCount: structureValidation.validCount
  });
  
  const debug = {
    traceId,
    stages: [],
    timings: {},
    inv001Stats: null,
    structureValidation: {
      totalMeals: structureValidation.totalMeals,
      validCount: structureValidation.validCount,
      invalidCount: structureValidation.invalidCount
    },
    sanitizationStats: null
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
    debug.timings.normalize = Date.now() - startNormalize;
    debug.stages.push('state_normalization');
    
    // Stage 3: Extract unique ingredients
    const startExtract = Date.now();
    const uniqueIngredients = extractUniqueIngredients(normalizedMeals, log);
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V3.3: MACRO ENHANCEMENT - Attach computed macros to items
    // ═══════════════════════════════════════════════════════════════════════════
    const startEnhance = Date.now();
    const enhancedMeals = enhanceItemsWithMacros(dailyResult.meals, getItemMacros, log);
    debug.timings.macroEnhancement = Date.now() - startEnhance;
    debug.stages.push('macro_enhancement');
    
    log('info', 'Macros attached to items', { mealsProcessed: enhancedMeals.length });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V3.3: OUTPUT SANITIZATION - Ensure all items have valid macros
    // ═══════════════════════════════════════════════════════════════════════════
    const startSanitize = Date.now();
    const { meals: sanitizedMeals, stats: sanitizationStats } = sanitizeOutputMeals(enhancedMeals, log);
    debug.timings.sanitization = Date.now() - startSanitize;
    debug.stages.push('output_sanitization');
    debug.sanitizationStats = sanitizationStats;
    
    log('info', 'Output sanitization complete', sanitizationStats);
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Stage 8: Calculate day totals (now uses sanitized meals with attached macros)
    const dayTotals = calculateDayTotals(sanitizedMeals, getItemMacros, log);
    
    // Stage 8b: Check INV-001 response-level blocking
    if (config.enableInv001Blocking) {
      const flaggedStats = countFlaggedItems(sanitizedMeals, getItemMacros, log);
      debug.inv001Stats = flaggedStats;
      
      log('info', 'INV-001 flagged items check', {
        flaggedCount: flaggedStats.flaggedCount,
        totalItems: flaggedStats.totalItems,
        flaggedRatePct: flaggedStats.flaggedRate.toFixed(2),
        threshold: config.responseBlockThresholdPct
      });
      
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
      meals: sanitizedMeals,
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
    for (const meal of sanitizedMeals) {
      if (!meal || !Array.isArray(meal.items)) continue;
      
      for (const item of meal.items) {
        if (!item || typeof item !== 'object') continue;
        
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
    
    const totalTime = Object.values(debug.timings).reduce((a, b) => a + b, 0);
    
    log('info', 'Pipeline execution completed', {
      traceId,
      totalTime,
      dayTotals,
      inv001Stats: debug.inv001Stats,
      sanitizationStats: debug.sanitizationStats
    });
    
    return {
      traceId,
      meals: sanitizedMeals,
      dayTotals,
      validation: validationResult,
      debug,
      data: {
        meals: sanitizedMeals,
        dayTotals,
        validation: validationResult
      },
      stats: {
        traceId,
        success: true,
        totalDuration: totalTime,
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
  createLogAdapter,
  
  // Sanitization helpers (V3.3)
  sanitizeNumber,
  roundTo,
  sanitizeItem,
  sanitizeOutputMeals,
  
  // Meal structure validation (V3.2)
  validateMealStructure,
  validateAllMealStructures,
  
  // State normalization
  normalizeItemState,
  normalizeAllItemStates,
  
  // Ingredient extraction
  extractUniqueIngredients,
  
  // Nutrition fetching
  fetchNutritionForIngredients,
  
  // Macro computation (V3.3 - dual format)
  computeItemMacros,
  createGetItemMacrosCallback,
  
  // Macro enhancement (V3.3)
  enhanceItemsWithMacros,
  
  // Reconciliation
  runMealReconciliation,
  runDailyReconciliation,
  
  // Validation
  runValidation,
  validateLLMOutputWithRetry,
  
  // Totals calculation
  calculateDayTotals,
  countFlaggedItems
};