/**
 * Cheffy API: /api/nutrition-search.js
 * V2.0 - Added pre-use validation gate in lookup chain
 * 
 * Module 3 Refactor: Nutrition Lookup Module
 * Ingredient-Centric Single Source of Truth
 * 
 * V2.0 CHANGES (Minimum Viable Reliability):
 * - Added validateNutritionAtLookup() for pre-use validation
 * - HotPath and Canonical results are validated before returning
 * - If validation fails, lookup skips to next tier
 * - Fallback data is NOT validated (marked with _validated: false)
 * - New alert: lookup_validation_failed
 */

const { createClient } = require('@vercel/kv');

// --- Imports ---
const { normalizeKey } = require('../scripts/normalize.js');
const { 
  emitAlert, 
  alertNewIngredient, 
  alertLookupValidationFailed,
  ALERT_LEVELS 
} = require('../utils/alerting.js');

// --- Hot-Path Module (Ultra-fast, top 150+ ingredients) ---
const { getHotPath, getHotPathStats } = require('./nutrition-hotpath.js');

// --- Canonical Database ---
let CANON_VERSION = '0.0.0-detached';
let canonGet = () => null;
let CANON_KEYS = [];

try {
  const canonModule = require('./_canon.js'); 
  CANON_VERSION = canonModule.CANON_VERSION;
  canonGet = canonModule.canonGet;
  
  if (canonModule.CANON && typeof canonModule.CANON === 'object') {
    CANON_KEYS = Object.keys(canonModule.CANON);
  }
} catch (e) {
  console.warn('[nutrition-search] WARN: Could not load _canon.js. Canonical DB will be unavailable.', e.message);
}

// --- V2.0: Validation Configuration ---
const VALIDATION_CONFIG = {
  // Macro-calorie consistency tolerance (5% per reliability strategy)
  calorieTolerancePct: 5,
  
  // Calorie calculation constants
  caloriesPerGramProtein: 4,
  caloriesPerGramCarbs: 4,
  caloriesPerGramFat: 9,
  
  // Enable/disable lookup validation
  enableLookupValidation: true
};

// --- Configuration ---
const FALLBACK_NUTRITION = {
  grain: { kcal: 350, protein: 10, fat: 2, carbs: 70, fiber: 3, confidence: 'low', description: 'Generic grain/cereal' },
  protein: { kcal: 180, protein: 25, fat: 8, carbs: 0, fiber: 0, confidence: 'low', description: 'Generic meat/fish' },
  vegetable: { kcal: 35, protein: 2, fat: 0.5, carbs: 6, fiber: 2, confidence: 'low', description: 'Generic vegetable' },
  fruit: { kcal: 55, protein: 0.8, fat: 0.3, carbs: 13, fiber: 2, confidence: 'low', description: 'Generic fruit' },
  dairy: { kcal: 65, protein: 3.5, fat: 3.5, carbs: 5, fiber: 0, confidence: 'low', description: 'Generic dairy' },
  fat: { kcal: 800, protein: 0, fat: 90, carbs: 0, fiber: 0, confidence: 'low', description: 'Generic oil/fat' },
  legume: { kcal: 340, protein: 22, fat: 2, carbs: 58, fiber: 15, confidence: 'low', description: 'Generic legume/pulse' },
  nut: { kcal: 600, protein: 18, fat: 52, carbs: 18, fiber: 8, confidence: 'low', description: 'Generic nut/seed' },
  supplement: { kcal: 370, protein: 80, fat: 2, carbs: 5, fiber: 0, confidence: 'low', description: 'Generic protein supplement' },
  sweetener: { kcal: 350, protein: 0, fat: 0, carbs: 90, fiber: 0, confidence: 'low', description: 'Generic sweetener' },
  condiment: { kcal: 100, protein: 2, fat: 5, carbs: 10, fiber: 0, confidence: 'low', description: 'Generic sauce/condiment' },
  unknown: { kcal: 150, protein: 5, fat: 5, carbs: 20, fiber: 1, confidence: 'very_low', description: 'Unknown category - conservative estimate' },
};

// --- Helpers ---

/**
 * Infers category for fallback selection.
 * 
 * @param {string} key - Normalized ingredient key
 * @returns {string} Category name
 */
function inferCategoryFromKey(key) {
  const k = key.toLowerCase();
  
  // Proteins
  if (/chicken|beef|pork|lamb|fish|salmon|tuna|prawn|shrimp|egg|tofu|tempeh|turkey|bacon|mince/.test(k)) return 'protein';
  
  // Grains/Carbs
  if (/rice|pasta|bread|oat|quinoa|couscous|noodle|flour|cereal|wheat|corn|potato|sweet_potato/.test(k)) return 'grain';
  
  // Dairy
  if (/milk|cheese|yogurt|cream|butter|cheddar|mozzarella|parmesan|feta|ricotta/.test(k)) return 'dairy';
  
  // Fats
  if (/oil|olive|coconut|avocado|butter|lard|ghee|fat|dripping/.test(k)) return 'fat';
  
  // Vegetables
  if (/broccoli|spinach|carrot|tomato|onion|lettuce|zucchini|cucumber|mushroom|cabbage|pepper|asparagus|celery|bean|pea|eggplant/.test(k)) return 'vegetable';
  
  // Fruits
  if (/apple|banana|orange|berry|grape|mango|melon|pear|peach|plum|kiwi|strawberry|blueberry/.test(k)) return 'fruit';
  
  // Legumes
  if (/lentil|chickpea|black_bean|kidney_bean|bean(?!s$)/.test(k)) return 'legume';
  
  // Nuts/Seeds
  if (/almond|walnut|cashew|peanut|nut|seed|pistachio/.test(k)) return 'nut';
  
  // Supplements
  if (/whey|protein|casein|creatine|supplement/.test(k)) return 'supplement';
  
  // Sweeteners
  if (/sugar|honey|syrup|sweetener|maple/.test(k)) return 'sweetener';
  
  // Condiments
  if (/sauce|dressing|mayo|ketchup|mustard|vinegar|soy|miso|curry/.test(k)) return 'condiment';
  
  return 'unknown';
}

/**
 * Levenshtein distance for fuzzy matching
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * V2.0: Validates nutrition data at lookup time
 * Checks macro-calorie consistency before returning data
 * 
 * @param {Object} nutrition - Nutrition data { calories, protein, fat, carbs }
 * @param {string} key - Ingredient key for logging
 * @param {string} source - Source name (hotpath, canonical)
 * @returns {{ valid: boolean, deviation_pct: number, expected_kcal: number, reported_kcal: number }}
 */
function validateNutritionAtLookup(nutrition, key, source) {
  // Skip validation if disabled
  if (!VALIDATION_CONFIG.enableLookupValidation) {
    return { valid: true, deviation_pct: 0 };
  }
  
  const { calories, protein, fat, carbs } = nutrition;
  
  // Skip if values are missing or zero
  if (!calories || calories === 0) {
    return { valid: true, deviation_pct: 0 };
  }
  if (protein === undefined || fat === undefined || carbs === undefined) {
    return { valid: true, deviation_pct: 0 };
  }
  
  // Calculate expected calories from macros
  const expectedKcal = 
    (protein * VALIDATION_CONFIG.caloriesPerGramProtein) +
    (carbs * VALIDATION_CONFIG.caloriesPerGramCarbs) +
    (fat * VALIDATION_CONFIG.caloriesPerGramFat);
  
  // Skip if expected is zero
  if (expectedKcal === 0) {
    return { valid: true, deviation_pct: 0 };
  }
  
  // Calculate deviation
  const deviation = Math.abs((calories - expectedKcal) / expectedKcal) * 100;
  const deviationRounded = Math.round(deviation * 100) / 100;
  
  // Check against tolerance
  if (deviation > VALIDATION_CONFIG.calorieTolerancePct) {
    return {
      valid: false,
      deviation_pct: deviationRounded,
      expected_kcal: Math.round(expectedKcal),
      reported_kcal: calories
    };
  }
  
  return {
    valid: true,
    deviation_pct: deviationRounded,
    expected_kcal: Math.round(expectedKcal),
    reported_kcal: calories
  };
}

/**
 * Transforms canonical data to standard output format
 * 
 * @param {Object} canonData - Raw canonical data
 * @param {string} key - Matched key
 * @param {string} source - Source identifier
 * @returns {Object} Standardized nutrition object
 */
function transformCanonToOutput(canonData, key, source) {
  return {
    status: 'found',
    source: source,
    isFallback: false,
    servingUnit: '100g',
    calories: canonData.kcal_per_100g,
    protein: canonData.protein_g_per_100g,
    fat: canonData.fat_g_per_100g,
    carbs: canonData.carb_g_per_100g,
    fiber: canonData.fiber_g_per_100g,
    notes: canonData.notes,
    version: CANON_VERSION,
    matchedKey: key,
    _validated: true  // V2.0: Mark as validated
  };
}

// --- Lookup Tiers ---

/**
 * V2.0: Looks up in HotPath with validation
 * 
 * @param {string} normalizedKey - Normalized ingredient key
 * @param {Function} log - Logger function
 * @returns {Object|null} Nutrition data or null if not found/invalid
 */
function lookupHotPath(normalizedKey, log) {
  const result = getHotPath(normalizedKey);
  if (!result) return null;
  
  // Transform to standard format
  const nutrition = {
    ...result,
    source: 'hotpath',
    isFallback: false,
    status: 'found',
    _validated: true  // Will be set based on validation
  };
  
  // V2.0: Validate before returning
  const validation = validateNutritionAtLookup(nutrition, normalizedKey, 'hotpath');
  
  if (!validation.valid) {
    // Log validation failure
    log(`[NUTRI] HOT-PATH VALIDATION FAILED: ${normalizedKey} (${validation.deviation_pct}% deviation)`, 'WARN', 'HOT_PATH');
    
    // Emit alert
    alertLookupValidationFailed(normalizedKey, 'hotpath', validation, {});
    
    // Return null to skip to next tier
    return null;
  }
  
  log(`[NUTRI] HOT-PATH HIT: ${normalizedKey}`, 'DEBUG', 'HOT_PATH');
  return nutrition;
}

/**
 * V2.0: Looks up in Canonical DB with validation
 * 
 * @param {string} normalizedKey - Normalized ingredient key
 * @param {Function} log - Logger function
 * @returns {Object|null} Nutrition data or null if not found/invalid
 */
function lookupCanonical(normalizedKey, log) {
  if (!CANON_VERSION) return null;

  // 1. Exact Match
  let data = canonGet(normalizedKey);
  if (data) {
    const nutrition = transformCanonToOutput(data, normalizedKey, 'canonical');
    
    // V2.0: Validate before returning
    const validation = validateNutritionAtLookup(nutrition, normalizedKey, 'canonical');
    
    if (!validation.valid) {
      log(`[NUTRI] CANONICAL VALIDATION FAILED: ${normalizedKey} (${validation.deviation_pct}% deviation)`, 'WARN', 'CANON');
      alertLookupValidationFailed(normalizedKey, 'canonical', validation, {});
      return null;  // Skip to fallback
    }
    
    return nutrition;
  }

  // 2. Fuzzy Match (Simple distance check on keys)
  if (CANON_KEYS.length > 0) {
    let bestMatch = null;
    let bestDist = 3; // Max distance allowed

    for (const key of CANON_KEYS) {
      const dist = levenshteinDistance(normalizedKey, key);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = key;
      }
      if (dist === 0) break; 
    }

    if (bestMatch) {
      data = canonGet(bestMatch);
      const nutrition = transformCanonToOutput(data, bestMatch, 'canonical');
      
      // V2.0: Validate fuzzy match too
      const validation = validateNutritionAtLookup(nutrition, bestMatch, 'canonical');
      
      if (!validation.valid) {
        log(`[NUTRI] CANONICAL FUZZY VALIDATION FAILED: ${normalizedKey} -> ${bestMatch} (${validation.deviation_pct}% deviation)`, 'WARN', 'CANON');
        alertLookupValidationFailed(bestMatch, 'canonical-fuzzy', validation, { originalKey: normalizedKey });
        return null;  // Skip to fallback
      }
      
      log(`[NUTRI] CANONICAL FUZZY HIT: ${normalizedKey} -> ${bestMatch}`, 'DEBUG', 'CANON');
      return nutrition;
    }
  }

  return null;
}

/**
 * Gets fallback nutrition based on inferred category
 * V2.0: Fallback is NOT validated, marked with _validated: false
 * 
 * @param {string} normalizedKey - Normalized ingredient key
 * @param {Function} log - Logger function
 * @returns {Object} Fallback nutrition data
 */
function getFallbackNutrition(normalizedKey, log) {
  const category = inferCategoryFromKey(normalizedKey);
  const fallback = FALLBACK_NUTRITION[category] || FALLBACK_NUTRITION.unknown;

  log(`[NUTRI] FALLBACK USED for ${normalizedKey} (Category: ${category})`, 'WARN', 'FALLBACK');

  // ALERT: Track fallback usage to identify gaps in canonical DB
  emitAlert(ALERT_LEVELS.WARNING, 'nutrition_fallback', {
    ingredientKey: normalizedKey,
    category: category,
    estimatedCalories: fallback.kcal
  });

  return {
    status: 'found',
    source: 'fallback',
    isFallback: true,
    servingUnit: '100g',
    calories: fallback.kcal,
    protein: fallback.protein,
    fat: fallback.fat,
    carbs: fallback.carbs,
    fiber: fallback.fiber,
    confidence: fallback.confidence,
    inferredCategory: category,
    matchedKey: normalizedKey,
    notes: `${fallback.description} - estimated`,
    _validated: false  // V2.0: Fallback is NOT validated
  };
}

// --- Main Entry Point ---

/**
 * Looks up nutrition data for a given ingredient.
 * Pipeline: Normalization -> HotPath -> Canonical -> Fallback
 * 
 * V2.0: Each tier validates data before returning.
 * If validation fails, lookup proceeds to next tier.
 * 
 * @param {string} ingredientKey - Raw ingredient name
 * @param {function} log - Logger instance
 * @returns {object} Standardized nutrition object
 */
async function lookupIngredientNutrition(ingredientKey, log = console.log) {
  const normalizedKey = normalizeKey(ingredientKey);
  let result = null;

  // 1. HotPath (with validation)
  result = lookupHotPath(normalizedKey, log);

  // 2. Canonical (with validation)
  if (!result) {
    result = lookupCanonical(normalizedKey, log);
    
    // ALERT: HotPath Miss (Data Improvement Signal)
    if (result) {
      alertNewIngredient(normalizedKey, { source: 'canonical' });
    }
  }

  // 3. Fallback (NO validation - assumed correct)
  if (!result) {
    result = getFallbackNutrition(normalizedKey, log);
  }

  return result;
}

// --- Exports ---
module.exports = {
  lookupIngredientNutrition,
  getHotPathStats,
  inferCategoryFromKey,
  validateNutritionAtLookup,  // V2.0: Export for testing
  VALIDATION_CONFIG,          // V2.0: Export config for testing
  // Deprecated: Maintained strictly for legacy test compatibility if needed
  fetchNutritionData: async (barcode, query, log) => lookupIngredientNutrition(query || '', log)
};