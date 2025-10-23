// --- ORCHESTRATOR API for Cheffy V3 ---

// This file implements the "Mark 19" pipeline:
// 1. (Optional) Creative AI call.
// 2. Technical AI call (plan, 3 STORE-PREFIXED query types, required/negativeKeywords, targetSize, accurate totalGrams).
// 3. Sequential Query Market Run (Tight -> Normal -> Wide) with **Smarter Checklist (Score-Based + Negative)** validation.
// 4. Backend Nutrition Calculation using Open Food Facts (Daily Average).

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // Retries for Gemini calls
const MAX_CONCURRENCY = 5; // Limit for Nutrition search concurrency
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery']; // Expanded banned list
const SIZE_TOLERANCE = 0.6; // +/- 60%
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60; // Must match >= 60%

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function concurrentlyMap(array, limit, asyncMapper) { /* no change */ const results = []; const executing = []; for (const item of array) { const promise = asyncMapper(item).then(result => { executing.splice(executing.indexOf(promise), 1); return result; }).catch(error => { console.error("Error during concurrentlyMap item processing:", error); executing.splice(executing.indexOf(promise), 1); return { error: error.message }; }); executing.push(promise); results.push(promise); if (executing.length >= limit) { await Promise.race(executing); } } return Promise.all(results); }

async function fetchWithRetry(url, options, log) { /* no change */ for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) { try { const response = await fetch(url, options); if (response.ok) return response; if (response.status === 429 || response.status >= 500) { log(`Attempt ${attempt}: Received retryable error ${response.status} from ${url}. Retrying...`, 'WARN', 'HTTP'); } else { const errorBody = await response.text(); log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from ${url}.`, 'CRITICAL', 'HTTP', { body: errorBody }); throw new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`); } } catch (error) { log(`Attempt ${attempt}: Fetch failed for ${url} with error: ${error.message}. Retrying...`, 'WARN', 'HTTP'); console.error(`Fetch Error Details (Attempt ${attempt}):`, error); } if (attempt < MAX_RETRIES) { const delayTime = Math.pow(2, attempt - 1) * 2000; await delay(delayTime); } } log(`API call to ${url} failed definitively after ${MAX_RETRIES} attempts.`, 'CRITICAL', 'HTTP'); throw new Error(`API call failed after ${MAX_RETRIES} attempts.`); }

const calculateUnitPrice = (price, size) => { /* no change */ if (!price || price <= 0 || typeof size !== 'string' || size.length === 0) return price; const sizeLower = size.toLowerCase().replace(/\s/g, ''); let numericSize = 0; const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/); if (match) { numericSize = parseFloat(match[1]); const unit = match[2]; if (numericSize > 0) { let totalUnits = (unit === 'kg' || unit === 'l') ? numericSize * 1000 : numericSize; if (totalUnits >= 100) return (price / totalUnits) * 100; } } return price; };

function parseSize(sizeString) { /* no change */ if (typeof sizeString !== 'string') return null; const sizeLower = sizeString.toLowerCase().replace(/\s/g, ''); const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/); if (match) { const value = parseFloat(match[1]); let unit = match[2]; let valueInBaseUnits = value; if (unit === 'kg') { valueInBaseUnits *= 1000; unit = 'g'; } else if (unit === 'l') { valueInBaseUnits *= 1000; unit = 'ml'; } return { value: valueInBaseUnits, unit: unit }; } return null; }

/**
 * Smarter Checklist function (Mark 14/17 - Score Based + Negative Keywords).
 * @param {object} product - Product object from RapidAPI.
 * @param {object} ingredientData - Data from the AI blueprint.
 * @param {Function} log - Logging function.
 * @returns {boolean} - True if the product passes the checklist.
 */
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) return false; // Fail if no product name

    const { requiredWords = [], negativeKeywords = [], targetSize } = ingredientData;
    const checkLogPrefix = `Checklist for "${product.product_name}" vs [${requiredWords.join(', ')}]`;

    // --- 1. Excludes Banned Words (Global Filter) ---
    const containsGlobalBanned = BANNED_KEYWORDS.some(kw => productNameLower.includes(kw));
    if (containsGlobalBanned) {
        // log(`${checkLogPrefix}: FAIL (Global Banned)`, 'DEBUG', 'CHECKLIST');
        return false;
    }

    // --- 2. Excludes Negative Keywords (AI Filter) ---
    if (negativeKeywords.length > 0) {
        const containsNegative = negativeKeywords.some(kw => productNameLower.includes(kw.toLowerCase()));
        if (containsNegative) {
            // log(`${checkLogPrefix}: FAIL (Negative Keyword)`, 'DEBUG', 'CHECKLIST');
            return false;
        }
    }

    // --- 3. Required Words Score ---
    let matchScore = 0;
    if (requiredWords.length > 0) {
        let wordsFound = 0;
        requiredWords.forEach(kw => {
            // Use word boundary check for more accuracy (\b)
            const regex = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
            if (regex.test(productNameLower)) {
                wordsFound++;
            }
        });
        matchScore = wordsFound / requiredWords.length;
    } else {
        matchScore = 1.0; // Pass if no required words
    }

    if (matchScore < REQUIRED_WORD_SCORE_THRESHOLD) {
        // log(`${checkLogPrefix}: FAIL (Score ${matchScore.toFixed(2)} < ${REQUIRED_WORD_SCORE_THRESHOLD})`, 'DEBUG', 'CHECKLIST');
        return false;
    }

    // --- 4. Size sanity check ---
    if (targetSize?.value && targetSize.unit && product.product_size) {
        const productSizeParsed = parseSize(product.product_size);
        if (productSizeParsed && productSizeParsed.unit === targetSize.unit) {
            const lowerBound = targetSize.value * (1 - SIZE_TOLERANCE);
            const upperBound = targetSize.value * (1 + SIZE_TOLERANCE);
            if (productSizeParsed.value < lowerBound || productSizeParsed.value > upperBound) {
                // log(`${checkLogPrefix}: FAIL (Size ${productSizeParsed.value}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
                return false;
            }
        } // No penalty if units mismatch or parse fails, rely on other checks
    }

    // log(`${checkLogPrefix}: PASS (Score: ${matchScore.toFixed(2)})`, 'DEBUG', 'CHECKLIST');
    return true; // Pass if all checks passed
}


function isCreativePrompt(cuisinePrompt) { /* no change */ if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false; const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'spicy', 'mild', 'quick', 'easy', 'high protein', 'low carb', 'low fat', 'vegetarian', 'vegan']; const promptLower = cuisinePrompt.toLowerCase(); if (simpleKeywords.some(kw => promptLower === kw)) return false; return cuisinePrompt.length > 20 || !simpleKeywords.some(kw => promptLower.includes(kw)); }

/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => { /* no change */ const logEntry={timestamp:new Date().toISOString(),level:level.toUpperCase(),tag:tag.toUpperCase(),message,data}; logs.push(logEntry); console.log(JSON.stringify(logEntry)); return logEntry;};

    log("Orchestrator invoked.", 'INFO', 'SYSTEM');
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') { log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP'); return response.status(200).end(); }
    if (request.method !== 'POST') { log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP'); return response.status(405).json({ message: 'Method Not Allowed', logs }); }

    try {
        const formData = request.body;
        const { store, cuisine } = formData;
        const numDays = parseInt(formData.days, 10) || 1; // Get number of days for nutrition calc

        // --- Phase 1: Creative Router --- (No change)
        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) { log(`Creative prompt detected: "${cuisine}". Calling Creative AI...`, 'INFO', 'LLM'); creativeIdeas = await generateCreativeIdeas(cuisine, log); log(`Creative AI returned: "${creativeIdeas.substring(0, 100)}..."`, 'SUCCESS', 'LLM'); }
        else { log("Simple prompt detected. Skipping Creative AI.", 'INFO', 'SYSTEM'); }

        // --- Phase 2: Technical Blueprint --- (Uses updated AI function)
        log("Phase 2: Generating Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData); log(`Calculated daily calorie target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log); // Function contains updated prompt
        if (!ingredientPlan || ingredientPlan.length === 0) { log("Blueprint failed: Technical AI did not return an ingredient plan.", 'CRITICAL', 'LLM'); throw new Error("Blueprint failed: LLM did not return ingredient plan."); }
        log(`Blueprint successful. ${ingredientPlan.length} ingredients found.`, 'SUCCESS', 'PHASE');


        // --- Phase 3: Market Run (Sequential Query + Smarter Checklist v4.0) --- (No change in logic flow)
        log("Phase 3: Executing Sequential Query Market Run...", 'INFO', 'PHASE');
        const finalResults = {};

        for (const ingredient of ingredientPlan) {
            const ingredientKey = ingredient.originalIngredient;
            log(`Processing ingredient: "${ingredientKey}"`, 'INFO', 'MARKET_RUN');
            finalResults[ingredientKey] = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };

            let foundProduct = null;
            // Use store prefix from AI queries
            const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];

            for (const { type, query } of queriesToTry) {
                 if (!query) { log(`Skipping query type "${type}" for "${ingredientKey}" as missing.`, 'WARN', 'MARKET_RUN'); finalResults[ingredientKey].searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0}); continue; }

                log(`Attempting "${type}" query for "${ingredientKey}": "${query}"`, 'INFO', 'HTTP');
                const priceData = await fetchPriceData(store, query, 1); // Page 1 only
                finalResults[ingredientKey].searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0, rawCount: 0});
                const currentAttemptLog = finalResults[ingredientKey].searchAttempts.at(-1);

                if (priceData.error) { log(`Failed fetch for "${type}" query "${query}": ${priceData.error.message}`, 'WARN', 'HTTP'); currentAttemptLog.status = 'fetch_error'; continue; }

                const rawProducts = priceData.results || [];
                currentAttemptLog.rawCount = rawProducts.length;
                log(`Raw results for "${ingredientKey}" (${type} query):`, 'INFO', 'DATA', rawProducts.map(p => p.product_name));

                const validProductsOnPage = [];
                for (const rawProduct of rawProducts) {
                    // *** USE SMARTER CHECKLIST v4.0 ***
                    if (runSmarterChecklist(rawProduct, ingredient, log)) {
                         validProductsOnPage.push({ name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size), });
                    }
                }
                currentAttemptLog.foundCount = validProductsOnPage.length;

                if (validProductsOnPage.length > 0) {
                    log(`Found ${validProductsOnPage.length} valid products for "${ingredientKey}" using "${type}" query.`, 'SUCCESS', 'DATA');
                    finalResults[ingredientKey].allProducts = validProductsOnPage;
                    foundProduct = validProductsOnPage.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, validProductsOnPage[0]);
                    finalResults[ingredientKey].currentSelectionURL = foundProduct.url;
                    finalResults[ingredientKey].source = 'discovery';
                    currentAttemptLog.status = 'success';
                    break; // Stop searching
                } else {
                    log(`No valid products for "${ingredientKey}" using "${type}" query after smarter checklist.`, 'WARN', 'DATA');
                    currentAttemptLog.status = 'no_match';
                }
            } // End query types loop
            if (!foundProduct) { log(`"${ingredientKey}" definitively failed - no valid products found.`, 'WARN', 'MARKET_RUN'); }
        } // End ingredients loop
        log("Market Run complete.", 'SUCCESS', 'PHASE');


        // --- Phase 4: Nutrition Calculation --- (Corrected Daily Average Calc)
        log("Phase 4: Calculating Estimated Nutrition...", 'INFO', 'PHASE');
        let calculatedTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        const itemsToFetchNutrition = [];
        for (const key in finalResults) { const result = finalResults[key]; const selectedProduct = result.allProducts.find(p => p.url === result.currentSelectionURL); if (result.source === 'discovery' && selectedProduct) { itemsToFetchNutrition.push({ ingredientKey: key, barcode: selectedProduct.barcode, query: selectedProduct.name, grams: result.totalGramsRequired || 0 }); } }

        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition data for ${itemsToFetchNutrition.length} selected products...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_CONCURRENCY, (item) => fetchNutritionData(item.barcode, item.query).then(nutrition => ({ ...item, nutrition })).catch(err => { log(`Nutrition fetch failed for ${item.ingredientKey}: ${err.message}`, 'WARN', 'HTTP'); return { ...item, nutrition: { status: 'not_found' } }; }));
            log("Nutrition data fetching complete.", 'SUCCESS', 'HTTP');

            let weeklyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
            nutritionResults.forEach(item => { if (item.nutrition?.status === 'found' && item.grams > 0) { const nut = item.nutrition; weeklyTotals.calories += (nut.calories / 100) * item.grams; weeklyTotals.protein += (nut.protein / 100) * item.grams; weeklyTotals.fat += (nut.fat / 100) * item.grams; weeklyTotals.carbs += (nut.carbs / 100) * item.grams; } else { log(`Skipping nutrition for ${item.ingredientKey}: Data not found/zero grams.`, 'INFO', 'CALC'); } });

            // Correct Daily Average Calculation
            calculatedTotals.calories = Math.round(weeklyTotals.calories / numDays);
            calculatedTotals.protein = Math.round(weeklyTotals.protein / numDays);
            calculatedTotals.fat = Math.round(weeklyTotals.fat / numDays);
            calculatedTotals.carbs = Math.round(weeklyTotals.carbs / numDays);

            log("Estimated DAILY nutrition totals calculated.", 'SUCCESS', 'CALC', calculatedTotals);
        } else { log("No valid products found to calculate nutrition.", 'WARN', 'CALC'); }


        // --- Phase 5: Assembling Final Response --- (No change)
        log("Phase 5: Assembling Final Response...", 'INFO', 'PHASE');
        const finalResponseData = { mealPlan: mealPlan || [], uniqueIngredients: ingredientPlan, results: finalResults, nutritionalTargets: calculatedTotals };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) }); // Log stack snippet
        console.error("ORCHESTRATOR CRITICAL ERROR STACK:", error);
        return response.status(500).json({ message: "An unrecoverable error occurred.", error: error.message, logs });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


async function generateCreativeIdeas(cuisinePrompt, log) { /* no change */ const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`; const systemPrompt = `You are a creative chef... Return *only* a simple, comma-separated list...`; const userQuery = `Theme: "${cuisinePrompt}"...`; log("Creative AI Prompt", 'INFO', 'LLM_PROMPT', { userQuery }); const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, }; try { const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log); if (!response.ok) throw new Error(`Creative AI API HTTP error! Status: ${response.status}.`); const result = await response.json(); const text = result.candidates?.[0]?.content?.parts?.[0]?.text; if (!text) throw new Error("Creative AI response was empty."); log("Creative AI Raw Response", 'INFO', 'LLM', { raw: text.substring(0, 500) }); return text; } catch (error) { log("Creative AI failed.", 'CRITICAL', 'LLM', { error: error.message }); return ""; } }

/**
 * AI Call #2: The "Technician" - Updated Prompt for Mark 17/19 (Store Prefix, Negative Keywords)
 */
async function generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['B','L','D'], '4': ['B','L','D','S1'], '5': ['B','L','D','S1','S2'] };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY lowest cost...", 'Quality Focus': "Premium quality...", 'Best Value': "Balance cost/quality..." }[costPriority] || "Balance cost/quality...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = creativeIdeas ? `Use these creative meal ideas: ${creativeIdeas}` : (cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Neutral profile.');

    // --- PROMPT UPDATED FOR MARK 17/19 ---
    const systemPrompt = `You are an expert dietitian, chef, and search query optimizer creating a practical grocery and meal plan for a specific store: ${store}.
RULES:
1.  Generate meal plan AND shopping list ('ingredients').
2.  **CRITICAL QUERY RULES**: For each ingredient:
    a. 'tightQuery': Hyper-specific query, PREPENDING store name (e.g., "${store} RSPCA chicken breast fillets 500g"). Null if impossible.
    b. 'normalQuery': 2-4 generic but descriptive words, PREPENDING store name (e.g., "${store} chicken breast fillets", "${store} smooth peanut butter"). MUST NOT be overly specific (NO brands/sizes unless essential).
    c. 'wideQuery': 1-2 very broad words, PREPENDING store name (e.g., "${store} chicken breast", "${store} peanut butter", "${store} oats"). Null if normal is broad.
3.  'requiredWords': Array of 2-4 ESSENTIAL, CORE, lowercase keywords defining the item for SCORE-BASED matching (e.g., ["chicken", "breast", "fillet"], ["peanut", "butter", "smooth"]).
4.  'negativeKeywords': Array of 1-5 lowercase words that indicate an INCORRECT product (e.g., for "tuna springwater": ["oil", "brine", "cat"]; for "diced beef": ["mince", "strip"]). Empty array if none apply.
5.  'targetSize': Object { "value": NUMBER, "unit": "g" | "ml" } for typical pack size (e.g., { "value": 500, "unit": "g" }). MUST BE 'g' or 'ml'. Null if not applicable (e.g., loose produce like 'apples').
6.  'totalGramsRequired': Your BEST ESTIMATE of total grams needed for the entire plan. Calculate this by summing portion sizes in your generated mealPlan. Be precise.
7.  Adhere to user constraints.
8.  'ingredients' MANDATORY. 'mealPlan' OPTIONAL but make BEST EFFORT (provide simple plan if needed).
9.  DO NOT include 'nutritionalTargets'.`;
    // --- END UPDATED PROMPT ---

    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}.
- Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Activity: ${formData.activityLevel}. Goal: ${goal}.
- Store: ${store}.
- Target: ~${calorieTarget} kcal (ref only). Dietary: ${dietary}.
- Meals: ${eatingOccasions} (${requiredMeals.join(', ')}). Spending: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}.
- Cuisine: ${cuisineInstruction}.`;

    log("Technical AI Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' });

    // --- SCHEMA UPDATED FOR MARK 17 (negativeKeywords) ---
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT", properties: {
                    "ingredients": {
                        type: "ARRAY", items: {
                            type: "OBJECT", properties: {
                                "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" },
                                "tightQuery": { "type": "STRING", nullable: true },
                                "normalQuery": { "type": "STRING" },
                                "wideQuery": { "type": "STRING", nullable: true },
                                "requiredWords": { type: "ARRAY", items: { "type": "STRING" } },
                                "negativeKeywords": { type: "ARRAY", items: { "type": "STRING" } }, // Added
                                "targetSize": { type: "OBJECT", properties: { "value": { "type": "NUMBER" }, "unit": { "type": "STRING", enum: ["g", "ml"] } }, nullable: true },
                                "totalGramsRequired": { "type": "NUMBER" },
                                "quantityUnits": { "type": "STRING" }
                            }, required: ["originalIngredient", "normalQuery", "requiredWords", "negativeKeywords", "totalGramsRequired", "quantityUnits"] // Added negativeKeywords
                        }
                    },
                    "mealPlan": {
                        type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } }
                }, required: ["ingredients"]
            }
        }
    };
    // --- END UPDATED SCHEMA ---


    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) throw new Error(`Technical AI API HTTP error! Status: ${response.status}.`);
    const result = await response.json(); const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text; if (!jsonText) { log("Technical AI returned no text.", 'CRITICAL', 'LLM', result); throw new Error("LLM response empty."); }
    log("Technical AI Raw Response", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });
    try {
        const parsed = JSON.parse(jsonText); log("Parsed Technical AI Response", 'INFO', 'DATA', { ingredientCount: parsed.ingredients?.length || 0, hasMealPlan: !!parsed.mealPlan && parsed.mealPlan.length > 0 }); if (!parsed.ingredients) { parsed.ingredients = []; log("Corrected missing 'ingredients' array.", 'WARN', 'LLM'); }
        // Basic validation
        if (parsed.ingredients.length > 0 && !parsed.ingredients[0]?.normalQuery) { log("Validation Warning: Missing 'normalQuery'.", 'WARN', 'LLM', parsed.ingredients[0]); }
        if (parsed.ingredients.length > 0 && (!parsed.ingredients[0]?.requiredWords || parsed.ingredients[0]?.requiredWords.length < 1)) { log("Validation Warning: Missing or empty 'requiredWords'.", 'WARN', 'LLM', parsed.ingredients[0]); }
        if (parsed.ingredients.length > 0 && !parsed.ingredients[0]?.negativeKeywords) { log("Validation Warning: Missing 'negativeKeywords'.", 'WARN', 'LLM', parsed.ingredients[0]); } // Check new field
        return parsed;
    } catch (parseError) { log("Failed to parse Technical AI JSON.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: parseError.message }); throw new Error(`Failed to parse LLM JSON: ${parseError.message}`); }
}

function calculateCalorieTarget(formData) { /* no change */ const { weight, height, age, gender, activityLevel, goal } = formData; const weightKg = parseFloat(weight); const heightCm = parseFloat(height); const ageYears = parseInt(age, 10); if (!weightKg || !heightCm || !ageYears) return 2000; let bmr = (gender === 'male') ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5) : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161); const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 }; const tdee = bmr * (activityMultipliers[activityLevel] || 1.55); const goalAdjustments = { cut: -500, maintain: 0, bulk: 500 }; return Math.round(tdee + (goalAdjustments[goal] || 0)); }
/// ===== API-CALLERS-END ===== ////