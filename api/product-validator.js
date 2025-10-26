// api/product-validator.js
// Purpose: deterministic product filtering to stop mismatches (e.g., carrots for berries, bottle oil for spray)
// Usage: const { validateProduct, selectBest } = require('./product-validator');

const WORD = /[a-z0-9]+/gi;

function norm(s) {
  return String(s || '').toLowerCase().trim();
}
function tokens(s) {
  return norm(s).match(WORD) || [];
}
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function hasWholeWord(haystack, needle) {
  if (!needle) return false;
  const h = ` ${norm(haystack)} `;
  const n = norm(needle).replace(/\s+/g, ' ');
  const re = new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i');
  return re.test(h);
}

function fieldBag(p) {
  const fields = [
    p.title, p.name, p.subtitle, p.brand, p.category, p.subcategory,
    p.description, p.package, p.form, p.variant
  ].filter(Boolean).join(' ');
  return norm(fields);
}

function toBase(value, unit) {
  if (!Number.isFinite(value)) return null;
  switch (unit) {
    case 'kg': return Math.round(value * 1000);   // g
    case 'g':  return Math.round(value);
    case 'l':  return Math.round(value * 1000);   // ml
    case 'ml': return Math.round(value);
    default:   return null;
  }
}

function numericSize(p) {
  const s = [p.size, p.net, p.net_weight, p.quantity, p.package].filter(Boolean).join(' ').toLowerCase();
  if (!s) return null;

  // multi-pack like "6 x 125g"
  const mp = s.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (mp) {
    const count = Number(mp[1]);
    const qty = toBase(Number(mp[2]), mp[3]);
    return count * qty;
  }

  // single like "500g", "0.5 kg", "400 ml", "1l"
  const m = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (m) return toBase(Number(m[1]), m[2]);

  return null;
}

function containsAny(text, list = []) {
  if (!list.length) return false;
  const t = ` ${norm(text)} `;
  return list.some(w => {
    const k = String(w || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!k) return false;
    const re = new RegExp(`\\b${escapeRegExp(k)}\\b`);
    return re.test(t);
  });
}

function passesRequiredWords(text, requiredWords = []) {
  if (!requiredWords.length) return true;
  const t = ` ${norm(text)} `;
  return requiredWords.every(w => {
    const k = String(w || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!k) return true;
    const re = new RegExp(`\\b${escapeRegExp(k)}\\b`);
    return re.test(t);
  });
}

function passesMustInclude(text, mustIncludeTokens = []) {
  return passesRequiredWords(text, mustIncludeTokens);
}

function passesMustExclude(text, mustExcludeTokens = []) {
  if (!mustExcludeTokens.length) return true;
  return !containsAny(text, mustExcludeTokens);
}

function brandScore(brand = '', preferBrands = [], avoidBrands = []) {
  const b = norm(brand);
  let s = 0;
  if (preferBrands.some(x => hasWholeWord(b, x))) s += 2;
  if (avoidBrands.some(x => hasWholeWord(b, x))) s -= 3;
  return s;
}

function fail(reason, extra) {
  return { ok: false, reason, ...(extra || {}) };
}

/**
 * Validate a single product.
 * @param {Object} product - raw product object from retailer search
 * @param {Object} spec - validation rules
 * @returns {{ok:boolean,score?:number,reasons?:string[]}} */
function validateProduct(product = {}, spec = {}) {
  const title = fieldBag(product);
  if (!title) return fail('empty');

  // Hard word gates
  if (!passesRequiredWords(title, spec.requiredWords || [])) return fail('requiredWords');
  if (!passesMustInclude(title, spec.mustIncludeTokens || [])) return fail('mustInclude');
  if (!passesMustExclude(title, spec.mustExcludeTokens || [])) return fail('mustExclude');
  if (containsAny(title, spec.negativeWords || [])) return fail('negativeWords');

  // Category allow/deny
  const cat = norm(product.category || product.subcategory || '');
  if ((spec.allowedCategories || []).length && !containsAny(cat, spec.allowedCategories)) return fail('categoryNotAllowed');
  if ((spec.disallowedCategories || []).length && containsAny(cat, spec.disallowedCategories)) return fail('categoryDenied');

  // Size gates
  const sz = numericSize(product);
  if (Number.isFinite(spec.minSize) && Number.isFinite(sz) && sz < spec.minSize) return fail('sizeTooSmall', { sz });
  if (Number.isFinite(spec.maxSize) && Number.isFinite(sz) && sz > spec.maxSize) return fail('sizeTooLarge', { sz });

  // Price gates
  const price = Number(product.price);
  if (Number.isFinite(spec.minPrice) && Number.isFinite(price) && price < spec.minPrice) return fail('priceTooLow');
  if (Number.isFinite(spec.maxPrice) && Number.isFinite(price) && price > spec.maxPrice) return fail('priceTooHigh');

  // Brand and relevance
  const bScore = brandScore(product.brand, spec.preferBrands || [], spec.avoidBrands || []);
  const reqCount = (spec.requiredWords || []).length;
  const score = (reqCount ? reqCount : 1) + bScore;

  return { ok: true, score };
}

/** Rank a list of products with the same spec. */
function selectBest(products = [], spec = {}) {
  const results = [];
  for (const p of products) {
    const v = validateProduct(p, spec);
    if (v.ok) results.push({ product: p, score: v.score });
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = Number(a.product.price), pb = Number(b.product.price);
    if (Number.isFinite(pa) && Number.isFinite(pb)) return pa - pb;
    return 0;
  });
  return results.map(r => r.product);
}

module.exports = { validateProduct, selectBest };
