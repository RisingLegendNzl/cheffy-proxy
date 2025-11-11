/// ========= NUTRITION-SEARCH-OPTIMIZED ========= \\
// File: api/nutrition-search.js
// Version: 3.0.0 - Optimized Pipeline with Hot-Path
// Pipeline: HOT-PATH → Canonical (fuzzy) → Avocavo → OFF → USDA
// Target: Sub-second lookups, 95%+ hit rate on tiers 1-2

const fetch = require('node-fetch');
const { createClient } = require('@vercel/kv');

// — Hot-Path Module (Ultra-fast, top 50 ingredients) —
const { getHotPath, isHotPath, getHotPathStats } = require('./nutrition-hotpath.js');

// — Canonical Database —
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

// — Normalization with Fuzzy Matching —
const {
  normalizeKey,
  getFuzzyMatchCandidates,
  findBestFuzzyMatch
} = require('../scripts/normalize.js');

// ––––– ENV & CONSTANTS –––––
const AVOCAVO_URL = 'https://app.avocavo.app/api/v2';
const AVOCAVO_KEY = process.env.AVOCAVO_API_KEY || '';
const USDA_KEY    = process.env.USDA_API_KEY || '';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// — Cache version includes both hot-path and canon version —
const CACHE_PREFIX = `nutri:v9:hot:cv:${CANON_VERSION}`; // Bumped to v9 for hot-path
const TTL_FINAL_MS = 1000 * 60 * 60 * 24 * 7;  // 7 days
const TTL_AVO_Q_MS = 1000 * 60 * 60 * 24 * 7;  // 7 days
const TTL_AVO_U_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TTL_NAME_MS  = 1000 * 60 * 60 * 24 * 7;  // 7 days
const TTL_BAR_MS   = 1000 * 60 * 60 * 24 * 30; // 30 days
const KJ_TO_KCAL   = 4.184;

// ––––– KV + Memory cache –––––
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

// ––––– Utilities –––––
const normFood = (q = '') => q.replace(/\bbananas\b/i, 'banana');
function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function withTimeout(promise, ms = 8000) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
function softLog(name, q) { try { console.log(`[NUTRI] ${name}: ${q}`); } catch {} }

// ––––– Tier 1: HOT-PATH Lookup (Target: <5ms) –––––
/**
 * - Attempts hot-path lookup for ultra-common ingredients.
 * - This is pure in-memory, no I/O.
 * - 
 * - @param {string} query - The ingredient query
 * - @param {function} log - Logger function
 * - @returns {object | null} Nutrition data or null
 */
function lookupHotPath(query, log = console.log) {
  if (!query) return null;

  const startTime = Date.now();
  const normalizedKey = normalizeKey(query);

  const result = getHotPath(normalizedKey);
  const latency = Date.now() - startTime;

  if (result) {
    log(`[NUTRI] HOT-PATH HIT for: ${query} (key: ${normalizedKey}) [${latency}ms]`, 'INFO', 'HOT_PATH');
    return result;
  }

  log(`[NUTRI] HOT-PATH MISS for: ${query} (key: ${normalizedKey}) [${latency}ms]`, 'DEBUG', 'HOT_PATH');
  return null;
}

// ––––– Tier 2: Canonical Lookup with Fuzzy Matching (Target: <50ms) –––––
/**
 * - Attempts to find nutrition data in the canonical database.
 * - Uses exact match first, then fuzzy matching variants.
 * - 
 * - @param {string} query - The ingredient query
 * - @param {function} log - Logger function
 * - @returns {object | null} Nutrition data or null
 */
function lookupCanonical(query, log = console.log) {
  if (!query) return null;

  const startTime = Date.now();
  const normalizedKey = normalizeKey(query);

  // 1. Try exact match first
  let canonData = canonGet(normalizedKey);
  if (canonData) {
    const latency = Date.now() - startTime;
    log(`[NUTRI] CANONICAL HIT (exact) for: ${query} (key: ${normalizedKey}) [${latency}ms]`, 'INFO', 'CANON');
    return transformCanonToOutput(canonData, normalizedKey);
  }

  // 2. Try fuzzy match candidates
  const candidates = getFuzzyMatchCandidates(normalizedKey);
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    canonData = canonGet(candidate);
    if (canonData) {
      const latency = Date.now() - startTime;
      log(`[NUTRI] CANONICAL HIT (fuzzy: ${normalizedKey} → ${candidate}) for: ${query} [${latency}ms]`, 'INFO', 'CANON');
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
        log(`[NUTRI] CANONICAL HIT (Levenshtein: ${normalizedKey} → ${fuzzyMatch.key}, distance: ${fuzzyMatch.distance}) for: ${query} [${latency}ms]`, 'INFO', 'CANON');
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

// ––––– USDA link helpers –––––
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

// ––––– Nutrition validation (calorie balance sanity) –––––
function accept(out) {
  const P = Number(out.protein), F = Number(out.fat), C = Number(out.carbs), K = Number(out.calories);
  if (!(K > 0 && P >= 0 && F >= 0 && C >= 0)) return false;
  const est = 4 * P + 4 * C + 9 * F;
  return Math.abs(K - est) / Math.max(1, K) <= 0.12;
}

// ––––– Tier 3: Avocavo API –––––
function pick(obj, keys) { for (const k of keys) { const v = obj && obj[k]; if (v != null) return Number(v); } return null; }
function extractAvocavoNutrition(n, raw) {
  if (!n) return null;
  const src = n.per_100g || n;
  const calories = pick(src, ['calories_total', 'energy_kcal', 'calories']);
  const protein  = pick(src, ['protein_total', 'proteins', 'protein']);
  const fat      = pick(src, ['total_fat_total', 'fat', 'total_fat']);
  const carbs    = pick(src, ['carbohydrates_total', 'carbohydrates', 'carbs']);
  if ([calories, protein, fat, carbs].some(v => v == null)) return null;
  if (calories === 0 && protein === 0 && fat === 0 && carbs === 0) return null;
  const fdcId = extractFdcId(src) || extractFdcId(n) || extractFdcId(raw);
  const out = { status: 'found', source: 'avocavo', servingUnit: '100g', calories, protein, fat, carbs, fdcId, usda_link: usdaLinkFromId(fdcId) };
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

// ––––– Tier 4: OpenFoodFacts –––––
async function offByBarcode(b) {
  const key = `${CACHE_PREFIX}:offb:${b}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const res = await withTimeout(fetch(`https://world.openfoodfacts.org/api/v0/product/${b}.json`));
    const j = await res.json().catch(() => null);
    if (j?.status !== 1) return null;
    const p = j.product; const n = p?.nutriments; if (!n) return null;
    const kcal = toNumber(n['energy-kcal_100g']) || (toNumber(n['energy-kj_100g']) ? toNumber(n['energy-kj_100g']) / KJ_TO_KCAL : null);
    const protein = toNumber(n.proteins_100g);
    const fat = toNumber(n.fat_100g);
    const carbs = toNumber(n.carbohydrates_100g);
    if ([kcal, protein, fat, carbs].some(v => v == null)) return null;
    const out = { status: 'found', source: 'off', servingUnit: '100g', calories: kcal, protein, fat, carbs, fdcId: null, usda_link: null };
    if (accept(out)) { await cacheSet(key, out, TTL_BAR_MS); return out; }
  } catch {}
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
      const out = { status: 'found', source: 'off', servingUnit: '100g', calories: kcal, protein, fat, carbs, fdcId: null, usda_link: null };
      if (accept(out)) { await cacheSet(key, out, TTL_NAME_MS); return out; }
    }
  } catch {}
  return null;
}

// ––––– Tier 5: USDA –––––
async function usdaByQuery(q) {
  if (!USDA_KEY) return null;
  const key = `${CACHE_PREFIX}:usda:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
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
      if ([kcal, protein, fat, carbs].some(v => v == null)) continue;
      const fdcId = extractFdcId(f);
      const out = { status: 'found', source: 'usda', servingUnit: '100g', calories: kcal, protein, fat, carbs, fdcId, usda_link: usdaLinkFromId(fdcId) };
      if (accept(out)) { await cacheSet(key, out, TTL_NAME_MS); return out; }
    }
  } catch {}
  return null;
}

// ––––– MAIN FETCH FUNCTION with Optimized Pipeline –––––
async function fetchNutritionData(barcode, query, log = console.log) {
  const overallStart = Date.now();
  query = normFood(query);

  // — TIER 1: HOT-PATH (Target: <5ms) —
  if (query) {
    const hotResult = lookupHotPath(query, log);
    if (hotResult) {
      const totalLatency = Date.now() - overallStart;
      log(`[NUTRI] Pipeline complete (HOT-PATH) [${totalLatency}ms]`, 'DEBUG', 'PIPELINE');
      return hotResult;
    }
  }

  // — TIER 2: CANONICAL (Target: <50ms) —
  if (query) {
    const canonResult = lookupCanonical(query, log);
    if (canonResult) {
      const totalLatency = Date.now() - overallStart;
      log(`[NUTRI] Pipeline complete (CANONICAL) [${totalLatency}ms]`, 'DEBUG', 'PIPELINE');
      return canonResult;
    }
  }

  // — TIER 3-5: EXTERNAL APIs (Cache first) —
  const finalKey = `${CACHE_PREFIX}:final:${normalizeKey(barcode || query || '')}`;
  const cached = await cacheGet(finalKey);
  if (cached) {
    const totalLatency = Date.now() - overallStart;
    log(`[NUTRI] Pipeline complete (CACHE) [${totalLatency}ms]`, 'DEBUG', 'PIPELINE');
    return cached;
  }

  log(`[NUTRI] External API Cache MISS for: ${query || barcode}`, 'DEBUG', 'CACHE');

  // Run external APIs in parallel
  const tasks = [];
  if (barcode) tasks.push(tryAvocavo(barcode, true));
  if (query)   tasks.push(tryAvocavo(query, false), offByQuery(query), usdaByQuery(query));

  let out = null;
  if (tasks.length) {
    try { out = await Promise.race(tasks.map(t => t.then(v => v || null).catch(() => null))); }
    catch { out = null; }
  }

  if (!out && barcode) out = await offByBarcode(barcode);
  if (!out && query)   out = await offByQuery(query) || await usdaByQuery(query);

  if (!out) {
    out = {
      status: 'not_found',
      source: 'error',
      reason: 'no_source_succeeded',
      searchedKey: query ? normalizeKey(query) : null,
      usda_link: null
    };
  }

  await cacheSet(finalKey, out, TTL_FINAL_MS);

  const totalLatency = Date.now() - overallStart;
  log(`[NUTRI] Pipeline complete (EXTERNAL) [${totalLatency}ms]`, 'DEBUG', 'PIPELINE');

  return out;
}

// ––––– HTTP handler –––––
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { barcode, query } = req.query;
    const data = await fetchNutritionData(barcode, query, console.log);
    if (data.status === 'found') return res.status(200).json(data);
    return res.status(404).json(data);
  } catch (e) {
    console.error('nutrition-search handler error', e);
    return res.status(500).json({ status: 'error', message: e.message });
  }
};

module.exports.fetchNutritionData = fetchNutritionData;
module.exports.getHotPathStats = getHotPathStats;
/// ========= NUTRITION-SEARCH-OPTIMIZED-END ========= \\

