// --- ORCHESTRATOR API for Cheffy V3 ---

// Mark 20 Pipeline + ENHANCED LOGGING to diagnose product and nutrition failures.
// 1. Creative AI (Optional)
// 2. Technical AI (Plan, 3 Queries, Keywords, Size, Total Grams) - Log full output
// 3. Parallel Market Run (T->N->W, Skip Heuristic, Smarter Checklist) - Log queries, raw results, checklist reasons
// 4. Nutrition Calculation - Log weekly totals & days

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3;
const MAX_NUTRITION_CONCURRENCY = 5;
const MAX_MARKET_RUN_CONCURRENCY = 5; // K value
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery', 'filter', 'paper', 'tip'];
const SIZE_TOLERANCE = 0.6;
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60;
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0;

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function concurrentlyMap(array, limit, asyncMapper) { /* no change */ const results = []; const executing = []; for (const item of array) { const promise = asyncMapper(item).then(result => { executing.splice(executing.indexOf(promise), 1); return result; }).catch(error => { console.error("Error during concurrentlyMap item processing:", error); executing.splice(executing.indexOf(promise), 1); return { error: error.message, item: item?.originalIngredient || 'unknown' }; }); executing.push(promise); results.push(promise); if (executing.length >= limit) { await Promise.race(executing); } } return Promise.all(results); }

async function fetchWithRetry(url, options, log) { /* no change */ for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) { try { const response = await fetch(url, options); if (response.ok) return response; if (response.status === 429 || response.status >= 500) { log(`Attempt ${attempt}: Retryable ${response.status} from ${url}. Retrying...`, 'WARN', 'HTTP'); } else { const errorBody = await response.text(); log(`Attempt ${attempt}: Non-retryable ${response.status} from ${url}.`, 'CRITICAL', 'HTTP', { body: errorBody }); throw new Error(`API call failed ${response.status}. Body: ${errorBody}`); } } catch (error) { if (!error.message.startsWith('API call failed')) { log(`Attempt ${attempt}: Fetch failed for ${url}: ${error.message}. Retrying...`, 'WARN', 'HTTP'); console.error(`Fetch Err Detail (Att ${attempt}):`, error); } else { throw error; } } if (attempt < MAX_RETRIES) { const delayTime = Math.pow(2, attempt - 1) * 2000; await delay(delayTime); } } log(`API call ${url} failed after ${MAX_RETRIES} attempts.`, 'CRITICAL', 'HTTP'); throw new Error(`API call ${url} failed.`); }

const calculateUnitPrice = (price, size) => { /* no change */ if (!price || price <= 0 || typeof size !== 'string' || size.length === 0) return price; const sizeLower = size.toLowerCase().replace(/\s/g, ''); let numericSize = 0; const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/); if (match) { numericSize = parseFloat(match[1]); const unit = match[2]; if (numericSize > 0) { let totalUnits = (unit === 'kg' || unit === 'l') ? numericSize * 1000 : numericSize; if (totalUnits >= 100) return (price / totalUnits) * 100; } } return price; };

function parseSize(sizeString) { /* no change */ if (typeof sizeString !== 'string') return null; const sizeLower = sizeString.toLowerCase().replace(/\s/g, ''); const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/); if (match) { const value = parseFloat(match[1]); let unit = match[2]; let valueInBaseUnits = value; if (unit === 'kg') { valueInBaseUnits *= 1000; unit = 'g'; } else if (unit === 'l') { valueInBaseUnits *= 1000; unit = 'ml'; } return { value: valueInBaseUnits, unit: unit }; } return null; }

function calculateRequiredWordScore(productNameLower, requiredWords) { /* no change */ if (!requiredWords || requiredWords.length === 0) return 1.0; let wordsFound = 0; requiredWords.forEach(kw => { const regex = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`); if (regex.test(productNameLower)) { wordsFound++; } }); return wordsFound / requiredWords.length; }

/**
 * Smarter Checklist function - WITH DETAILED LOGGING ENABLED.
 */
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) return { pass: false, score: 0 };

    const { originalIngredient, requiredWords = [], negativeKeywords = [], targetSize } = ingredientData;
    // Use originalIngredient in log prefix for clarity
    const checkLogPrefix = `Checklist [${originalIngredient}] for "${product.product_name}"`;
    let score = 0;

    // --- 1. Excludes Banned Words (Global Filter) ---
    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // --- 2. Excludes Negative Keywords (AI Filter) ---
    if (negativeKeywords.length > 0) {
        const negativeWordFound = negativeKeywords.find(kw => productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }

    // --- 3. Required Words Score ---
    score = calculateRequiredWordScore(productNameLower, requiredWords);
    if (score < REQUIRED_WORD_SCORE_THRESHOLD) {
        log(`${checkLogPrefix}: FAIL (Score ${score.toFixed(2)} < ${REQUIRED_WORD_SCORE_THRESHOLD} vs [${requiredWords.join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: score };
    }

    // --- 4. Size sanity check ---
    if (targetSize?.value && targetSize.unit && product.product_size) {
        const productSizeParsed = parseSize(product.product_size);
        if (productSizeParsed && productSizeParsed.unit === targetSize.unit) {
            const lowerBound = targetSize.value * (1 - SIZE_TOLERANCE);
            const upperBound = targetSize.value * (1 + SIZE_TOLERANCE);
            if (productSizeParsed.value < lowerBound || productSizeParsed.value > upperBound) {
                log(`${checkLogPrefix}: FAIL (Size ${productSizeParsed.value}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
                return { pass: false, score: score };
            }
        } else if (productSizeParsed) {
            // Log unit mismatch only if needed for debugging, less critical
             log(`${checkLogPrefix}: WARN (Size Unit Mismatch ${productSizeParsed.unit} vs ${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
        } else {
             log(`${checkLogPrefix}: WARN (Size Parse Fail "${product.product_size}")`, 'DEBUG', 'CHECKLIST');
        }
    } // No penalty if units mismatch or parse fails

    log(`${checkLogPrefix}: PASS (Score: ${score.toFixed(2)})`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: score };
}


function isCreativePrompt(cuisinePrompt) { /* no change */ if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false; const simpleKeywords = ['italian','mexican','chinese','thai','indian','japanese','mediterranean','french','spanish','korean','vietnamese','greek','american','spicy','mild','quick','easy','high protein','low carb','low fat','vegetarian','vegan']; const promptLower = cuisinePrompt.toLowerCase(); if (simpleKeywords.some(kw => promptLower === kw)) return false; return cuisinePrompt.length > 20 || !simpleKeywords.some(kw => promptLower.includes(kw)); }

/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => { const logEntry={timestamp:new Date().toISOString(),level:level.toUpperCase(),tag:tag.toUpperCase(),message,data}; logs.push(logEntry); console.log(JSON.stringify(logEntry)); return logEntry;};

    log("Orchestrator invoked.", 'INFO', 'SYSTEM');
    // CORS Headers (no change)
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') { log("OPTIONS request.", 'INFO', 'HTTP'); return response.status(200).end(); }
    if (request.method !== 'POST') { log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP'); return response.status(405).json({ message: 'Method Not Allowed', logs }); }

    try {
        const formData = request.body;
        const { store, cuisine } = formData;
        const numDays = parseInt(formData.days, 10) || 1;

        // --- Phase 1: Creative Router --- (No change)
        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) { log(`Creative: "${cuisine}". Calling AI...`, 'INFO', 'LLM'); creativeIdeas = await generateCreativeIdeas(cuisine, log); log(`Creative AI: "${creativeIdeas.substring(0, 50)}..."`, 'SUCCESS', 'LLM'); }
        else { log("Simple prompt. Skipping.", 'INFO', 'SYSTEM'); }

        // --- Phase 2: Technical Blueprint --- (ADDED LOGGING)
        log("Phase 2: Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData); log(`Daily target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log); // Uses Mark 19 prompt
        if (!ingredientPlan || ingredientPlan.length === 0) { log("Blueprint fail: No ingredients.", 'CRITICAL', 'LLM'); throw new Error("Blueprint fail: No ingredients."); }
        log(`Blueprint success: ${ingredientPlan.length} ingredients.`, 'SUCCESS', 'PHASE');
        // *** ADDED LOGGING: Log full AI output for ingredients ***
        ingredientPlan.forEach((ing, index) => {
            log(`AI Ingredient ${index + 1}: ${ing.originalIngredient}`, 'DEBUG', 'DATA', ing);
        });
        // *** END ADDED LOGGING ***

        // --- Phase 3: Market Run (Parallel & Optimized) --- (ADDED LOGGING)
        log("Phase 3: Parallel Market Run...", 'INFO', 'PHASE');

        const processSingleIngredientOptimized = async (ingredient) => {
            const ingredientKey = ingredient.originalIngredient;
            const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
            let foundProduct = null;
            let bestScoreSoFar = -1;

            const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];

            for (const { type, query } of queriesToTry) {
                 if (!query) { result.searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0}); continue; }

                // *** ADDED LOGGING: Log query being used ***
                log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
                const priceData = await fetchPriceData(store, query, 1); // Page 1 only
                result.searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0, rawCount: 0, bestScore: 0});
                const currentAttemptLog = result.searchAttempts.at(-1);

                if (priceData.error) { log(`[${ingredientKey}] Fetch failed (${type}): ${priceData.error.message}`, 'WARN', 'HTTP'); currentAttemptLog.status = 'fetch_error'; continue; }

                const rawProducts = priceData.results || [];
                currentAttemptLog.rawCount = rawProducts.length;
                // *** ADDED LOGGING: Log raw product names before checklist ***
                log(`[${ingredientKey}] Raw results (${type}, ${rawProducts.length}):`, 'DEBUG', 'DATA', rawProducts.map(p => p.product_name));

                const validProductsOnPage = [];
                let pageBestScore = -1;
                for (const rawProduct of rawProducts) {
                    // Checklist now includes detailed fail reasons
                    const checklistResult = runSmarterChecklist(rawProduct, ingredient, log);
                    if (checklistResult.pass) {
                         validProductsOnPage.push({ product: { name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size), }, score: checklistResult.score });
                         pageBestScore = Math.max(pageBestScore, checklistResult.score);
                    }
                }
                currentAttemptLog.foundCount = validProductsOnPage.length;
                currentAttemptLog.bestScore = pageBestScore;

                if (validProductsOnPage.length > 0) {
                    log(`[${ingredientKey}] Found ${validProductsOnPage.length} valid (${type}, Score: ${pageBestScore.toFixed(2)}).`, 'INFO', 'DATA');
                    result.allProducts.push(...validProductsOnPage.map(vp => vp.product));
                    foundProduct = result.allProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, result.allProducts[0]);
                    result.currentSelectionURL = foundProduct.url;
                    result.source = 'discovery';
                    currentAttemptLog.status = 'success';
                    bestScoreSoFar = Math.max(bestScoreSoFar, pageBestScore);

                    if (type === 'tight' && bestScoreSoFar >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                        log(`[${ingredientKey}] Skip heuristic hit (Score ${bestScoreSoFar.toFixed(2)}).`, 'INFO', 'MARKET_RUN');
                        break;
                    }
                } else {
                    log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA');
                    currentAttemptLog.status = 'no_match';
                }
            } // End query loop

            if (result.source === 'failed') { log(`[${ingredientKey}] Definitive fail.`, 'WARN', 'MARKET_RUN'); }
            return { [ingredientKey]: result };
        }; // End processSingleIngredient

        log(`Market Run: ${ingredientPlan.length} ingredients, K=${MAX_MARKET_RUN_CONCURRENCY}...`, 'INFO', 'MARKET_RUN');
        const startMarketTime = Date.now();
        const parallelResultsArray = await concurrentlyMap(ingredientPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        const endMarketTime = Date.now();
        log(`Market Run parallel took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

        const finalResults = parallelResultsArray.reduce((acc, currentResult) => { /* error handling no change */ if(currentResult.error){ log(`Error processing "${currentResult.item}": ${currentResult.error}`, 'CRITICAL', 'MARKET_RUN'); if(currentResult.item){ acc[currentResult.item] = { ...ingredientPlan.find(i=>i.originalIngredient===currentResult.item), source: 'error', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: currentResult.error}] }; } return acc; } return { ...acc, ...currentResult }; }, {});
        log("Market Run complete.", 'SUCCESS', 'PHASE');


        // --- Phase 4: Nutrition Calculation --- (ADDED LOGGING)
        log("Phase 4: Nutrition Calculation...", 'INFO', 'PHASE');
        let calculatedTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        const itemsToFetchNutrition = [];
        for (const key in finalResults) { const result = finalResults[key]; const selected = result.allProducts?.find(p => p.url === result.currentSelectionURL); if (result.source === 'discovery' && selected) { itemsToFetchNutrition.push({ ingredientKey: key, barcode: selected.barcode, query: selected.name, grams: result.totalGramsRequired || 0 }); } }

        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition for ${itemsToFetchNutrition.length} products...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, (item) => fetchNutritionData(item.barcode, item.query).then(nut => ({ ...item, nut })).catch(err => { log(`Nutri fetch fail ${item.ingredientKey}: ${err.message}`, 'WARN', 'HTTP'); return { ...item, nut: { status: 'not_found' } }; }));
            log("Nutrition fetch complete.", 'SUCCESS', 'HTTP');

            let weeklyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
            nutritionResults.forEach(item => { if (item.nut?.status === 'found' && item.grams > 0) { const nut=item.nut; weeklyTotals.calories+=(nut.calories/100)*item.grams; weeklyTotals.protein+=(nut.protein/100)*item.grams; weeklyTotals.fat+=(nut.fat/100)*item.grams; weeklyTotals.carbs+=(nut.carbs/100)*item.grams; } else { /* skip log already present */ } });

            // *** ADDED LOGGING: Log weekly totals and days before division ***
            log("Calculated WEEKLY nutrition totals:", 'DEBUG', 'CALC', weeklyTotals);
            log(`Number of days for averaging: ${numDays}`, 'DEBUG', 'CALC');
            // *** END ADDED LOGGING ***

            calculatedTotals.calories = Math.round(weeklyTotals.calories / numDays); calculatedTotals.protein = Math.round(weeklyTotals.protein / numDays); calculatedTotals.fat = Math.round(weeklyTotals.fat / numDays); calculatedTotals.carbs = Math.round(weeklyTotals.carbs / numDays);
            log("DAILY nutrition totals calculated.", 'SUCCESS', 'CALC', calculatedTotals);
        } else { log("No products for nutrition.", 'WARN', 'CALC'); }


        // --- Phase 5: Assembling Final Response --- (No change)
        log("Phase 5: Final Response...", 'INFO', 'PHASE');
        const finalResponseData = { mealPlan: mealPlan || [], uniqueIngredients: ingredientPlan, results: finalResults, nutritionalTargets: calculatedTotals };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error("ORCHESTRATOR ERROR:", error);
        return response.status(500).json({ message: "An unrecoverable error occurred.", error: error.message, logs });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


async function generateCreativeIdeas(cuisinePrompt, log) { /* no change */ const GEMINI_API_URL=`${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;const sysPrompt=`Creative chef... comma-separated list.`;const userQuery=`Theme: "${cuisinePrompt}"...`;log("Creative Prompt",'INFO','LLM_PROMPT',{userQuery});const payload={contents:[{parts:[{text:userQuery}]}],systemInstruction:{parts:[{text:sysPrompt}]}};try{const res=await fetchWithRetry(GEMINI_API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},log);if(!res.ok)throw new Error(`Creative AI HTTP ${res.status}.`);const result=await res.json();const text=result.candidates?.[0]?.content?.parts?.[0]?.text;if(!text)throw new Error("Creative AI empty.");log("Creative Raw",'INFO','LLM',{raw:text.substring(0,500)});return text;}catch(e){log("Creative AI failed.",'CRITICAL','LLM',{error:e.message});return"";}}

async function generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log) { /* Prompt no change from Mark 19 */ const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData; const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`; const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']}; const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3']; const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality..."; const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2; const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.'); const systemPrompt = `Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate meal plan & shopping list ('ingredients'). 2. QUERIES: For each ingredient: a. 'tightQuery': Hyper-specific, STORE-PREFIXED (e.g., "${store} RSPCA chicken breast 500g"). Null if impossible. b. 'normalQuery': 2-4 generic words, STORE-PREFIXED (e.g., "${store} chicken breast fillets"). NO brands/sizes unless essential. c. 'wideQuery': 1-2 broad words, STORE-PREFIXED (e.g., "${store} chicken"). Null if normal is broad. 3. 'requiredWords': Array[2-4] ESSENTIAL, CORE, lowercase keywords for SCORE-BASED matching (e.g., ["chicken", "breast", "fillet"]). 4. 'negativeKeywords': Array[1-5] lowercase words indicating INCORRECT product (e.g., ["oil", "brine", "cat"]). Empty array ok. 5. 'targetSize': Object {value: NUM, unit: "g"|"ml"} (e.g., {value: 500, unit: "g"}). Null if N/A. 6. 'totalGramsRequired': BEST ESTIMATE total g/ml for plan. SUM your meal portions. Be precise. 7. Adhere to constraints. 8. 'ingredients' MANDATORY. 'mealPlan' OPTIONAL but BEST EFFORT. 9. NO 'nutritionalTargets'.`; const userQuery = `Gen ${days}-day plan for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Target: ~${calorieTarget} kcal (ref). Dietary: ${dietary}. Meals: ${eatingOccasions} (${requiredMeals.join(', ')}). Spend: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}. Cuisine: ${cuisineInstruction}.`; log("Technical Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' }); const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "tightQuery": { "type": "STRING", nullable: true }, "normalQuery": { "type": "STRING" }, "wideQuery": { "type": "STRING", nullable: true }, "requiredWords": { type: "ARRAY", items: { "type": "STRING" } }, "negativeKeywords": { type: "ARRAY", items: { "type": "STRING" } }, "targetSize": { type: "OBJECT", properties: { "value": { "type": "NUMBER" }, "unit": { "type": "STRING", enum: ["g", "ml"] } }, nullable: true }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } }, required: ["originalIngredient", "normalQuery", "requiredWords", "negativeKeywords", "totalGramsRequired", "quantityUnits"] } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } } }, required: ["ingredients"] } } }; const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log); if (!response.ok) throw new Error(`Technical AI HTTP ${response.status}.`); const result=await response.json(); const jsonText=result.candidates?.[0]?.content?.parts?.[0]?.text; if (!jsonText){log("Technical AI empty.",'CRITICAL','LLM',result); throw new Error("LLM empty.");} log("Technical Raw",'INFO','LLM',{raw:jsonText.substring(0,1000)+'...'}); try { const parsed=JSON.parse(jsonText); log("Parsed Technical",'INFO','DATA',{ingreds:parsed.ingredients?.length||0,hasMealPlan:!!parsed.mealPlan?.length}); if(!parsed.ingredients){parsed.ingredients=[];log("Added missing 'ingredients'.",'WARN','LLM');} if(parsed.ingredients.length>0&&!parsed.ingredients[0]?.normalQuery){log("WARN: Missing 'normalQuery'.",'WARN','LLM',parsed.ingredients[0]);} if(parsed.ingredients.length>0&&(!parsed.ingredients[0]?.requiredWords||parsed.ingredients[0]?.requiredWords.length<1)){log("WARN: Missing 'requiredWords'.",'WARN','LLM',parsed.ingredients[0]);} if(parsed.ingredients.length>0&&!parsed.ingredients[0]?.negativeKeywords){log("WARN: Missing 'negativeKeywords'.",'WARN','LLM',parsed.ingredients[0]);} return parsed; } catch (e) { log("Failed parse Technical JSON.",'CRITICAL','LLM',{jsonText:jsonText.substring(0,1000),error:e.message}); throw new Error(`Parse LLM JSON: ${e.message}`); } }

function calculateCalorieTarget(formData) { /* no change */ const{weight,height,age,gender,activityLevel,goal}=formData;const w=parseFloat(weight);const h=parseFloat(height);const y=parseInt(age,10);if(!w||!h||!y)return 2000;let bmr=(gender==='male')?(10*w+6.25*h-5*y+5):(10*w+6.25*h-5*y-161);const actM={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryActive:1.9};const tdee=bmr*(actM[level]||1.55);const goalAdj={cut:-500,maintain:0,bulk:500};return Math.round(tdee+(goalAdj[goal]||0));} // Fixed typo activityLevel -> level
/// ===== API-CALLERS-END ===== ////

