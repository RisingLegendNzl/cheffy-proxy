// --- ORCHESTRATOR API for Cheffy V3 ---

// This file implements the "Mark 13" pipeline:
// 1. (Optional) Creative AI call.
// 2. Technical AI call (plan, 3 query types, requiredWords, targetSize).
// 3. Sequential Query Market Run (Tight -> Normal -> Wide) with Tiny Checklist validation.
// 4. Backend Nutrition Calculation using Open Food Facts.

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
const MAX_CONCURRENCY = 5; // Limit for Nutrition search concurrency (Price search is now sequential per ingredient)

// Banned words for the checklist
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on'];
// Size sanity check tolerance (e.g., +/- 50%)
const SIZE_TOLERANCE = 0.5;

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


// --- HELPERS ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function concurrentlyMap(array, limit, asyncMapper) {
    // No change from Mark 10
    const results = [];
    const executing = [];
    for (const item of array) {
        const promise = asyncMapper(item).then(result => {
            executing.splice(executing.indexOf(promise), 1);
            return result;
        }).catch(error => {
             console.error("Error during concurrentlyMap item processing:", error);
             executing.splice(executing.indexOf(promise), 1);
             return { error: error.message };
        });
        executing.push(promise);
        results.push(promise);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}


async function fetchWithRetry(url, options, log) {
    // No change from Mark 10
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status} from ${url}. Retrying...`, 'WARN', 'HTTP');
            } else {
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from ${url}.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call to ${url} failed with client error ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
            log(`Attempt ${attempt}: Fetch failed for ${url} with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
            console.error(`Fetch Error Details (Attempt ${attempt}):`, error);
        }
        if (attempt < MAX_RETRIES) {
            const delayTime = Math.pow(2, attempt - 1) * 2000;
            await delay(delayTime);
        }
    }
    log(`API call to ${url} failed definitively after ${MAX_RETRIES} attempts.`, 'CRITICAL', 'HTTP');
    throw new Error(`API call to ${url} failed after ${MAX_RETRIES} attempts.`);
}


const calculateUnitPrice = (price, size) => {
    // No change from Mark 10
    if (!price || price <= 0 || typeof size !== 'string' || size.length === 0) return price;
    const sizeLower = size.toLowerCase().replace(/\s/g, '');
    let numericSize = 0;
    const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/);
    if (match) {
        numericSize = parseFloat(match[1]);
        const unit = match[2];
        if (numericSize > 0) {
            let totalUnits = (unit === 'kg' || unit === 'l') ? numericSize * 1000 : numericSize;
            if (totalUnits >= 100) return (price / totalUnits) * 100;
        }
    }
    return price;
};

// Function to extract numeric value and unit from size string (e.g., "500g", "1L")
function parseSize(sizeString) {
    if (typeof sizeString !== 'string') return null;
    const sizeLower = sizeString.toLowerCase().replace(/\s/g, '');
    const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/);
    if (match) {
        const value = parseFloat(match[1]);
        let unit = match[2];
        let valueInBaseUnits = value; // Default to g or ml

        if (unit === 'kg') {
            valueInBaseUnits *= 1000;
            unit = 'g';
        } else if (unit === 'l') {
            valueInBaseUnits *= 1000;
            unit = 'ml';
        }

        return { value: valueInBaseUnits, unit: unit }; // Return value in grams or ml
    }
    return null; // Return null if no match
}


/**
 * Your Tiny Checklist function.
 * @param {object} product - Product object from RapidAPI.
 * @param {object} ingredientData - Data from the AI blueprint.
 * @param {Function} log - Logging function.
 * @returns {boolean} - True if the product passes the checklist.
 */
function runTinyChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    const { requiredWords = [], targetSize } = ingredientData;

    // 1. Includes required words
    if (requiredWords.length > 0) {
        const includesAll = requiredWords.every(kw => productNameLower.includes(kw.toLowerCase()));
        if (!includesAll) {
            // log(`Checklist FAIL (Required): "${product.product_name}" missing words from [${requiredWords.join(', ')}]`, 'DEBUG', 'CHECKLIST');
            return false;
        }
    }

    // 2. Excludes banned words
    const containsBanned = BANNED_KEYWORDS.some(kw => productNameLower.includes(kw));
    if (containsBanned) {
        // log(`Checklist FAIL (Banned): "${product.product_name}" contains banned word`, 'DEBUG', 'CHECKLIST');
        return false;
    }

    // 3. Size sanity check
    if (targetSize?.value && targetSize.unit && product.product_size) {
        const productSizeParsed = parseSize(product.product_size);
        if (productSizeParsed && productSizeParsed.unit === targetSize.unit) {
            const lowerBound = targetSize.value * (1 - SIZE_TOLERANCE);
            const upperBound = targetSize.value * (1 + SIZE_TOLERANCE);
            if (productSizeParsed.value < lowerBound || productSizeParsed.value > upperBound) {
                // log(`Checklist FAIL (Size): "${product.product_name}" size ${productSizeParsed.value}${productSizeParsed.unit} outside range (${lowerBound}-${upperBound}${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
                return false;
            }
        } else if (productSizeParsed) {
             // log(`Checklist WARN (Size Unit Mismatch): "${product.product_name}" unit ${productSizeParsed.unit} != target ${targetSize.unit}. Skipping size check.`, 'DEBUG', 'CHECKLIST');
             // Allow unit mismatches for now, rely on other checks
        } else {
            // log(`Checklist WARN (Size Parse Fail): Could not parse size "${product.product_size}" for "${product.product_name}". Skipping size check.`, 'DEBUG', 'CHECKLIST');
        }
    } else if (targetSize?.value) {
        // log(`Checklist WARN (Size Info Missing): Target size provided but product size missing or unparsable for "${product.product_name}". Skipping size check.`, 'DEBUG', 'CHECKLIST');
    }

    // If all checks pass
    // log(`Checklist PASS: "${product.product_name}"`, 'DEBUG', 'CHECKLIST');
    return true;
}


function isCreativePrompt(cuisinePrompt) {
    // No change from Mark 10
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') {
        return false;
    }
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'spicy', 'mild', 'quick', 'easy', 'high protein', 'low carb', 'low fat', 'vegetarian', 'vegan'];
    const promptLower = cuisinePrompt.toLowerCase();
    if (simpleKeywords.some(kw => promptLower === kw)) {
        return false;
    }
    return cuisinePrompt.length > 20 || !simpleKeywords.some(kw => promptLower.includes(kw));
}

/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];

    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        // No change from Mark 10
        const logEntry = { timestamp: new Date().toISOString(), level: level.toUpperCase(), tag: tag.toUpperCase(), message: message, data: data };
        logs.push(logEntry);
        console.log(JSON.stringify(logEntry));
        return logEntry;
    };

    log("Orchestrator invoked.", 'INFO', 'SYSTEM');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP');
        return response.status(200).end();
    }

    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        return response.status(405).json({ message: 'Method Not Allowed', logs });
    }

    try {
        const formData = request.body;
        const { store, cuisine } = formData;

        // --- Phase 1: Creative Router --- (No change)
        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) {
            log(`Creative prompt detected: "${cuisine}". Calling Creative AI...`, 'INFO', 'LLM');
            creativeIdeas = await generateCreativeIdeas(cuisine, log);
            log(`Creative AI returned: "${creativeIdeas.substring(0, 100)}..."`, 'SUCCESS', 'LLM');
        } else {
            log("Simple prompt detected. Skipping Creative AI.", 'INFO', 'SYSTEM');
        }

        // --- Phase 2: Technical Blueprint --- (MODIFIED TO GET 3 QUERIES + SIZE)
        log("Phase 2: Generating Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData);
        log(`Calculated daily calorie target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        // Now expects tightQuery, normalQuery, wideQuery, requiredWords, targetSize
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log);
        if (!ingredientPlan || ingredientPlan.length === 0) {
            log("Blueprint failed: Technical AI did not return an ingredient plan.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log(`Blueprint successful. ${ingredientPlan.length} ingredients found.`, 'SUCCESS', 'PHASE');


        // --- Phase 3: Market Run (Sequential Query + Checklist) --- (NEW LOGIC)
        log("Phase 3: Executing Sequential Query Market Run...", 'INFO', 'PHASE');

        const finalResults = {}; // Store the final selected product for each ingredient

        // Process ingredients sequentially to avoid RapidAPI rate limits from parallel bursts
        for (const ingredient of ingredientPlan) {
            const ingredientKey = ingredient.originalIngredient;
            log(`Processing ingredient: "${ingredientKey}"`, 'INFO', 'MARKET_RUN');
            finalResults[ingredientKey] = { // Initialize result structure
                ...ingredient, // Keep AI data (grams, original name, category etc.)
                allProducts: [], // Store all *valid* products found across queries
                currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, // Default to mock
                source: 'failed', // Default status
                searchAttempts: [] // Log attempts
            };

            let foundProduct = null;
            const queriesToTry = [
                { type: 'tight', query: ingredient.tightQuery },
                { type: 'normal', query: ingredient.normalQuery },
                { type: 'wide', query: ingredient.wideQuery }
            ];

            for (const { type, query } of queriesToTry) {
                 if (!query) {
                    log(`Skipping query type "${type}" for "${ingredientKey}" as it's missing.`, 'WARN', 'MARKET_RUN');
                    finalResults[ingredientKey].searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0});
                    continue;
                 }

                log(`Attempting "${type}" query for "${ingredientKey}": "${query}"`, 'INFO', 'HTTP');
                const priceData = await fetchPriceData(store, query, 1); // Fetch only Page 1
                finalResults[ingredientKey].searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0, rawCount: 0});
                const currentAttemptLog = finalResults[ingredientKey].searchAttempts.at(-1);


                if (priceData.error) {
                    log(`Failed fetch for "${type}" query "${query}": ${priceData.error.message}`, 'WARN', 'HTTP');
                    currentAttemptLog.status = 'fetch_error';
                    // Continue to the next query type if fetch fails
                    continue;
                }

                const rawProducts = priceData.results || [];
                currentAttemptLog.rawCount = rawProducts.length;
                log(`Raw results for "${ingredientKey}" (${type} query):`, 'INFO', 'DATA', rawProducts.map(p => p.product_name));

                const validProductsOnPage = [];
                for (const rawProduct of rawProducts) {
                    // Run checklist on each product
                    if (runTinyChecklist(rawProduct, ingredient, log)) {
                         validProductsOnPage.push({
                              name: rawProduct.product_name,
                              brand: rawProduct.product_brand,
                              price: rawProduct.current_price,
                              size: rawProduct.product_size,
                              url: rawProduct.url,
                              barcode: rawProduct.barcode,
                              unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size),
                         });
                    }
                }

                currentAttemptLog.foundCount = validProductsOnPage.length;

                if (validProductsOnPage.length > 0) {
                    log(`Found ${validProductsOnPage.length} valid products for "${ingredientKey}" using "${type}" query.`, 'SUCCESS', 'DATA');
                    // Add all valid products found in this successful query attempt
                    finalResults[ingredientKey].allProducts = validProductsOnPage;
                    // Select the cheapest valid product from this query
                    foundProduct = validProductsOnPage.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, validProductsOnPage[0]);
                    finalResults[ingredientKey].currentSelectionURL = foundProduct.url;
                    finalResults[ingredientKey].source = 'discovery';
                    currentAttemptLog.status = 'success';
                    break; // Stop searching once a valid product is found
                } else {
                    log(`No valid products found for "${ingredientKey}" using "${type}" query after checklist.`, 'WARN', 'DATA');
                    currentAttemptLog.status = 'no_match';
                    // Continue to the next query type
                }
            } // End of query types loop

            if (!foundProduct) {
                 log(`"${ingredientKey}" definitively failed - no valid products found after all query attempts.`, 'WARN', 'MARKET_RUN');
                 // Keep source as 'failed' and URL as mock
            }
        } // End of ingredients loop

        log("Market Run complete.", 'SUCCESS', 'PHASE');
        // --- END NEW PHASE 3 ---


        // --- Phase 4: Nutrition Calculation --- (MODIFIED TO USE finalResults)
        log("Phase 4: Calculating Estimated Nutrition...", 'INFO', 'PHASE');
        let calculatedTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };

        const itemsToFetchNutrition = [];
        for (const key in finalResults) {
             const result = finalResults[key];
             // Find the selected product based on currentSelectionURL
             const selectedProduct = result.allProducts.find(p => p.url === result.currentSelectionURL);
             if (result.source === 'discovery' && selectedProduct) {
                  itemsToFetchNutrition.push({
                       ingredientKey: key,
                       barcode: selectedProduct.barcode,
                       query: selectedProduct.name, // Use the selected product's name
                       grams: result.totalGramsRequired || 0
                  });
             }
        }


        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition data for ${itemsToFetchNutrition.length} selected products...`, 'INFO', 'HTTP');

            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_CONCURRENCY, (item) =>
                fetchNutritionData(item.barcode, item.query)
                    .then(nutrition => ({ ...item, nutrition }))
                    .catch(err => {
                        log(`Nutrition fetch failed for ${item.ingredientKey}: ${err.message}`, 'WARN', 'HTTP');
                        return { ...item, nutrition: { status: 'not_found' } };
                    })
            );

            log("Nutrition data fetching complete.", 'SUCCESS', 'HTTP');

            nutritionResults.forEach(item => {
                if (item.nutrition && item.nutrition.status === 'found' && item.grams > 0) {
                    const nutritionPer100g = item.nutrition;
                    calculatedTotals.calories += (nutritionPer100g.calories / 100) * item.grams;
                    calculatedTotals.protein += (nutritionPer100g.protein / 100) * item.grams;
                    calculatedTotals.fat += (nutritionPer100g.fat / 100) * item.grams;
                    calculatedTotals.carbs += (nutritionPer100g.carbs / 100) * item.grams;
                } else {
                    log(`Skipping nutrition calculation for ${item.ingredientKey}: Data not found or zero grams.`, 'INFO', 'CALC');
                }
            });

            // Calculate DAILY average
            const numDays = parseInt(formData.days, 10) || 1;
            calculatedTotals.calories = Math.round(calculatedTotals.calories / numDays);
            calculatedTotals.protein = Math.round(calculatedTotals.protein / numDays);
            calculatedTotals.fat = Math.round(calculatedTotals.fat / numDays);
            calculatedTotals.carbs = Math.round(calculatedTotals.carbs / numDays);


            log("Estimated DAILY nutrition totals calculated.", 'SUCCESS', 'CALC', calculatedTotals);
        } else {
             log("No valid products found to calculate nutrition.", 'WARN', 'CALC');
        }
        // --- END PHASE 4 ---

        log("Phase 5: Assembling Final Response...", 'INFO', 'PHASE');

        const finalResponseData = {
            mealPlan: mealPlan || [],
            uniqueIngredients: ingredientPlan, // Send original AI plan list
            results: finalResults, // Send processed results object
            nutritionalTargets: calculatedTotals
        };

        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');

        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack, name: error.name });
        console.error("ORCHESTRATOR CRITICAL ERROR STACK:", error);
        return response.status(500).json({ message: "An unrecoverable error occurred during plan generation.", error: error.message, logs });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


// --- API-CALLING FUNCTIONS ---

async function generateCreativeIdeas(cuisinePrompt, log) {
    // No change from Mark 11
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a creative chef and pop-culture expert. A user wants a meal plan based on a theme. Brainstorm a simple list of 10-15 meal names that fit the theme. Return *only* a simple, comma-separated list of the meal names. Do not add any other text.`;
    const userQuery = `Theme: "${cuisinePrompt}"
    
    Return a comma-separated list of meal names.`;
    log("Creative AI Prompt", 'INFO', 'LLM_PROMPT', { userQuery });
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, };
    try {
        const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
        if (!response.ok) { throw new Error(`Creative AI API HTTP error! Status: ${response.status}.`); }
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) { throw new Error("Creative AI response was empty."); }
        log("Creative AI Raw Response", 'INFO', 'LLM', { raw: text.substring(0, 500) });
        return text;
    } catch (error) {
        log("Creative AI failed.", 'CRITICAL', 'LLM', { error: error.message });
        return "";
    }
}


/**
 * AI Call #2: The "Technician" - Updated for Mark 13 (3 Queries + Size)
 */
async function generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost...", 'Quality Focus': "Prioritize premium quality...", 'Best Value': "Balance unit cost..." }[costPriority] || "Balance unit cost...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = creativeIdeas ? `Use these creative meal ideas: ${creativeIdeas}` : (cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Neutral profile.');

    // --- PROMPT UPDATED FOR MARK 13 ---
    const systemPrompt = `You are an expert dietitian, chef, and search query optimizer creating a practical grocery and meal plan.
RULES:
1.  Generate a meal plan AND a consolidated shopping list ('ingredients').
2.  **CRITICAL QUERY RULES**: For each ingredient:
    a. 'tightQuery': MUST be a hyper-specific query, likely including brand/size if known/important (e.g., "Coles RSPCA chicken breast fillets 500g"). MAY be null if impossible.
    b. 'normalQuery': MUST be 2-4 generic but descriptive words (e.g., "chicken breast fillets", "smooth peanut butter"). This is the primary query.
    c. 'wideQuery': MUST be 1-2 very broad words or synonyms (e.g., "chicken breast", "peanut butter", "oats"). MAY be null if normalQuery is already very broad.
3.  'requiredWords': MUST be an array of 2-3 essential lowercase keywords for validation (e.g., ["chicken", "breast", "fillet"], ["peanut", "butter", "smooth"]).
4.  'targetSize': MUST be an object { "value": NUMBER, "unit": "g" | "ml" } representing the typical pack size (e.g., { "value": 500, "unit": "g" }). Estimate if needed. MUST BE IN 'g' or 'ml'. Be null if not applicable (e.g., loose produce).
5.  Adhere strictly to user constraints.
6.  'ingredients' array is MANDATORY. 'mealPlan' is OPTIONAL but make best effort.
7.  DO NOT include 'nutritionalTargets'.`;
    // --- END UPDATED PROMPT ---

    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}.
- Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Activity: ${formData.activityLevel}. Goal: ${goal}.
- Target: ~${calorieTarget} kcal (reference only). Dietary Needs: ${dietary}.
- Meals: ${eatingOccasions} (${requiredMeals.join(', ')}). Spending: ${costPriority} (${costInstruction}). Repetition Max: ${maxRepetitions}.
- Cuisine: ${cuisineInstruction}. Store: ${store}.`;

    log("Technical AI Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' });

    // --- SCHEMA UPDATED FOR MARK 13 ---
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT", properties: {
                    "ingredients": {
                        type: "ARRAY", items: {
                            type: "OBJECT", properties: {
                                "originalIngredient": { "type": "STRING" },
                                "category": { "type": "STRING" },
                                "tightQuery": { "type": "STRING", nullable: true }, // Added
                                "normalQuery": { "type": "STRING" }, // Changed name
                                "wideQuery": { "type": "STRING", nullable: true }, // Added
                                "requiredWords": { type: "ARRAY", items: { "type": "STRING" } }, // Added
                                "targetSize": { type: "OBJECT", properties: { "value": { "type": "NUMBER" }, "unit": { "type": "STRING", enum: ["g", "ml"] } }, nullable: true }, // Added
                                "totalGramsRequired": { "type": "NUMBER" },
                                "quantityUnits": { "type": "STRING" }
                            }, required: ["originalIngredient", "normalQuery", "requiredWords", "totalGramsRequired", "quantityUnits"] // Adjusted required
                        }
                    },
                    "mealPlan": {
                        type: "ARRAY", items: {
                            type: "OBJECT", properties: {
                                "day": { "type": "NUMBER" },
                                "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } }
                            }
                        }
                    }
                }, required: ["ingredients"]
            }
        }
    };
    // --- END UPDATED SCHEMA ---


    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) { throw new Error(`Technical AI API HTTP error! Status: ${response.status}.`); }
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) { log("Technical AI returned no text.", 'CRITICAL', 'LLM', result); throw new Error("LLM response empty."); }
    log("Technical AI Raw Response", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });
    try {
        const parsed = JSON.parse(jsonText);
        log("Parsed Technical AI Response", 'INFO', 'DATA', { ingredientCount: parsed.ingredients?.length || 0, hasMealPlan: !!parsed.mealPlan && parsed.mealPlan.length > 0 });
        if (!parsed.ingredients) { parsed.ingredients = []; log("Corrected missing 'ingredients' array.", 'WARN', 'LLM'); }
        // Add basic validation for expected new fields (optional chaining)
        if (parsed.ingredients.length > 0 && !parsed.ingredients[0]?.normalQuery) {
            log("Validation Warning: Technical AI response missing 'normalQuery' in first ingredient.", 'WARN', 'LLM', parsed.ingredients[0]);
        }
         if (parsed.ingredients.length > 0 && !parsed.ingredients[0]?.requiredWords) {
            log("Validation Warning: Technical AI response missing 'requiredWords' in first ingredient.", 'WARN', 'LLM', parsed.ingredients[0]);
        }

        return parsed;
    } catch (parseError) {
        log("Failed to parse Technical AI JSON.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: parseError.message });
        throw new Error(`Failed to parse LLM JSON: ${parseError.message}`);
    }
}

function calculateCalorieTarget(formData) {
    // No change from previous version
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);
    if (!weightKg || !heightCm || !ageYears) return 2000;
    let bmr = (gender === 'male') ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5) : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);
    const goalAdjustments = { cut: -500, maintain: 0, bulk: 500 };
    return Math.round(tdee + (goalAdjustments[goal] || 0));
}
/// ===== API-CALLERS-END ===== ////

