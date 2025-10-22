// --- ASYNCHRONOUS ORCHESTRATOR API for Cheffy V3 ---
const fetch = require('node-fetch');
const { fetchPriceDataWithFallback } = require('./price-search.js');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, updateDoc } = require('firebase/firestore');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3;

// --- ROBUST FIREBASE INITIALIZATION ---
let db;
let firebaseError = null;
if (!process.env.FIREBASE_CONFIG) {
    firebaseError = "CRITICAL: FIREBASE_CONFIG environment variable not set. Server cannot connect to the database.";
    console.error(firebaseError);
} else {
    try {
        const FIREBASE_CONFIG = JSON.parse(process.env.FIREBASE_CONFIG);
        if (!FIREBASE_CONFIG.projectId) {
            throw new Error('"projectId" is missing from the Firebase configuration.');
        }
        const app = initializeApp(FIREBASE_CONFIG);
        db = getFirestore(app);
        console.log("Firebase initialized successfully.");
    } catch (e) {
        firebaseError = `CRITICAL: Firebase initialization failed. Error: ${e.message}. Check the FIREBASE_CONFIG environment variable.`;
        console.error(firebaseError);
    }
}


// --- MOCK DATA & HELPERS ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.status < 500) return response;
            log({ message: `Attempt ${attempt}: Server error ${response.status}. Retrying...`, level: 'WARN', tag: 'HTTP' });
        } catch (error) {
            log({ message: `Attempt ${attempt}: Network error: ${error.message}. Retrying...`, level: 'WARN', tag: 'HTTP' });
        }
        if (attempt < MAX_RETRIES) await delay(Math.pow(2, attempt - 1) * 1000);
    }
    throw new Error(`API call failed after ${MAX_RETRIES} attempts.`);
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

function calculateNutritionalTargets(formData, log) {
    // ... (implementation remains the same)
    const { weight, height, age, gender, activityLevel, goal, bodyFat } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);
    const bodyFatPercent = parseFloat(bodyFat);

    if (!weightKg || !heightCm || !ageYears) {
        return { calories: 2000, protein: 150, fat: 60, carbs: 215, method: 'defaults' };
    }

    let bmr;
    if (bodyFatPercent && bodyFatPercent > 0) {
        const leanBodyMass = weightKg * (1 - (bodyFatPercent / 100));
        bmr = 370 + (21.6 * leanBodyMass);
    } else {
        bmr = (gender === 'male')
            ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
            : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    }
    
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);
    const goalAdjustments = { cut: -500, maintain: 0, bulk: 500 };
    const calorieTarget = tdee + (goalAdjustments[goal] || 0);

    const proteinTargetGrams = Math.round(weightKg * 1.8);
    const fatTargetGrams = Math.round((calorieTarget * 0.25) / 9);
    const caloriesFromProtein = proteinTargetGrams * 4;
    const caloriesFromFat = fatTargetGrams * 9;
    const remainingCaloriesForCarbs = calorieTarget - caloriesFromProtein - caloriesFromFat;
    const carbsTargetGrams = Math.round(remainingCaloriesForCarbs / 4);

    return { calories: Math.round(calorieTarget), protein: proteinTargetGrams, fat: fatTargetGrams, carbs: carbsTargetGrams };
}


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    // Fail-fast if Firebase isn't configured
    if (firebaseError) {
        return response.status(500).json({ message: "Firebase configuration error on the server.", error: firebaseError });
    }
    
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(200).end();
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method Not Allowed' });

    // --- PART 1: INSTANT RESPONSE ---
    try {
        const formData = request.body;
        // Get userId and appId from the frontend request
        const { userId, appId } = formData;

        if (!userId || !appId) {
            console.error("CRITICAL: Missing userId or appId in request body.", formData);
            return response.status(400).json({ message: "Missing required userId or appId." });
        }

        const planId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const log = (logObject) => console.log(`${new Date().toISOString()} [${planId}] - [${logObject.level || 'INFO'}/${logObject.tag}] ${logObject.message}`);
        
        log({ message: `Starting plan generation for ID: ${planId} for user: ${userId}`, tag: 'SYSTEM' });

        const nutritionalTargets = calculateNutritionalTargets(formData, log);
        const { ingredients, mealPlan } = await generateLLMPlanAndMeals(formData, nutritionalTargets, log);
        
        const initialResults = {};
        ingredients.forEach(item => {
            initialResults[item.originalIngredient.replace(/\./g, '')] = { // Sanitize dots from keys
                ...item,
                status: 'searching',
                allProducts: [],
                currentSelectionURL: null,
                userQuantity: 1
            };
        });

        // Use the new, correct Firestore path
        const planDocPath = `artifacts/${appId}/users/${userId}/plans`;
        const planDocRef = doc(db, planDocPath, planId);
        
        await setDoc(planDocRef, {
            id: planId,
            status: 'pending',
            formData,
            nutritionalTargets,
            mealPlan,
            uniqueIngredients: ingredients,
            results: initialResults,
            createdAt: new Date().toISOString()
        });
        
        log({ message: `Blueprint for ${planId} created in Firestore at ${planDocPath}.`, level: 'SUCCESS', tag: 'DB' });
        
        // Pass userId and appId to the background task
        runMarketAnalysisInBackground(appId, userId, planId, formData.store, ingredients, log);
        
        return response.status(202).json({ planId });

    } catch (error) {
        console.error("ORCHESTRATOR CRITICAL ERROR:", error);
        return response.status(500).json({ message: "An error occurred during plan generation.", error: error.message });
    }
};

// Added appId and userId to the function signature
async function runMarketAnalysisInBackground(appId, userId, planId, store, ingredients, log) {
    
    // Define the correct path for updates
    const planDocPath = `artifacts/${appId}/users/${userId}/plans`;
    const planDocRef = doc(db, planDocPath, planId);

    try {
        log({ message: "Starting background Market Run...", tag: 'BACKGROUND' });

        const pricePromises = ingredients.map(item =>
            fetchPriceDataWithFallback(store, item.searchQuery)
                .then(rawProducts => ({ item, rawProducts }))
        );
        const allPriceResults = await Promise.all(pricePromises);
        
        const analysisPayload = allPriceResults
            .filter(result => result.rawProducts.length > 0)
            .map(result => ({
                ingredientName: result.item.searchQuery,
                productCandidates: result.rawProducts.map(p => p.product_name || "Unknown")
            }));

        let fullAnalysis = [];
        if (analysisPayload.length > 0) {
            fullAnalysis = await analyzeProductsInBatch(analysisPayload, log);
        }

        for (const { item, rawProducts } of allPriceResults) {
            const ingredientKey = item.originalIngredient;
            const analysisForItem = fullAnalysis.find(a => a.ingredientName === item.searchQuery);
            const perfectMatchNames = new Set((analysisForItem?.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
            
            const finalProducts = rawProducts
                .filter(p => perfectMatchNames.has(p.product_name))
                .map(p => ({
                    name: p.product_name, brand: p.product_brand, price: p.current_price, size: p.product_size, url: p.url, barcode: p.barcode,
                    unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
                }));
            
            const cheapest = finalProducts.length > 0 ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]) : null;

            const finalResult = {
                ...item,
                status: finalProducts.length > 0 ? 'found' : 'not_found',
                allProducts: finalProducts.length > 0 ? finalProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)`}],
                currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url,
                userQuantity: 1
            };

            // Use the correct doc ref
            await updateDoc(planDocRef, {
                [`results.${ingredientKey.replace(/\./g, '')}`]: finalResult
            });
        }
        
        // Use the correct doc ref
        await updateDoc(planDocRef, { status: 'complete' });
        log({ message: "Background Market Run complete.", level: 'SUCCESS', tag: 'BACKGROUND' });

    } catch (error) {
        log({ message: `Background task failed: ${error.message}`, level: 'CRITICAL', tag: 'BACKGROUND' });
        // Use the correct doc ref
        await updateDoc(planDocRef, { status: 'failed', error: error.message });
    }
}


async function generateLLMPlanAndMeals(formData, nutritionalTargets, log) {
    // ... (implementation remains the same)
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], };
    const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3'];
    const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost, most basic ingredients (e.g., rice, beans, oats, basic vegetables). Avoid expensive meats, pre-packaged items, and specialty goods.", 'Quality Focus': "Prioritize premium quality, organic, free-range, and branded ingredients where appropriate. Cost is a secondary concern to quality and health benefits.", 'Best Value': "Balance unit cost with general quality. Use a mix of budget-friendly staples and good quality fresh produce and proteins. Avoid premium brands unless necessary." }[costPriority] || "Balance unit cost with general quality...";
    const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2;
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Maintain a neutral, balanced global flavor profile.';
    const systemPrompt = `You are an expert dietitian and chef creating a practical, cost-effective grocery and meal plan based on precise, science-backed nutritional targets.
RULES:
1.  Generate a complete meal plan for the specified number of days that STRICTLY adheres to the daily nutritional targets provided.
2.  Generate a consolidated shopping list of unique ingredients required for the entire plan.
3.  Provide a user-friendly 'quantityUnits' string.
4.  Estimate the total grams required for each ingredient across the entire plan.
5.  CRITICAL RULE FOR 'searchQuery': The searchQuery MUST be the most generic, searchable keyword for the item. EXCLUDE preparations, packaging, and specifiers.
    - EXAMPLE 1: 'Canned Tuna in Water' -> \`searchQuery\`: 'tuna'.
    - EXAMPLE 2: 'Rolled Oats (dry)' -> \`searchQuery\`: 'rolled oats'.
6.  Adhere strictly to all user-provided constraints.`;
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}.
- User Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg.
- Goal: ${goal}.
- DAILY NUTRITIONAL TARGETS (Adhere Strictly):
  - Calories: ~${nutritionalTargets.calories} kcal
  - Protein: ~${nutritionalTargets.protein} g
  - Fat: ~${nutritionalTargets.fat} g
  - Carbohydrates: ~${nutritionalTargets.carbs} g
- Other Constraints: ${eatingOccasions} meals/day, ${costPriority} spending, ${mealVariety} repetition, ${cuisineInstruction || 'any cuisine'}.
- Grocery Store: ${store}.`;
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } } } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } } } } } }
    };
    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) throw new Error(`LLM API HTTP error! Status: ${response.status}.`);
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("LLM response was empty or malformed.");
    return JSON.parse(jsonText);
}

async function analyzeProductsInBatch(analysisData, log) {
    // ... (implementation remains the same)
    if (!analysisData || analysisData.length === 0) return [];
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a specialized AI Grocery Analyst. Your task is to accurately classify product names returned by a grocery store search engine against the generic search query used to find them.
CRITICAL RULE: The goal is to maximize successful ingredient matches. A "perfect" match must be returned if the product is fundamentally the correct food item for the search query.

Classifications:
- "perfect": The product is a **direct core ingredient match** for the search query. This includes common varieties, packaging differences, and quality descriptors.
    - Examples: query "salmon" -> product "Smoked Salmon Slices" (Perfect). query "beef mince" -> product "Lean Ground Beef" (Perfect).
- "irrelevant": The product is completely wrong.`;
    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(analysisData, null, 2)}`;
    // FIX: Added 'type:' before '"OBJECT"' in the 'analysis' items schema
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING" }, "reason": { "type": "STRING" } } } } } } } } } } };
    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    if (!response.ok) throw new Error(`Product Analysis LLM Error: HTTP ${response.status}`);
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    return jsonText ? (JSON.parse(jsonText).batchAnalysis || []) : [];
}


