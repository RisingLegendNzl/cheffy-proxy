// api/generate-full-plan.js
// Calls Gemini to build the plan + ingredients, then hydrates prices via /api/price-search
// and PREFILLS nutrition via /api/nutrition-search. Returns strict schema + structured logs.
// Env required: GEMINI_API_KEY. Optional: GEMINI_MODEL (default: gemini-1.5-pro)

const axios = require("axios");

// ---------------- CORS ----------------
const cors = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
};

// ---------------- Logging ----------------
const nowISO = () => new Date().toISOString();
const L = (level, tag, message, data) => ({ timestamp: nowISO(), level, tag, message: String(message), ...(data==null?{}:{ data }) });
const logHttpStart = (logs, method, url, paramsOrBody) => logs.push(L("INFO","HTTP",`${method} ${url}`, paramsOrBody));
const logHttpEnd = (logs, status, url, extra) => logs.push(L(status<400?"SUCCESS":"WARN","HTTP",`${status} ${url}`, extra));

// ---------------- Small utils ----------------
const str = (v)=> v==null?"":String(v).trim();
const num = (v)=> { const n=Number(v); return Number.isFinite(n)? Number(n.toFixed(2)) : null; };

function parseSizeToGrams(sizeStr){
  if(!sizeStr) return null; const s=str(sizeStr).toLowerCase();
  const multi = s.match(/(\d+)\s*[x×]\s*([\d\.]+)\s*(g|kg|ml|l)\b/);
  if(multi){ const c=Number(multi[1]); const q=Number(multi[2]); const u=multi[3]; return c*toGrams(q,u); }
  const single = s.match(/([\d\.]+)\s*(g|kg|ml|l)\b/);
  if(single){ const q=Number(single[1]); const u=single[2]; return toGrams(q,u); }
  return null;
  function toGrams(q,u){ if(u==="g")return q; if(u==="kg")return q*1000; if(u==="ml")return q; if(u==="l")return q*1000; return null; }
}
function unitPricePer100(sizeStr, price){ const g=parseSizeToGrams(sizeStr); if(!g||!price||price<=0) return null; return Number(((price/g)*100).toFixed(3)); }

function mapProductRaw(p){
  const name  = str(p.name || p.product_name || p.title);
  const brand = str(p.brand || p.product_brand || p.manufacturer);
  const size  = str(p.size || p.product_size || p.pack_size || p.net_content);
  const url   = str(p.url || p.link || p.product_url);
  const price = num(p.price || p.current_price || p.sale_price || p.unit_price);
  const barcode = str(p.barcode || p.ean || p.gtin);
  const up100 = unitPricePer100(size, price);
  if(!name||!brand||!size||!url||!Number.isFinite(price)||price<=0) return null;
  return { name, brand, price, size, url, unit_price_per_100: up100, ...(barcode?{barcode}:{}) };
}

function sortProducts(arr){
  return (arr||[]).slice().sort((a,b)=>{
    const au=a.unit_price_per_100, bu=b.unit_price_per_100;
    if(Number.isFinite(au)&&Number.isFinite(bu)) return au-bu;
    if(Number.isFinite(au)) return -1; if(Number.isFinite(bu)) return 1; return a.price-b.price;
  });
}

function selfBaseUrl(req){
  const hdr = req.headers["x-forwarded-host"] || req.headers.host;
  if(hdr) return `https://${hdr}`; // Vercel/Prod
  if(process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000"; // local dev
}

async function httpGetWithRetries(url, params, logs, tries=2){
  for(let i=0;i<tries;i++){
    try{
      logHttpStart(logs, "GET", url, { params });
      const r = await axios.get(url, { params, timeout: 15000 });
      logHttpEnd(logs, r.status, url, { count: Array.isArray(r.data?.products)? r.data.products.length : undefined });
      return r.data;
    }catch(err){
      const code = err.response?.status || "net_error";
      logs.push(L(i<tries-1?"WARN":"CRITICAL","HTTP",`GET failed (${code})`,{ url, params, error: str(err.message) }));
      if(i===tries-1) throw err;
    }
  }
}

// ---------------- Gemini orchestration ----------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro";

async function callGeminiStructured(input, logs){
  if(!GEMINI_API_KEY){
    logs.push(L("WARN","LLM","GEMINI_API_KEY missing; using seed"));
    return null; // caller will seed
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const schemaHint = `Strict JSON only. No prose. Schema:\n{\n  \"mealPlan\": [{ \"day\": number, \"meals\": [{ \"type\": string, \"name\": string, \"description\": string }] }],\n  \"uniqueIngredients\": [{ \"originalIngredient\": string, \"quantityUnits\": string, \"category\": string }],\n  \"queries\": [{ \"ingredient\": string, \"searchQuery\": string }],\n  \"nutritionalTargets\": { \"calories\": number, \"protein\": number, \"fat\": number, \"carbs\": number }\n}`;

  const sys = `You design budget-aware Australian meal plans for Coles/Woolworths. Use metric units (g, kg, ml, L). Categories in {Pantry, Dairy, Meat, Produce, Frozen, Bakery, Canned, Spices, Other}. Quantities represent total required across the plan horizon. Build concise searchQuery strings like \"rolled oats 1kg\" or \"full cream milk 2l\". Return JSON only.`;
  const user = {
    name: str(input.name), height: str(input.height), weight: str(input.weight), age: str(input.age), gender: str(input.gender),
    activityLevel: str(input.activityLevel), goal: str(input.goal), dietary: str(input.dietary), days: Number(input.days||1),
    store: str(input.store||"Woolworths"), mealsPerDay: Number(input.eatingOccasions||3), costPriority: str(input.costPriority||"Best Value"),
    mealVariety: str(input.mealVariety||"Balanced"), cuisine: str(input.cuisine||""), bodyFat: str(input.bodyFat||"")
  };

  const prompt = `${sys}\n${schemaHint}\nUser: ${JSON.stringify(user)}`;
  logs.push(L("INFO","LLM_PROMPT","Gemini prompt prepared", { model: GEMINI_MODEL, len: prompt.length }));

  try{
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }]}], generationConfig: { temperature: 0.2 } };
    logHttpStart(logs, "POST", url, { body: { _redacted: true, generationConfig: { temperature: 0.2 }}});
    const r = await axios.post(url, payload, { timeout: 25000 });
    logHttpEnd(logs, r.status, url, { });
    const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonText = text.trim().replace(/^```json\n?|```$/g, "");
    const parsed = JSON.parse(jsonText);
    logs.push(L("SUCCESS","LLM","Gemini JSON parsed", { keys: Object.keys(parsed||{}) }));
    return parsed;
  }catch(err){
    logs.push(L("WARN","LLM","Gemini failed; falling back to seed", { error: str(err.message) }));
    return null;
  }
}

function seedPlanAndIngredients(form){
  const mpd = Number(form?.eatingOccasions||3);
  const days = Math.max(1, Math.min(7, Number(form?.days||1)));
  const plan = Array.from({length: days}, (_,i)=>({
    day: i+1,
    meals: [
      { type:"breakfast", name:"Oats + Milk", description:"Rolled oats, milk, banana" },
      { type:"lunch", name:"Chicken rice", description:"Chicken breast, rice, broccoli" },
      { type:"dinner", name:"Beef pasta", description:"Lean beef, pasta, tomato" }
    ].slice(0, mpd)
  }));
  const uniq = [
    { originalIngredient:"Rolled oats", quantityUnits:"1 kg", category:"Pantry" },
    { originalIngredient:"Full cream milk", quantityUnits:"2 L", category:"Dairy" },
    { originalIngredient:"Chicken breast", quantityUnits:"1 kg", category:"Meat" },
    { originalIngredient:"White rice", quantityUnits:"1 kg", category:"Pantry" },
    { originalIngredient:"Broccoli", quantityUnits:"500 g", category:"Produce" },
  ];
  const queries = uniq.map(u=>({ ingredient: u.originalIngredient, searchQuery: `${u.originalIngredient} ${u.quantityUnits.replace(/\s+/g, "")}`.toLowerCase() }));
  const nutritionalTargets = { calories: 3500, protein: 180, fat: 100, carbs: 450 };
  return { mealPlan: plan, uniqueIngredients: uniq, queries, nutritionalTargets };
}

// ---------------- Main handler ----------------
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const logs = [];
  try{
    logs.push(L("INFO","SYSTEM","Request received",{ path: req.url }));
    const body = typeof req.body === "object" && req.body ? req.body : {};
    logs.push(L("INFO","DATA","Input body accepted",{ keys: Object.keys(body) }));

    // 1) LLM plan
    logs.push(L("INFO","PHASE","LLM orchestration start"));
    let llm = await callGeminiStructured(body, logs);
    if(!llm) llm = seedPlanAndIngredients(body);
    logs.push(L("SUCCESS","PHASE","LLM orchestration finished"));

    // Normalize LLM outputs
    const mealPlan = Array.isArray(llm.mealPlan)? llm.mealPlan.map(d=>({
      day: Number(d.day||1),
      meals: Array.isArray(d.meals)? d.meals.map(m=>({ type: str(m.type), name: str(m.name), description: str(m.description) })) : []
    })) : [];

    const uniqueIngredients = Array.isArray(llm.uniqueIngredients)? llm.uniqueIngredients.map(it=>({
      originalIngredient: str(it.originalIngredient||it.name||it.ingredient),
      quantityUnits: str(it.quantityUnits||it.qty),
      category: str(it.category||"Other")
    })) : [];

    const queryIndex = new Map();
    if(Array.isArray(llm.queries)){
      for(const q of llm.queries){
        const k = str(q.ingredient);
        if(k) queryIndex.set(k.toLowerCase(), str(q.searchQuery));
      }
    }

    const nutritionalTargets = {
      calories: Number(llm?.nutritionalTargets?.calories)||0,
      protein: Number(llm?.nutritionalTargets?.protein)||0,
      fat: Number(llm?.nutritionalTargets?.fat)||0,
      carbs: Number(llm?.nutritionalTargets?.carbs)||0
    };

    // 2) Price hydration via your own API
    const base = selfBaseUrl(req);
    const store = body.store || "Woolworths";
    logs.push(L("INFO","PHASE","Price search hydration start",{ base, store }));

    const results = {};
    for(const ing of uniqueIngredients){
      const name = ing.originalIngredient;
      const fallbackQuery = `${name} ${str(ing.quantityUnits).replace(/\s+/g, "")}`.toLowerCase();
      const searchQuery = queryIndex.get(name.toLowerCase()) || fallbackQuery;
      const url = `${base}/api/price-search`;
      let mapped = [];
      try{
        const data = await httpGetWithRetries(url, { store, query: searchQuery }, logs, 2);
        mapped = sortProducts((data?.products||[]).map(mapProductRaw).filter(Boolean));
      }catch(err){
        logs.push(L("WARN","HTTP","Price search failed for ingredient",{ ingredient: name, error: str(err.message) }));
      }
      const current = mapped[0] || null;
      results[name] = {
        category: ing.category,
        searchQuery,
        quantityUnits: ing.quantityUnits,
        totalGramsRequired: parseSizeToGrams(ing.quantityUnits) || undefined,
        userQuantity: 1,
        currentSelectionURL: current ? current.url : "",
        allProducts: mapped
      };
    }

    // 3) Nutrition PREFILL for current selections
    logs.push(L("INFO","PHASE","Nutrition prefill start"));
    const nutritionPrefill = {}; // key: product.url -> per-100g nutrition
    for(const [ingredient, block] of Object.entries(results)){
      const sel = block.allProducts.find(p=>p.url===block.currentSelectionURL);
      if(!sel) continue;
      const nUrl = `${base}/api/nutrition-search`;
      const params = sel.barcode ? { barcode: sel.barcode } : { query: sel.name };
      try{
        logHttpStart(logs, "GET", nUrl, { params });
        const r = await axios.get(nUrl, { params, timeout: 12000 });
        logHttpEnd(logs, r.status, nUrl, {});
        nutritionPrefill[sel.url] = r.data || { status: 'not_found' };
      }catch(err){
        logs.push(L("WARN","HTTP","Nutrition fetch failed",{ ingredient, error: str(err.message) }));
      }
    }

    logs.push(L("SUCCESS","SYSTEM","Response ready"));
    return res.status(200).json({ logs, mealPlan, uniqueIngredients, results, nutritionalTargets, nutritionPrefill });

  }catch(err){
    logs.push(L("CRITICAL","SYSTEM","Unhandled error",{ message: str(err.message) }));
    return res.status(500).json({ logs, error: "internal_error" });
  }
};
