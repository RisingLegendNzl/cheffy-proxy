// --- ORCHESTRATOR API for Cheffy V3 ---

// This file implements the "Mark 9" pipeline:
// 1. (Optional) Creative AI call.
// 2. Technical AI call (plan, queries, validationKeywords - NO nutrition).
// 3. Paginated price search + Local Validation.
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
const MAX_RETRIES = 3;
const MAX_CONCURRENCY = 5; // Limit for RapidAPI price search AND Nutrition search
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
        }

        // Wait with exponential backoff if this isn't the last attempt
        if (attempt < MAX_RETRIES) {
            // Increased base delay from 1000ms to 2000ms for a safer backoff (2s, 4s)
            const delayTime = Math.pow(2, attempt - 1) * 2000;
            await delay(delayTime);
        }
    }
    throw new Error(`API call to ${url} failed after ${MAX_RETRIES} attempts.`);
}


const calculateUnitPrice = (price, size) => {
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
 * @param {string} cuisinePrompt - The user's cuisine input.
 * @returns {boolean} True if the prompt is considered creative.
 */
function isCreativePrompt(cuisinePrompt) {
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') {
        return false;
    }
    // Simple keywords that are NOT creative
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'spicy', 'mild', 'quick', 'easy', 'high protein', 'low carb', 'low fat', 'vegetarian', 'vegan'];
    const promptLower = cuisinePrompt.toLowerCase();

    // If the prompt is just a simple keyword, it's not creative
    if (simpleKeywords.some(kw => promptLower === kw)) {
        return false;
    }

    // If the prompt is long (e.g., a sentence) or contains non-standard keywords,
    // it's considered creative.
    return cuisinePrompt.length > 20 || !simpleKeywords.some(kw => promptLower.includes(kw));
}


/**
 * Performs local validation to filter "false aspects"
 * @param {string} productName - The product name from the store.
 * @param {string[]} keywords - The list of required keywords from the AI.
 * @returns {boolean} True if the product name contains all keywords.
 */
function isMatch(productName, keywords) {
    if (!productName) return false; // Handle null product names
    if (!keywords || keywords.length === 0) {
        // If no keywords are provided, default to true (no filter)
        // This is a safety net in case the AI fails to provide keywords
        return true;
    }
    const nameLower = productName.toLowerCase();
    // Check if *every* keyword is present in the product name
    return keywords.every(kw => nameLower.includes(kw.toLowerCase()));
}


/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];

    // Log function now captures logs as objects for better display on frontend AND prints JSON to console
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            tag: tag.toUpperCase(),
            message: message,
            data: data
        };
        logs.push(logEntry);
        // Console output: print the structured JSON for better debugging
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

        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) {
            log(`Creative prompt detected: "${cuisine}". Calling Creative AI...`, 'INFO', 'LLM');
            creativeIdeas = await generateCreativeIdeas(cuisine, log);
            log(`Creative AI returned: "${creativeIdeas.substring(0, 100)}..."`, 'SUCCESS', 'LLM');
        } else {
            log("Simple prompt detected. Skipping Creative AI.", 'INFO', 'SYSTEM');
        }

        log("Phase 2: Generating Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData);
        log(`Calculated daily calorie target: ${calorieTarget} kcal.`, 'INFO', 'CALC');

        // Note: nutritionalTargets is NOT expected from the AI anymore
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log);

        // Robustness check: Ensure ingredients list exists
        if (!ingredientPlan || ingredientPlan.length === 0) {
            log("Blueprint failed: Technical AI did not return an ingredient plan.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log(`Blueprint successful. ${ingredientPlan.length} ingredients found.`, 'SUCCESS', 'PHASE');

        log("Phase 3: Executing Paginated Market Run...", 'INFO', 'PHASE');

        // This is a sequential loop to allow for pagination fallback.
        const finalResults = {};
        for (const ingredient of ingredientPlan) {
            const ingredientKey = ingredient.originalIngredient;
            const validationKeywords = ingredient.validationKeywords || [];
            log(`Fetching prices for: "${ingredientKey}" (Query: "${ingredient.searchQuery}")`, 'INFO', 'HTTP');

            let allValidProducts = [];
            let totalPages = 1; // Start with 1, update after first fetch

            for (let page = 1; page <= MAX_PRICE_SEARCH_PAGES; page++) {
                if (page > totalPages && totalPages > 0) { // Check if totalPages has been set
                    log(`No more pages to search for "${ingredientKey}". Stopping.`, 'INFO', 'HTTP');
                    break; // Stop if we've exceeded the total pages available
                }

                log(`Fetching Page ${page} for "${ingredientKey}"...`, 'INFO', 'HTTP');
                const priceData = await fetchPriceData(store, ingredient.searchQuery, page);

                // Update total pages from the first valid query response
                if (page === 1 && priceData && !priceData.error) {
                    totalPages = priceData.total_pages || 1;
                }

                if (priceData.error || !priceData.results) {
                    log(`Failed to fetch Page ${page} for "${ingredientKey}": ${priceData.error?.message}`, 'WARN', 'HTTP');
                    // Do not break here if page 1 fails, allow fallback to page 2/3
                    if (page >= MAX_PRICE_SEARCH_PAGES) break;
                    else continue;
                }

                // Log raw product names for debugging (as requested)
                const rawNames = priceData.results.map(p => p.product_name);
                log(`Raw results for "${ingredientKey}" (Page ${page}):`, 'INFO', 'DATA', rawNames);

                // Phase 4: Local Validation
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
                    .filter(p => p.price > 0 && isMatch(p.name, validationKeywords)); // Run validation

                if (validProductsOnPage.length > 0) {
                    log(`Found ${validProductsOnPage.length} valid products for "${ingredientKey}" on Page ${page}.`, 'SUCCESS', 'DATA');
                    allValidProducts.push(...validProductsOnPage);
                    // We found products, break the page loop (as requested)
                    break;
                } else {
                    log(`No valid products found for "${ingredientKey}" on Page ${page}.`, 'WARN', 'DATA');
                    // Continue to the next page...
                }
            }

            // After page loop, assemble results
            const cheapest = allValidProducts.length > 0 ? allValidProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, allValidProducts[0]) : null;

            finalResults[ingredientKey] = {
                ...ingredient, // Includes searchQuery, validationKeywords, totalGramsRequired etc.
                allProducts: allValidProducts.length > 0 ? allValidProducts : [{ ...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)` }],
                currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url,
                userQuantity: 1,
                source: allValidProducts.length > 0 ? 'discovery' : 'failed'
            };
        }
        log("Market Run complete.", 'SUCCESS', 'PHASE');

        // --- NEW PHASE 4: Nutrition Calculation ---
        log("Phase 4: Calculating Estimated Nutrition...", 'INFO', 'PHASE');
        let calculatedTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        
        // Prepare list of items to fetch nutrition for
        const itemsToFetch = Object.entries(finalResults)
            .filter(([key, result]) => result.source === 'discovery' && result.currentSelectionURL)
            .map(([key, result]) => {
                const selectedProduct = result.allProducts.find(p => p.url === result.currentSelectionURL);
                return {
                    ingredientKey: key,
                    barcode: selectedProduct?.barcode,
                    query: selectedProduct?.name, // Fallback query using product name
                    grams: result.totalGramsRequired || 0
                };
            });

        if (itemsToFetch.length > 0) {
            log(`Fetching nutrition data for ${itemsToFetch.length} selected products...`, 'INFO', 'HTTP');
            
            // Fetch nutrition data concurrently
            const nutritionResults = await concurrentlyMap(itemsToFetch, MAX_CONCURRENCY, (item) => 
                fetchNutritionData(item.barcode, item.query) // Use existing function
                    .then(nutrition => ({ ...item, nutrition }))
                    .catch(err => {
                        log(`Nutrition fetch failed for ${item.ingredientKey}: ${err.message}`, 'WARN', 'HTTP');
                        return { ...item, nutrition: { status: 'not_found' } }; // Handle fetch errors
                    })
            );

            log("Nutrition data fetching complete.", 'SUCCESS', 'HTTP');

            // Calculate totals
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

             // Round the final totals
             calculatedTotals.calories = Math.round(calculatedTotals.calories);
             calculatedTotals.protein = Math.round(calculatedTotals.protein);
             calculatedTotals.fat = Math.round(calculatedTotals.fat);
             calculatedTotals.carbs = Math.round(calculatedTotals.carbs);

            log("Estimated nutrition totals calculated.", 'SUCCESS', 'CALC', calculatedTotals);
        } else {
             log("No valid products found to calculate nutrition.", 'WARN', 'CALC');
        }
        // --- END NEW PHASE 4 ---

        log("Phase 5: Assembling Final Response...", 'INFO', 'PHASE');
        const finalResponseData = {
            mealPlan: mealPlan || [], // Handle optional mealPlan
            uniqueIngredients: ingredientPlan,
            results: finalResults,
            nutritionalTargets: calculatedTotals // Use the calculated totals
        };

        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');

        // Return the final data and the structured logs
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack, name: error.name });
        console.error("ORCHESTRATOR CRITICAL ERROR STACK:", error);
        // Only return the friendly message and the collected logs
        return response.status(500).json({ message: "An unrecoverable error occurred during plan generation.", error: error.message, logs });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


// --- API-CALLING FUNCTIONS ---

/**
 * AI Call #1: The "Creative"
 * Brainstorms meal ideas for complex prompts.
 */
async function generateCreativeIdeas(cuisinePrompt, log) {
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a creative chef and pop-culture expert. A user wants a meal plan based on a theme. Brainstorm a simple list of 10-15 meal names that fit the theme. Return *only* a simple, comma-separated list of the meal names. Do not add any other text.`;
    const userQuery = `Theme: "${cuisinePrompt}"
    
    Return a comma-separated list of meal names.`;

    log("Creative AI Prompt", 'INFO', 'LLM_PROMPT', { userQuery });

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    try {
        const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
        if (!response.ok) {
            throw new Error(`Creative AI API HTTP error! Status: ${response.status}.`);
        }
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error("Creative AI response was empty.");
        }
        log("Creative AI Raw Response", 'INFO', 'LLM', { raw: text.substring(0, 500) }); // Log more of the response
        return text;
    } catch (error) {
        log("Creative AI failed.", 'CRITICAL', 'LLM', { error: error.message });
        // Fallback: return an empty string so the technician can proceed
        return "";
    }
}

/**
 * AI Call #2: The "Technician"
 * Generates the full plan, queries, and validation keywords.
 * NO LONGER generates nutritionalTargets.
 */
async function generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost, most basic ingredients (e.g., rice, beans, oats, basic vegetables). Avoid expensive meats, pre-packaged items, and specialty goods.", 'Quality Focus': "Prioritize premium quality, organic, free-range, and branded ingredients where appropriate. Cost is a secondary concern to quality and health benefits.", 'Best Value': "Balance unit cost with general quality. Use a mix of budget-friendly staples and good quality fresh produce and proteins. Avoid premium brands unless necessary." }[costPriority] || "Balance unit cost with general quality...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;

    // Use creative ideas if they exist, otherwise use the original cuisine prompt
    const cuisineInstruction = creativeIdeas
        ? `Use these creative meal ideas as inspiration: ${creativeIdeas}`
        : (cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Maintain a neutral, balanced global flavor profile.');

    // --- REFINED PROMPT ---
    const systemPrompt = `You are an expert dietitian and chef creating a practical, cost-effective grocery and meal plan.
RULES:
1.  Generate a complete meal plan AND a consolidated shopping list.
2.  For each ingredient, provide a 'searchQuery'. This query MUST be an OPTIMIZED, slightly LESS specific search term suitable for a grocery store search engine (e.g., "chicken breast fillets", "traditional rolled oats", "lean beef mince"). AVOID hyper-specific queries with brands/sizes unless essential (like "Coles RSPCA... 2kg"). Prioritize getting relevant items on Page 1.
3.  For each ingredient, provide 'validationKeywords'. This MUST be an array of 2-3 essential FLEXIBLE lowercase keywords from the product type (e.g., for "Lean Turkey Mince", keywords: ["turkey", "mince"]; for "Traditional Rolled Oats", keywords: ["oats", "rolled"]).
4.  For produce, prioritize store-brand queries IF the generic query is too broad (e.g., "Coles bananas", but just "carrots" is okay).
5.  Adhere strictly to all user-provided constraints.
6.  The 'ingredients' array is MANDATORY. The 'mealPlan' is OPTIONAL.
7.  HOWEVER: You MUST make your best effort to generate a plausible 'mealPlan', even for creative requests. If the theme is impossible, generate a simple, healthy plan and note the difficulty in the meal descriptions. DO NOT leave mealPlan empty unless absolutely impossible.
8.  DO NOT include 'nutritionalTargets' in the response.`;
    // --- END REFINED PROMPT ---


    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}.
- User Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg.
- Activity: ${formData.activityLevel}.
- Goal: ${goal}.
- Daily Calorie Target: ~${calorieTarget} kcal (for meal planning reference only, do not include targets in response).
- Dietary Needs: ${dietary}.
- Meals Per Day: ${eatingOccasions} (${requiredMeals.join(', ')}).
- Spending Priority: ${costPriority} (${costInstruction}).
- Meal Repetition Allowed: A single meal can appear up to ${maxRepetitions} times max.
- Cuisine Profile: ${cuisineInstruction}.
- Grocery Store: ${store}.`;

    log("Technical AI Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' });

    // --- UPDATED SCHEMA (No nutritionalTargets) ---
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "ingredients": {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "originalIngredient": { "type": "STRING" },
                                "category": { "type": "STRING" },
                                "searchQuery": { "type": "STRING" },
                                "validationKeywords": { type: "ARRAY", items: { type: "STRING" } },
                                "totalGramsRequired": { "type": "NUMBER" },
                                "quantityUnits": { "type": "STRING" }
                            },
                            required: ["originalIngredient", "searchQuery", "validationKeywords", "totalGramsRequired", "quantityUnits"] // Made grams/units required
                        }
                    },
                    "mealPlan": {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "day": { "type": "NUMBER" },
                                "meals": { type: "ARRAY", items: { "type": "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } }
                            }
                        }
                    }
                    // nutritionalTargets REMOVED from schema
                },
                required: ["ingredients"] // Only ingredients is mandatory
            }
        }
    };
    // --- END UPDATED SCHEMA ---

    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) {
        throw new Error(`Technical AI API HTTP error! Status: ${response.status}.`);
    }
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) {
        log("Technical AI returned no candidate text.", 'CRITICAL', 'LLM', result);
        throw new Error("LLM response was empty or malformed.");
    }

    log("Technical AI Raw Response", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });

    try {
        const parsed = JSON.parse(jsonText);
        // Enrich logs (as requested)
        log("Parsed Technical AI Response", 'INFO', 'DATA', {
            ingredientCount: parsed.ingredients?.length || 0,
            hasMealPlan: !!parsed.mealPlan && parsed.mealPlan.length > 0
        });
        // Ensure ingredients array exists, even if empty (schema should guarantee this)
        if (!parsed.ingredients) {
             parsed.ingredients = [];
             log("Technical AI returned valid JSON but missing 'ingredients' array. Corrected.", 'WARN', 'LLM');
        }
        return parsed;
    } catch (parseError) {
        log("Failed to parse Technical AI JSON response.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: parseError.message });
        throw new Error(`Failed to parse LLM JSON response: ${parseError.message}`);
    }
}

function calculateCalorieTarget(formData) {
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);
    if (!weightKg || !heightCm || !ageYears) return 2000;
    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);
    const goalAdjustments = { cut: -500, maintain: 0, bulk: 500 };
    return Math.round(tdee + (goalAdjustments[goal] || 0));
}
/// ===== API-CALLERS-END ===== ////

