
// ==============================================
// Cheffy — Single-file Product Validator API
// All logic consolidated here for easy paste.
// Requires: Vercel/Next.js API route environment with fetch and process.env.GEMINI_API_KEY
// Endpoint: POST /api/validate-products
// ==============================================

import type { NextApiRequest, NextApiResponse } from 'next';

// //////////// size utils start \\\\\\\\\\\\\\\
export type Size = { amount: number, unit: string, kind: 'weight'|'volume'|'count' };

const WEIGHT_UNITS: Record<string, number> = {
  g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
};
const VOLUME_UNITS: Record<string, number> = {
  ml: 1, millilitre: 1, millilitres: 1, l: 1000, litre: 1000, litres: 1000,
};
const COUNT_UNITS = new Set(['count','pack','pc','pcs','ea','each','ct']);

export function parseSize(text?: string): Size | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/×/g,'x').replace(/,/g,' ').trim();
  const multi = t.match(/(\d+)\s*x\s*(\d+(\.\d+)?)\s*([a-z]+)\b/);
  if (multi) {
    const c = Number(multi[1]);
    const amt = Number(multi[2]);
    const unit = multi[4];
    const base = unitToSize(amt, unit);
    if (base) return { amount: c * base.amount, unit: base.unit, kind: base.kind };
  }
  const m = t.match(/(\d+(\.\d+)?)\s*([a-z]+)\b/);
  if (m) {
    const amt = Number(m[1]);
    const unit = m[3];
    const base = unitToSize(amt, unit);
    if (base) return base;
  }
  const count = t.match(/\b(\d+)\s*(pack|pk|count|pcs?)\b/);
  if (count) return { amount: Number(count[1]), unit: 'count', kind: 'count' };
  const justNum = t.match(/^\s*(\d+)\s*$/);
  if (justNum) return { amount: Number(justNum[1]), unit: 'count', kind: 'count' };
  return null;
}

function unitToSize(amount: number, unitRaw: string): Size | null {
  const unit = unitRaw.toLowerCase();
  if (unit in WEIGHT_UNITS) return { amount: amount * WEIGHT_UNITS[unit], unit: 'g', kind: 'weight' };
  if (unit in VOLUME_UNITS) return { amount: amount * VOLUME_UNITS[unit], unit: 'ml', kind: 'volume' };
  if (COUNT_UNITS.has(unit)) return { amount, unit: 'count', kind: 'count' };
  return null;
}

export function withinTolerance(a: Size | null, b: Size | null, percent = 15, countSlack = 1): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'count') return Math.abs(a.amount - b.amount) <= countSlack;
  const tol = (percent/100) * a.amount;
  return Math.abs(a.amount - b.amount) <= tol;
}
// //////////// size utils end \\\\\\\\\\\\\\\

// //////////// category rules start \\\\\\\\\\\\\\\
export const GLOBAL_BANNED_CATEGORY_TOKENS = [
  'condiment','sauce','mayonnaise','aioli','dessert','chocolate','confectionery','drink','soft drink','energy drink',
  'alcohol','beauty','pet','cleaning','household','supplement','vitamin','meal kit','ready meal'
];

export const GLOBAL_BANNED_TITLE_TOKENS = [
  'mayonnaise','aioli','dressing','sauce kit','meal kit','powdered','protein powder','chocolate','dessert','lotion','shampoo'
];

export type IngredientForm = 'raw'|'fresh'|'dry'|'frozen'|'cooked'|'canned'|'liquid'|'powder';

export const FORM_BANS: Record<IngredientForm, string[]> = {
  raw: ['pasteurised whites','liquid egg','egg white','mayonnaise','aioli','powder'],
  fresh: ['powder','kit','sauce'],
  dry: ['sauce','fresh','kit','ready meal'],
  frozen: [],
  cooked: ['raw','kit'],
  canned: ['fresh only'],
  liquid: ['powder'],
  powder: ['liquid'],
};
// //////////// category rules end \\\\\\\\\\\\\\\

// //////////// tiny hash start \\\\\\\\\\\\\\\
export function hashKey(obj: any): string {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    h = ((h << 5) - h) + chr;
    h |= 0;
  }
  return 'h' + Math.abs(h).toString(36);
}
// //////////// tiny hash end \\\\\\\\\\\\\\\

// //////////// simple cache start \\\\\\\\\\\\\\\
type Entry<T> = { value: T, expiresAt: number };
const _memCache = new Map<string, Entry<any>>();

export function setCache<T>(key: string, value: T, ttlMs: number) {
  _memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
export function getCache<T>(key: string): T | null {
  const e = _memCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _memCache.delete(key); return null; }
  return e.value as T;
}
// //////////// simple cache end \\\\\\\\\\\\\\\

// //////////// gemini client start \\\\\\\\\\\\\\\
export type ValidatorItem = {
  ingredient: string;
  candidate_title: string;
  candidate_category?: string;
  candidate_size?: string;
};
export type ValidatorResult = { verdict: 'pass'|'fail'|'unsure'; confidence: number; reason: string; };

export async function geminiValidateBatch(items: ValidatorItem[], model: string = 'gemini-1.5-flash') : Promise<ValidatorResult[]> {
  const _gemStart = Date.now();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const sys = `You are a strict product-matching judge. Decide if each store product matches the requested ingredient.
Require same base food and form. Require size within ±15% or nearest standard pack size if exact pack does not exist.
Reject items from unrelated categories. Return compact JSON array with same order: [{"verdict":"pass|fail|unsure","confidence":0.00-1.00,"reason":"..."}].`;

  const user = `Evaluate the following items:\n${JSON.stringify(items, null, 2)}\nReturn JSON array only.`;

  const body = {
    contents: [
      { role: "system", parts: [{ text: sys }] },
      { role: "user", parts: [{ text: user }] }
    ],
    generationConfig: { temperature: 0.2, topP: 0.9, topK: 32, maxOutputTokens: 512, responseMimeType: "application/json" }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Gemini returned non-JSON: ' + text);
    parsed = JSON.parse(m[0]);
  }
  const _gemLatency = Date.now() - _gemStart;
  console.log('[VALIDATOR][Gemini]', { items: items.length, model, latency_ms: _gemLatency });
  return parsed.map((x: any) => ({
    verdict: x.verdict ?? 'unsure',
    confidence: typeof x.confidence === 'number' ? x.confidence : 0.5,
    reason: x.reason ?? 'no reason'
  })) as ValidatorResult[];
}
// //////////// gemini client end \\\\\\\\\\\\\\\

// //////////// validator core start \\\\\\\\\\\\\\\
export type IngredientSpec = {
  name: string; // "eggs"
  form?: IngredientForm; // "raw"
  quantity?: { amount: number, unit: 'g'|'ml'|'count' };
};
export type CandidateProduct = {
  productId: string;
  title: string;
  sizeText?: string;
  categoryPath?: string[];
  brand?: string;
  unitPrice?: number;
  price?: number;
};
export type ValidationOutput = {
  verdict: 'pass'|'fail'|'unsure';
  confidence: number;
  reason: string;
  signals: { rule_conf: number, ai_conf?: number };
};

const TTL_MS = 24 * 60 * 60 * 1000;

function titleHasAny(t: string, tokens: string[]): boolean {
  const low = t.toLowerCase();
  return tokens.some(w => low.includes(w));
}
function pathHasAny(path: string[]|undefined, tokens: string[]): boolean {
  if (!path || path.length===0) return false;
  const p = path.join(' > ').toLowerCase();
  return tokens.some(w => p.includes(w));
}
function ingredientSize(spec: IngredientSpec): Size | null {
  if (!spec.quantity) return null;
  const { amount, unit } = spec.quantity;
  if (unit === 'g') return { amount, unit: 'g', kind: 'weight' };
  if (unit === 'ml') return { amount, unit: 'ml', kind: 'volume' };
  return { amount, unit: 'count', kind: 'count' };
}

export function ruleEvaluate(spec: IngredientSpec, candidate: CandidateProduct): { verdict: 'pass'|'fail'|'unsure', rule_conf: number, reason: string } {
  const ingSize = ingredientSize(spec);
  const candSize = parseSize(candidate.sizeText || candidate.title);
  let conf = 0.5;
  const reasons: string[] = [];

  if (pathHasAny(candidate.categoryPath, GLOBAL_BANNED_CATEGORY_TOKENS)) {
    return { verdict: 'fail', rule_conf: 0.1, reason: 'banned category token' };
  }
  if (titleHasAny(candidate.title, GLOBAL_BANNED_TITLE_TOKENS)) {
    return { verdict: 'fail', rule_conf: 0.1, reason: 'banned title token' };
  }
  if (spec.form) {
    const bans = FORM_BANS[spec.form] || [];
    if (titleHasAny(candidate.title, bans)) {
      return { verdict: 'fail', rule_conf: 0.2, reason: `form mismatch for ${spec.form}` };
    }
  }
  if (ingSize && candSize) {
    if (withinTolerance(ingSize, candSize, 15, 1)) conf += 0.2;
    else { reasons.push('size outside tolerance'); conf -= 0.2; }
  }
  const key = spec.name.toLowerCase();
  if (candidate.title.toLowerCase().includes(key)) conf += 0.1;
  if (candidate.categoryPath && candidate.categoryPath.length>0) conf += 0.1;

  conf = Math.max(0, Math.min(0.9, conf));
  if (conf >= 0.8) return { verdict: 'pass', rule_conf: conf, reason: reasons.join('; ') || 'rule pass' };
  if (conf <= 0.3) return { verdict: 'fail', rule_conf: conf, reason: reasons.join('; ') || 'rule fail' };
  return { verdict: 'unsure', rule_conf: conf, reason: reasons.join('; ') || 'needs ai' };
}

export async function validateCandidates(spec: IngredientSpec, candidates: CandidateProduct[], model?: string): Promise<ValidationOutput[]> {
  const outputs: ValidationOutput[] = [];
  const toAI: { idx: number, item: ValidatorItem }[] = [];

  for (let i=0;i<candidates.length;i++) {
    const cand = candidates[i];
    const cacheKey = `VAL2:${hashKey({spec,cand})}`;
    const cached = getCache<ValidationOutput>(cacheKey);
    if (cached && cached.confidence >= 0.8) { outputs.push(cached); continue; }

    const rule = ruleEvaluate(spec, cand);
    if (rule.verdict === 'pass' || rule.verdict === 'fail') {
      const out: ValidationOutput = { verdict: rule.verdict, confidence: rule.rule_conf, reason: rule.reason, signals: { rule_conf: rule.rule_conf } };
      if (out.confidence >= 0.8) setCache(cacheKey, out, TTL_MS);
      outputs.push(out);
    } else {
      const ingPhrase = humanIngredient(spec);
      const item: ValidatorItem = {
        ingredient: ingPhrase,
        candidate_title: cand.title,
        candidate_category: (cand.categoryPath || []).join(' > ') || undefined,
        candidate_size: cand.sizeText
      };
      toAI.push({ idx: i, item });
      outputs.push({ verdict: 'unsure', confidence: rule.rule_conf, reason: rule.reason, signals: { rule_conf: rule.rule_conf } });
    }
  }

  if (toAI.length) {
    const aiResults: ValidatorResult[] = await geminiValidateBatch(toAI.map(x=>x.item), model);
    for (let j=0;j<toAI.length;j++) {
      const idx = toAI[j].idx;
      const cand = candidates[idx];
      const ai = aiResults[j];
      const prev = outputs[idx];
      const finalConf = Math.max(prev.signals.rule_conf, ai.confidence);
      const verdict = ai.verdict === 'pass' && ai.confidence >= 0.7 ? 'pass' :
                      ai.verdict === 'fail' && ai.confidence >= 0.7 ? 'fail' : 'unsure';
      const out: ValidationOutput = {
        verdict, confidence: finalConf,
        reason: ai.reason || prev.reason,
        signals: { rule_conf: prev.signals.rule_conf, ai_conf: ai.confidence }
      };
      const cacheKey = `VAL2:${hashKey({spec,cand})}`;
      if (out.confidence >= 0.8 && verdict !== 'unsure') setCache(cacheKey, out, TTL_MS);
      outputs[idx] = out;
      try { console.log('[VALIDATOR][Item]', { ingredient: spec.name, product: cand.title, verdict: out.verdict, conf: out.confidence, rule_conf: out.signals.rule_conf, ai_conf: out.signals.ai_conf }); } catch {}
    }
  }

  return outputs;
}

function humanIngredient(spec: IngredientSpec): string {
  const parts = [spec.quantity ? (spec.quantity.unit==='count' ? `${spec.quantity.amount}-pack` : `${spec.quantity.amount} ${spec.quantity.unit}`) : '', spec.form, spec.name]
    .filter(Boolean);
  return parts.join(' ');
}
// //////////// validator core end \\\\\\\\\\\\\\\

// //////////// next api route start \\\\\\\\\\\\\\\
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const _batchStart = Date.now();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { spec, candidates, model } = req.body as { spec: IngredientSpec, candidates: CandidateProduct[], model?: string };
    if (!spec || !candidates || !Array.isArray(candidates)) return res.status(400).json({ error: 'Invalid payload' });
    const results = await validateCandidates(spec, candidates, model);
    try {
      const avg_conf = results.length ? results.reduce((a,b)=>a+b.confidence,0)/results.length : 0;
      const passes = results.filter(r=>r.verdict==='pass').length;
      const fails = results.filter(r=>r.verdict==='fail').length;
      const time_ms = Date.now() - _batchStart;
      console.log('[VALIDATOR] batch', { count: candidates.length, model, avg_conf, passes, fails, time_ms });
    } catch {}
    res.status(200).json({ results });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Internal error' });
  }
}
// //////////// next api route end \\\\\\\\\\\\\\\
