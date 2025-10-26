/// ========= NUTRITION-SEARCH-START ========= \\\\
// File: api/nutrition-search.js
// Pipeline: Avocavo → OpenFoodFacts → USDA → Canonical
// Caching: Memory + Vercel KV (Upstash) with SWR for name/barcode and final responses
// Exports:
//   module.exports (Vercel handler)
//   module.exports.fetchNutritionData(barcode, query, log)
//
// Notes:
// - All macros are per 100 g. Caller converts to serving/grams as needed.
// - Avocavo is first-line to reduce latency and improve hit rate.
// - OFF and USDA are kept for resilience. Canonical table is the last resort.
// - KV is optional. If not configured, memory cache still works per lambda instance.

const fetch = require('node-fetch');
const { createClient } = require('@vercel/kv');

// ---------- ENV & CONSTANTS ----------
const AVOCAVO_URL = 'https://app.avocavo.app/api/v2';
const AVOCAVO_KEY = process.env.AVOCAVO_API_KEY || '';
const USDA_KEY    = process.env.USDA_API_KEY || '';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const CACHE_PREFIX = 'nutri:v4';              // bump to invalidate old entries
const TTL_FINAL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days for final responses
const TTL_AVO_Q_MS = 1000 * 60 * 60 * 24 * 7; // 7 days for Avocavo ingredient cache
const TTL_AVO_U_MS = 1000 * 60 * 60 * 24 *30; // 30 days for Avocavo UPC cache
const TTL_NAME_MS  = 1000 * 60 * 60 * 24 * 7; // 7 days for name cache (OFF/USDA)
const TTL_BAR_MS   = 1000 * 60 * 60 * 24 *30; // 30 days for barcode cache (OFF)
const SWR_NAME_MS  = 1000 * 60 * 60 * 24 * 2; // 2 days stale-while-revalidate
const SWR_BAR_MS   = 1000 * 60 * 60 * 24 *10; // 10 days SWR for barcode
const KJ_TO_KCAL   = 4.184;

// ---------- KV + Memory cache ----------
const kv = createClient({ url: KV_URL, token: KV_TOKEN });
const kvReady = !!(KV_URL && KV_TOKEN);

// memory cache for hot keys inside a single lambda/container
const mem = new Map();
function memGet(key) { const x = mem.get(key); return x && x.exp > Date.now() ? x.v : null; }
function memSet(key, v, ms = 5 * 60 * 1000) { mem.set(key, { v, exp: Date.now() + ms }); }

async function cacheGet(key) {
  const m = memGet(key);
  if (m) return m;
  if (!kvReady) return null;
  try {
    const hit = await kv.get(key);
    if (hit) memSet(key, hit);
    return hit;
  } catch { return null; }
}

async function cacheSet(key, val, ttlMs) {
  memSet(key, val);
  if (!kvReady) return;
  try { await kv.set(key, val, { px: ttlMs }); } catch {}
}

// ---------- Utilities ----------
const normalizeKey = (s='') => s.toString().toLowerCase().trim().replace(/\s+/g, '_');
function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function safeLog(log, msg, level='INFO', tag='NUTRI', data=null) { try { (log||console.log)(msg, level, tag, data); } catch {} }
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

// ---------- Canonical fallbacks (per 100 g) ----------
const CANON = {
  banana_fresh:             { calories: 89,  protein: 1.1,  fat: 0.3,  carbs: 22.8 },
  broccoli_fresh:           { calories: 34,  protein: 2.8,  fat: 0.4,  carbs: 7.0  },
  rolled_oats_dry:          { calories: 389, protein: 16.9, fat: 6.9,  carbs: 66.3 },
  egg_whole_raw:            { calories: 143, protein: 12.6, fat: 9.5,  carbs: 0.7  },
  soy_sauce_reduced_sodium: { calories: 53,  protein: 8.1,  fat: 0.6,  carbs: 4.9  },
  canola_oil_spray:         { calories: 884, protein: 0,    fat: 100, carbs: 0    },
  olive_oil:                { calories: 884, protein: 0,    fat: 100, carbs: 0    },
  lean_beef_mince_5_star:   { calories: 137, protein: 21,   fat: 5,   carbs: 0    },
  canned_tuna_in_water:     { calories: 110, protein: 25,   fat: 1.0, carbs: 0    },
  tuna_in_brine_drained:    { calories: 116, protein: 26,   fat: 0.8, carbs: 0    },
  bread_white:              { calories: 265, protein: 9,    fat: 3.2, carbs: 49   },
  wholegrain_bread_slice:   { calories: 250, protein: 10,   fat: 3.5, carbs: 40   }
};

function canonical(query) {
  if (!query) return null;
  const k = normalizeKey(query);
  const c = CANON[k];
  if (!c) return null;
  return { status: 'found', source: 'canonical', servingUnit: '100g', ...c };
}

// ---------- Avocavo ----------
async function avocavoIngredient(query) {
  if (!AVOCAVO_KEY) return null;
  const key = `${CACHE_PREFIX}:avq:${normalizeKey(query)}`;
  const c = await cacheGet(key);
  if (c) return c;
  const res = await withTimeout(fetch(`${AVOCAVO_URL}/nutrition/ingredient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AVOCAVO_KEY },
    body: JSON.stringify({ ingredient: query })
  }), 10000);
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.success) return null;
  const n = j.nutrition || {};
  const out = {
    status: 'found', source: 'avocavo', servingUnit: '100g',
    calories: Number(n.calories_total ?? n.energy_kcal ?? 0),
    protein:  Number(n.protein_total  ?? n.proteins    ?? 0),
    fat:      Number(n.total_fat_total?? n.fat         ?? 0),
    carbs:    Number(n.carbohydrates_total ?? n.carbohydrates ?? 0)
  };
  await cacheSet(key, out, TTL_AVO_Q_MS);
  return out;
}

async function avocavoUPC(barcode) {
  if (!AVOCAVO_KEY) return null;
  const key = `${CACHE_PREFIX}:avupc:${normalizeKey(barcode)}`;
  const c = await cacheGet(key);
  if (c) return c;
  const res = await withTimeout(fetch(`${AVOCAVO_URL}/upc/ingredient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AVOCAVO_KEY },
    body: JSON.stringify({ upc: String(barcode) })
  }), 10000);
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.success) return null;
  const n = j.product?.nutrition || {};
  const out = {
    status: 'found', source: 'avocavo', servingUnit: '100g',
    calories: Number(n.energy_kcal ?? n.calories_total ?? 0),
    protein:  Number(n.proteins    ?? n.protein_total  ?? 0),
    fat:      Number(n.fat         ?? n.total_fat_total?? 0),
    carbs:    Number(n.carbohydrates ?? n.carbohydrates_total ?? 0)
  };
  await cacheSet(key, out, TTL_AVO_U_MS);
  return out;
}

// ---------- OpenFoodFacts ----------
async function offByBarcode(barcode) {
  const key = `${CACHE_PREFIX}:off:barcode:${normalizeKey(barcode)}`;
  const c = await cacheGet(key);
  if (c) return c;
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`
  const res = await withTimeout(fetch(url), 12000);
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json || !json.product) return null;
  const nutr = json.product.nutriments || {};
  const kcal = nutr['energy-kcal_100g'] ?? (nutr['energy-kj_100g'] ? nutr['energy-kj_100g'] / KJ_TO_KCAL : null);
  const out = {
    status: 'found', source: 'openfoodfacts', servingUnit: '100g',
    calories: toNumber(kcal),
    protein:  toNumber(nutr['proteins_100g']),
    fat:      toNumber(nutr['fat_100g']),
    carbs:    toNumber(nutr['carbohydrates_100g'])
  };
  if ([out.calories, out.protein, out.fat, out.carbs].every(v => v != null)) {
    await cacheSet(key, out, TTL_BAR_MS);
    return out;
  }
  return null;
}

async function offByQuery(q) {
  const key = `${CACHE_PREFIX}:off:query:${normalizeKey(q)}`;
  const c = await cacheGet(key);
  if (c) return c;
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=3`;
  const res = await withTimeout(fetch(url), 12000);
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const items = json?.products || [];
  for (const p of items) {
    const nutr = p.nutriments || {};
    const kcal = nutr['energy-kcal_100g'] ?? (nutr['energy-kj_100g'] ? nutr['energy-kj_100g'] / KJ_TO_KCAL : null);
    const out = {
      status: 'found', source: 'openfoodfacts', servingUnit: '100g',
      calories: toNumber(kcal),
      protein:  toNumber(nutr['proteins_100g']),
      fat:      toNumber(nutr['fat_100g']),
      carbs:    toNumber(nutr['carbohydrates_100g'])
    };
    if ([out.calories, out.protein, out.fat, out.carbs].every(v => v != null)) {
      await cacheSet(key, out, TTL_NAME_MS);
      return out;
    }
  }
  return null;
}

// ---------- USDA ----------
function pickBestFdc(list, query) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const q = (query || '').toLowerCase();
  const NEG = [/rolls?/i, /bread/i, /muesli/i, /bran/i, /white\s*only/i];
  const score = (h) => {
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
  return [...list].sort((a,b)=>score(b)-score(a))[0];
}

async function usdaByQuery(q) {
  if (!USDA_KEY) return null;
  const key = `${CACHE_PREFIX}:usda:${normalizeKey(q)}`;
  const c = await cacheGet(key);
  if (c) return c;

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
  const kcal = findAmt([1008, 208]);
  const prot = findAmt([1003, 203]);
  const fat  = findAmt([1004, 204]);
  const carb = findAmt([1005, 205]);
  if ([kcal, prot, fat, carb].some(v => v == null)) return null;

  const out = { status:'found', source:'usda', servingUnit:'100g', calories:kcal, protein:prot, fat:fat, carbs:carb };
  await cacheSet(key, out, TTL_NAME_MS);
  return out;
}

// ---------- Final resolver with strong caching ----------
async function fetchNutritionData(barcode, query, log = console.log) {
  const finalKey = `${CACHE_PREFIX}:final:${normalizeKey(barcode || query || '')}`;
  const hit = await cacheGet(finalKey);
  if (hit) return hit;

  let out = null;

  // 1) Avocavo
  if (!out && barcode) out = await avocavoUPC(barcode);
  if (!out && query)   out = await avocavoIngredient(query);

  // 2) OFF
  if (!out && barcode) out = await offByBarcode(barcode);
  if (!out && query)   out = await offByQuery(query);

  // 3) USDA
  if (!out && query)   out = await usdaByQuery(query);

  // 4) Canonical
  if (!out)            out = canonical(query);

  // 5) Final
  if (!out) out = { status: 'not_found', source: 'error', reason: 'no_source_succeeded' };
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
    const result = await fetchNutritionData(barcode, query, console.log);
    if (result.status === 'found') return res.status(200).json(result);
    return res.status(404).json(result);
  } catch (e) {
    console.error('nutrition-search handler error', e);
    return res.status(500).json({ status: 'error', message: e.message });
  }
};

module.exports.fetchNutritionData = fetchNutritionData;
/// ========= NUTRITION-SEARCH-END ========= \\\\
