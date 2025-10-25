// --- ORCHESTRATOR API for Cheffy Mark 44 (LLM wired) ---
// Env:
//   OPENAI_API_KEY
//   LLM_MODEL   (e.g., "gpt-4o-mini" or "gpt-4o")
//   LLM_MEALS_MIN (optional, default 4)
//   LLM_MEALS_MAX (optional, default 6)

"use strict";

///   IMPORTS-START   \\\\
const axios = require("axios");
const fetch = require("node-fetch");
const { createClient } = require("@vercel/kv");

const {
  buildMacroContract,
  fitMealsToContract,
  checkContractSatisfied
} = require("./macro-solver.js");

const {
  mapIngredientsToCID,
  buildQueriesForCID,
  CID_REGISTRY,
  getExpectedMacroFingerprint
} = require("./canonical-ingredients.js");

const { fetchPriceDataForCID } = require("./price-search.js");
const { fetchNutritionForProduct } = require("./nutrition-search.js");
///   IMPORTS-END     \\\\



///   KV-START   \\\\
const kv = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});
function isKvConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
///   KV-END     \\\\



///   LOGGING-START   \\\\
function makeLogger() {
  const logs = [];
  function pushLog(level, tag, message, data) {
    const entry = { ts: new Date().toISOString(), level, tag, message, data: data ?? null };
    logs.push(entry);
    if (level === "ERROR" || level === "CRITICAL" || level === "WARN") {
      console.warn(`[${level}] [${tag}] ${message}`, data || "");
    } else {
      console.log(`[${level}] [${tag}] ${message}`);
    }
  }
  return { log: pushLog, getLogs: () => logs };
}
///   LOGGING-END     \\\\



///   UTIL-START   \\\\
function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function sumMacrosFromLedger(ledger) {
  let kcal = 0, p = 0, f = 0, c = 0;
  for (const row of ledger) {
    kcal += row.calories_kcal || 0;
    p    += row.protein_g || 0;
    f    += row.fat_g || 0;
    c    += row.carbs_g || 0;
  }
  return { calories: kcal, protein_g: p, fat_g: f, carbs_g: c };
}

function coerceNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
///   UTIL-END     \\\\



///   LLM-WIRED-START   \\\\
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const LLM_MEALS_MIN = Number(process.env.LLM_MEALS_MIN || 4);
const LLM_MEALS_MAX = Number(process.env.LLM_MEALS_MAX || 6);

const HAVE_LLM = Boolean(OPENAI_API_KEY);

const SYSTEM_PROMPT = `
You are a deterministic nutrition planner for Australian supermarkets.
Output strict JSON with key "meals".
Each meal must include: mealName, portionNote, estMacrosPerPortion {kcal,protein_g,fat_g,carbs_g}, ingredients[] of {displayName, quantityGrams}.
Bias: high-carb staples, moderate fat, steady protein. Avoid sauces masquerading as protein.
No commentary. JSON only.
`.trim();

function llmUserPayload(userProfile, macroContract, biasNote = "") {
  return {
    instruction: "Generate meals with realistic portions for the macro targets.",
    userProfile,
    macroTargets: macroContract,
    constraints: {
      meals_min: LLM_MEALS_MIN,
      meals_max: LLM_MEALS_MAX,
      macro_bias: "high carbs, moderate fat, steady protein",
      avoid: ["sauce-based proteins", "fried items", "protein waters", "olive oil spreads"],
      bias_note: biasNote
    },
    required_shape: {
      meals: [
        {
          mealName: "string",
          portionNote: "string",
          estMacrosPerPortion: { kcal: "number", protein_g: "number", fat_g: "number", carbs_g: "number" },
          ingredients: [{ displayName: "string", quantityGrams: "number" }]
        }
      ]
    }
  };
}

async function callOpenAIChatJson(systemPrompt, userPayload, logger) {
  const url = "https://api.openai.com/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };
  const body = {
    model: LLM_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) }
    ],
    temperature: 0.2
  };

  const resp = await axios.post(url, body, { headers, timeout: 45000 });
  const content = resp?.data?.choices?.[0]?.message?.content || "{}";
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    const cleaned = content.replace(/```json|```/g, "").trim();
    json = JSON.parse(cleaned);
  }
  logger.log("INFO", "LLM_OK", "Meals received", { meals: Array.isArray(json.meals) ? json.meals.length : 0 });
  return json;
}

function validateMealsShape(obj) {
  if (!obj || !Array.isArray(obj.meals)) return { ok: false, reason: "NO_MEALS_ARRAY" };
  const meals = obj.meals.slice(0, Math.max(LLM_MEALS_MIN, 1));
  if (meals.length < LLM_MEALS_MIN) return { ok: false, reason: "TOO_FEW_MEALS" };

  for (const m of meals) {
    if (!m || typeof m !== "object") return { ok: false, reason: "BAD_MEAL_OBJECT" };
    if (!m.mealName || !m.portionNote) return { ok: false, reason: "MISSING_FIELDS" };
    const e = m.estMacrosPerPortion || {};
    if (![e.kcal, e.protein_g, e.fat_g, e.carbs_g].every(x => Number.isFinite(Number(x)))) {
      return { ok: false, reason: "BAD_MACROS" };
    }
    if (!Array.isArray(m.ingredients) || m.ingredients.length === 0) {
      return { ok: false, reason: "NO_INGREDIENTS" };
    }
    for (const ing of m.ingredients) {
      if (!ing.displayName || !Number.isFinite(Number(ing.quantityGrams))) {
        return { ok: false, reason: "BAD_INGREDIENT" };
      }
    }
  }

  // coerce numbers
  const fixed = {
    meals: obj.meals.map(m => ({
      mealName: m.mealName,
      portionNote: m.portionNote,
      estMacrosPerPortion: {
        kcal: coerceNumber(m.estMacrosPerPortion.kcal),
        protein_g: coerceNumber(m.estMacrosPerPortion.protein_g),
        fat_g: coerceNumber(m.estMacrosPerPortion.fat_g),
        carbs_g: coerceNumber(m.estMacrosPerPortion.carbs_g)
      },
      ingredients: m.ingredients.map(g => ({
        displayName: g.displayName,
        quantityGrams: coerceNumber(g.quantityGrams)
      }))
    }))
  };
  return { ok: true, mealsObj: fixed };
}

async function draftMealPlanLLM(userProfile, macroContract, logger, biasNote = "") {
  if (!HAVE_LLM) {
    logger.log("WARN", "LLM_STUB", "OPENAI_API_KEY missing. Using placeholder draft.");
    return {
      meals: [
        {
          mealName: "Chicken Breast + Rice + Veg",
          portionNote: "plate",
          estMacrosPerPortion: { kcal: 700, protein_g: 55, fat_g: 15, carbs_g: 80 },
          ingredients: [
            { displayName: "Chicken Breast Fillet (Raw, Skinless)", quantityGrams: 200 },
            { displayName: "White Rice (Cooked)", quantityGrams: 250 },
            { displayName: "Olive Oil (Cook)", quantityGrams: 10 },
            { displayName: "Broccoli", quantityGrams: 100 }
          ]
        },
        {
          mealName: "Oats + Whey + Banana",
          portionNote: "bowl",
          estMacrosPerPortion: { kcal: 650, protein_g: 40, fat_g: 12, carbs_g: 85 },
          ingredients: [
            { displayName: "Rolled Oats", quantityGrams: 90 },
            { displayName: "Whey Protein Powder", quantityGrams: 30 },
            { displayName: "Banana", quantityGrams: 120 },
            { displayName: "Peanut Butter", quantityGrams: 20 }
          ]
        },
        {
          mealName: "Greek Yogurt + Fruit + Honey",
          portionNote: "bowl",
          estMacrosPerPortion: { kcal: 400, protein_g: 30, fat_g: 5, carbs_g: 55 },
          ingredients: [
            { displayName: "Greek Yogurt (Low Fat)", quantityGrams: 250 },
            { displayName: "Blueberries", quantityGrams: 100 },
            { displayName: "Honey", quantityGrams: 15 }
          ]
        }
      ]
    };
  }

  const payload = llmUserPayload(userProfile, macroContract, biasNote);
  const raw = await callOpenAIChatJson(SYSTEM_PROMPT, payload, logger);

  const v = validateMealsShape(raw);
  if (!v.ok) throw new Error(`LLM_BAD_OUTPUT:${v.reason}`);

  return v.mealsObj;
}
///   LLM-WIRED-END     \\\\



///   RESOLUTION-START   \\\\
async function resolveIngredientsAndBuildLedger(mealPlanScaled, storeList, logger) {
  const allIngredients = [];
  for (const meal of mealPlanScaled.meals) {
    for (const ing of meal.ingredientsScaled) {
      allIngredients.push({ name: ing.displayName, gramsUsed: ing.quantityGrams });
    }
  }

  const mapped = mapIngredientsToCID(allIngredients, logger);
  const uniqueByCID = uniqBy(mapped, x => x.canonical_id);

  const ingredientResults = {};
  const ledgerRows = [];
  const failedIngredients = [];

  for (const item of uniqueByCID) {
    const cid = item.canonical_id;
    const cidData = CID_REGISTRY[cid];
    if (!cidData) {
      logger.log("ERROR", "CID_LOOKUP", `No CID for ${item.name}`, { name: item.name });
      failedIngredients.push({ name: item.name, canonical_id: cid, reason: "NO_CID" });
      continue;
    }

    let bestProduct = null;
    let bestScore = 0;
    const debugMarketLog = [];

    for (const store of storeList) {
      const queries = buildQueriesForCID(cidData, store);
      const priceResp = await fetchPriceDataForCID({ cid, cidData, queries, store }, logger);

      debugMarketLog.push({
        store,
        queries,
        rawProducts: priceResp.rawProducts || [],
        acceptedProducts: priceResp.acceptedProducts || []
      });

      if (priceResp.acceptedProducts && priceResp.acceptedProducts.length > 0) {
        const top = priceResp.acceptedProducts[0];
        if (top.confidenceScore > bestScore) {
          bestScore = top.confidenceScore;
          bestProduct = { ...top, store };
        }
      }
    }

    if (!bestProduct) {
      logger.log("WARN", "RESOLVE_FAIL", `No valid SKU for ${cid}`, { cid });
      failedIngredients.push({ name: item.name, canonical_id: cid, reason: "NO_VALID_SKU", debugMarketLog });
      continue;
    }

    const expectedFingerprint = getExpectedMacroFingerprint(cidData);
    const nutri = await fetchNutritionForProduct(bestProduct, expectedFingerprint, logger);

    if (!nutri || nutri.reject === true) {
      logger.log("WARN", "NUTRITION_REJECT", `Fingerprint mismatch for ${cid}`, { cid, product: bestProduct });
      failedIngredients.push({ name: item.name, canonical_id: cid, reason: "MACRO_FINGERPRINT_REJECT", debugMarketLog });
      continue;
    }

    ingredientResults[cid] = {
      chosenStore: bestProduct.store,
      chosenProduct: bestProduct,
      nutritionPer100g: nutri.nutritionPer100g,
      confidenceScore: bestProduct.confidenceScore,
      debugMarketLog
    };

    const totalUsageGrams = mapped.filter(x => x.canonical_id === cid)
      .reduce((acc, row) => acc + (row.gramsUsed || 0), 0);

    const scale = totalUsageGrams / 100;
    ledgerRows.push({
      canonical_id: cid,
      gramsUsed: totalUsageGrams,
      calories_kcal: nutri.nutritionPer100g.calories_kcal * scale,
      protein_g:     nutri.nutritionPer100g.protein_g     * scale,
      fat_g:         nutri.nutritionPer100g.fat_g         * scale,
      carbs_g:       nutri.nutritionPer100g.carbs_g       * scale
    });
  }

  return { ingredientResults, ledgerRows, failedIngredients };
}
///   RESOLUTION-END     \\\\



///   HANDLER-START   \\\\
module.exports = async function handler(req, res) {
  const { log, getLogs } = makeLogger();

  try {
    const body = req.method === "POST" ? req.body : {};

    const userProfile = {
      height_cm: body.height_cm || 187,
      weight_kg: body.weight_kg || 73,
      age: body.age || 23,
      sex: body.sex || "male",
      activityLevel: body.activityLevel || "active",
      goal: body.goal || "lean_bulk_15pct",
      cuisinePrompt: body.cuisinePrompt || "high-carb lean bulk comfort foods"
    };

    const preferredStores = Array.isArray(body.preferredStores) && body.preferredStores.length > 0
      ? body.preferredStores
      : ["Coles", "Woolworths"];

    log("INFO", "INPUT", "Profile received", { userProfile, preferredStores });

    // 1) Macro contract
    const macroContract = buildMacroContract(userProfile);
    log("INFO", "MACRO_CONTRACT", "Computed", macroContract);

    // 2) First draft from LLM
    let llmDraft;
    try {
      llmDraft = await draftMealPlanLLM(userProfile, macroContract, { log });
    } catch (e) {
      log("ERROR", "LLM_FAIL", "Primary LLM call failed", { message: e.message });
      // hard fallback only if no LLM key or bad output
      llmDraft = await draftMealPlanLLM(userProfile, macroContract, { log }, "");
    }
    log("INFO", "LLM_DRAFT", "Meals received", { mealsCount: llmDraft.meals.length });

    // 3) Fit portions
    let fitResult = fitMealsToContract(llmDraft.meals, macroContract, { log });

    // 3b) Targeted retry with explicit carb bias if needed
    if (!fitResult.feasible && HAVE_LLM) {
      log("WARN", "MACRO_SOLVER_RETRY", "Retrying with high-carb meal bias via LLM");
      const llmDraft2 = await draftMealPlanLLM(
        { ...userProfile, cuisinePrompt: (userProfile.cuisinePrompt || "") },
        macroContract,
        { log },
        "emphasize rice, pasta, breads, fruit; keep fats moderate; protein steady"
      );
      fitResult = fitMealsToContract(llmDraft2.meals, macroContract, { log });
    }

    if (!fitResult.feasible) {
      log("CRITICAL", "MACRO_SOLVER_FAIL", "Solver could not satisfy macro contract", fitResult.reason);
      return res.status(500).json({
        error: "MACRO_INFEASIBLE",
        reason: fitResult.reason,
        logs: getLogs()
      });
    }

    log("INFO", "MACRO_SOLVER_OK", "Portions scaled", { totalMeals: fitResult.meals.length });

    // 4) Resolve to supermarkets + build nutrition ledger
    const marketPack = await resolveIngredientsAndBuildLedger(fitResult, preferredStores, { log });

    // 5) Totals from accepted SKUs
    const ledgerTotals = sumMacrosFromLedger(marketPack.ledgerRows);
    log("INFO", "LEDGER_TOTALS", "Macros from SKUs", ledgerTotals);

    // 6) Final contract check
    const finalCheck = checkContractSatisfied(ledgerTotals, macroContract);
    if (!finalCheck.ok) {
      log("ERROR", "FINAL_CONTRACT_MISS", "Actual macros violate contract", finalCheck);
      return res.status(500).json({
        error: "FINAL_MACRO_MISMATCH",
        reason: finalCheck,
        fitMealsToContractResult: fitResult,
        ledgerTotals,
        ingredientResults: marketPack.ingredientResults,
        failedIngredients: marketPack.failedIngredients,
        logs: getLogs()
      });
    }

    log("INFO", "FINAL_CONTRACT_OK", "Within tolerance", finalCheck);

    // 7) Response payload
    const uniqueIngredients = Object.keys(marketPack.ingredientResults).map(cid => {
      const data = marketPack.ingredientResults[cid];
      return {
        canonical_id: cid,
        chosenStore: data.chosenStore,
        chosenProductName: data.chosenProduct?.name || data.chosenProduct?.title || "",
        confidenceScore: data.confidenceScore
      };
    });

    const responsePayload = {
      nutritionalTargets: {
        calories_kcal: macroContract.calories,
        protein_g: macroContract.protein_g,
        fat_g: macroContract.fat_g,
        carbs_g: macroContract.carbs_g,
        tolerance: macroContract.tolerance
      },
      mealPlan: fitResult,
      uniqueIngredients,
      results: marketPack.ingredientResults,
      ledgerTotals,
      contractSatisfied: finalCheck,
      failedIngredientHistory: marketPack.failedIngredients,
      logs: getLogs()
    };

    return res.status(200).json(responsePayload);

  } catch (err) {
    console.error("UNCAUGHT_ERROR", err);
    const { log, getLogs } = makeLogger(); // ensure logs exist
    log("CRITICAL", "UNCAUGHT", "Unhandled error", { message: err.message, stack: err.stack });
    return res.status(500).json({ error: "UNCAUGHT", message: err.message, logs: getLogs() });
  }
};
///   HANDLER-END   \\\\
