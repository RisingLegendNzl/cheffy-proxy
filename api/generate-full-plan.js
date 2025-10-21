// --- ORCHESTRATOR API for Cheffy V3 ---
const fetch = require('node-fetch');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const BATCH_SIZE = 3;
const MAX_RETRIES = 3;

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const MOCK_NUTRITION_DATA = { status: 'not_found', calories: 0, protein: 0, fat: 0, carbs: 0 };

// --- HELPERS ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.status < 500) {
                return response;
            }
            log(`[WARNING] Attempt ${attempt}: Received server error ${response.status} from ${url}. Retrying...`, 'WARN');
        } catch (error) {
            log(`[WARNING] Attempt ${attempt}: Fetch failed for ${url} with network error: ${error.message}. Retrying...`, 'WARN');
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
    const log = (message, level = 'INFO') => {
        // New structured log format
        const logEntry = `${new Date().toISOString()} - [${level}] ${message}`;
        logs.push(logEntry);
        // Also log to console for Vercel's backend logs
        console.log(logEntry);
    };
    
    log("Orchestrator invoked.");
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.");
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN');
        return response.status(405).json({ message: 'Method Not Allowed', logs });
    }

    try {
        const formData = request.body;
        const { store } = formData;
        const selfUrl = `https://${request.headers.host}`; 
        
        log("Phase 1: Generating Blueprint...");
        const calorieTarget = calculateCalorieTarget(formData);
        log(`Calculated daily calorie target: ${calorieTarget} kcal.`);
        
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, log);
        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log(`Blueprint successful. ${ingredientPlan.length} ingredients found.`, 'SUCCESS');

        log("Phase 2 & 3: Executing Market Run...");
        const finalResults = {};
        const itemsToDiscover = [...ingredientPlan];
        
        for (let i = 0; i < itemsToDiscover.length; i += BATCH_SIZE) {
            const batchNum = (i / BATCH_SIZE) + 1;
            const batch = itemsToDiscover.slice(i, i + BATCH_SIZE);
            log(`Processing Batch ${batchNum} of ${Math.ceil(itemsToDiscover.length / BATCH_SIZE)}...`);
            
            const batchPromises = batch.map(item => processSingleIngredient(item, store, selfUrl, log));
            const batchResults = await Promise.all(batchPromises);
            
            for (const result of batchResults) {
                finalResults[result.ingredientKey] = result.data;
            }
            log(`Batch ${batchNum} complete.`);
            await delay(200); 
        }
        log("Market Run complete.", 'SUCCESS');

        log("Phase 4: Assembling Final Response...");
        const finalResponseData = { mealPlan, uniqueIngredients: ingredientPlan, results: finalResults, calorieTarget };
        
        log("Orchestrator finished successfully.", 'SUCCESS');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`, 'CRITICAL');
        console.error("ORCHESTRATOR CRITICAL ERROR STACK:", error);
        return response.status(500).json({ message: "An error occurred during plan generation.", error: error.message, logs });
    }
}

// --- SUB-PROCESS ---
async function processSingleIngredient(item, store, selfUrl, log) {
    const ingredientKey = item.originalIngredient;
    const currentQuery = item.searchQuery;
    const nutritionApiUrl = `${selfUrl}/api/nutrition-search`;
    const priceApiUrl = `${selfUrl}/api/price-search`;
    
    let rawProducts = [];
    try {
        rawProducts = await fetchRawProducts(currentQuery, store, priceApiUrl, log);
        log(`Price search for "${currentQuery}" successful, found ${rawProducts.length} raw products.`);
    } catch (err) {
        log(`Price search FAILED for "${currentQuery}". Reason: ${err.message}. Proceeding without this item.`, 'WARN');
        rawProducts = [];
    }
    
    let finalProducts = [];
    if (rawProducts.length > 0) {
        try {
            const productCandidates = rawProducts.map(p => p.product_name || "Unknown");
            const analysisResult = await analyzeProductsInBatch([{ ingredientName: ingredientKey, productCandidates }], log);
            const perfectMatchNames = new Set((analysisResult[0]?.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
            
            const perfectProductsRaw = rawProducts.filter(p => perfectMatchNames.has(p.product_name));
            log(`Found ${perfectProductsRaw.length} perfect matches for "${ingredientKey}".`);

            if (perfectProductsRaw.length > 0) {
                 const nutritionPromises = perfectProductsRaw.map(p => fetchNutritionData(p, store, nutritionApiUrl, log));
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
        } catch (err) {
            log(`Product analysis/nutrition phase failed for "${ingredientKey}". Reason: ${err.message}. This item will be marked as not found.`, 'WARN');
            finalProducts = [];
        }
    }
    
    const cheapest = finalProducts.length > 0 ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]) : null;

    const data = {
        ...item,
        allProducts: finalProducts.length > 0 ? finalProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)`}],
        currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url,
        userQuantity: 1,
        source: finalProducts.length > 0 ? 'discovery' : 'failed'
    };
    
    return { ingredientKey, data };
}


// --- API-CALLING FUNCTIONS ---
async function fetchRawProducts(query, store, log) {
    const priceSearchHandler = require('./price-search.js');
    const mockReq = { query: { store, query } };
    let capturedData;
    let errorOccurred = false;

    // FIXED: The mock response object now includes a dummy setHeader to prevent crashes.
    const mockRes = {
        setHeader: () => {}, // This is the fix. It does nothing but prevents the error.
        status: (code) => ({
            json: (data) => {
                if (code >= 400) {
                    log(`Internal Price API Error for query "${query}": HTTP ${code}, Data: ${JSON.stringify(data)}`, 'WARN');
                    errorOccurred = true;
                }
                capturedData = data;
            },
        }),
    };
    
    await priceSearchHandler(mockReq, mockRes);
    
    if (errorOccurred) {
        throw new Error(`Price search failed with status >= 400 for query: "${query}"`);
    }

    return capturedData.results || [];
}

async function fetchNutritionData(product, store, apiUrl, log) {
    const { barcode, product_name } = product;
    let url = store === 'Woolworths' && barcode ? `${apiUrl}?barcode=${barcode}` : `${apiUrl}?query=${encodeURIComponent(product_name)}`;
    try {
        // This is a simple external fetch, not a Gemini API call, so retry logic is overkill here.
        const res = await fetch(url);
        if (!res.ok) {
            log(`Nutrition fetch failed for "${product_name}" with status ${res.status}`, 'WARN');
            return MOCK_NUTRITION_DATA;
        }
        return await res.json();
    } catch(e) {
        log(`Nutrition fetch CRITICAL for "${product_name}": ${e.message}`, 'WARN');
        return MOCK_NUTRITION_DATA;
    }
}

async function analyzeProductsInBatch(analysisData, log) {
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a specialized AI Grocery Analyst...`;
    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(analysisData, null, 2)}`;
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING" }, "reason": { "type": "STRING" } } } } } } } } } } };
    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) {
        throw new Error(`Product Analysis LLM Error: HTTP ${response.status} after all retries.`);
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
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost...", 'Quality Focus': "Prioritize premium quality, organic...", 'Best Value': "Balance unit cost with general quality..." }[costPriority] || "Balance unit cost with general quality...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Maintain a neutral, balanced global flavor profile.';
    const systemPrompt = `You are an expert dietitian and chef...`;
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}...`;
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


