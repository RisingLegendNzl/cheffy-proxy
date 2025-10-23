// --- ORCHESTRATOR API for Cheffy V3 ---

// This file implements the "Mark 10" pipeline:
// 1. (Optional) Creative AI call.
// 2. Technical AI call (plan, queries, validationKeywords).
// 3. Parallel "Scatter-Gather" price search + Local Validation.
// 4. Backend Nutrition Calculation using Open Food Facts.

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
// Import the nutrition fetching function
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // Retries for Gemini calls
const MAX_CONCURRENCY = 5; // Limit for RapidAPI price search AND Nutrition search concurrency
const MAX_PRICE_SEARCH_PAGES = 3; // Max pages to search for a valid product

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


// --- HELPERS ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executes an async mapping function on an array, limiting the number of promises run concurrently.
 * @param {Array} array - The array to iterate over.
 * @param {number} limit - The maximum number of promises to run at once.
 * @param {Function} asyncMapper - The async function to apply to each item.
 * @returns {Promise<Array>} A promise that resolves to an array of results.
 */
async function concurrentlyMap(array, limit, asyncMapper) {
    const results = [];
    const executing = [];
    for (const item of array) {
        // Create a wrapper function to ensure the promise is removable from the 'executing' array
        const promise = asyncMapper(item).then(result => {
            executing.splice(executing.indexOf(promise), 1);
            return result;
        }).catch(error => {
             // Ensure errors in the mapper don't break Promise.all
             console.error("Error during concurrentlyMap item processing:", error);
             executing.splice(executing.indexOf(promise), 1);
             return { error: error.message }; // Return an error marker
        });
        executing.push(promise);

        results.push(promise);

        // If we reach the limit, wait for the oldest promise to finish
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    // Wait for all remaining promises to finish
    return Promise.all(results);
}


async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, options);

            // Success: (200-299)
            if (response.ok) {
                return response;
            }

            // Retryable Errors: 429 (Rate Limit) or 5xx (Server Error)
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status} from ${url}. Retrying...`, 'WARN', 'HTTP');
                // Let the loop continue to the delay and next attempt
            } else {
                // Non-retryable client error (e.g., 400, 401, 404)
                // Stop retrying and throw an error.
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from ${url}.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call to ${url} failed with client error ${response.status}. Body: ${errorBody}`);
            }

        } catch (error) {
            // This will catch network errors (fetch failed) or the error we just threw
            log(`Attempt ${attempt}: Fetch failed for ${url} with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
            // Log the error object itself for more detail if needed
            console.error(`Fetch Error Details (Attempt ${attempt}):`, error);
        }

        // Wait with exponential backoff if this isn't the last attempt
        if (attempt < MAX_RETRIES) {
            // Increased base delay from 1000ms to 2000ms for a safer backoff (2s, 4s)
            const delayTime = Math.pow(2, attempt - 1) * 2000;
            await delay(delayTime);
        }
    }
    // If all retries fail, throw the final error
    log(`API call to ${url} failed definitively after ${MAX_RETRIES} attempts.`, 'CRITICAL', 'HTTP');
    throw new Error(`API call to ${url} failed after ${MAX_RETRIES} attempts.`);
}


const calculateUnitPrice = (price, size) => {
    // No change from previous version
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

/**
 * Checks if a prompt is simple or complex (creative).
 */
function isCreativePrompt(cuisinePrompt) {
    // No change from previous version
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


/**
 * Performs local validation to filter "false aspects"
 */
function isMatch(productName, keywords) {
    // No change from previous version
    if (!productName) return false;
    if (!keywords || keywords.length === 0) {
        return true;
    }
    const nameLower = productName.toLowerCase();
    return keywords.every(kw => nameLower.includes(kw.toLowerCase()));
}


/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];

    // Log function (no change)
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            tag: tag.toUpperCase(),
            message: message,
            data: data
        };
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

        // --- Phase 2: Technical Blueprint --- (No change)
        log("Phase 2: Generating Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData);
        log(`Calculated daily calorie target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log);
        if (!ingredientPlan || ingredientPlan.length === 0) {
            log("Blueprint failed: Technical AI did not return an ingredient plan.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log(`Blueprint successful. ${ingredientPlan.length} ingredients found.`, 'SUCCESS', 'PHASE');


        // --- Phase 3: Market Run (Scatter-Gather) --- (NEW LOGIC)
        log("Phase 3: Executing Parallel Market Run...", 'INFO', 'PHASE');
        
        // Use a Map to store results keyed by originalIngredient for easy updates
        const resultsMap = new Map(ingredientPlan.map(ing => [ing.originalIngredient, {
            ...ing, // Keep original AI data (query, keywords, grams etc.)
            allProducts: [], // Initialize empty
            foundPage: 0, // Track which page the item was found on
            source: 'pending' // Initial status
        }]));

        // Keep track of ingredients still needing products
        let ingredientsToSearch = [...ingredientPlan]; 

        for (let page = 1; page <= MAX_PRICE_SEARCH_PAGES; page++) {
            if (ingredientsToSearch.length === 0) {
                 log(`All ingredients found products before page ${page}. Stopping search.`, 'INFO', 'HTTP');
                 break; // Stop if all ingredients have products
            }

            log(`Market Run - Page ${page}: Fetching for ${ingredientsToSearch.length} ingredients...`, 'INFO', 'HTTP');

            // --- SCATTER: Fetch current page for remaining ingredients in parallel ---
            const pageResults = await concurrentlyMap(ingredientsToSearch, MAX_CONCURRENCY, (ingredient) =>
                 fetchPriceData(store, ingredient.searchQuery, page)
                      .then(priceData => ({ ingredient, priceData })) // Return ingredient along with data
            );

            // --- GATHER: Process results for this page ---
            const stillNeedSearching = []; // List for the *next* page's search
            for (const { ingredient, priceData } of pageResults) {
                const ingredientKey = ingredient.originalIngredient;
                
                // Handle API errors during fetchPriceData
                if (!priceData || priceData.error) {
                    log(`Failed to fetch Page ${page} for "${ingredientKey}": ${priceData?.error?.message || 'Unknown error'}`, 'WARN', 'HTTP');
                    // If it failed on page 1, keep it for page 2 etc. If it fails on the last page, it's definitively failed.
                    if (page < MAX_PRICE_SEARCH_PAGES) {
                        stillNeedSearching.push(ingredient);
                    } else {
                         resultsMap.get(ingredientKey).source = 'failed'; // Mark as failed if error on last attempt
                         log(`"${ingredientKey}" definitively failed after Page ${page} fetch error.`, 'CRITICAL', 'HTTP');
                    }
                    continue; // Skip processing for this ingredient on this page
                }

                // Log raw product names
                const rawNames = priceData.results.map(p => p.product_name);
                log(`Raw results for "${ingredientKey}" (Page ${page}):`, 'INFO', 'DATA', rawNames);

                // Local Validation
                const validProductsOnPage = priceData.results
                    .map(p => ({
                        name: p.product_name,
                        brand: p.product_brand,
                        price: p.current_price,
                        size: p.product_size,
                        url: p.url,
                        barcode: p.barcode,
                        unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
                    }))
                    .filter(p => p.price > 0 && isMatch(p.name, ingredient.validationKeywords || []));

                // Update resultsMap if valid products are found
                if (validProductsOnPage.length > 0) {
                     log(`Found ${validProductsOnPage.length} valid products for "${ingredientKey}" on Page ${page}.`, 'SUCCESS', 'DATA');
                     const currentResult = resultsMap.get(ingredientKey);
                     // Only add products if none were found on previous pages
                     if (currentResult.source === 'pending') {
                          currentResult.allProducts.push(...validProductsOnPage);
                          currentResult.foundPage = page;
                          currentResult.source = 'discovery'; // Mark as found
                     }
                     // Do NOT add to stillNeedSearching, as we found it.
                } else {
                     log(`No valid products found for "${ingredientKey}" on Page ${page}.`, 'WARN', 'DATA');
                     // Only keep searching if we haven't reached the max pages
                     if (page < MAX_PRICE_SEARCH_PAGES) {
                          stillNeedSearching.push(ingredient);
                     } else {
                          // Mark as failed if not found by the last page
                          resultsMap.get(ingredientKey).source = 'failed';
                          log(`"${ingredientKey}" definitively failed - no valid products found after ${MAX_PRICE_SEARCH_PAGES} pages.`, 'WARN', 'DATA');
                     }
                }
            }
            // Update the list for the next iteration
            ingredientsToSearch = stillNeedSearching;
        }
        log("Market Run complete.", 'SUCCESS', 'PHASE');
        // --- END NEW PHASE 3 ---


        // --- Phase 4: Nutrition Calculation --- (MODIFIED TO USE resultsMap)
        log("Phase 4: Calculating Estimated Nutrition...", 'INFO', 'PHASE');
        let calculatedTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        
        // Prepare list directly from resultsMap
        const itemsToFetchNutrition = [];
        resultsMap.forEach((result, key) => {
             if (result.source === 'discovery' && result.allProducts.length > 0) {
                  // Find the cheapest among the valid products found
                  const cheapest = result.allProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, result.allProducts[0]);
                  // Set the currentSelectionURL based on the cheapest found
                  result.currentSelectionURL = cheapest.url; 
                  itemsToFetchNutrition.push({
                       ingredientKey: key,
                       barcode: cheapest.barcode,
                       query: cheapest.name, // Use the actual product name for nutrition query
                       grams: result.totalGramsRequired || 0
                  });
             } else {
                 // Ensure items not found or pending have the mock URL
                 result.currentSelectionURL = MOCK_PRODUCT_TEMPLATE.url;
             }
        });


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

             calculatedTotals.calories = Math.round(calculatedTotals.calories);
             calculatedTotals.protein = Math.round(calculatedTotals.protein);
             calculatedTotals.fat = Math.round(calculatedTotals.fat);
             calculatedTotals.carbs = Math.round(calculatedTotals.carbs);

            log("Estimated nutrition totals calculated.", 'SUCCESS', 'CALC', calculatedTotals);
        } else {
             log("No valid products found to calculate nutrition.", 'WARN', 'CALC');
        }
        // --- END PHASE 4 ---

        log("Phase 5: Assembling Final Response...", 'INFO', 'PHASE');
        
        // Convert Map back to the expected object structure for the frontend
        const finalResultsObject = Object.fromEntries(resultsMap);

        const finalResponseData = {
            mealPlan: mealPlan || [],
            uniqueIngredients: ingredientPlan, // Send the original plan list
            results: finalResultsObject, // Send the processed results object
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

/**
 * AI Call #1: The "Creative"
 */
async function generateCreativeIdeas(cuisinePrompt, log) {
    // No change from previous version
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
 * AI Call #2: The "Technician" - Prompt refined in Mark 8
 */
async function generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log) {
    // No change from previous version (Mark 8 prompt refinement included)
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost...", 'Quality Focus': "Prioritize premium quality...", 'Best Value': "Balance unit cost..." }[costPriority] || "Balance unit cost...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = creativeIdeas ? `Use these creative meal ideas: ${creativeIdeas}` : (cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Neutral profile.');
    
    // --- PROMPT from Mark 8 ---
    const systemPrompt = `You are an expert dietitian and chef creating a practical, cost-effective grocery and meal plan.
RULES:
1.  Generate a complete meal plan AND a consolidated shopping list.
2.  For each ingredient, provide a 'searchQuery'. This query MUST be an OPTIMIZED, slightly LESS specific search term (e.g., "chicken breast fillets", "traditional rolled oats"). AVOID hyper-specific queries with brands/sizes unless essential.
3.  For each ingredient, provide 'validationKeywords'. This MUST be an array of 2-3 essential FLEXIBLE lowercase keywords from the product type (e.g., ["turkey", "mince"]; ["oats", "rolled"]).
4.  For produce, prioritize store-brand queries IF generic is too broad (e.g., "Coles bananas", but just "carrots").
5.  Adhere strictly to user constraints.
6.  'ingredients' array is MANDATORY. 'mealPlan' is OPTIONAL.
7.  HOWEVER: You MUST try your best to generate 'mealPlan'. If impossible, generate a simple healthy plan and note difficulty in descriptions. DO NOT leave mealPlan empty unless truly impossible.
8.  DO NOT include 'nutritionalTargets'.`;

    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}.
- Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Activity: ${formData.activityLevel}. Goal: ${goal}.
- Target: ~${calorieTarget} kcal (reference only). Dietary Needs: ${dietary}.
- Meals: ${eatingOccasions} (${requiredMeals.join(', ')}). Spending: ${costPriority} (${costInstruction}). Repetition Max: ${maxRepetitions}.
- Cuisine: ${cuisineInstruction}. Store: ${store}.`;

    log("Technical AI Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' });

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT", properties: {
                    "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "validationKeywords": { type: "ARRAY", items: { type: "STRING" } }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } }, required: ["originalIngredient", "searchQuery", "validationKeywords", "totalGramsRequired", "quantityUnits"] } },
                    "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { "type": "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } }
                }, required: ["ingredients"]
            }
        }
    };

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


