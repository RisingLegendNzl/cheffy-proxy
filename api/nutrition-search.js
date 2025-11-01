/// ========= NUTRITION-SEARCH-START ========= \\\\
// File: api/nutrition-search.js
// [MODIFIED] Pipeline: Canonical → Avocavo → OFF → USDA
// Caching: Memory + Upstash (Vercel KV) incl. final-response cache

const fetch = require('node-fetch');
const { createClient } = require('@vercel/kv');

// --- [NEW] CommonJS imports for our new modules ---
// Use require for CommonJS compatibility

// --- [MODIFICATION] Add defensive try/catch for the _canon.js import ---
let CANON_VERSION = '0.0.0-detached';
let canonGet = () => null;
try {
  // This file is generated at build time. If it fails, we fallback.
  const canonModule = require('./_canon.js'); 
  CANON_VERSION = canonModule.CANON_VERSION;
  canonGet = canonModule.canonGet;
  console.log(`[nutrition-search] Successfully loaded _canon.js version ${CANON_VERSION}`);
} catch (e) {
  console.warn('[nutrition-search] WARN: Could not load _canon.js. Canonical DB will be unavailable. Error:', e.message);
}
// --- [END MODIFICATION] ---

const { normalizeKey } = require('../scripts/normalize.js'); 
// --- [END NEW] ---

// ---------- ENV & CONSTANTS ----------
const AVOCAVO_URL = 'https://app.avocavo.app/api/v2';
const AVOCAVO_KEY = process.env.AVOCAVO_API_KEY || '';
const USDA_KEY    = process.env.USDA_API_KEY || '';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// --- [MODIFIED] Cache key now includes CANON_VERSION ---
const CACHE_PREFIX = `nutri:v7:cv:${CANON_VERSION}`;
const TTL_FINAL_MS = 1000 * 60 * 60 * 24 * 7;
const TTL_AVO_Q_MS = 1000 * 60 * 60 * 24 * 7;
const TTL_AVO_U_MS = 1000 * 60 * 60 * 24 * 30;
const TTL_NAME_MS  = 1000 * 60 * 60 * 24 * 7;
const TTL_BAR_MS   = 1000 * 60 * 60 * 24 * 30;
const KJ_TO_KCAL   = 4.184;

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

// ---------- Utilities ----------
// --- [DELETED] Old local normalizeKey function (now imported) ---
const normFood = (q = '') => q.replace(/\bbananas\b/i, 'banana');
function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function withTimeout(promise, ms) { return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
function softLog(name, q) { try { console.log(`[NUTRI] ${name}: ${q}`); } catch {} }

// --- [DELETED] Old CANON object and canonical() function ---

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

// ---------- Avocavo strict extractor ----------
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

// ---------- Avocavo calls ----------
async function avocavoIngredient(q) {
  if (!AVOCAVO_KEY) return null;
  const key = `${CACHE_PREFIX}:avq:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const res = await withTimeout(fetch(`${AVOCAVO_URL}/nutrition/ingredient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AVOCAVO_KEY },
      body: JSON.stringify({ ingredient: q })
    }), 10000);
    const j = await res.json().catch(() => null);
    const n = j?.nutrition || j?.result?.nutrition || j?.results?.[0]?.nutrition || null;
    const out = extractAvocavoNutrition(n, j);
    if (!out) return null;
    await cacheSet(key, out, TTL_AVO_Q_MS);
    return out;
  } catch { softLog('avocavo:ingredient timeout', q); return null; }
}
async function avocavoUPC(barcode) {
  if (!AVOCAVO_KEY) return null;
  const key = `${CACHE_PREFIX}:avupc:${normalizeKey(barcode)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const res = await withTimeout(fetch(`${AVOCAVO_URL}/upc/ingredient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AVOCAVO_KEY },
      body: JSON.stringify({ upc: String(barcode) })
    }), 10000);
    const j = await res.json().catch(() => null);
    const n = j?.product?.nutrition || j?.nutrition || null;
    const out = extractAvocavoNutrition(n, j);
    if (!out) return null;
    await cacheSet(key, out, TTL_AVO_U_MS);
    return out;
  } catch { softLog('avocavo:upc timeout', barcode); return null; }
}
async function tryAvocavo(arg, isUPC) {
  try { return await withTimeout(isUPC ? avocavoUPC(arg) : avocavoIngredient(arg), 3500); }
  catch { return null; }
}

// ---------- OpenFoodFacts ----------
async function offByBarcode(barcode) {
  const key = `${CACHE_PREFIX}:off:barcode:${normalizeKey(barcode)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
    const res = await withTimeout(fetch(url), 12000);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json || !json.product) return null;
    const nutr = json.product.nutriments || {};
    const kcal = nutr['energy-kcal_100g'] ?? (nutr['energy-kj_100g'] ? nutr['energy-kj_100g'] / KJ_TO_KCAL : null);
    const out = {
      status: 'found', source: 'openfoodfacts', servingUnit: '100g', usda_link: null,
      calories: toNumber(kcal),
      protein:  toNumber(nutr['proteins_100g']),
      fat:      toNumber(nutr['fat_100g']),
      carbs:    toNumber(nutr['carbohydrates_100g'])
    };
    if (!accept(out)) return null;
    await cacheSet(key, out, TTL_BAR_MS);
    return out;
  } catch { softLog('off:barcode timeout', barcode); return null; }
}
async function offByQuery(q) {
  const key = `${CACHE_PREFIX}:off:query:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=3`;
    const res = await withTimeout(fetch(url), 12000);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const items = json?.products || [];
    for (const p of items) {
      const nutr = p.nutriments || {};
      const kcal = nutr['energy-kcal_100g'] ?? (nutr['energy-kj_100g'] ? nutr['energy-kj_1D.1:200g'] / KJ_TO_KCAL : null);
      const out = {
        status: 'found', source: 'openfoodfacts', servingUnit: '100g', usda_link: null,
        calories: toNumber(kcal),
        protein:  toNumber(nutr['proteins_100g']),
        fat:      toNumber(nutr['fat_100g']),
        carbs:    toNumber(nutr['carbohydrates_100g'])
      };
      if (!accept(out)) continue;
      await cacheSet(key, out, TTL_NAME_MS);
      return out;
    }
    return null;
  } catch { softLog('off:query timeout', q); return null; }
}

// ---------- USDA ----------
function pickBestFdc(list, query) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const q = (query || '').toLowerCase();
  // lightweight scoring
  const score = (h) => {
    const d = (h.description || '').toLowerCase();
    let s = 0;
    if (q && d.includes(q)) s += 3;
    if (d.includes('low sodium') || d.includes('reduced sodium')) s += 1;
    if (d.includes('egg white')) s -= 2;
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0];
}
async function usdaByQuery(q) {
  if (!USDA_KEY) return null;
  const key = `${CACHE_PREFIX}:usda:${normalizeKey(q)}`;
  const c = await cacheGet(key); if (c) return c;
  try {
    const sURL = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_KEY}&query=${encodeURIComponent(q)}&pageSize=7`;
    const sres = await withTimeout(fetch(sURL), 12000);
    if (!sres.ok) return null;
    const sjson = await sres.json().catch(() => null);
    const foods = sjson?.foods || [];
    if (!foods.length) return null;
    const best = pickBestFdc(foods, q) || foods[0];
    const id = best.fdcId;
    const dURL = `https://api.nal.usda.gov/fdc/v1/food/${id}?api_key=${USDA_KEY}`;
    const dres = await withTimeout(fetch(dURL), 12000);
    if (!dres.ok) return null;
    const food = await dres.json().catch(() => null);
    const arr = food?.foodNutrients || [];

    const findAmt = (ids) => {
      for (const i of ids) {
        const n = arr.find(x => x.nutrient?.id === i);
        if (n && Number.isFinite(n.amount)) return n.amount;
      }
      return null;
    };
    const calories = findAmt([1008, 208]);
    const protein  = findAmt([1003, 203]);
    const fat      = findAmt([1004, 204]);
    const carbs    = findAmt([1005, 205]);
    if ([calories, protein, fat, carbs].some(v => v == null)) return null;

    const out = {
      status: 'found', source: 'usda', servingUnit: '100g',
      calories, protein, fat, carbs,
      fdcId: String(id), usda_link: usdaLinkFromId(String(id))
    };
    if (!accept(out)) return null;
    await cacheSet(key, out, TTL_NAME_MS);
    return out;
  } catch { softLog('usda:query timeout', q); return null; }
}

// ---------- [MODIFIED] Resolver (Canonical-First) ----------
async function fetchNutritionData(barcode, query, log = console.log) {
  query = query ? normFood(query) : query;
  
  // --- [NEW] Step 1: Check Canonical DB First ---
  if (query) {
    const key = normalizeKey(query); // Use shared normalizer
    const canonData = canonGet(key); // Use imported getter
    if (canonData) {
      log(`[NUTRI] Canonical HIT for: ${query} (key: ${key})`, 'INFO', 'CANON');
      // Transform CanonRow to the expected output format
      return {
        status: 'found',
        source: 'CANON', // Use 'CANON' as the source
        servingUnit: '100g',
        usda_link: null, // No USDA link for canonical data
        calories: canonData.kcal_per_100g,
        protein: canonData.protein_g_per_100g,
        fat: canonData.fat_g_per_100g,
        carbs: canonData.carb_g_per_100g,
        // Add fiber and other details
        fiber: canonData.fiber_g_per_100g,
        notes: canonData.notes,
        version: CANON_VERSION
      };
    }
    log(`[NUTRI] Canonical MISS for: ${query} (key: ${key})`, 'DEBUG', 'CANON');
  }
  // --- [END NEW] ---

  // --- Step 2: Check Cache (for external API results) ---
  // Cache key already includes CANON_VERSION from CACHE_PREFIX
  const finalKey = `${CACHE_PREFIX}:final:${normalizeKey(barcode || query || '')}`;
  const cached = await cacheGet(finalKey);
  if (cached) return cached;
  log(`[NUTRI] External API Cache MISS for: ${query || barcode}`, 'DEBUG', 'CACHE');

  // --- Step 3: Run external API fallbacks ---
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
  
  // --- [DELETED] Old canonical(query) fallback ---
  
  if (!out)            out = { status: 'not_found', source: 'error', reason: 'no_source_succeeded', usda_link: null };

  // --- Step 4: Cache external results ---
  await cacheSet(finalKey, out, TTL_FINAL_MS);
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
    const data = await fetchNutritionData(barcode, query, console.log);
    if (data.status === 'found') return res.status(200).json(data);
    return res.status(404).json(data);
  } catch (e) {
    console.error('nutrition-search handler error', e);
    return res.status(500).json({ status: 'error', message: e.message });
  }
};

module.exports.fetchNutritionData = fetchNutritionData;
/// ========= NUTRITION-SEARCH-END ========= \\\\

