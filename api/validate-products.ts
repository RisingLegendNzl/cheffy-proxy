// ==============================================
// Cheffy — Full Product Validator (All-in-One)
// Includes: size utils, rules, cache, Gemini client,
// validator core, API endpoint, and inline caller.
// ==============================================

import type { NextApiRequest, NextApiResponse } from 'next';

/* //////////// size utils start \\\\\\\\\\\\ */
type Size = { amount: number; unit: string; kind: 'weight'|'volume'|'count' };

const WEIGHT_UNITS: Record<string, number> = { g:1, gram:1, grams:1, kg:1000, kilogram:1000, kilograms:1000 };
const VOLUME_UNITS: Record<string, number> = { ml:1, millilitre:1, millilitres:1, l:1000, litre:1000, litres:1000 };
const COUNT_UNITS = new Set(['count','pack','pc','pcs','ea','each','ct']);

function parseSize(text?: string): Size | null {
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

function withinTolerance(a: Size|null, b: Size|null, percent=15, countSlack=1){
  if(!a||!b) return false;
  if(a.kind!==b.kind) return false;
  if(a.kind==='count') return Math.abs(a.amount-b.amount)<=countSlack;
  const tol=(percent/100)*a.amount;
  return Math.abs(a.amount-b.amount)<=tol;
}
/* //////////// size utils end \\\\\\\\\\\\ */

/* //////////// rules start \\\\\\\\\\\\ */
const GLOBAL_BANNED_CATEGORY_TOKENS=[
  'condiment','sauce','mayonnaise','aioli','dessert','chocolate','drink','energy drink',
  'alcohol','pet','cleaning','vitamin','meal kit','ready meal'
];
const GLOBAL_BANNED_TITLE_TOKENS=[
  'mayonnaise','aioli','dressing','sauce kit','meal kit','powdered','protein powder','dessert'
];
const FORM_BANS={
  raw:['pasteurised whites','liquid egg','mayonnaise','aioli','powder'],
  fresh:['powder','kit','sauce'],
  dry:['sauce','kit','ready meal']
};
/* //////////// rules end \\\\\\\\\\\\ */

/* //////////// helpers start \\\\\\\\\\\\ */
function hashKey(o:any){return'b'+Math.abs([...JSON.stringify(o)].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0)).toString(36);}
const cache=new Map<string,{v:any,t:number}>();
function getCache(k:string){const e=cache.get(k);if(!e)return null;if(Date.now()>e.t){cache.delete(k);return null;}return e.v;}
function setCache(k:string,v:any,ttl=86400000){cache.set(k,{v,t:Date.now()+ttl});}
/* //////////// helpers end \\\\\\\\\\\\ */

/* //////////// gemini client start \\\\\\\\\\\\ */
type ValidatorItem={ingredient:string;candidate_title:string;candidate_category?:string;candidate_size?:string};
type ValidatorResult={verdict:'pass'|'fail'|'unsure';confidence:number;reason:string};

async function geminiValidateBatch(items:ValidatorItem[],model='gemini-1.5-flash'):Promise<ValidatorResult[]>{
  const key=process.env.GEMINI_API_KEY;
  if(!key)throw new Error('GEMINI_API_KEY not set');
  const sys=`You are a strict product-matching judge. Require same base food and form. Size ±15%. Reject unrelated categories. Return JSON array [{"verdict":"pass|fail|unsure","confidence":0-1,"reason":"..."}].`;
  const user=`Evaluate:\n${JSON.stringify(items,null,2)}\nReturn JSON only.`;
  const body={contents:[{role:"system",parts:[{text:sys}]},{role:"user",parts:[{text:user}]}],generationConfig:{temperature:0.2,topP:0.9,maxOutputTokens:512,responseMimeType:"application/json"}};
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const start=Date.now();
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const latency=Date.now()-start;
  console.log('[VALIDATOR][Gemini]',{items:items.length,model,latency_ms:latency});
  const data=await res.json().catch(()=>({}));
  const text=data?.candidates?.[0]?.content?.parts?.[0]?.text??'[]';
  try{return JSON.parse(text);}catch{return JSON.parse(text.match(/\[[\s\S]*\]/)?.[0]??'[]');}
}
/* //////////// gemini client end \\\\\\\\\\\\ */

/* //////////// validator core start \\\\\\\\\\\\ */
async function validateCandidates(spec:any,candidates:any[],model?:string){
  const outs=[];const toAI=[];
  for(let i=0;i<candidates.length;i++){
    const c=candidates[i];const key='v:'+hashKey({spec,c});const cached=getCache(key);
    if(cached){outs.push(cached);continue;}
    const title=c.title.toLowerCase();const path=(c.categoryPath||[]).join('>').toLowerCase();
    let conf=0.5;let verdict:'pass'|'fail'|'unsure'='unsure';let reason='';
    if(GLOBAL_BANNED_CATEGORY_TOKENS.some(w=>path.includes(w))||GLOBAL_BANNED_TITLE_TOKENS.some(w=>title.includes(w))){
      verdict='fail';conf=0.1;reason='banned token';
    }else if(spec.form&&FORM_BANS[spec.form]?.some(w=>title.includes(w))){
      verdict='fail';conf=0.2;reason='form mismatch';
    }else{
      const ing=parseSize(spec.quantity?`${spec.quantity.amount}${spec.quantity.unit}`:'');
      const can=parseSize(c.sizeText||c.title);
      if(ing&&can&&withinTolerance(ing,can))conf+=0.2;else conf-=0.2;
      if(title.includes(spec.name.toLowerCase()))conf+=0.1;
      if(conf>=0.8)verdict='pass';else if(conf<=0.3)verdict='fail';
    }
    if(verdict==='unsure'){toAI.push({idx:i,item:{ingredient:spec.name,candidate_title:c.title,candidate_category:(c.categoryPath||[]).join('>'),candidate_size:c.sizeText}});}
    outs.push({verdict,confidence:conf,reason,signals:{rule_conf:conf}});
  }
  if(toAI.length){
    const ai=await geminiValidateBatch(toAI.map(x=>x.item),model);
    for(let j=0;j<toAI.length;j++){
      const i=toAI[j].idx;const a=ai[j];const p=outs[i];
      const final=a.confidence>=0.7?a.verdict:'unsure';
      outs[i]={verdict:final,confidence:Math.max(p.confidence,a.confidence),reason:a.reason,signals:{rule_conf:p.confidence,ai_conf:a.confidence}};
      console.log('[VALIDATOR][Item]',{ingredient:spec.name,product:candidates[i].title,verdict:final,conf:outs[i].confidence});
      setCache('v:'+hashKey({spec,c:candidates[i]}),outs[i]);
    }
  }
  console.log('[VALIDATOR] batch',{count:candidates.length,passes:outs.filter(x=>x.verdict==='pass').length});
  return outs;
}
/* //////////// validator core end \\\\\\\\\\\\ */

/* //////////// inline caller start \\\\\\\\\\\\ */
export async function validateAndSelect(spec:any,candidates:any[],model='gemini-1.5-flash'){
  const start=Date.now();
  console.log('[VALIDATOR_REQUEST]',{ingredient:spec?.name,count:candidates.length,model});
  const res=await fetch('/api/validate-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec,candidates,model})});
  if(!res.ok){console.error('[VALIDATOR_ERROR]',{status:res.status,text:await res.text()});return{picked:undefined,results:[]};}
  const json=await res.json();const results=json?.results||[];
  const pickedIndex=results.findIndex((r:any)=>r.verdict==='pass'&&r.confidence>=0.7);
  const picked=pickedIndex>=0?candidates[pickedIndex]:undefined;
  console.log('[VALIDATOR_DECISION]',{ingredient:spec?.name,passes:results.filter((r:any)=>r.verdict==='pass').length,pickedIndex,pickedTitle:picked?.title,latency_ms:Date.now()-start});
  return{picked,results};
}
/* //////////// inline caller end \\\\\\\\\\\\ */

/* //////////// next api route start \\\\\\\\\\\\ */
export default async function handler(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const {spec,candidates,model}=req.body;
    console.log('[VALIDATOR][Request]',{ingredient:spec?.name,count:candidates.length,model});
    const results=await validateCandidates(spec,candidates,model);
    res.status(200).json({results});
  }catch(e:any){res.status(500).json({error:e.message});}
}
/* //////////// next api route end \\\\\\\\\\\\ */