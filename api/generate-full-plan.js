// --- ORCHESTRATOR API for Cheffy V3 ---
const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3;
const MAX_CONCURRENCY = 5; // Limit for price search parallelism

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };

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
            if (response.status < 500) {
                return response;
            }
            log(`Attempt ${attempt}: Received server error ${response.status} from ${url}. Retrying...`, 'WARN', 'HTTP');
        } catch (error) {
            log(`Attempt ${attempt}: Fetch failed for ${url} with network error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
        }
        if (attempt < MAX_RETRIES) {
            const delayTime = Math.pow(2, attempt - 1) * 1000;
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
        const { store } = formData;
        
        log("Phase 1: Generating Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData);
        log(`Calculated daily calorie target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        
        // Include nutritionalTargets in the destructuring here, as it's returned by the LLM now
        const { ingredients: ingredientPlan, mealPlan, nutritionalTargets } = await generateLLMPlanAndMeals(formData, calorieTarget, log);
        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log(`Blueprint successful. ${ingredientPlan.length} ingredients found.`, 'SUCCESS', 'PHASE');

        log("Phase 2: Executing Parallel Market Run...", 'INFO', 'PHASE');

        // Step 1: Fetch all price data in parallel, but with limited concurrency.
        log(`Fetching all product prices simultaneously with concurrency limit of ${MAX_CONCURRENCY}...`, 'INFO', 'HTTP');
        
        const priceResultsMapper = (item) => 
            // fetchPriceData now returns { results: [...] } or { error: {...} }
            fetchPriceData(store, item.searchQuery)
                .then(priceResult => {
                    // Check if an error was returned by the price-search function
                    if (priceResult.error) {
                        log(`Price search failed for "${item.searchQuery}": ${priceResult.error.message}`, 'WARN', 'HTTP', priceResult.error);
                        return { item, rawProducts: [], error: priceResult.error };
                    }
                    return { item, rawProducts: priceResult.results };
                })
                .catch(err => {
                    // This catch should only happen if fetchPriceData throws, which it shouldn't now
                    log(`Price search failed catastrophically for "${item.searchQuery}" (unhandled): ${err.message}`, 'CRITICAL', 'HTTP');
                    return { item, rawProducts: [], error: { message: err.message, status: 500 } }; 
                });
                
        const allPriceResults = await concurrentlyMap(ingredientPlan, MAX_CONCURRENCY, priceResultsMapper);
        log("All price searches complete.", 'SUCCESS', 'HTTP');

        // Step 2: Prepare one single payload for AI analysis.
        const analysisPayload = allPriceResults
            .filter(result => result.rawProducts.length > 0)
            .map(result => ({
                ingredientName: result.item.originalIngredient,
                productCandidates: result.rawProducts.map(p => p.product_name || "Unknown")
            }));

        // Step 3: Make a single, consolidated call to the AI for analysis.
        let fullAnalysis = [];
        if (analysisPayload.length > 0) {
            try {
                log("Sending single batch for AI product analysis...", 'INFO', 'LLM');
                fullAnalysis = await analyzeProductsInBatch(analysisPayload, log);
                log("Product analysis successful.", 'SUCCESS', 'LLM');
            } catch (err) {
                log(`The single AI analysis batch failed. Reason: ${err.message}. Proceeding without intelligent matching.`, 'CRITICAL', 'LLM');
            }
        }
        
        // Step 4: Assemble final results without nutrition data.
        log("Assembling final results...", 'INFO', 'SYSTEM');
        const finalResults = {};
        allPriceResults.forEach(({ item, rawProducts }) => {
            const ingredientKey = item.originalIngredient;
            const analysisForItem = fullAnalysis.find(a => a.ingredientName === ingredientKey);
            
            // Filter to only include 'perfect' matches from AI analysis
            const perfectMatchNames = new Set((analysisForItem?.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
            
            const finalProducts = rawProducts
                .filter(p => perfectMatchNames.has(p.product_name)) 
                .map(p => ({
                    name: p.product_name,
                    brand: p.product_brand,
                    price: p.current_price,
                    size: p.product_size,
                    url: p.url,
                    barcode: p.barcode, 
                    unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
                })).filter(p => p.price > 0);

            // Determine the cheapest of the approved products
            const cheapest = finalProducts.length > 0 ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]) : null;

            finalResults[ingredientKey] = {
                ...item,
                // If products were found, use them. If not, use mock data and set a clear "failed" source.
                allProducts: finalProducts.length > 0 ? finalProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)`}],
                currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url,
                userQuantity: 1,
                source: finalProducts.length > 0 ? 'discovery' : 'failed'
            };
        });

        log("Market Run complete.", 'SUCCESS', 'PHASE');

        log("Phase 3: Assembling Final Response...", 'INFO', 'PHASE');
        const finalResponseData = { mealPlan, uniqueIngredients: ingredientPlan, results: finalResults, nutritionalTargets };
        
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

// --- API-CALLING FUNCTIONS (Unchanged from previous step) ---
async function analyzeProductsInBatch(analysisData, log) {
    if (!analysisData || analysisData.length === 0) {
        log("Skipping product analysis: no data to analyze.", "INFO", 'LLM');
        return [];
    }
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a specialized AI Grocery Analyst. Your task is to determine if a given product name is a "perfect match" for a required grocery ingredient.
Classifications:
- "perfect": The product is exactly what was asked for (e.g., ingredient "Chicken Breast" and product "Woolworths RSPCA Approved Chicken Breast Fillets"). Brand names, sizes, or minor descriptors like "fresh" or "frozen" are acceptable.
- "substitute": The product is a reasonable alternative but not an exact match (e.g., ingredient "Chicken Breast" and product "Chicken Thighs").
- "irrelevant": The product is completely wrong (e.g., ingredient "Chicken Breast" and product "Beef Mince").

Analyze the following list of grocery items and provide a JSON response. For each ingredient, analyze its corresponding product candidates.`;
    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(analysisData, null, 2)}`;
    
    // Log the prompt payload
    log("Product Analysis LLM Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' });
    
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING" }, "reason": { "type": "STRING" } } } } } } } } } } };
    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Product Analysis LLM Error: HTTP ${response.status} after all retries. Body: ${errorBody}`);
    }
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) {
        log("LLM returned no candidate text. Response object:", 'CRITICAL', 'LLM', result);
        throw new Error("LLM response was empty or malformed.");
    }
    
    // Log the raw LLM response (first 1000 chars)
    log("Product Analysis LLM Raw Response", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });
    
    try {
        return JSON.parse(jsonText).batchAnalysis || [];
    } catch (parseError) {
        log("Failed to parse LLM JSON response.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: parseError.message });
        throw new Error(`Failed to parse LLM JSON response: ${parseError.message}`);
    }
}

async function generateLLMPlanAndMeals(formData, calorieTarget, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost, most basic ingredients (e.g., rice, beans, oats, basic vegetables). Avoid expensive meats, pre-packaged items, and specialty goods.", 'Quality Focus': "Prioritize premium quality, organic, free-range, and branded ingredients where appropriate. Cost is a secondary concern to quality and health benefits.", 'Best Value': "Balance unit cost with general quality. Use a mix of budget-friendly staples and good quality fresh produce and proteins. Avoid premium brands unless necessary." }[costPriority] || "Balance unit cost with general quality...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Maintain a neutral, balanced global flavor profile.';
    const systemPrompt = `You are an expert dietitian and chef creating a practical, cost-effective grocery and meal plan.
RULES:
1.  Generate a complete meal plan for the specified number of days.
2.  Generate a consolidated shopping list of unique ingredients required for the entire plan.
3.  For each ingredient, provide a 'searchQuery' which MUST be a simple, generic term suitable for a grocery store search engine (e.g., "chicken breast", "rolled oats", "mixed berries"). DO NOT include quantities or brands in the searchQuery.
4.  Estimate the total grams required for each ingredient across the entire plan.
5.  Provide a user-friendly 'quantityUnits' string (e.g., "1 Large Jar", "500g Bag", "2 Cans").
6.  Adhere strictly to all user-provided constraints (dietary, cost, variety, etc.).`;
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}.
- User Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg.
- Activity: ${formData.activityLevel}.
- Goal: ${goal}.
- Daily Calorie Target: ~${calorieTarget} kcal.
- Dietary Needs: ${dietary}.
- Meals Per Day: ${eatingOccasions} (${requiredMeals.join(', ')}).
- Spending Priority: ${costPriority} (${costInstruction}).
- Meal Repetition Allowed: A single meal can appear up to ${maxRepetitions} times max.
- Cuisine Profile: ${cuisineInstruction}.
- Grocery Store: ${store}.`;
    
    // Log the prompt payload
    log("Plan Generation LLM Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' });
    
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // Added nutritionalTargets to the response schema here
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } } } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } }, "nutritionalTargets": { type: "OBJECT", properties: { "calories": { "type": "NUMBER" }, "protein": { "type": "NUMBER" }, "fat": { "type": "NUMBER" }, "carbs": { "type": "NUMBER" } } } } } }
    };
    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) {
        throw new Error(`LLM API HTTP error! Status: ${response.status}.`);
    }
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) {
        log("LLM returned no candidate text for plan generation. Response object:", 'CRITICAL', 'LLM', result);
        throw new Error("LLM response was empty or malformed.");
    }
    
    // Log the raw LLM response (first 1000 chars)
    log("Plan Generation LLM Raw Response", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });

    try {
        return JSON.parse(jsonText);
    } catch (parseError) {
        log("Failed to parse LLM JSON response for plan generation.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: parseError.message });
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
