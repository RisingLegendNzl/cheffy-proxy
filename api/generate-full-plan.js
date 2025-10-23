// --- ORCHESTRATOR API for Cheffy V3 ---

// This file implements the "Mark 11" pipeline:
// This is a refinement of Mark 10, with a much stricter prompt for the
// Technical AI to solve the "bad search query" (e.g., "cigarettes") problem.

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


function isMatch(productName, keywords) {
    // No change from Mark 10
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

        // --- Phase 2: Technical Blueprint --- (No change)
        log("Phase 2: Generating Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData);
        log(`Calculated daily calorie target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log); // Function itself is updated
        if (!ingredientPlan || ingredientPlan.length === 0) {
            log("Blueprint failed: Technical AI did not return an ingredient plan.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log(`Blueprint successful. ${ingredientPlan.length} ingredients found.`, 'SUCCESS', 'PHASE');


        // --- Phase 3: Market Run (Scatter-Gather) --- (No change)
        log("Phase 3: Executing Parallel Market Run...", 'INFO', 'PHASE');

        const resultsMap = new Map(ingredientPlan.map(ing => [ing.originalIngredient, {
            ...ing, allProducts: [], foundPage: 0, source: 'pending'
        }]));
        let ingredientsToSearch = [...ingredientPlan];

        for (let page = 1; page <= MAX_PRICE_SEARCH_PAGES; page++) {
            if (ingredientsToSearch.length === 0) {
                 log(`All ingredients found products before page ${page}. Stopping search.`, 'INFO', 'HTTP');
                 break;
            }
            log(`Market Run - Page ${page}: Fetching for ${ingredientsToSearch.length} ingredients...`, 'INFO', 'HTTP');

            const pageResults = await concurrentlyMap(ingredientsToSearch, MAX_CONCURRENCY, (ingredient) =>
                 fetchPriceData(store, ingredient.searchQuery, page)
                      .then(priceData => ({ ingredient, priceData }))
            );

            const stillNeedSearching = [];
            for (const { ingredient, priceData } of pageResults) {
                const ingredientKey = ingredient.originalIngredient;
                
                if (!priceData || priceData.error) {
                    log(`Failed to fetch Page ${page} for "${ingredientKey}": ${priceData?.error?.message || 'Unknown error'}`, 'WARN', 'HTTP');
                    if (page < MAX_PRICE_SEARCH_PAGES) {
                        stillNeedSearching.push(ingredient);
                    } else {
                         resultsMap.get(ingredientKey).source = 'failed';
                         log(`"${ingredientKey}" definitively failed after Page ${page} fetch error.`, 'CRITICAL', 'HTTP');
                    }
                    continue;
                }

                const rawNames = priceData.results.map(p => p.product_name);
                log(`Raw results for "${ingredientKey}" (Page ${page}):`, 'INFO', 'DATA', rawNames);

                const validProductsOnPage = priceData.results
                    .map(p => ({
                        name: p.product_name, brand: p.product_brand, price: p.current_price,
                        size: p.product_size, url: p.url, barcode: p.barcode,
                        unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
                    }))
                    .filter(p => p.price > 0 && isMatch(p.name, ingredient.validationKeywords || []));

                if (validProductsOnPage.length > 0) {
                     log(`Found ${validProductsOnPage.length} valid products for "${ingredientKey}" on Page ${page}.`, 'SUCCESS', 'DATA');
                     const currentResult = resultsMap.get(ingredientKey);
                     if (currentResult.source === 'pending') {
                          currentResult.allProducts.push(...validProductsOnPage);
                          currentResult.foundPage = page;
                          currentResult.source = 'discovery';
                     }
                } else {
                     log(`No valid products found for "${ingredientKey}" on Page ${page}.`, 'WARN', 'DATA');
                     if (page < MAX_PRICE_SEARCH_PAGES) {
                          stillNeedSearching.push(ingredient);
                     } else {
                          resultsMap.get(ingredientKey).source = 'failed';
                          log(`"${ingredientKey}" definitively failed - no valid products found after ${MAX_PRICE_SEARCH_PAGES} pages.`, 'WARN', 'DATA');
                     }
                }
            }
            ingredientsToSearch = stillNeedSearching;
        }
        log("Market Run complete.", 'SUCCESS', 'PHASE');


        // --- Phase 4: Nutrition Calculation --- (No change)
        log("Phase 4: Calculating Estimated Nutrition...", 'INFO', 'PHASE');
        let calculatedTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        
        const itemsToFetchNutrition = [];
        resultsMap.forEach((result, key) => {
             if (result.source === 'discovery' && result.allProducts.length > 0) {
                  const cheapest = result.allProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, result.allProducts[0]);
                  result.currentSelectionURL = cheapest.url;
                  itemsToFetchNutrition.push({
                       ingredientKey: key,
                       // We are ALREADY passing both barcode and query. This logic is correct.
                       barcode: cheapest.barcode, 
                       query: cheapest.name,
                       grams: result.totalGramsRequired || 0
                  });
             } else {
                 result.currentSelectionURL = MOCK_PRODUCT_TEMPLATE.url;
             }
        });


        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition data for ${itemsToFetchNutrition.length} selected products...`, 'INFO', 'HTTP');

            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_CONCURRENCY, (item) =>
                // Calling with both barcode and query is correct.
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

        // --- Phase 5: Assembling Final Response --- (No change)
        log("Phase 5: Assembling Final Response...", 'INFO', 'PHASE');
        
        const finalResultsObject = Object.fromEntries(resultsMap);
        const finalResponseData = {
            mealPlan: mealPlan || [],
            uniqueIngredients: ingredientPlan,
            results: finalResultsObject,
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
    // No change from Mark 10
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
 * AI Call #2: The "Technician" - Prompt refined in Mark 11
 */
async function generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost...", 'Quality Focus': "Prioritize premium quality...", 'Best Value': "Balance unit cost..." }[costPriority] || "Balance unit cost...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = creativeIdeas ? `Use these creative meal ideas: ${creativeIdeas}` : (cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Neutral profile.');
    
    // --- PROMPT REFINED FOR MARK 11 ---
    const systemPrompt = `You are an expert dietitian and chef creating a practical, cost-effective grocery and meal plan.
RULES:
1.  Generate a complete meal plan AND a consolidated shopping list.
2.  **CRITICAL RULE**: For each ingredient, 'searchQuery' MUST be 2-3 GENERIC words. This is the MOST important rule for product matching.
    - GOOD: "eggs", "banana", "beef mince", "canned tuna springwater", "rolled oats"
    - BAD (Causes errors): "Coles free range large eggs 30 pack", "Budget Beef Mince (80/20)", "Coles bananas value pack"
3.  For each ingredient, 'validationKeywords' MUST be an array of 2-3 essential FLEXIBLE lowercase keywords.
    - GOOD: ["beef", "mince"], ["oats", "rolled"], ["tuna", "springwater"]
    - BAD: ["budget", "beef", "80/20"]
4.  For produce, prioritize store-brand queries ONLY if generic is too broad (e.g., "Coles bananas" is OK, but just "carrots" is better).
5.  Adhere strictly to user constraints.
6.  'ingredients' array is MANDATORY. 'mealPlan' is OPTIONAL.
7.  HOWEVER: You MUST try your best to generate 'mealPlan'. If impossible, generate a simple healthy plan and note difficulty in descriptions. DO NOT leave mealPlan empty unless truly impossible.
8.  DO NOT include 'nutritionalTargets'.`;
    // --- END REFINED PROMPT ---

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
                    "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "validationKeywords": { type: "ARRAY", items: { "type": "STRING" } }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } }, required: ["originalIngredient", "searchQuery", "validationKeywords", "totalGramsRequired", "quantityUnits"] } },
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

