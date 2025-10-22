// api/generate-full-plan.js
// Vercel serverless handler: POST /api/generate-full-plan
// Env: GEMINI_API_KEY, RAPIDAPI_KEY (if this handler calls price/nutrition helpers)

const axios = require("axios");

// ---------- Utilities
const cors = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
};

const nowISO = () => new Date().toISOString();
const L = (level, tag, message, data) => ({
  timestamp: nowISO(),
  level, // 'CRITICAL' | 'WARN' | 'SUCCESS' | 'INFO'
  tag,   // 'SYSTEM' | 'PHASE' | 'HTTP' | 'LLM' | 'LLM_PROMPT' | 'DATA' | 'CALC'
  message: String(message),
  ...(data === undefined ? {} : { data })
});

// Size → grams (approx). Handles "500 g", "1 kg", "1.25 L", "750 ml", "20 x 50 g"
function parseSizeToGrams(sizeStr) {
  if (!sizeStr) return null;
  const s = sizeStr.trim().toLowerCase();

  // match multipack: "x" or "×"
  const multi = s.match(/(\d+)\s*[x×]\s*([\d\.]+)\s*(g|kg|ml|l)\b/);
  if (multi) {
    const count = Number(multi[1]);
    const qty = Number(multi[2]);
    const unit = multi[3];
    return count * toGrams(qty, unit);
  }

  // single
  const single = s.match(/([\d\.]+)\s*(g|kg|ml|l)\b/);
  if (single) {
    const qty = Number(single[1]);
    const unit = single[2];
    return toGrams(qty, unit);
  }
  return null;

  function toGrams(qty, unit) {
    if (unit === "g") return qty;
    if (unit === "kg") return qty * 1000;
    if (unit === "ml") return qty;         // water-like density assumption
    if (unit === "l") return qty * 1000;   // "
    return null;
  }
}

function unitPricePer100(sizeStr, price) {
  const grams = parseSizeToGrams(sizeStr);
  if (!grams || !price || price <= 0) return null;
  return Number(((price / grams) * 100).toFixed(3));
}

// ---------- Strict mappers
function mapProductRaw(p) {
  // Accept various raw keys; coerce to the strict schema
  const name  = str(p.name || p.product_name || p.title);
  const brand = str(p.brand || p.product_brand || p.manufacturer);
  const size  = str(p.size || p.product_size || p.pack_size || p.net_content);
  const url   = str(p.url || p.link || p.product_url);
  const price = num(p.price || p.current_price || p.sale_price || p.unit_price);
  const barcode = str(p.barcode || p.ean || p.gtin);
  const up100 = unitPricePer100(size, price);

  return sanitizeProduct({
    name, brand, price, size, url,
    unit_price_per_100: up100,
    ...(barcode ? { barcode } : {})
  });

  function str(v){ return v == null ? "" : String(v).trim(); }
  function num(v){ const n = Number(v); return Number.isFinite(n) ? Number(n.toFixed(2)) : null; }
}

function sanitizeProduct(prod) {
  // Remove invalids and enforce required fields
  const required = ["name","brand","price","size","url"];
  for (const k of required) if (!prod[k]) return null;
  if (!Number.isFinite(prod.price) || prod.price <= 0) return null;
  // unit_price_per_100 can be null if size parse failed; keep it but prefer when sorting
  return prod;
}

function mapResults(rawResultsObj) {
  // Input shape: { [ingredient]: { searchQuery, quantityUnits, totalGramsRequired?, userQuantity?, currentSelectionURL, allProducts:[raw...] , category? } }
  const out = {};
  for (const [ingredient, block] of Object.entries(rawResultsObj || {})) {
    const allProducts = (block.allProducts || [])
      .map(mapProductRaw)
      .filter(Boolean);

    // Sort by unit price when available, else by absolute price
    allProducts.sort((a, b) => {
      const au = a.unit_price_per_100, bu = b.unit_price_per_100;
      if (Number.isFinite(au) && Number.isFinite(bu)) return au - bu;
      if (Number.isFinite(au)) return -1;
      if (Number.isFinite(bu)) return 1;
      return a.price - b.price;
    });

    // Validate currentSelectionURL
    let currentSelectionURL = String(block.currentSelectionURL || "");
    if (!allProducts.find(p => p.url === currentSelectionURL) && allProducts.length > 0) {
      currentSelectionURL = allProducts[0].url;
    }

    out[ingredient] = {
      category: block.category || undefined,
      searchQuery: String(block.searchQuery || ""),
      quantityUnits: String(block.quantityUnits || ""),
      totalGramsRequired: num(block.totalGramsRequired),
      userQuantity: num(block.userQuantity) ?? 1,
      currentSelectionURL,
      allProducts
    };
  }
  return out;

  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : undefined; }
}

function mapUniqueIngredients(rawList) {
  return (rawList || []).map(it => ({
    originalIngredient: String(it.originalIngredient || it.name || it.ingredient || ""),
    quantityUnits: String(it.quantityUnits || it.qty || ""),
    category: String(it.category || it.group || "")
  }));
}

function mapMealPlan(rawDays) {
  // Expect [{ day, meals:[{type,name,description}]}]
  return (rawDays || []).map(d => ({
    day: Number(d.day ?? 1),
    meals: (d.meals || []).map(m => ({
      type: String(m.type || m.meal_type || ""),
      name: String(m.name || m.title || ""),
      description: String(m.description || m.desc || "")
    }))
  }));
}

// ---------- LLM orchestration stub
async function runLLMOrchestrator(input, logs) {
  logs.push(L("INFO","PHASE","Start LLM orchestration"));
  // Replace this stub with your existing Gemini flow
  // It should produce: mealPlan, uniqueIngredients, preliminary results (products), nutritionalTargets
  // Here we return a tiny deterministic mock so the frontend can load while you wire the real call.
  const mealPlan = [
    { day: 1, meals: [
      { type: "breakfast", name: "Oats + Milk", description: "Rolled oats, milk, banana" },
      { type: "lunch", name: "Chicken rice", description: "Chicken breast, rice, broccoli" },
      { type: "dinner", name: "Beef pasta", description: "Lean beef, pasta, tomato" }
    ]}
  ];
  const uniqueIngredients = [
    { originalIngredient: "Rolled oats", quantityUnits: "500 g", category: "Pantry" },
    { originalIngredient: "Full cream milk", quantityUnits: "2 L", category: "Dairy" }
  ];
  const candidateResults = {
    "Rolled oats": {
      category: "Pantry",
      searchQuery: "rolled oats 1kg",
      quantityUnits: "500 g",
      totalGramsRequired: 500,
      userQuantity: 1,
      currentSelectionURL: "https://example.com/prod/rolled-oats-1kg",
      allProducts: [
        { name:"Coles Rolled Oats 1kg", brand:"Coles", price:3.60, size:"1 kg", url:"https://example.com/prod/rolled-oats-1kg" },
        { name:"Uncle Tobys Oats 1kg", brand:"Uncle Tobys", price:6.50, size:"1 kg", url:"https://example.com/prod/uncle-tobys-1kg" }
      ]
    },
    "Full cream milk": {
      category: "Dairy",
      searchQuery: "full cream milk 2L",
      quantityUnits: "2 L",
      totalGramsRequired: 2000,
      userQuantity: 1,
      currentSelectionURL: "https://example.com/prod/coles-milk-2l",
      allProducts: [
        { name:"Coles Full Cream Milk 2L", brand:"Coles", price:3.10, size:"2 L", url:"https://example.com/prod/coles-milk-2l" },
        { name:"Dairy Farmers Full Cream 2L", brand:"Dairy Farmers", price:4.20, size:"2 L", url:"https://example.com/prod/df-milk-2l" }
      ]
    }
  };
  const nutritionalTargets = { calories: 3500, protein: 180, fat: 100, carbs: 450 };

  logs.push(L("SUCCESS","PHASE","LLM orchestration finished"));
  return { mealPlan, uniqueIngredients, results: candidateResults, nutritionalTargets };
}

// ---------- HTTP handler
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const logs = [];
  try {
    logs.push(L("INFO","SYSTEM","Request received", { path: req.url }));

    // 1) Validate body minimally
    const body = typeof req.body === "object" && req.body ? req.body : {};
    logs.push(L("INFO","DATA","Input body accepted", { keys: Object.keys(body) }));

    // 2) Orchestrate
    const raw = await runLLMOrchestrator(body, logs);

    // 3) Strict mapping
    logs.push(L("INFO","PHASE","Mapping uniqueIngredients"));
    const uniqueIngredients = mapUniqueIngredients(raw.uniqueIngredients);

    logs.push(L("INFO","PHASE","Mapping results and products"));
    const results = mapResults(raw.results);

    logs.push(L("INFO","PHASE","Mapping mealPlan"));
    const mealPlan = mapMealPlan(raw.mealPlan);

    // 4) Nutritional targets
    const nutritionalTargets = {
      calories: num(raw.nutritionalTargets?.calories) ?? 0,
      protein:  num(raw.nutritionalTargets?.protein)  ?? 0,
      fat:      num(raw.nutritionalTargets?.fat)      ?? 0,
      carbs:    num(raw.nutritionalTargets?.carbs)    ?? 0
    };

    // 5) Response
    logs.push(L("SUCCESS","SYSTEM","Response ready"));
    res.status(200).json({ logs, mealPlan, uniqueIngredients, results, nutritionalTargets });
  } catch (err) {
    logs.push(L("CRITICAL","SYSTEM","Unhandled error", { message: String(err && err.message || err) }));
    res.status(500).json({ logs, error: "internal_error" });
  }

  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : undefined; }
};
