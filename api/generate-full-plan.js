// --- ORCHESTRATOR API for Cheffy Mark 44 (patched) ---
// Adds targeted retry for high-carb set and uses the widened solver.

"use strict";

///   IMPORTS-START   \\\\
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
///   UTIL-END     \\\\



///   LLM-STUB-START   \\\\
async function draftMealPlanLLM(userProfile, macroContract, logger) {
  logger.log("INFO", "LLM", "draftMealPlanLLM() placeholder draft");
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
///   LLM-STUB-END     \\\\



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

    // 2) First draft
    const llmDraft = await draftMealPlanLLM(userProfile, macroContract, { log });
    log("INFO", "LLM_DRAFT", "Meals", { mealsCount: llmDraft.meals.length });

    // 3) Fit portions
    let fitResult = fitMealsToContract(llmDraft.meals, macroContract, { log });

    // 3b) Targeted retry with carb bias if needed
    if (!fitResult.feasible) {
      log("WARN", "MACRO_SOLVER_RETRY", "Retrying with high-carb meal bias");
      const llmDraft2 = await draftMealPlanLLM(
        {
          ...userProfile,
          cuisinePrompt:
            (userProfile.cuisinePrompt || "") +
            " | emphasize rice, pasta, breads, fruit; keep fats moderate; protein steady"
        },
        macroContract,
        { log }
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
    log("CRITICAL", "UNCAUGHT", "Unhandled error", { message: err.message, stack: err.stack });
    return res.status(500).json({ error: "UNCAUGHT", message: err.message, logs: getLogs() });
  }
};
///   HANDLER-END   \\\\
