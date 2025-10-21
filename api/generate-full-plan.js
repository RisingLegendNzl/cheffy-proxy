const fetch = require('node-fetch');
// --- MODIFICATION: Directly import the pure function ---
const { fetchPriceData } = require('./price-search.js');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const BATCH_SIZE = 3;
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const MOCK_NUTRITION_DATA = { status: 'not_found', calories: 0, protein: 0, fat: 0, carbs: 0 };

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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

module.exports = async function handler(request, response) {
    // --- MODIFICATION: Structured Log Collector ---
    const logs = [];
    const log = (type, title, content = '') => {
        const logEntry = { type, title, content, timestamp: new Date().toISOString() };
        logs.push(logEntry);
        console.log(`[LOG] ${type} - ${title}: ${content}`);
    };
    
    log("SYSTEM", "Orchestrator Invoked");
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        log("SYSTEM", "Handling OPTIONS pre-flight request.");
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        log("ERROR", "Method Not Allowed", request.method);
        return response.status(405).json({ message: 'Method Not Allowed', logs });
    }

    try {
        const formData = request.body;
        log("USER_INPUT", "Received User Data", JSON.stringify(formData, null, 2));
        
        const calorieTarget = calculateCalorieTarget(formData);
        log("CALCULATION", "Calorie Target Calculated", `${calorieTarget} kcal/day`);
        
        const { ingredients: ingredientPlan, mealPlan, llmPayload } = await generateLLMPlanAndMeals(formData, calorieTarget);
        log("LLM_PROMPT", "Sent to Gemini AI", JSON.stringify(llmPayload, null, 2));
        if (!ingredientPlan || ingredientPlan.length === 0) throw new Error("LLM did not return an ingredient plan.");
        log("LLM_RESPONSE", "Blueprint Received", `Found ${ingredientPlan.length} ingredients.`);

        log("SYSTEM", "Executing Market Run...");
        const finalResults = {};
        for (let i = 0; i < ingredientPlan.length; i += BATCH_SIZE) {
            const batchNum = (i / BATCH_SIZE) + 1;
            const batch = ingredientPlan.slice(i, i + BATCH_SIZE);
            log("SYSTEM", `Processing Batch ${batchNum} of ${Math.ceil(ingredientPlan.length / BATCH_SIZE)}...`);
            
            const batchPromises = batch.map(item => processSingleIngredient(item, formData.store, `https://${request.headers.host}`, log));
            const batchResults = await Promise.all(batchPromises);
            
            for (const result of batchResults) { finalResults[result.ingredientKey] = result.data; }
            log("SYSTEM", `Batch ${batchNum} complete.`);
            await delay(200); 
        }
        log("SYSTEM", "Market Run complete.");

        const finalResponseData = { mealPlan, uniqueIngredients: ingredientPlan, results: finalResults, calorieTarget };
        log("SUCCESS", "Orchestrator finished successfully.");
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        console.error("ORCHESTRATOR CRITICAL ERROR:", error);
        log("ERROR", "Critical Failure", error.stack);
        return response.status(500).json({ message: "An error occurred during plan generation.", error: error.message, logs });
    }
}

async function processSingleIngredient(item, store, selfUrl, log) {
    const ingredientKey = item.originalIngredient;
    const currentQuery = item.searchQuery;
    
    // --- MODIFICATION: Call the pure function directly ---
    const rawProducts = await fetchPriceData(store, currentQuery);
    log("PRICE_API", `Fetched ${rawProducts.length} products for "${currentQuery}"`);
    
    let finalProducts = [];
    if (rawProducts.length > 0) {
        const productCandidates = rawProducts.map(p => p.product_name || "Unknown");
        // Analysis and Nutrition steps remain the same...
        const analysisResult = await analyzeProductsInBatch([{ ingredientName: ingredientKey, productCandidates }], log);
        const perfectMatchNames = new Set((analysisResult[0]?.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
        const perfectProductsRaw = rawProducts.filter(p => perfectMatchNames.has(p.product_name));
        
        const nutritionPromises = perfectProductsRaw.map(p => fetchNutritionData(p, store, `${selfUrl}/api/nutrition-search`));
        const nutritionResults = await Promise.all(nutritionPromises);

        finalProducts = perfectProductsRaw.map((p, i) => ({
            name: p.product_name, brand: p.product_brand, price: p.current_price,
            size: p.product_size, url: p.url, unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
            nutrition: nutritionResults[i] || MOCK_NUTRITION_DATA,
        })).filter(p => p.price > 0);
    }
    
    const cheapest = finalProducts.length > 0 ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]) : null;
    return { ingredientKey, data: { ...item, allProducts: finalProducts.length > 0 ? finalProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)`}], currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url, userQuantity: 1 } };
}

async function fetchNutritionData(product, store, apiUrl) {
    const { barcode, product_name } = product;
    let url = store === 'Woolworths' && barcode ? `${apiUrl}?barcode=${barcode}` : `${apiUrl}?query=${encodeURIComponent(product_name)}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return MOCK_NUTRITION_DATA;
        return await res.json();
    } catch(e) { return MOCK_NUTRITION_DATA; }
}

async function analyzeProductsInBatch(analysisData) {
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a specialized AI Grocery Analyst. Classify every product with extreme accuracy. RULES: 'perfect': ideal match. 'component': ingredient in a larger meal. 'processed': heavily altered form. 'irrelevant': no connection. Return a single JSON object.`;
    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(analysisData, null, 2)}`;
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING", "enum": ["perfect", "component", "processed", "irrelevant"] }, "reason": { "type": "STRING" } } } } } } } } } } };
    try {
        const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) return [];
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        return jsonText ? (JSON.parse(jsonText).batchAnalysis || []) : [];
    } catch(e) { return []; }
}

async function generateLLMPlanAndMeals(formData, calorieTarget) {
    const { name, height, weight, age, gender, goal, dietary, days, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost...", 'Quality Focus': "Prioritize premium quality, organic...", 'Best Value': "Balance unit cost with general quality..." }[costPriority] || "Balance unit cost with general quality...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Maintain a neutral, balanced global flavor profile.';
    const systemPrompt = `You are an expert dietitian and chef. Generate a shopping list AND a meal plan. PRIMARY GOAL: The total calories for EACH DAY must be close to ${calorieTarget} kcal. INGREDIENT RULES: 'totalGramsRequired' is for nutritional math. 'quantityUnits' must be a practical shopping size. 'searchQuery' must be a simple term, no units, reflecting cost priority: ${costInstruction}. MEAL RULES: Use ONLY the generated ingredients. Provide meals for: ${requiredMeals.join(', ')}. Meal repetition must not exceed ${maxRepetitions} times. CULINARY STYLE: ${cuisineInstruction}. Return a single JSON object.`;
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}:\n- GOAL: ${goal.toUpperCase()}\n- STATS: ${height}cm, ${weight}kg, ${age} years, ${gender}.\n- DIETARY: ${dietary}\n- DAILY CALORIE TARGET: ${calorieTarget} kcal`;
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "totalGramsRequired": { "type": "INTEGER" }, "quantityUnits": { "type": "STRING" } } } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "INTEGER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } } } } } };
    const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`LLM API HTTP error! Status: ${response.status}.`);
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("LLM response was empty or malformed.");
    return { ...JSON.parse(jsonText), llmPayload: { systemPrompt, userQuery } };
}

function calculateCalorieTarget(formData) {
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


