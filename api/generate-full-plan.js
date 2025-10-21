// --- ORCHESTRATOR API for Cheffy V2 ---
// This single endpoint handles the entire meal plan generation process.

// Use 'require' for node-fetch version 2.x
const fetch = require('node-fetch');

// --- CONFIGURATION ---
// We read the secure key from Vercel's Environment Variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const BATCH_SIZE = 3; // Process 3 ingredients at a time to prevent overload

// --- MOCK DATA (for when APIs fail) ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const MOCK_NUTRITION_DATA = { status: 'not_found', calories: 0, protein: 0, fat: 0, carbs: 0 };

// --- HELPER: Delay function to space out requests if needed ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- HELPER: Calculate Unit Price (copied from your React app) ---
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
export default async function handler(request, response) {
    // Set CORS headers to allow your React app to call this endpoint
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const formData = request.body;
        const { store } = formData;
        const selfUrl = `https://${request.headers.host}`; 

        // --- Phase 1: The Blueprint (Call Gemini) ---
        const calorieTarget = calculateCalorieTarget(formData);
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget);
        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan.");
        }

        // --- Phase 2 & 3: Execution & Fusion ---
        const finalResults = {};
        const itemsToDiscover = [...ingredientPlan];
        
        for (let i = 0; i < itemsToDiscover.length; i += BATCH_SIZE) {
            const batch = itemsToDiscover.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(item => processSingleIngredient(item, store, selfUrl));
            const batchResults = await Promise.all(batchPromises);
            
            for (const result of batchResults) {
                finalResults[result.ingredientKey] = result.data;
            }
            await delay(250); 
        }

        // --- Phase 4: Assemble and Return ---
        const finalResponseData = {
            mealPlan,
            uniqueIngredients: ingredientPlan,
            results: finalResults,
            calorieTarget
        };
        
        return response.status(200).json(finalResponseData);

    } catch (error) {
        console.error("Orchestrator Error:", error);
        return response.status(500).json({ message: "An error occurred during plan generation.", error: error.message });
    }
}


// --- SUB-PROCESS: Handles fetching and analysis for one ingredient ---
async function processSingleIngredient(item, store, selfUrl) {
    const ingredientKey = item.originalIngredient;
    const currentQuery = item.searchQuery;

    // --- START OF FIX ---
    // The grocery store API lives at a different Vercel deployment.
    // We must use its full, hardcoded address.
    const priceApiUrl = 'https://cheffy-api-proxy.vercel.app/api/proxy';
    
    // The nutrition API lives in THIS deployment, so 'selfUrl' is correct.
    const nutritionApiUrl = `${selfUrl}/api/nutrition-search`;
    // --- END OF FIX ---

    const rawProducts = await fetchRawProducts(currentQuery, store, priceApiUrl);
    
    let finalProducts = [];
    if (rawProducts.length > 0) {
        const productCandidates = rawProducts.map(p => p.product_name || "Unknown");
        const analysisResult = await analyzeProductsInBatch([{ ingredientName: ingredientKey, productCandidates }]);
        const perfectMatchNames = new Set((analysisResult[0]?.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
        
        const perfectProductsRaw = rawProducts.filter(p => perfectMatchNames.has(p.product_name));

        const nutritionPromises = perfectProductsRaw.map(p => fetchNutritionData(p, store, nutritionApiUrl));
        const nutritionResults = await Promise.all(nutritionPromises);

        finalProducts = perfectProductsRaw.map((p, i) => ({
            name: p.product_name,
            brand: p.product_brand,
            price: p.current_price,
            size: p.product_size,
            url: p.url,
            unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
            nutrition: nutritionResults[i] || MOCK_NUTRITION_DATA,
        })).filter(p => p.price > 0);
    }
    
    const cheapest = finalProducts.length > 0
        ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0])
        : null;

    const data = {
        ...item,
        allProducts: finalProducts.length > 0 ? finalProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)`}],
        currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url,
        userQuantity: 1,
        source: finalProducts.length > 0 ? 'discovery' : 'failed'
    };
    
    return { ingredientKey, data };
}


// --- API-CALLING FUNCTIONS (Adapted from React App) ---

async function fetchRawProducts(query, store, apiUrl) {
    const url = `${apiUrl}?store=${store}&query=${encodeURIComponent(query)}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return data.results || [];
    } catch {
        return [];
    }
}

async function fetchNutritionData(product, store, apiUrl) {
    const { barcode, name } = product;
    let url = store === 'Woolworths' && barcode ? `${apiUrl}?barcode=${barcode}` : `${apiUrl}?query=${encodeURIComponent(name)}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return MOCK_NUTRITION_DATA;
        return await res.json();
    } catch {
        return MOCK_NUTRITION_DATA;
    }
}

async function analyzeProductsInBatch(analysisData) {
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a specialized AI Grocery Analyst. Classify every product with extreme accuracy. RULES: 'perfect': ideal match. 'component': ingredient in a larger meal. 'processed': heavily altered form. 'irrelevant': no connection. Return a single JSON object.`;
    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(analysisData, null, 2)}`;
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING", "enum": ["perfect", "component", "processed", "irrelevant"] }, "reason": { "type": "STRING" } } } } } } } } } };
    try {
        const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) return [];
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        return jsonText ? (JSON.parse(jsonText).batchAnalysis || []) : [];
    } catch {
        return [];
    }
}

async function generateLLMPlanAndMeals(formData, calorieTarget) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost...", 'Quality Focus': "Prioritize premium quality, organic...", 'Best Value': "Balance unit cost with general quality..." }[costPriority] || "Balance unit cost with general quality...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Maintain a neutral, balanced global flavor profile.';
    const systemPrompt = `You are an expert dietitian and chef. Generate a shopping list AND a meal plan. PRIMARY GOAL: The total calories for EACH DAY must be close to ${calorieTarget} kcal. INGREDIENT RULES: 'totalGramsRequired' is for nutritional math. 'quantityUnits' must be a practical shopping size. 'searchQuery' must be a simple term, no units, reflecting cost priority: ${costInstruction}. MEAL RULES: Use ONLY the generated ingredients. Provide meals for: ${requiredMeals.join(', ')}. Meal repetition must not exceed ${maxRepetitions} times. CULINARY STYLE: ${cuisineInstruction}. Return a single JSON object.`;
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}:\n- GOAL: ${goal.toUpperCase()}\n- STATS: ${height}cm, ${weight}kg, ${age} years, ${gender}.\n- DIETARY: ${dietary}\n- DAILY CALORIE TARGET: ${calorieTarget} kcal`;
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "totalGramsRequired": { "type": "INTEGER" }, "quantityUnits": { "type": "STRING" } } } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "INTEGER" }, "meals": { "type": "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } } } }
    };
    const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`LLM API HTTP error! Status: ${response.status}.`);
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("LLM response was empty or malformed.");
    return JSON.parse(jsonText);
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

