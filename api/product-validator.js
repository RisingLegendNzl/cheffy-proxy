/// ========= PRODUCT-VALIDATOR-START ========= \\\\
// File: api/product-validator.js  (Upstash-backed KV)

const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@vercel/kv');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';

// ---- KV client (Upstash vars) ----
const kv = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// ---- utils ----
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const tokenize = (s='') => s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ---- policy ----
const RISKY_TOKENS_BY_ID = {
  ing_eggs: ['mayo','mayonnaise','aioli','custard','powder','substitute','vegan','plant','noodle'],
  ing_olive_oil_spray: ['canola','sunflower','vegetable','eucalyptus'],
  ing_canola_oil_spray: ['olive','sunflower','vegetable','eucalyptus'],
};

// ---- router ----
function shouldLLMValidate(product, ingredientData) {
  const title = (product.product_name || '').toLowerCase();
  const cat = (product.product_category || '').toLowerCase();
  const id = ingredientData?.ingredient_id || '';

  const risky = RISKY_TOKENS_BY_ID[id] || [];
  const hasRisk = risky.some(w => title.includes(w));

  const must = new Set((ingredientData?.requiredWords || []).map(s => s.toLowerCase()));
  const toks = new Set(tokenize(title));
  const overlap = [...must].some(w => toks.has(w));

  const allowedCats = (ingredientData?.allowedCategories || []).map(s => s.toLowerCase());
  const catOK = allowedCats.length === 0 ? true : allowedCats.some(c => cat.includes(c));

  const ambiguous = !overlap || !catOK;
  return hasRisk || ambiguous;
}

// ---- LLM validator ----
async function validateWithGeminiFlash(product, ingredientData, log = console.log) {
  if (!GEMINI_API_KEY) {
    log('Validator: GEMINI_API_KEY missing. Bypass.', 'WARN', 'VALIDATOR');
    return { pass: true, reason: 'no_api_key', flags: [] };
  }

  const id = ingredientData?.ingredient_id || 'unknown';
  const must = (ingredientData?.requiredWords || []).map(s => s.toLowerCase());
  const neg = (ingredientData?.negativeKeywords || []).map(s => s.toLowerCase());
  const extraNeg = RISKY_TOKENS_BY_ID[id] || [];
  const allowedCats = (ingredientData?.allowedCategories || []).map(s => s.toLowerCase());

  const cacheKey = `val:v1:${id}:${sha1(
    `${product.product_name}|${product.product_category}|${product.product_brand}|${product.product_size}`
  )}`;

  // cache read
  if (kvReady) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) return cached;
    } catch (e) {
      log(`Validator KV get fail: ${e.message}`, 'WARN', 'VALIDATOR_KV');
    }
  }

  const sys = `You validate supermarket products for a target ingredient. Output strict JSON only.
Rules:
- Fail if title contains any MUST_EXCLUDE tokens.
- Pass only if title has at least one MUST_INCLUDE token and category is plausible.
- Be conservative.`;

  const user = {
    TARGET_INGREDIENT: ingredientData?.originalIngredient || id,
    MUST_INCLUDE: must,
    MUST_EXCLUDE: [...new Set([...neg, ...extraNeg])],
    ALLOWED_CATEGORIES: allowedCats,
    PRODUCT: {
      title: product.product_name || '',
      category: product.product_category || '',
      brand: product.product_brand || '',
      size: product.product_size || '',
      url: product.url || ''
    }
  };

  const payload = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ parts: [{ text: JSON.stringify(user) }]}],
    generationConfig: { responseMimeType: 'application/json' }
  };

  let result;
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    result = j(text) || { pass:false, reason:'parse_error', flags:['bad_json'], suggested_negatives:[] };
  } catch(e){
    log(`Validator LLM error: ${e.message}`, 'WARN', 'VALIDATOR_LLM');
    result = { pass:true, reason:'llm_error_bypass', flags:['llm_error'] };
  }

  // cache write
  if (kvReady) {
    try { await kv.set(cacheKey, result, { ex: 60 * 60 * 24 * 7 }); }
    catch (e) { log(`Validator KV set fail: ${e.message}`, 'WARN', 'VALIDATOR_KV'); }
  }

  return result;
}

module.exports = { shouldLLMValidate, validateWithGeminiFlash };
/// ========= PRODUCT-VALIDATOR-END ========= \\\\