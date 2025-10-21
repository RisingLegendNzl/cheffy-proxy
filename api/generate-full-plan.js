// --- ORCHESTRATOR API for Cheffy V3 ---
const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3;

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };

// --- HELPERS ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.status < 500) {
                return response;
            }
            log({ message: `Attempt ${attempt}: Received server error ${response.status} from ${url}. Retrying...`, level: 'WARN', tag: 'HTTP' });
        } catch (error) {
            log({ message: `Attempt ${attempt}: Fetch failed for ${url} with network error: ${error.message}. Retrying...`, level: 'WARN', tag: 'HTTP' });
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
    const log = (logObject) => {
        const entry = {
            timestamp: new Date().toISOString(),
            level: 'INFO', // Default level
            tag: 'GENERAL', // Default tag
            ...logObject
        };
        logs.push(entry);
        console.log(`${entry.timestamp} - [${entry.level}/${entry.tag}] ${entry.message}`);
    };
    
    log({ message: "Orchestrator invoked.", tag: 'SYSTEM' });
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        log({ message: "Handling OPTIONS pre-flight request.", tag: 'HTTP' });
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        log({ message: `Method Not Allowed: ${request.method}`, level: 'WARN', tag: 'HTTP' });
        return response.status(405).json({ message: 'Method Not Allowed', logs });
    }

    try {
        const formData = request.body;
        const { store } = formData;
        
        log({ message: "Phase 1: Generating Blueprint...", tag: 'PHASE' });
        log({ message: `Received form data for store: ${store}`, data: formData, tag: 'DATA' });
        
        const calorieTarget = calculateCalorieTarget(formData);
        log({ message: `Calculated daily calorie target: ${calorieTarget} kcal.`, tag: 'CALC' });
        
        const { ingredients: ingredientPlan, mealPlan, llmPayload } = await generateLLMPlanAndMeals(formData, calorieTarget, log);
        log({ message: 'LLM Blueprint Prompt', data: llmPayload, tag: 'LLM_PROMPT' });

        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log({ message: `Blueprint successful. ${ingredientPlan.length} ingredients found.`, level: 'SUCCESS', tag: 'LLM' });

        log({ message: "Phase 2: Executing Parallel Market Run...", tag: 'PHASE' });
        log({ message: "Fetching all product prices simultaneously...", tag: 'HTTP' });

        const pricePromises = ingredientPlan.map(item =>
            fetchPriceData(store, item.searchQuery)
                .then(rawProducts => {
                    log({ message: `Found ${rawProducts.length} candidates for "${item.searchQuery}"`, tag: 'DATA' });
                    return { item, rawProducts };
                })
                .catch(err => {
                    log({ message: `Price search failed catastrophically for "${item.searchQuery}": ${err.message}`, level: 'CRITICAL', tag: 'HTTP' });
                    return { item, rawProducts: [] };
                })
        );
        const allPriceResults = await Promise.all(pricePromises);
        log({ message: "All price searches complete.", level: 'SUCCESS', tag: 'HTTP' });

        const analysisPayload = allPriceResults
            .filter(result => result.rawProducts.length > 0)
            .map(result => ({
                ingredientName: result.item.originalIngredient,
                productCandidates: result.rawProducts.map(p => p.product_name || "Unknown")
            }));

        let fullAnalysis = [];
        if (analysisPayload.length > 0) {
            log({ message: `Sending single batch of ${analysisPayload.length} ingredients for AI product analysis...`, tag: 'LLM' });
            log({ message: 'LLM Analysis Prompt', data: analysisPayload, tag: 'LLM_PROMPT' });
            try {
                fullAnalysis = await analyzeProductsInBatch(analysisPayload, log);
                log({ message: "Product analysis successful.", level: 'SUCCESS', tag: 'LLM' });
            } catch (err) {
                 log({ message: `The single AI analysis batch failed. Reason: ${err.message}. Proceeding without matches.`, level: 'CRITICAL', tag: 'LLM' });
            }
        }
        
        log({ message: "Assembling final results...", tag: 'SYSTEM' });
        const finalResults = {};
        allPriceResults.forEach(({ item, rawProducts }) => {
            const ingredientKey = item.originalIngredient;
            const analysisForItem = fullAnalysis.find(a => a.ingredientName === ingredientKey);
            const perfectMatchNames = new Set((analysisForItem?.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
            
            const finalProducts = rawProducts
                .filter(p => perfectMatchNames.has(p.product_name))
                .map(p => ({
                    name: p.product_name, brand: p.product_brand, price: p.current_price, size: p.product_size, url: p.url, barcode: p.barcode,
                    unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
                }));

            const cheapest = finalProducts.length > 0 ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]) : null;

            finalResults[ingredientKey] = {
                ...item,
                allProducts: finalProducts.length > 0 ? finalProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)`}],
                currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url, userQuantity: 1, source: finalProducts.length > 0 ? 'discovery' : 'failed'
            };
        });
        log({ message: "Market Run complete.", level: 'SUCCESS', tag: 'PHASE' });

        log({ message: "Phase 3: Assembling Final Response...", tag: 'PHASE' });
        const finalResponseData = { mealPlan, uniqueIngredients: ingredientPlan, results: finalResults, calorieTarget };
        
        log({ message: "Orchestrator finished successfully.", level: 'SUCCESS', tag: 'SYSTEM' });
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log({ message: `CRITICAL ERROR: ${error.message}`, level: 'CRITICAL', tag: 'SYSTEM' });
        console.error("ORCHESTRATOR CRITICAL ERROR STACK:", error);
        return response.status(500).json({ message: "An error occurred during plan generation.", error: error.message, logs });
    }
}

// --- API-CALLING FUNCTIONS ---
async function analyzeProductsInBatch(analysisData, log) {
    if (!analysisData || analysisData.length === 0) {
        log({ message: "Skipping product analysis: no data to analyze.", tag: 'LLM' });
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
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING" }, "reason": { "type": "STRING" } } } } } } } } } } };
    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Product Analysis LLM Error: HTTP ${response.status} after all retries. Body: ${errorBody}`);
    }
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    return jsonText ? (JSON.parse(jsonText).batchAnalysis || []) : [];
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
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } } } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } } } } }
    };
    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) {
        throw new Error(`LLM API HTTP error! Status: ${response.status}.`);
    }
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("LLM response was empty or malformed.");
    // Return the payload along with the result for logging purposes
    return { ...JSON.parse(jsonText), llmPayload: { systemPrompt, userQuery } };
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

