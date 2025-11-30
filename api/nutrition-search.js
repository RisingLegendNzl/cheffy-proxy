// --- Cheffy API: /api/nutrition-search.js ---
// Module 3 Refactor: Nutrition Lookup Module
// V15.0 - Ingredient-Centric Single Source of Truth

const { createClient } = require('@vercel/kv');

// --- Imports ---
const { normalizeKey } = require('../scripts/normalize.js');
const { emitAlert, alertNewIngredient, ALERT_LEVELS } = require('../utils/alerting.js');

// --- Hot-Path Module (Ultra-fast, top 50+ ingredients) ---
// Preserving existing local dependency
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
    // Silent success log to reduce noise
  }
} catch (e) {
  console.warn('[nutrition-search] WARN: Could not load _canon.js. Canonical DB will be unavailable.', e.message);
}

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
 */
function inferCategoryFromKey(normalizedKey) {
  const key = (normalizedKey || '').toLowerCase();
  
  if (/rice|pasta|oat|quinoa|couscous|barley|bulgur|farro|bread|cereal|wheat|corn_flake|granola|muesli|noodle|freekeh|spelt|teff|amaranth|millet|buckwheat/.test(key)) return 'grain';
  if (/chicken|beef|pork|lamb|turkey|fish|salmon|tuna|prawn|shrimp|egg|tofu|tempeh|duck|goat|veal|venison|mince|steak|fillet|breast|thigh|drumstick|bacon|sausage/.test(key)) return 'protein';
  if (/lentil|chickpea|bean(?!_sprout)|pea(?!nut)|dal|dhal/.test(key)) return 'legume';
  if (/broccoli|spinach|carrot|potato(?!_chip)|tomato|onion|pepper|capsicum|zucchini|mushroom|lettuce|cabbage|celery|asparagus|cucumber|corn(?!_flake)|kale|cauliflower|eggplant|aubergine|pumpkin|squash|beetroot|beet/.test(key)) return 'vegetable';
  if (/banana|apple|orange|strawberry|blueberry|mango|grape|watermelon|pear|peach|plum|cherry|raspberry|blackberry|kiwi|pineapple|melon|avocado/.test(key)) return 'fruit';
  if (/milk|yogurt|yoghurt|cheese|cream(?!_of)|butter|ricotta|feta|mozzarella|cheddar|parmesan|cottage/.test(key)) return 'dairy';
  if (/oil|lard|ghee|dripping|tallow|shortening/.test(key)) return 'fat';
  if (/almond|walnut|cashew|peanut|nut|seed|pecan|pistachio|macadamia|hazelnut|chestnut/.test(key)) return 'nut';
  if (/whey|protein_powder|protein_isolate|creatine|maltodextrin|dextrose|bcaa|casein/.test(key)) return 'supplement';
  if (/sugar|honey|syrup|maple|agave|stevia|sweetener/.test(key)) return 'sweetener';
  if (/sauce|ketchup|mustard|mayo|dressing|vinegar|soy_sauce|sriracha|salsa/.test(key)) return 'condiment';
  
  return 'unknown';
}

/**
 * Calculates Levenshtein distance for fuzzy matching.
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Transforms internal canonical data to standard output format.
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
    matchedKey: key
  };
}

// --- Lookup Tiers ---

function lookupHotPath(normalizedKey, log) {
  const result = getHotPath(normalizedKey);
  if (result) {
    log(`[NUTRI] HOT-PATH HIT: ${normalizedKey}`, 'DEBUG', 'HOT_PATH');
    // Ensure HotPath result has the standard source/isFallback structure
    return {
      ...result,
      source: 'hotpath',
      isFallback: false,
      status: 'found'
    };
  }
  return null;
}

function lookupCanonical(normalizedKey, log) {
  if (!CANON_VERSION) return null;

  // 1. Exact Match
  let data = canonGet(normalizedKey);
  if (data) return transformCanonToOutput(data, normalizedKey, 'canonical');

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
      log(`[NUTRI] CANONICAL FUZZY HIT: ${normalizedKey} -> ${bestMatch}`, 'DEBUG', 'CANON');
      return transformCanonToOutput(data, bestMatch, 'canonical');
    }
  }

  return null;
}

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
    notes: `${fallback.description} - estimated`
  };
}

// --- Main Entry Point ---

/**
 * Looks up nutrition data for a given ingredient.
 * Pipeline: Normalization -> HotPath -> Canonical -> Fallback
 * * @param {string} ingredientKey - Raw ingredient name
 * @param {function} log - Logger instance
 * @returns {object} Standardized nutrition object
 */
async function lookupIngredientNutrition(ingredientKey, log = console.log) {
  const normalizedKey = normalizeKey(ingredientKey);
  let result = null;

  // 1. HotPath
  result = lookupHotPath(normalizedKey, log);

  // 2. Canonical
  if (!result) {
    result = lookupCanonical(normalizedKey, log);
    
    // ALERT: HotPath Miss (Data Improvement Signal)
    if (result) {
      alertNewIngredient(normalizedKey, { source: 'canonical' });
    }
  }

  // 3. Fallback
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
  // Deprecated: Maintained strictly for legacy test compatibility if needed
  fetchNutritionData: async (barcode, query, log) => lookupIngredientNutrition(query || '', log)
};

