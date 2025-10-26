/// ========= NUTRITION-SEARCH-START ========= \\\\
// File: api/nutrition-search.js
// Purpose: Fetch nutrition per 100g from OFF → USDA with improved hit selection, unit parsing, and canonical fallbacks.
// Exports:
//   - module.exports = handler(req,res)
//   - module.exports.fetchNutritionData = fetchNutritionData(barcode, query, log)
//
// This version aligns Canonical keys with normalizeKey(query) and improves USDA parsing.

const fetch = require('node-fetch');
const { createClient } = require('@vercel/kv');

// --- KV client (Upstash via Vercel KV) ---
const kv = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// --- CACHE CONFIGURATION ---
const TTL_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 30; // 30d
const SWR_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 10;
const TTL_NUTRI_NAME_MS    = 1000 * 60 * 60 * 24 * 7;  // 7d
const SWR_NUTRI_NAME_MS    = 1000 * 60 * 60 * 24 * 2;
const CACHE_PREFIX_NUTRI   = 'nutri';

// --- USDA API CONFIGURATION ---
const USDA_API_KEY      = process.env.USDA_API_KEY;
const USDA_SEARCH_URL   = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_DETAILS_URL  = 'https://api.nal.usda.gov/fdc/v1/food/'; // Append {fdcId}?api_key=...
const USDA_FETCH_TIMEOUT_MS = 8000;

// --- TOKEN BUCKET CONFIGURATION (USDA) ---
const BUCKET_CAPACITY = 10;
const BUCKET_REFILL_RATE = 1; // 1 req/sec
const BUCKET_RETRY_DELAY_MS = 1100;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// --- CONSTANT FOR UNIT CONVERSION ---
const KJ_TO_KCAL_FACTOR = 4.184;

// ---- Canonical fallbacks (per 100 g). Keys are normalizeKey(query). ----
const CANONICAL_NUTRITION_TABLE_V1 = {
  banana_fresh:               { calories: 89,  protein: 1.1,  fat: 0.3,  carbs: 22.8, fiber: 2.6, sodium: 0.001 },
  wholegrain_bread_slice:     { calories: 250, protein: 10,   fat: 3.5,  carbs: 40,   fiber: 7,   sodium: 0.450 },
  canned_tuna_in_water:       { calories: 110, protein: 25,   fat: 1.0,  carbs: 0,    fiber: 0,   sodium: 0.350 },
  tuna_in_brine_drained:      { calories: 116, protein: 26,   fat: 0.8,  carbs: 0,    fiber: 0,   sodium: 0.300 },
  canola_oil_spray:           { calories: 884, protein: 0,    fat: 100,  carbs: 0,    fiber: 0,   sodium: 0     },
  olive_oil:                  { calories: 884, protein: 0,    fat: 100,  carbs: 0,    fiber: 0,   sodium: 0     },
  rolled_oats_dry:            { calories: 389, protein: 16.9, fat: 6.9,  carbs: 66.3, fiber: 10,  sodium: 0.005 },
  brown_rice_raw:             { calories: 360, protein: 7.5,  fat: 2.7,  carbs: 76,   fiber: 3.4, sodium: 0.005 },
  white_rice_raw:             { calories: 360, protein: 7,    fat: 0.7,  carbs: 79,   fiber: 1,   sodium: 0.005 },
  smooth_peanut_butter:       { calories: 590, protein: 25,   fat: 50,   carbs: 16,   fiber: 6,   sodium: 0.450 },
  egg_whole_raw:              { calories: 143, protein: 12.6, fat: 9.5,  carbs: 0.7,  fiber: 0,   sodium: 0.124 },
  soy_sauce_reduced_sodium:   { calories: 53,  protein: 8.1,  fat: 0.6,  carbs: 4.9,  fiber: 0,   sodium: 0.550 },
  bread_white:                { calories: 265, protein: 9,    fat: 3.2,  carbs: 49,   fiber: 2.7, sodium: 0.490 }
};

// Track ongoing refreshes
const inflightRefreshes = new Set();

// Normalize cache keys
const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');

// Check if KV is configured
const isKvConfigured = () => {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
};

// ---------- Helpers ----------
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}
function safeLog(log, msg, level='INFO', tag='NUTRITION', data=null) {
  try { (log || console.log)(msg, level, tag, data); } catch {}
}
function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }

// --------- USDA selection improvements ---------
function pickBestFdc(list, query) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const q = (query || '').toLowerCase();
  const NEG = [/rolls?/i, /bread/i, /muesli/i, /bran/i, /white\s*only/i];
  const S = (h) => {
    const d = (h.description || '').toLowerCase();
    const c = (h.foodCategory || '').toLowerCase();
    let s = 0;
    if (d.includes('rolled oats')) s += 6;
    if (d.includes('oats')) s += 2;
    if (d.includes('egg, whole') || d.includes('whole, raw')) s += 6;
    if (d.includes('egg white')) s -= 6;
    if (d.includes('soy sauce') && d.includes('low sodium')) s += 6;
    if (NEG.some(r => r.test(d))) s -= 8;
    if (c.includes('grain') || c.includes('cereal')) s += 1;
    if (c.includes('eggs')) s += 1;
    if (d.includes(q)) s += 1;
    return s;
  };
  return [...list].sort((a, b) => S(b) - S(a))[0];
}

// ---------- USDA Normalizer (improved unit handling) ----------
function normalizeUsdaResponse(usdaDetailsResponse, query, log) {
  const defaultResult = { complete: false, reason: 'unknown', data: null };

  if (!usdaDetailsResponse || !Array.isArray(usdaDetailsResponse.foodNutrients)) {
    safeLog(log, `USDA: No valid foodNutrients array for query: ${query} (FDC ID: ${usdaDetailsResponse?.fdcId})`, 'WARN', 'USDA_PARSE');
    defaultResult.reason = 'no_foodNutrients_array';
    return defaultResult;
  }

  const nutrients = usdaDetailsResponse.foodNutrients;
  const foodDescription = usdaDetailsResponse.description || 'Unknown Food';
  const fdcId = usdaDetailsResponse.fdcId || 'N/A';
  safeLog(log, `USDA: Normalizing response for "${foodDescription}" (FDC ID: ${fdcId})`, 'DEBUG', 'USDA_PARSE', { nutrientCount: nutrients.length });

  // Helper to find and scale nutrient value to per 100g, handling g/mg/mcg/kcal/kJ and blank units
  const getNutrientPer100g = (nutrientIds, targetUnit, nameHints = []) => {
    let valueFound = null;
    let unitFound = '';

    for (const nutrientId of nutrientIds) {
      const nutrient = nutrients.find(n => n.nutrient?.id === nutrientId && n.amount !== undefined && n.amount !== null);
      if (nutrient) {
        const amount = parseFloat(nutrient.amount);
        const unit = (nutrient.unitName || '').toUpperCase();
        if (!isNaN(amount)) {
          unitFound = unit;
          // Accept blank unit as target
          if (!unit || unit === targetUnit.toUpperCase()) {
            valueFound = amount;
            break;
          }
          // Conversions
          if (targetUnit.toUpperCase() === 'G' && unit === 'MG') { valueFound = amount / 1000; unitFound = 'MG -> G'; break; }
          if (targetUnit.toUpperCase() === 'G' && unit === 'MCG') { valueFound = amount / 1_000_000; unitFound = 'MCG -> G'; break; }
          if (targetUnit.toUpperCase() === 'KCAL' && unit === 'KJ') { valueFound = amount / KJ_TO_KCAL_FACTOR; unitFound = 'KJ -> KCAL'; break; }
        }
      }
    }

    if (valueFound !== null) {
      safeLog(log, `USDA: Final value for ${targetUnit} = ${valueFound} (${unitFound || 'unit-ok'})`, 'INFO', 'USDA_PARSE_RESULT');
      return valueFound;
    }

    // Fallback by nutrient name string matching
    if (nameHints.length) {
      const hit = nutrients.find(x => nameHints.some(h => String(x.nutrient?.name || '').toLowerCase().includes(h)));
      if (hit && Number.isFinite(hit.amount)) return hit.amount;
    }
    return null;
  };

  const kcalIds   = [1008, 208];
  const proteinIds= [1003, 203];
  const fatIds    = [1004, 204];
  const carbIds   = [1005, 205];
  const satFatIds = [1258, 606];
  const sugarsIds = [2000, 269];
  const fiberIds  = [1079, 291];
  const sodiumIds = [1093, 307];

  const calories = getNutrientPer100g(kcalIds, 'KCAL', ['energy']);
  const protein  = getNutrientPer100g(proteinIds, 'G', ['protein']);
  const fat      = getNutrientPer100g(fatIds, 'G', ['fat']);
  const carbs    = getNutrientPer100g(carbIds, 'G', ['carbohydrate']);

  const coreMacrosValid = (
    calories !== null && calories > 0 &&
    protein  !== null && protein  >= 0 &&
    fat      !== null && fat      >= 0 &&
    carbs    !== null && carbs    >= 0
  );

  if (!coreMacrosValid) {
    safeLog(log, `USDA: Core macros missing/invalid for "${foodDescription}" (FDC ID: ${fdcId})`, 'WARN', 'USDA_PARSE_FAIL', { calories, protein, fat, carbs });
    defaultResult.reason = 'core_macros_missing_or_invalid';
    return defaultResult;
  }

  const saturatedFat = getNutrientPer100g(satFatIds, 'G') ?? 0;
  const sugars       = getNutrientPer100g(sugarsIds, 'G') ?? 0;
  const fiber        = getNutrientPer100g(fiberIds, 'G') ?? 0;
  const sodium       = getNutrientPer100g(sodiumIds, 'G') ?? 0;

  const ingredientsText = usdaDetailsResponse.inputFoods?.map(f => f.foodDescription).join(', ')
    || usdaDetailsResponse.ingredients || foodDescription || null;

  return {
    complete: true,
    reason: 'success',
    data: {
      status: 'found',
      source: 'usda',
      servingUnit: '100g',
      calories, protein, fat, carbs,
      saturatedFat, sugars, fiber, sodium,
      ingredientsText
    }
  };
}

// ---------- USDA fetch with improved selection ----------
async function _fetchUsdaFromApi(query, log = console.log) {
  if (!USDA_API_KEY) {
    safeLog(log, 'Configuration Error: USDA_API_KEY is not set.', 'CRITICAL', 'CONFIG');
    return { error: { message: 'Server configuration error: USDA API key missing.', status: 500 }, source: 'usda_config' };
  }

  let searchTimeoutId, detailsTimeoutId;
  const searchAbortController = new AbortController();
  const detailsAbortController = new AbortController();

  try {
    // Search
    searchTimeoutId = setTimeout(() => searchAbortController.abort(), USDA_FETCH_TIMEOUT_MS);
    const searchUrl = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=10&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS),Branded`;
    safeLog(log, `USDA search: ${query}`, 'DEBUG', 'USDA_REQUEST', { url: `${USDA_SEARCH_URL}?query=...` });
    const sres = await fetch(searchUrl, { signal: searchAbortController.signal });
    clearTimeout(searchTimeoutId);
    if (!sres.ok) {
      if (sres.status === 429) { const e = new Error('USDA API rate limit hit (search)'); e.statusCode = 429; throw e; }
      const body = await sres.text();
      return { error: { message: `USDA search failed. Status: ${sres.status}`, status: sres.status, details: body }, source: 'usda_search' };
    }
    const sjson = await sres.json();
    const foods = sjson?.foods || [];
    if (!foods.length) return { error: { message: 'No results found in USDA search', status: 404 }, source: 'usda_search_no_results' };

    // Choose best FDC
    const best = pickBestFdc(foods, query) || foods[0];
    const bestFdcId = best.fdcId;
    safeLog(log, `USDA selected FDC ${bestFdcId} (${best.description})`, 'INFO', 'USDA_SELECT');

    // Details
    detailsTimeoutId = setTimeout(() => detailsAbortController.abort(), USDA_FETCH_TIMEOUT_MS);
    const durl = `${USDA_DETAILS_URL}${bestFdcId}?api_key=${USDA_API_KEY}`;
    const dres = await fetch(durl, { signal: detailsAbortController.signal });
    clearTimeout(detailsTimeoutId);
    if (!dres.ok) {
      if (dres.status === 429) { const e = new Error('USDA API rate limit hit (details)'); e.statusCode = 429; throw e; }
      const body = await dres.text();
      return { error: { message: `USDA details fetch failed. Status: ${dres.status}`, status: dres.status, details: body }, source: 'usda_details' };
    }
    const food = await dres.json();
    return food;
  } catch (error) {
    clearTimeout(searchTimeoutId);
    clearTimeout(detailsTimeoutId);
    if (error.name === 'AbortError') {
      return { error: { message: `USDA ${detailsTimeoutId ? 'details' : 'search'} fetch timed out.`, status: 504 }, source: `usda_${detailsTimeoutId ? 'details' : 'search'}_timeout`, timeout_ms: USDA_FETCH_TIMEOUT_MS };
    }
    if (error.statusCode === 429) throw error;
    return { error: { message: `USDA network/fetch error: ${error.message}`, status: 504 }, source: 'usda_fetch_error' };
  } finally {
    clearTimeout(searchTimeoutId);
    clearTimeout(detailsTimeoutId);
  }
}

// ---------- Token-bucket wrapper for USDA ----------
async function fetchUsdaSafe(query, log = console.log) {
  const bucketKey = `bucket:usda`;
  const refillRatePerMs = BUCKET_REFILL_RATE / 1000;

  while (true) {
    const now = Date.now();
    let bucketState = null;
    if (isKvConfigured()) {
      try { bucketState = await kv.get(bucketKey); }
      catch (e) { safeLog(log, `KV GET failed for bucket. Bypass limiter.`, 'CRITICAL', 'KV_ERROR'); break; }
    }
    if (!bucketState) {
      if (isKvConfigured()) { try { await kv.set(bucketKey, { tokens: BUCKET_CAPACITY - 1, lastRefill: now }, { ex: 86400 }); } catch {} }
      break;
    }
    const elapsedMs = now - bucketState.lastRefill;
    const tokensToAdd = elapsedMs * refillRatePerMs;
    let tokens = Math.min(BUCKET_CAPACITY, bucketState.tokens + tokensToAdd);
    if (tokens >= 1) {
      tokens -= 1;
      if (isKvConfigured()) { try { await kv.set(bucketKey, { tokens, lastRefill: now }, { ex: 86400 }); } catch {} }
      break;
    } else {
      const waitTime = Math.max(50, Math.ceil((1 - tokens) / refillRatePerMs));
      safeLog(log, `USDA limiter wait ${waitTime}ms`, 'INFO', 'BUCKET_WAIT');
      await delay(waitTime);
    }
  }

  try {
    const data = await _fetchUsdaFromApi(query, log);
    return { data };
  } catch (error) {
    if (error.statusCode === 429) {
      safeLog(log, `USDA 429. Retrying after ${BUCKET_RETRY_DELAY_MS}ms`, 'WARN', 'BUCKET_RETRY');
      await delay(BUCKET_RETRY_DELAY_MS);
      const retryData = await _fetchUsdaFromApi(query, log);
      return { data: retryData };
    }
    return { data: { error: { message: `Unexpected error during safe USDA fetch: ${error.message}`, status: error.status || 500 }, source: error.source || 'usda_safe' } };
  }
}

// ---------- OpenFoodFacts ----------
async function offByBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
  const res = await withTimeout(fetch(url), 15000);
  if (!res.ok) throw new Error(`OFF barcode ${res.status}`);
  const json = await res.json();
  if (!json || !json.product) return null;
  const nutr = json.product.nutriments || {};
  const to100 = (x) => toNumber(nutr[`${x}_100g`]);
  let calories = to100('energy-kcal');
  if (calories == null || calories <= 0) {
    const kj = to100('energy-kj');
    if (kj != null && kj > 0) calories = kj / KJ_TO_KCAL_FACTOR;
  }
  const protein  = to100('proteins');
  const fat      = to100('fat');
  const carbs    = to100('carbohydrates');
  if ([calories, protein, fat, carbs].some(v => v == null)) return null;
  return {
    status: 'found', source: 'openfoodfacts', servingUnit: json.product.nutrition_data_per || '100g',
    calories, protein, fat, carbs,
    saturatedFat: to100('saturated-fat') ?? 0,
    sugars: to100('sugars') ?? 0,
    fiber: to100('fiber') ?? 0,
    sodium: to100('sodium') ?? 0,
    ingredientsText: json.product.ingredients_text || null
  };
}

async function offByQuery(q) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=5`;
  const res = await withTimeout(fetch(url), 15000);
  if (!res.ok) throw new Error(`OFF query ${res.status}`);
  const json = await res.json();
  const items = json.products || [];
  for (const p of items) {
    const nutr = p.nutriments || {};
    const to100 = (x) => toNumber(nutr[`${x}_100g`]);
    let calories = to100('energy-kcal');
    if (calories == null || calories <= 0) {
      const kj = to100('energy-kj');
      if (kj != null && kj > 0) calories = kj / KJ_TO_KCAL_FACTOR;
    }
    const protein  = to100('proteins');
    const fat      = to100('fat');
    const carbs    = to100('carbohydrates');
    if ([calories, protein, fat, carbs].every(v => v != null)) {
      return {
        status: 'found', source: 'openfoodfacts', servingUnit: p.nutrition_data_per || '100g',
        calories, protein, fat, carbs,
        saturatedFat: to100('saturated-fat') ?? 0,
        sugars: to100('sugars') ?? 0,
        fiber: to100('fiber') ?? 0,
        sodium: to100('sodium') ?? 0,
        ingredientsText: p.ingredients_text || null
      };
    }
  }
  return null;
}

// ---------- Internal orchestrator OFF → USDA → Canonical ----------
async function _fetchNutritionDataFromApi(barcode, query, log = console.log) {
  let offNutritionResult = null;
  let offFetchFailed = false;
  let offIsIncomplete = false;
  let reasonIncomplete = 'n/a';

  const identifier = barcode || query;
  const identifierType = barcode ? 'barcode' : 'query';
  if (!identifier) {
    safeLog(log, 'Missing barcode or query for nutrition search.', 'WARN', 'INPUT');
    return { status: 'not_found', error: 'Missing barcode or query parameter', source: 'input_error' };
  }

  // OFF
  try {
    if (barcode) {
      offNutritionResult = await offByBarcode(barcode);
    } else if (query) {
      offNutritionResult = await offByQuery(query);
    }
    if (offNutritionResult) return offNutritionResult;
    offIsIncomplete = true;
    reasonIncomplete = 'off_incomplete_or_no_match';
  } catch (e) {
    offFetchFailed = true;
    reasonIncomplete = e.name === 'AbortError' ? 'off_timeout_15s' : `off_error_${e.message}`;
    safeLog(log, `OFF error for ${identifierType}: ${reasonIncomplete}`, 'WARN', 'OFF_FAILURE');
  }

  // USDA
  if (query) {
    const { data: usdaRawData } = await fetchUsdaSafe(query, log);
    if (usdaRawData && !usdaRawData.error) {
      const normalized = normalizeUsdaResponse(usdaRawData, query, log);
      if (normalized.complete) return normalized.data;
      reasonIncomplete = `usda_parse_fail_${normalized.reason}`;
    } else {
      reasonIncomplete = `usda_${usdaRawData?.source || 'fetch_fail'}`;
    }
  } else {
    safeLog(log, `OFF failed for barcode and no query provided`, 'WARN', 'NUTRITION_NO_QUERY');
    reasonIncomplete = offFetchFailed ? 'off_fetch_fail_no_query' : 'off_incomplete_no_query';
  }

  // Canonical
  const normalizedQuery = query ? normalizeKey(query) : null;
  if (normalizedQuery && CANONICAL_NUTRITION_TABLE_V1[normalizedQuery]) {
    const canonicalData = CANONICAL_NUTRITION_TABLE_V1[normalizedQuery];
    safeLog(log, `Using CANONICAL fallback for "${query}" (Reason: ${reasonIncomplete})`, 'INFO', 'CANONICAL_FALLBACK');
    return {
      status: 'found',
      source: 'canonical_v1',
      servingUnit: '100g',
      calories: canonicalData.calories,
      protein: canonicalData.protein,
      fat: canonicalData.fat,
      carbs: canonicalData.carbs,
      saturatedFat: canonicalData.saturatedFat ?? 0,
      sugars: canonicalData.sugars ?? 0,
      fiber: canonicalData.fiber ?? 0,
      sodium: canonicalData.sodium ?? 0,
      ingredientsText: `Generic ${query} (canonical data)`
    };
  }

  // Failure
  safeLog(log, `All nutrition sources failed for ${identifierType}: ${identifier} (Final Reason: ${reasonIncomplete})`, 'WARN', 'NUTRITION_FAIL_ALL');
  return { status: 'not_found', reason_incomplete: reasonIncomplete };
}

// ---------- SWR background refresh ----------
async function refreshInBackground(cacheKey, barcode, query, ttlMs, log, keyType) {
  if (inflightRefreshes.has(cacheKey)) {
    safeLog(log, `Nutri refresh already in progress for ${cacheKey}, skipping.`, 'DEBUG', 'SWR_SKIP', { key_type: keyType });
    return;
  }
  inflightRefreshes.add(cacheKey);
  safeLog(log, `Starting nutri background refresh for ${cacheKey}...`, 'INFO', 'SWR_REFRESH_START', { key_type: keyType });

  (async () => {
    let freshData = null;
    try {
      // Try full flow
      freshData = await _fetchNutritionDataFromApi(barcode, query, log);
      if (freshData && (freshData.status === 'found' || freshData.status === 'not_found')) {
        if (isKvConfigured()) {
          await kv.set(cacheKey, { data: freshData, ts: Date.now() }, { px: ttlMs });
          safeLog(log, `Nutri background refresh successful for ${cacheKey}`, 'INFO', 'SWR_REFRESH_SUCCESS', { status: freshData.status, source: freshData.source, key_type: keyType });
        } else {
          safeLog(log, `Nutri background refresh fetched data but KV not configured, skip set`, 'WARN', 'SWR_REFRESH_SKIP_KV');
        }
      } else {
        safeLog(log, `Nutri background refresh failed to fetch valid data`, 'WARN', 'SWR_REFRESH_FAIL', { key_type: keyType });
      }
    } catch (error) {
      safeLog(log, `Nutri background refresh error: ${error.message}`, 'ERROR', 'SWR_REFRESH_ERROR', { key_type: keyType });
    } finally {
      inflightRefreshes.delete(cacheKey);
    }
  })();
}

// ---------- Cache-wrapped public API ----------
async function fetchNutritionData(barcode, query, log = console.log) {
  const startTime = Date.now();

  if (!isKvConfigured()) {
    safeLog(log, 'UPSTASH_REDIS vars missing. Bypassing cache.', 'CRITICAL', 'CONFIG_ERROR');
    return await _fetchNutritionDataFromApi(barcode, query, log);
  }

  let cacheKey = '';
  let ttlMs = 0;
  let swrMs = 0;
  let keyType = '';

  if (!barcode && !query) {
    safeLog(log, 'Missing barcode or query for nutrition search.', 'WARN', 'INPUT');
    return { status: 'not_found', error: 'Missing barcode or query parameter', source: 'input_error' };
  }

  if (barcode) {
    cacheKey = `${CACHE_PREFIX_NUTRI}:barcode:${normalizeKey(barcode)}`;
    ttlMs = TTL_NUTRI_BARCODE_MS; swrMs = SWR_NUTRI_BARCODE_MS; keyType = 'nutri_barcode';
  } else {
    cacheKey = `${CACHE_PREFIX_NUTRI}:name:${normalizeKey(query)}`;
    ttlMs = TTL_NUTRI_NAME_MS; swrMs = SWR_NUTRI_NAME_MS; keyType = 'nutri_name';
  }

  // Cache read
  let cachedItem = null;
  try { cachedItem = await kv.get(cacheKey); } catch (e) { safeLog(log, `Cache GET error: ${e.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType }); }

  if (cachedItem && typeof cachedItem === 'object' && cachedItem.data && cachedItem.ts) {
    const ageMs = Date.now() - cachedItem.ts;
    if (ageMs < swrMs) {
      safeLog(log, `Cache Hit (Fresh) ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, age_ms: ageMs, source: cachedItem.data.source });
      return cachedItem.data;
    } else if (ageMs < ttlMs) {
      safeLog(log, `Cache Hit (Stale) ${cacheKey}. Serving stale and refreshing.`, 'INFO', 'CACHE_HIT_STALE', { key_type: keyType, age_ms: ageMs, source: cachedItem.data.source });
      refreshInBackground(cacheKey, barcode, query, ttlMs, log, keyType);
      return cachedItem.data;
    }
  }

  // Miss
  safeLog(log, `Cache Miss or Expired ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
  const fetchedData = await _fetchNutritionDataFromApi(barcode, query, log);
  const fetchLatencyMs = Date.now() - startTime;

  // Write
  if (fetchedData && (fetchedData.status === 'found' || fetchedData.status === 'not_found')) {
    try {
      await kv.set(cacheKey, { data: fetchedData, ts: Date.now() }, { px: ttlMs });
      safeLog(log, `Cache SET ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, status: fetchedData.status, source: fetchedData.source, ttl_ms: ttlMs });
    } catch (e) {
      safeLog(log, `Cache SET error: ${e.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
    }
  }

  safeLog(log, `Fetch complete ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', {
    key_type: keyType,
    status: fetchedData?.status,
    latency_ms: fetchLatencyMs,
    source_used: fetchedData?.source,
    reason_incomplete: fetchedData?.reason_incomplete
  });
  return fetchedData || { status: 'not_found', error: 'Internal fetch error', source: 'internal_error', reason_incomplete: 'internal_error' };
}

// ---------- Vercel handler ----------
module.exports = async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  try {
    const { barcode, query } = request.query;
    const log = (message, level = 'INFO', tag = 'HANDLER') => { console.log(`[${level}] [${tag}] ${message}`); };
    const nutritionData = await fetchNutritionData(barcode, query, log);
    if (nutritionData.status === 'found') {
      return response.status(200).json(nutritionData);
    } else {
      return response.status(404).json({
        status: 'not_found',
        message: nutritionData.error || 'Nutrition data not found via OFF, USDA, or Canonical.',
        reason: nutritionData.reason_incomplete
      });
    }
  } catch (error) {
    console.error('Handler error:', error);
    return response.status(500).json({ status: 'error', message: 'Internal server error in nutrition handler.', details: error.message });
  }
};

// Export for orchestrator
module.exports.fetchNutritionData = fetchNutritionData;
/// ========= NUTRITION-SEARCH-END ========= \\\\
