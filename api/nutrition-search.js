/// ========= NUTRITION-SEARCH-OPTIMIZED ========= \\
// File: api/nutrition-search.js
// Version: 4.0.0 - Phase 4 Update: Ingredient-Centric Core (TARGET FLOW)
// Pipeline: HOT-PATH → Canonical (fuzzy) → EXTERNAL (Last Resort) → FALLBACK
// Target: Decouple macro accuracy from market run product selection.

const fetch = require('node-fetch');
const { createClient } = require('@vercel/kv');

// --- Hot-Path Module (Ultra-fast, top 50+ ingredients) ---
const { getHotPath, isHotPath, getHotPathStats } = require('./nutrition-hotpath.js');

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
    console.log(`[nutrition-search] Successfully loaded _canon.js version ${CANON_VERSION} with ${CANON_KEYS.length} items`);
  }
} catch (e) {
  console.warn('[nutrition-search] WARN: Could not load _canon.js. Canonical DB will be unavailable. Error:', e.message);
}

// --- Normalization with Fuzzy Matching ---
const { 
  normalizeKey, 
  getFuzzyMatchCandidates, 
  findBestFuzzyMatch 
} = require('../scripts/normalize.js');

// ---------- ENV & CONSTANTS ----------
const AVOCAVO_URL = 'https://app.avocavo.app/api/v2';
const AVOCAVO_KEY = process.env.AVOCAVO_API_KEY || '';
const USDA_KEY    = process.env.USDA_API_KEY || '';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_FOOD_URL = 'https://food-calories-and-macros-api.p.rapidapi.com/food';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// --- Cache version includes both hot-path and canon version ---
const CACHE_PREFIX = `nutri:v10:hot:cv:${CANON_VERSION}`; // Bumped to v10 for Phase 2
const TTL_FINAL_MS = 1000 * 60 * 60 * 24 * 7;  // 7 days
const TTL_AVO_Q_MS = 1000 * 60 * 60 * 24 * 7;  // 7 days
const TTL_AVO_U_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TTL_NAME_MS  = 1000 * 60 * 60 * 24 * 7;  // 7 days
const TTL_BAR_MS   = 1000 * 60 * 60 * 24 * 30; // 30 days
const KJ_TO_KCAL   = 4.184;

// ---------- PHASE 2: Fallback Nutrition Data ----------
/**
 * Generic category-based nutrition estimates for when all tiers fail.
 * These are conservative estimates per 100g/ml.
 * Confidence is marked as 'low' or 'very_low' to indicate uncertainty.
 */
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

/**
 * Infers the food category from a normalized key using regex patterns.
 * Used to select appropriate fallback nutrition data.
 * * @param {string} normalizedKey - The normalized ingredient key
 * @returns {string} Category name matching FALLBACK_NUTRITION keys
 */
function inferCategoryFromKey(normalizedKey) {
  const key = (normalizedKey || '').toLowerCase();
  
  // Grains/Cereals (check before protein due to 'oat' overlap)
  if (/rice|pasta|oat|quinoa|couscous|barley|bulgur|farro|bread|cereal|wheat|corn_flake|granola|muesli|noodle|freekeh|spelt|teff|amaranth|millet|buckwheat/.test(key)) {
    return 'grain';
  }
  
  // Proteins (meat, fish, eggs, tofu)
  if (/chicken|beef|pork|lamb|turkey|fish|salmon|tuna|prawn|shrimp|egg|tofu|tempeh|duck|goat|veal|venison|mince|steak|fillet|breast|thigh|drumstick|bacon|sausage/.test(key)) {
    return 'protein';
  }
  
  // Legumes (check before vegetables due to 'bean' overlap)
  if (/lentil|chickpea|bean(?!_sprout)|pea(?!nut)|dal|dhal/.test(key)) {
    return 'legume';
  }
  
  // Vegetables
  if (/broccoli|spinach|carrot|potato(?!_chip)|tomato|onion|pepper|capsicum|zucchini|mushroom|lettuce|cabbage|celery|asparagus|cucumber|corn(?!_flake)|kale|cauliflower|eggplant|aubergine|pumpkin|squash|beetroot|beet/.test(key)) {
    return 'vegetable';
  }
  
  // Fruits
  if (/banana|apple|orange|strawberry|blueberry|mango|grape|watermelon|pear|peach|plum|cherry|raspberry|blackberry|kiwi|pineapple|melon|avocado/.test(key)) {
    return 'fruit';
  }
  
  // Dairy
  if (/milk|yogurt|yoghurt|cheese|cream(?!_of)|butter|ricotta|feta|mozzarella|cheddar|parmesan|cottage/.test(key)) {
    return 'dairy';
  }
  
  // Fats/Oils
  if (/oil|lard|ghee|dripping|tallow|shortening/.test(key)) {
    return 'fat';
  }
  
  // Nuts/Seeds
  if (/almond|walnut|cashew|peanut|nut|seed|pecan|pistachio|macadamia|hazelnut|chestnut/.test(key)) {
    return 'nut';
  }
  
  // Supplements
  if (/whey|protein_powder|protein_isolate|creatine|maltodextrin|dextrose|bcaa|casein/.test(key)) {
    return 'supplement';
  }
  
  // Sweeteners
  if (/sugar|honey|syrup|maple|agave|stevia|sweetener/.test(key)) {
    return 'sweetener';
  }
  
  // Condiments/Sauces
  if (/sauce|ketchup|mustard|mayo|dressing|vinegar|soy_sauce|sriracha|salsa/.test(key)) {
    return 'condiment';
  }
  
  return 'unknown';
}

/**
 * Returns fallback nutrition data when all lookup tiers fail.
 * This ensures we never return 0 macros for an ingredient.
 * * @param {string} query - Original query string
 * @param {function} log - Logger function (now structuredLog)
 * @returns {object} Nutrition data object with fallback values
 */
function getFallbackNutrition(query, log = console.log) {
  const normalizedKey = normalizeKey(query);
  const category = inferCategoryFromKey(normalizedKey);
  const fallback = FALLBACK_NUTRITION[category] || FALLBACK_NUTRITION.unknown;
  
  // --- NUTRITION_LOOKUP Logging (Fallback Tier) ---
  structuredLog('NUTRITION_LOOKUP', {
    normalizedKeyInput: normalizedKey,
    lookupTier: 'fallback',
    externalApiQuery: null,
    externalApiProductName: null,
    rawApiResponse: null,
    mappedFields: {
      kcal: fallback.kcal,
      protein: fallback.protein,
      fat: fallback.fat,
      carbs: fallback.carbs
    },
    fieldMappingUsed: null,
    fallbackReason: fallback.description || 'All external lookups failed.',
  });
  
  log(`[NUTRI] FALLBACK USED for '${query}' (category: ${category}, key: ${normalizedKey})`, 'WARN', 'FALLBACK');
  
  // Increment stats
  pipelineStats.fallbackHits++;
  
  return {
    status: 'found',
    source: 'FALLBACK',
    servingUnit: '100g',
    usda_link: null,
    calories: fallback.kcal,
    protein: fallback.protein,
    fat: fallback.fat,
    carbs: fallback.carbs,
    fiber: fallback.fiber,
    confidence: fallback.confidence,
    inferredCategory: category,
    matchedKey: normalizedKey,
    notes: `${fallback.description} - actual values may vary significantly`,
    isFallback: true,
  };
}

// ---------- PHASE 2: Pipeline Telemetry ----------
/**
 * Tracks hit rates across pipeline tiers for monitoring and optimization.
 */
const pipelineStats = {
  hotPathHits: 0,
  canonicalHits: 0,
  externalHits: 0,
  cacheHits: 0,
  fallbackHits: 0,
  totalQueries: 0,
  errors: 0,
  startTime: Date.now(),
};

/**
 * Returns current pipeline statistics.
 * Useful for monitoring tier effectiveness and identifying optimization opportunities.
 * * @returns {object} Pipeline statistics
 */
function getPipelineStats() {
  const uptime = (Date.now() - pipelineStats.startTime) / 1000;
  const total = pipelineStats.totalQueries || 1; // Avoid division by zero
  
  return {
    ...pipelineStats,
    uptimeSeconds: uptime,
    hitRates: {
      hotPath: ((pipelineStats.hotPathHits / total) * 100).toFixed(1) + '%',
      canonical: ((pipelineStats.canonicalHits / total) * 100).toFixed(1) + '%',
      external: ((pipelineStats.externalHits / total) * 100).toFixed(1) + '%',
      cache: ((pipelineStats.cacheHits / total) * 100).toFixed(1) + '%',
      fallback: ((pipelineStats.fallbackHits / total) * 100).toFixed(1) + '%',
    },
  };
}

/**
 * Resets pipeline statistics. Useful for testing or periodic resets.
 */
function resetPipelineStats() {
  pipelineStats.hotPathHits = 0;
  pipelineStats.canonicalHits = 0;
  pipelineStats.externalHits = 0;
  pipelineStats.cacheHits = 0;
  pipelineStats.fallbackHits = 0;
  pipelineStats.totalQueries = 0;
  pipelineStats.errors = 0;
  pipelineStats.startTime = Date.now();
}

// ---------- KV + Memory cache ----------
const kv = createClient({ url: KV_URL, token: KV_TOKEN });
const kvReady = !!(KV_URL && KV_TOKEN);

const mem = new Map();
function memGet(key) { const x = mem.get(key); return x && x.exp > Date.now() ? x.v : null; }
function memSet(key, v, ms = 5 * 60 * 1000) { mem.set(key, { v, exp: Date.now() + ms }); }

async function cacheGet(key) {
  const m = memGet(key);
  if (m) return m;
  if (!kvReady) return null;
  try { const hit = await kv.get(key); if (hit) memSet(key, hit); return hit; } catch { return null; }
}
async function cacheSet(key, val, ttl) {
  memSet(key, val);
  if (!kvReady) return;
  try { await kv.set(key, val, { px: ttl }); } catch {}
}

// ---------- Structured Logging Utility ----------
/**
 * Generates a structured JSON log for easy parsing and ingestion.
 * @param {string} tag - The log event tag (e.g., 'NUTRITION_LOOKUP', 'KEY_NORMALIZATION')
 * @param {object} fields - The data fields to include in the log.
 */
function structuredLog(tag, fields) {
  try {
    const logOutput = JSON.stringify({
      logTag: tag,
      timestamp: new Date().toISOString(),
      ...fields
    }, (key, value) => {
      // Custom replacer to truncate large objects (like raw responses)
      if (key === 'rawApiResponse' && typeof value === 'object' && value !== null) {
        // Truncate if stringified response is > 5KB
        const stringified = JSON.stringify(value);
        if (stringified.length > 5 * 1024) {
          return {
            _truncated: true,
            _length: stringified.length,
            _snippet: stringified.substring(0, 500) + '...'
          };
        }
      }
      return value;
    });
    console.log(`[STRUCTURED_LOG] ${logOutput}`);
  } catch (e) {
    console.error(`Failed to generate structured log for tag ${tag}:`, e);
  }
}

// ---------- Utilities ----------
const normFood = (q = '') => q.replace(/\bbananas\b/i, 'banana');
function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function withTimeout(promise, ms = 8000) { 
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); 
}
function softLog(name, q) { try { console.log(`[NUTRI] ${name}: ${q}`); } catch {} }

// ---------- USDA link helpers ----------
function extractFdcId(any) {
  const c = [
    any?.fdc_id, any?.fdcId, any?.fdc_id_str,
    any?.usda_fdc_id, any?.usda?.fdc_id,
    any?.match?.fdc_id, any?.matches?.[0]?.fdc_id,
    any?.product?.fdc_id, any?.meta?.fdc_id
  ];
  const id = c.find(v => v != null && String(v).match(/^\d+$/));
  return id ? String(id) : null;
}
function usdaLinkFromId(id) { return id ? `https://fdc.nal.usda.gov/fdc-app.html#/food/${id}` : null; }

// ---------- Nutrition validation (calorie balance sanity) ----------
function accept(out) {
  const P = Number(out.protein), F = Number(out.fat), C = Number(out.carbs), K = Number(out.calories);
  if (!(K > 0 && P >= 0 && F >= 0 && C >= 0)) return false;
  const est = 4 * P + 4 * C + 9 * F;
  return Math.abs(K - est) / Math.max(1, K) <= 0.12;
}

/**
 * RFC-005: Validates that external nutrition data matches expected category profile.
 * Returns true if data is plausible for the ingredient category.
 * @param {string} normalizedKey - The normalized ingredient key
 * @param {object} nutritionData - The nutrition data to validate
 * @returns {boolean} True if data passes category validation
 */
function validateCategoryMatch(normalizedKey, nutritionData) {
    const P = Number(nutritionData.protein) || 0;
    const F = Number(nutritionData.fat) || 0;
    const C = Number(nutritionData.carbs) || 0;
    const K = Number(nutritionData.calories) || 0;
    
    // Infer category from key
    const category = inferCategoryFromKey(normalizedKey);
    
    switch (category) {
        case 'protein':
            // Lean proteins: protein > 15g/100g, carbs < 15g/100g, fat < 30g/100g (allow some fatty cuts)
            if (P < 10 || C > 15 || F > 30) {
                console.log(`[NUTRI] Category mismatch: ${normalizedKey} (protein) failed: P=${P}, C=${C}, F=${F}`);
                return false;
            }
            break;
        case 'vegetable':
            // Vegetables: kcal < 150, protein < 15, fat < 10 (allow for starchy/avocado, but keep lean)
            if (K > 200 || P > 15 || F > 15) {
                console.log(`[NUTRI] Category mismatch: ${normalizedKey} (vegetable) failed: K=${K}, P=${P}, F=${F}`);
                return false;
            }
            break;
        case 'grain':
            // Grains: carbs > 30g/100g (dry basis)
            if (C < 30) {
                console.log(`[NUTRI] Category mismatch: ${normalizedKey} (grain) failed: C=${C}`);
                return false;
            }
            break;
        case 'fruit':
            // Fruits: kcal < 200, protein < 10, fat < 10 (allow for fatty fruits like avocado)
            if (K > 250 || P > 15 || F > 20) {
                console.log(`[NUTRI] Category mismatch: ${normalizedKey} (fruit) failed: K=${K}, P=${P}, F=${F}`);
                return false;
            }
            break;
        // dairy, fat, nut, condiment, supplement, sweetener, legume: less strict, accept by default
        default:
            return true;
    }
    return true;
}


// ---------- Tier 1: HOT-PATH Lookup (Target: <5ms) ----------
/**
 * Attempts hot-path lookup for ultra-common ingredients.
 * This is pure in-memory, no I/O.
 * * @param {string} normalizedKey - The ingredient key, already normalized
 * @param {function} log - Logger function
 * @returns {object|null} Nutrition data or null
 */
function lookupHotPath(normalizedKey, log = console.log) {
  if (!normalizedKey) return null;
  
  const startTime = Date.now();
  
  const result = getHotPath(normalizedKey);
  const latency = Date.now() - startTime;
  
  if (result) {
    log(`[NUTRI] HOT-PATH HIT for: ${normalizedKey} [${latency}ms]`, 'INFO', 'HOT_PATH');
    pipelineStats.hotPathHits++;
    
    // --- NUTRITION_LOOKUP Logging (Hotpath Tier) ---
    structuredLog('NUTRITION_LOOKUP', {
      normalizedKeyInput: normalizedKey,
      lookupTier: 'hotpath',
      externalApiQuery: null,
      externalApiProductName: result.matchedKey,
      rawApiResponse: result,
      mappedFields: {
        kcal: result.calories,
        protein: result.protein,
        fat: result.fat,
        carbs: result.carbs
      },
      fieldMappingUsed: { kcal: 'calories', protein: 'protein', fat: 'fat', carbs: 'carbs' },
      fallbackReason: null,
    });
    
    return result;
  }
  
  log(`[NUTRI] HOT-PATH MISS for: ${normalizedKey} [${latency}ms]`, 'DEBUG', 'HOT_PATH');
  return null;
}

// ---------- Tier 2: Canonical Lookup with Fuzzy Matching (Target: <50ms) ----------
/**
 * Attempts to find nutrition data in the canonical database.
 * Uses exact match first, then fuzzy matching variants.
 * * @param {string} query - The ingredient query
 * @param {function} log - Logger function
 * @returns {object|null} Nutrition data or null
 */
function lookupCanonical(query, log = console.log) {
  if (!query) return null;
  
  const startTime = Date.now();
  const normalizedKey = normalizeKey(query);
  let finalLookupKey = normalizedKey;
  
  // 1. Try exact match first
  let canonData = canonGet(normalizedKey);
  if (canonData) {
    const latency = Date.now() - startTime;
    log(`[NUTRI] CANONICAL HIT (exact) for: ${query} (key: ${normalizedKey}) [${latency}ms]`, 'INFO', 'CANON');
    pipelineStats.canonicalHits++;
    
    // Log before returning
    structuredLog('NUTRITION_LOOKUP', {
      normalizedKeyInput: normalizedKey,
      lookupTier: 'canonical',
      externalApiQuery: null,
      externalApiProductName: finalLookupKey,
      rawApiResponse: canonData,
      mappedFields: {
        kcal: canonData.kcal_per_100g,
        protein: canonData.protein_g_per_100g,
        fat: canonData.fat_g_per_100g,
        carbs: canonData.carb_g_per_100g
      },
      fieldMappingUsed: { kcal: 'kcal_per_100g', protein: 'protein_g_per_100g', fat: 'fat_g_per_100g', carbs: 'carb_g_per_100g' },
      fallbackReason: null,
    });

    return transformCanonToOutput(canonData, normalizedKey);
  }
  
  // 2. Try fuzzy match candidates
  const candidates = getFuzzyMatchCandidates(normalizedKey);
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    canonData = canonGet(candidate);
    if (canonData) {
      const latency = Date.now() - startTime;
      finalLookupKey = candidate;
      log(`[NUTRI] CANONICAL HIT (fuzzy: ${normalizedKey} → ${candidate}) for: ${query} [${latency}ms]`, 'INFO', 'CANON');
      pipelineStats.canonicalHits++;
      
      // Log before returning
      structuredLog('NUTRITION_LOOKUP', {
        normalizedKeyInput: normalizedKey,
        lookupTier: 'canonical',
        externalApiQuery: null,
        externalApiProductName: finalLookupKey,
        rawApiResponse: canonData,
        mappedFields: {
          kcal: canonData.kcal_per_100g,
          protein: canonData.protein_g_per_100g,
          fat: canonData.fat_g_per_100g,
          carbs: canonData.carb_g_per_100g
        },
        fieldMappingUsed: { kcal: 'kcal_per_100g', protein: 'protein_g_per_100g', fat: 'fat_g_per_100g', carbs: 'carb_g_per_100g' },
        fallbackReason: null,
      });

      return transformCanonToOutput(canonData, candidate);
    }
  }
  
  // 3. Try Levenshtein fuzzy matching
  if (CANON_KEYS.length > 0) {
    const fuzzyMatch = findBestFuzzyMatch(normalizedKey, CANON_KEYS, 2);
    if (fuzzyMatch) {
      canonData = canonGet(fuzzyMatch.key);
      if (canonData) {
        const latency = Date.now() - startTime;
        finalLookupKey = fuzzyMatch.key;
        log(`[NUTRI] CANONICAL HIT (Levenshtein: ${normalizedKey} → ${fuzzyMatch.key}, distance: ${fuzzyMatch.distance}) for: ${query} [${latency}ms]`, 'INFO', 'CANON');
        pipelineStats.canonicalHits++;
        
        // Log before returning
        structuredLog('NUTRITION_LOOKUP', {
          normalizedKeyInput: normalizedKey,
          lookupTier: 'canonical',
          externalApiQuery: null,
          externalApiProductName: finalLookupKey,
          rawApiResponse: canonData,
          mappedFields: {
            kcal: canonData.kcal_per_100g,
            protein: canonData.protein_g_per_100g,
            fat: canonData.fat_g_per_100g,
            carbs: canonData.carb_g_per_100g
          },
          fieldMappingUsed: { kcal: 'kcal_per_100g', protein: 'protein_g_per_100g', fat: 'fat_g_per_100g', carbs: 'carb_g_per_100g' },
          fallbackReason: null,
        });

        return transformCanonToOutput(canonData, fuzzyMatch.key);
      }
    }
  }
  
  const latency = Date.now() - startTime;
  log(`[NUTRI] CANONICAL MISS for: ${query} (key: ${normalizedKey}) [${latency}ms]`, 'DEBUG', 'CANON');
  return null;
}

function transformCanonToOutput(canonData, key) {
  return {
    status: 'found',
    source: 'CANON',
    servingUnit: '100g',
    usda_link: null,
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

// ---------- Tier 3-5: External API functions (unchanged for BC) ----------
function pick(obj, keys) { for (const k of keys) { const v = obj && obj[k]; if (v != null) return Number(v); } return null; }
function extractAvocavoNutrition(n, raw) {
  if (!n) return null;
  const src = n.per_100g || n;
  
  const fieldMapping = {
    kcal: ['calories_total', 'energy_kcal', 'calories'],
    protein: ['protein_total', 'proteins', 'protein'],
    fat: ['total_fat_total', 'fat', 'total_fat'],
    carbs: ['carbohydrates_total', 'carbohydrates', 'carbs']
  };

  const calories = pick(src, fieldMapping.kcal);
  const protein  = pick(src, fieldMapping.protein);
  const fat      = pick(src, fieldMapping.fat);
  const carbs    = pick(src, fieldMapping.carbs);

  if ([calories, protein, fat, carbs].some(v => v == null)) return null;
  if (calories === 0 && protein === 0 && fat === 0 && carbs === 0) return null;
  const fdcId = extractFdcId(src) || extractFdcId(n) || extractFdcId(raw);
  
  // NOTE: Adding the mapped fields to the output object for logging in fetchNutritionData
  const out = { 
    status: 'found', source: 'avocavo', servingUnit: '100g', 
    calories, protein, fat, carbs, fdcId, 
    usda_link: usdaLinkFromId(fdcId),
    _raw: raw, // Temporary for logging
    _mapping: fieldMapping // Temporary for logging
  };
  
  return accept(out) ? out : null;
}
async function avocavoIngredient(q) {
  if (!AVOCAVO_KEY) return null;
  const key = `${CACHE_PREFIX}:avq:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const res = await withTimeout(fetch(`${AVOCAVO_URL}/nutrition/ingredient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AVOCAVO_KEY },
      body: JSON.stringify({ ingredient: q })
    }));
    const j = await res.json().catch(() => null);
    const n = j?.nutrition || j?.result?.nutrition || j?.results?.[0]?.nutrition;
    const out = extractAvocavoNutrition(n, j);
    if (out) { await cacheSet(key, out, TTL_AVO_Q_MS); return out; }
  } catch {}
  return null;
}
async function avocavoBarcode(u) {
  if (!AVOCAVO_KEY) return null;
  const key = `${CACHE_PREFIX}:avu:${normalizeKey(u)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const res = await withTimeout(fetch(`${AVOCAVO_URL}/nutrition/upc/${u}`, {
      method: 'GET',
      headers: { 'X-API-Key': AVOCAVO_KEY }
    }));
    const j = await res.json().catch(() => null);
    const n = j?.nutrition || j?.result?.nutrition;
    const out = extractAvocavoNutrition(n, j);
    if (out) { await cacheSet(key, out, TTL_AVO_U_MS); return out; }
  } catch {}
  return null;
}
function tryAvocavo(qOrB, isBarcode) {
  return isBarcode ? avocavoBarcode(qOrB) : avocavoIngredient(qOrB);
}
async function rapidApiFoodSearch(q) {
  if (!RAPIDAPI_KEY) return null;
  const key = `${CACHE_PREFIX}:rapid:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const querySent = `food=${encodeURIComponent(q)}`;
    const res = await withTimeout(fetch(`${RAPIDAPI_FOOD_URL}?${querySent}`, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'food-calories-and-macros-api.p.rapidapi.com'
      }
    }));
    const j = await res.json().catch(() => null);
    
    // Default log fields for failure
    let logFields = {
      normalizedKeyInput: normalizeKey(q),
      lookupTier: 'external',
      externalApiQuery: querySent,
      externalApiProductName: j?.food?.name || q,
      rawApiResponse: j,
      fieldMappingUsed: null,
      fallbackReason: 'RapidAPI lookup failed or invalid response.',
    };

    if (!j || !j.food) {
      logFields.mappedFields = { kcal: null, protein: null, fat: null, carbs: null };
      structuredLog('NUTRITION_LOOKUP', logFields);
      return null;
    }
    
    const food = j.food;
    const calories = toNumber(food.calories);
    const protein = toNumber(food.protein);
    const fat = toNumber(food.fat);
    const carbs = toNumber(food.carbohydrates);
    
    const fieldMapping = { kcal: 'calories', protein: 'protein', fat: 'fat', carbs: 'carbohydrates' };

    if ([calories, protein, fat, carbs].some(v => v == null)) {
      logFields.mappedFields = { kcal: calories, protein: protein, fat: fat, carbs: carbs };
      logFields.fieldMappingUsed = fieldMapping;
      logFields.fallbackReason = 'Required macro field was missing or invalid.';
      structuredLog('NUTRITION_LOOKUP', logFields);
      return null;
    }
    
    const out = { 
      status: 'found', source: 'rapidapi', servingUnit: '100g', 
      calories, protein, fat, carbs, fdcId: null, usda_link: null,
      _raw: j, // Temporary for logging
      _mapping: fieldMapping // Temporary for logging
    };

    // Successful log
    if (accept(out)) { 
      await cacheSet(key, out, TTL_NAME_MS); 
      logFields.mappedFields = { kcal: calories, protein: protein, fat: fat, carbs: carbs };
      logFields.fieldMappingUsed = fieldMapping;
      logFields.fallbackReason = null;
      structuredLog('NUTRITION_LOOKUP', logFields);
      return out; 
    }
    
    // Failed sanity check log
    logFields.mappedFields = { kcal: calories, protein: protein, fat: fat, carbs: carbs };
    logFields.fieldMappingUsed = fieldMapping;
    logFields.fallbackReason = 'Failed calorie balance sanity check.';
    structuredLog('NUTRITION_LOOKUP', logFields);
  } catch {
    structuredLog('NUTRITION_LOOKUP', {
      normalizedKeyInput: normalizeKey(q),
      lookupTier: 'external',
      externalApiQuery: `food=${encodeURIComponent(q)}`,
      externalApiProductName: q,
      rawApiResponse: { error: 'Request failed or timed out' },
      mappedFields: { kcal: null, protein: null, fat: null, carbs: null },
      fieldMappingUsed: null,
      fallbackReason: 'Network error or timeout on RapidAPI.',
    });
  }
  return null;
}
async function offByBarcode(b) {
  const key = `${CACHE_PREFIX}:offb:${b}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const res = await withTimeout(fetch(`https://world.openfoodfacts.org/api/v0/product/${b}.json`));
    const j = await res.json().catch(() => null);
    
    // Define logging fields for OFF (simpler than RapidAPI due to code structure)
    const logFields = {
      normalizedKeyInput: b,
      lookupTier: 'external',
      externalApiQuery: b,
      externalApiProductName: j?.product?.product_name || 'Barcode lookup',
      rawApiResponse: j,
      fieldMappingUsed: { 
        kcal: "energy-kcal_100g or energy-kj_100g", 
        protein: "proteins_100g", 
        fat: "fat_100g", 
        carbs: "carbohydrates_100g" 
      }
    };

    if (j?.status !== 1) {
      logFields.mappedFields = { kcal: null, protein: null, fat: null, carbs: null };
      logFields.fallbackReason = 'OpenFoodFacts: Product not found or API status error.';
      structuredLog('NUTRITION_LOOKUP', logFields);
      return null;
    }
    const p = j.product; const n = p?.nutriments; if (!n) {
      logFields.mappedFields = { kcal: null, protein: null, fat: null, carbs: null };
      logFields.fallbackReason = 'OpenFoodFacts: Nutriments data missing.';
      structuredLog('NUTRITION_LOOKUP', logFields);
      return null;
    }
    const kcal = toNumber(n['energy-kcal_100g']) || (toNumber(n['energy-kj_100g']) ? toNumber(n['energy-kj_100g']) / KJ_TO_KCAL : null);
    const protein = toNumber(n.proteins_100g);
    const fat = toNumber(n.fat_100g);
    const carbs = toNumber(n.carbohydrates_100g);
    
    logFields.mappedFields = { kcal, protein, fat, carbs };

    if ([kcal, protein, fat, carbs].some(v => v == null)) {
      logFields.fallbackReason = 'OpenFoodFacts: Required macro field was missing or invalid.';
      structuredLog('NUTRITION_LOOKUP', logFields);
      return null;
    }

    const out = { 
      status: 'found', source: 'off', servingUnit: '100g', 
      calories: kcal, protein, fat, carbs, fdcId: null, usda_link: null,
      _raw: j, 
      _mapping: logFields.fieldMappingUsed
    };

    if (accept(out)) { 
      await cacheSet(key, out, TTL_BAR_MS); 
      logFields.fallbackReason = null;
      structuredLog('NUTRITION_LOOKUP', logFields);
      return out; 
    }
    
    logFields.fallbackReason = 'OpenFoodFacts: Failed calorie balance sanity check.';
    structuredLog('NUTRITION_LOOKUP', logFields);

  } catch (e) {
    structuredLog('NUTRITION_LOOKUP', {
      normalizedKeyInput: b,
      lookupTier: 'external',
      externalApiQuery: b,
      externalApiProductName: 'Barcode lookup',
      rawApiResponse: { error: 'Request failed or timed out: ' + e.message },
      mappedFields: { kcal: null, protein: null, fat: null, carbs: null },
      fieldMappingUsed: null,
      fallbackReason: 'Network error or timeout on OpenFoodFacts Barcode.',
    });
  }
  return null;
}
async function offByQuery(q) {
  const key = `${CACHE_PREFIX}:offq:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const res = await withTimeout(fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1`));
    const j = await res.json().catch(() => null);
    if (!j?.products?.length) return null;
    for (const p of j.products.slice(0, 3)) {
      const n = p?.nutriments; if (!n) continue;
      const kcal = toNumber(n['energy-kcal_100g']) || (toNumber(n['energy-kj_100g']) ? toNumber(n['energy-kj_100g']) / KJ_TO_KCAL : null);
      const protein = toNumber(n.proteins_100g);
      const fat = toNumber(n.fat_100g);
      const carbs = toNumber(n.carbohydrates_100g);
      if ([kcal, protein, fat, carbs].some(v => v == null)) continue;
      const out = { 
        status: 'found', source: 'off', servingUnit: '100g', 
        calories: kcal, protein, fat, carbs, fdcId: null, usda_link: null,
        _raw: p, // Raw product object
        _mapping: { 
          kcal: "energy-kcal_100g or energy-kj_100g", 
          protein: "proteins_100g", 
          fat: "fat_100g", 
          carbs: "carbohydrates_100g" 
        }
      };
      if (accept(out)) { await cacheSet(key, out, TTL_NAME_MS); return out; }
    }
  } catch {}
  return null;
}
async function usdaByQuery(q) {
  const key = `${CACHE_PREFIX}:usda:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const querySent = `query=${encodeURIComponent(q)}&pageSize=3&api_key=...`;
    const res = await withTimeout(fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=3&api_key=${USDA_KEY}`));
    const j = await res.json().catch(() => null);
    if (!j?.foods?.length) return null;
    for (const f of j.foods.slice(0, 3)) {
      const n = f?.foodNutrients; if (!n) continue;
      const kcalN = n.find(x => x.nutrientNumber === '208');
      const proteinN = n.find(x => x.nutrientNumber === '203');
      const fatN = n.find(x => x.nutrientNumber === '204');
      const carbsN = n.find(x => x.nutrientNumber === '205');
      const kcal = toNumber(kcalN?.value);
      const protein = toNumber(proteinN?.value);
      const fat = toNumber(fatN?.value);
      const carbs = toNumber(carbsN?.value);
      
      const fieldMapping = { 
        kcal: "nutrientNumber=208", 
        protein: "nutrientNumber=203", 
        fat: "nutrientNumber=204", 
        carbs: "nutrientNumber=205" 
      };

      if ([kcal, protein, fat, carbs].some(v => v == null)) continue;
      const fdcId = extractFdcId(f);
      const out = { 
        status: 'found', source: 'usda', servingUnit: '100g', 
        calories: kcal, protein, fat, carbs, fdcId, 
        usda_link: usdaLinkFromId(fdcId),
        _raw: f, // Raw food object
        _mapping: fieldMapping
      };

      if (accept(out)) { await cacheSet(key, out, TTL_NAME_MS); return out; }
    }
  } catch {}
  return null;
}
// ---------- END Tier 3-5: External API functions ----------


// ---------- MOD ZONE 1: NEW INGREDIENT-CENTRIC LOOKUP ----------
/**
 * Ingredient-Centric Macro Lookup (TIER 1, 2, 3).
 * Core function for macro calculation, focusing only on trusted, stable sources.
 * Excludes external API lookups and barcode searches entirely.
 * * @param {string} ingredientKey - The original, raw ingredient name (e.g., "Chicken Breast")
 * @param {function} log - Logger function
 * @returns {object} Nutrition data (guaranteed to be found)
 */
async function lookupIngredientNutrition(ingredientKey, log = console.log) {
  const overallStart = Date.now();
  const query = normFood(ingredientKey);
  const normalizedKey = normalizeKey(query);
  const finalLookupKey = normalizedKey;

  // --- KEY_NORMALIZATION Logging (Start of lookup) ---
  structuredLog('KEY_NORMALIZATION', {
    originalItemKey: ingredientKey,
    normalizedKey: normalizedKey,
    synonymLookupAttempted: true, 
    synonymMatchFound: null,
    finalLookupKey: finalLookupKey,
  });

  // Increment total queries (counted here for ingredient-centric flow)
  pipelineStats.totalQueries++;
  
  // --- TIER 1: HOT-PATH (RFC-002 enforced) ---
  let out = lookupHotPath(normalizedKey, log);

  // --- TIER 2: CANONICAL ---
  if (!out) {
    out = lookupCanonical(query, log);
    
    // Update KEY_NORMALIZATION log for canonical hit if a synonym was used (best effort to capture this)
    if (out && out.source === 'CANON' && out.matchedKey !== normalizedKey) {
        structuredLog('KEY_NORMALIZATION', {
          originalItemKey: ingredientKey,
          normalizedKey: normalizedKey,
          synonymLookupAttempted: true,
          synonymMatchFound: out.matchedKey,
          finalLookupKey: out.matchedKey,
        });
    }
    if (out && out.source === 'CANON') out.source = 'canonical'; // Normalize source name
  }

  // --- TIER 3: FALLBACK ---
  if (!out) {
    log(`[NUTRI] All trusted tiers failed for '${ingredientKey}', using FALLBACK`, 'WARN', 'PIPELINE');
    out = getFallbackNutrition(ingredientKey, log);
  }

  const totalLatency = Date.now() - overallStart;
  log(`[NUTRI] Ingredient Pipeline complete (${out.source}) [${totalLatency}ms]`, 'DEBUG', 'PIPELINE');
  
  return out;
}


// ---------- MAIN FETCH FUNCTION (BACKWARD COMPATIBILITY & EXTERNAL FALLBACK) ----------
/**
 * Main nutrition lookup function with tiered pipeline (Hotpath → Canonical → Cache → External → Fallback).
 * This function remains for consumers expecting full external lookup capabilities (e.g., recipe builder).
 * * @param {string} barcode - Optional barcode for lookup (used for cache/external API queries)
 * @param {string} query - Ingredient name query (product name if barcode provided)
 * @param {function} log - Logger function
 * @returns {object} Nutrition data (guaranteed to have non-zero values)
 */
async function fetchNutritionData(barcode, query, log = console.log) {
  const overallStart = Date.now();
  const originalItemKey = barcode || query;
  
  // Normalize query
  query = normFood(query);
  const normalizedKey = normalizeKey(query);
  
  // --- KEY_NORMALIZATION Logging ---
  structuredLog('KEY_NORMALIZATION', {
    originalItemKey: originalItemKey,
    normalizedKey: normalizedKey,
    synonymLookupAttempted: true,
    synonymMatchFound: null,
    finalLookupKey: barcode || normalizedKey,
  });

  // Increment total queries
  // Note: Only counting in fetchNutritionData to track external calls properly.
  pipelineStats.totalQueries++;
  
  // --- TIER 1/2: HOT-PATH / CANONICAL ---
  let out = await lookupIngredientNutrition(query, log);

  // If internal lookup hit, return it.
  if (out.source !== 'FALLBACK') {
    return out;
  }
  
  // --- TIER 3: CACHE (Using original query + barcode for external results) ---
  // MOD ZONE 6.3: Barcode lookup for cache remains for BC with external APIs
  const cacheKeyBase = normalizeKey(barcode || query || '');
  const finalKey = `${CACHE_PREFIX}:final:${cacheKeyBase}`;
  const cached = await cacheGet(finalKey);
  
  // Check if cache hit exists AND is NOT just a fallback result
  if (cached && cached.source !== 'FALLBACK') {
    const totalLatency = Date.now() - overallStart;
    log(`[NUTRI] Pipeline complete (CACHE/BC) [${totalLatency}ms]`, 'DEBUG', 'PIPELINE');
    pipelineStats.cacheHits++;
    
    structuredLog('NUTRITION_LOOKUP', {
      normalizedKeyInput: cacheKeyBase,
      lookupTier: 'cache',
      externalApiQuery: null,
      externalApiProductName: 'Cached Data',
      rawApiResponse: cached,
      mappedFields: {
        kcal: cached.calories,
        protein: cached.protein,
        fat: cached.fat,
        carbs: cached.carbs
      },
      fieldMappingUsed: null,
      fallbackReason: null,
    });
    
    return cached;
  }
  
  // --- TIER 4: EXTERNAL APIs (MOD ZONE 4: Demoted to last resort) ---
  // Only proceed if internal lookup failed (out is currently the FALLBACK result)
  if (out.source === 'FALLBACK') {
    log(`[NUTRI] Internal lookup failed, attempting EXTERNAL API FALLBACK for '${query || barcode}'`, 'WARN', 'PIPELINE');
    
    const tasks = [];
    // Barcode remains only in the external lookup functions for BC/deep search
    if (barcode) tasks.push(tryAvocavo(barcode, true), offByBarcode(barcode)); 
    // Query remains for ingredient-based external search
    if (query)   tasks.push(tryAvocavo(query, false), rapidApiFoodSearch(query), offByQuery(query), usdaByQuery(query));

    let externalOut = null;
    if (tasks.length) {
      try { externalOut = await Promise.race(tasks.map(t => t.then(v => v || null).catch(() => null))); }
      catch { externalOut = null; }
    }
    
    // --- External API Success Check and Validation ---
    if (externalOut) {
      // RFC-005: Validate external result matches expected category
      if (!validateCategoryMatch(normalizedKey, externalOut)) {
          log(`[NUTRI] External result for '${query || barcode}' (Source: ${externalOut.source}) failed category validation, retaining FALLBACK`, 'WARN', 'PIPELINE');
          // Log failure but do NOT set 'out' to externalOut, keep the FALLBACK
          
          // Log failure details
          structuredLog('NUTRITION_LOOKUP', {
              normalizedKeyInput: normalizedKey,
              lookupTier: 'external',
              externalApiQuery: barcode || query,
              externalApiProductName: (externalOut._raw && (externalOut._raw.product_name || externalOut._raw.name)) || externalOut.matchedKey || (barcode || query),
              rawApiResponse: externalOut._raw || externalOut,
              mappedFields: {
                  kcal: externalOut.calories,
                  protein: externalOut.protein,
                  fat: externalOut.fat,
                  carbs: externalOut.carbs
              },
              fieldMappingUsed: externalOut._mapping || { error: 'Mapping details missing for source: ' + externalOut.source },
              fallbackReason: `Failed category validation for ${inferCategoryFromKey(normalizedKey)}`,
          });
          
      } else {
        // External API succeeded and passed validation
        pipelineStats.externalHits++;
        out = externalOut; // Use the valid external result

        // Log external success
        if (out.source !== 'rapidapi') { 
          structuredLog('NUTRITION_LOOKUP', {
            normalizedKeyInput: normalizedKey,
            lookupTier: 'external',
            externalApiQuery: barcode || query,
            externalApiProductName: (out._raw && (out._raw.product_name || out._raw.name)) || out.matchedKey || (barcode || query),
            rawApiResponse: out._raw || out,
            mappedFields: {
              kcal: out.calories,
              protein: out.protein,
              fat: out.fat,
              carbs: out.carbs
            },
            fieldMappingUsed: out._mapping || { error: 'Mapping details missing for source: ' + out.source },
            fallbackReason: null,
          });
        }
        
        // Clean up temporary logging fields before caching final result
        delete out._raw;
        delete out._mapping;
      }
    }
  }

  // --- TIER 5: Final Cache & Return ---
  await cacheSet(finalKey, out, TTL_FINAL_MS);
  
  const totalLatency = Date.now() - overallStart;
  log(`[NUTRI] Pipeline complete (${out.source}) [${totalLatency}ms]`, 'DEBUG', 'PIPELINE');
  
  return out;
}

// ---------- HTTP handler ----------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { barcode, query } = req.query;
    // For BC: Uses barcode and product name (query) to potentially hit external APIs
    const data = await fetchNutritionData(barcode, query, console.log);
    if (data.status === 'found') return res.status(200).json(data);
    return res.status(404).json(data);
  } catch (e) {
    console.error('nutrition-search handler error', e);
    pipelineStats.errors++;
    return res.status(500).json({ status: 'error', message: e.message });
  }
};

module.exports.fetchNutritionData = fetchNutritionData;
module.exports.lookupIngredientNutrition = lookupIngredientNutrition; // MOD ZONE 1: NEW EXPORT
module.exports.getHotPathStats = getHotPathStats;
module.exports.getPipelineStats = getPipelineStats;
module.exports.resetPipelineStats = resetPipelineStats;
module.exports.inferCategoryFromKey = inferCategoryFromKey;
module.exports.getFallbackNutrition = getFallbackNutrition;
module.exports.FALLBACK_NUTRITION = FALLBACK_NUTRITION;
/// ========= NUTRITION-SEARCH-OPTIMIZED-END ========= \\

