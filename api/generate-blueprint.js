// --- API ENDPOINT: GENERATE BLUEPRINT (PHASE 1) ---
const fetch = require('node-fetch');
const crypto = require('crypto');

// This file is unchanged.

// --- UTILITIES ---
class Logger { constructor(traceId, initialLogs = []) { this.traceId = traceId; this.logs = [...initialLogs]; } log(level, message, details = {}) { const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), level, message, traceId: this.traceId, ...details }); console.log(logEntry); this.logs.push(logEntry); } getLogs() { return this.logs; } }
async function callGeminiAPI(payload, logger, maxRetries = 2) { /* ... */ }

// --- MAIN HANDLER ---
module.exports = async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const jobId = `job-${crypto.randomUUID()}`;
    const logger = new Logger(jobId);

    if (request.method !== 'POST') {
        logger.log('WARN', `Method Not Allowed: ${request.method}`);
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    logger.log('INFO', 'Blueprint generation invoked.', { phase: 1 });
    
    try {
        const formData = request.body;
        const calorieTarget = calculateCalorieTarget(formData);
        logger.log('INFO', 'Calculated daily calorie target.', { phase: 1, details: { calorieTarget } });

        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, logger);
        if (!ingredientPlan || ingredientPlan.length === 0) throw new Error("LLM did not return an ingredient plan.");
        logger.log('INFO', 'Blueprint generated successfully.', { phase: 1, details: { ingredientCount: ingredientPlan.length } });

        const workerPayload = { jobId, store: formData.store, ingredientPlan, logs: logger.getLogs() };
        
        const host = request.headers.host;
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const workerUrl = `${protocol}://${host}/api/market-run-worker`;

        fetch(workerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workerPayload) })
            .catch(err => console.error(`[${jobId}] CRITICAL: Failed to trigger market run worker:`, err.message));

        const initialResponse = { jobId, status: 'processing', mealPlan, uniqueIngredients: ingredientPlan, calorieTarget, results: {}, logs: logger.getLogs() };
        return response.status(202).json(initialResponse);

    } catch (error) {
        logger.log('CRITICAL', 'Blueprint generation failed.', { error: error.message });
        return response.status(500).json({ message: error.message, logs: logger.getLogs() });
    }
}

// --- HELPER FUNCTIONS ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
async function generateLLMPlanAndMeals(formData, calorieTarget, logger) { const { days, name, height, weight, age, gender, goal, dietary, eatingOccasions, costPriority, mealVariety, cuisine, activityLevel, store } = formData; const mealTypesMap = { '3': ['Breakfast', 'Lunch', 'Dinner'], '4': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1'], '5': ['Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2'], }; const requiredMeals = mealTypesMap[eatingOccasions] || mealTypesMap['3']; const costInstruction = { 'Extreme Budget': "STRICTLY prioritize the lowest unit cost, most basic ingredients (e.g., rice, beans, oats, basic vegetables). Avoid expensive meats, pre-packaged items, and specialty goods.", 'Quality Focus': "Prioritize premium quality, organic, free-range, and branded ingredients where appropriate. Cost is a secondary concern to quality and health benefits.", 'Best Value': "Balance unit cost with general quality. Use a mix of budget-friendly staples and good quality fresh produce and proteins. Avoid premium brands unless necessary." }[costPriority] || "Balance unit cost with general quality..."; const maxRepetitions = { 'High Repetition': 3, 'Low Repetition': 1, 'Balanced Variety': 2 }[mealVariety] || 2; const cuisineInstruction = cuisine && cuisine.trim() ? `Focus recipes around: ${cuisine}.` : 'Maintain a neutral, balanced global flavor profile.'; const systemPrompt = `You are an expert dietitian and chef creating a practical, cost-effective grocery and meal plan. RULES: 1. Generate a complete meal plan for the specified number of days. 2. Generate a consolidated shopping list of unique ingredients required for the entire plan. 3. For each ingredient, provide a 'searchQuery' which MUST be a simple, generic term suitable for a grocery store search engine (e.g., "chicken breast", "rolled oats", "mixed berries"). DO NOT include quantities or brands in the searchQuery. 4. Estimate the total grams required for each ingredient across the entire plan. 5. Provide a user-friendly 'quantityUnits' string (e.g., "1 Large Jar", "500g Bag", "2 Cans"). 6. Adhere strictly to all user-provided constraints (dietary, cost, variety, etc.).`; const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}. - User Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. - Activity: ${activityLevel}. - Goal: ${goal}. - Daily Calorie Target: ~${calorieTarget} kcal. - Dietary Needs: ${dietary}. - Meals Per Day: ${eatingOccasions} (${requiredMeals.join(', ')}). - Spending Priority: ${costPriority} (${costInstruction}). - Meal Repetition Allowed: A single meal can appear up to ${maxRepetitions} times max. - Cuisine Profile: ${cuisineInstruction}. - Grocery Store: ${store}.`; const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } } } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } } } } } }; logger.log('INFO', 'Sending request for meal plan blueprint.', { phase: 1, service: 'AIClient', prompt: userQuery }); return callGeminiAPI(payload, logger); }
function calculateCalorieTarget(formData) { const { weight, height, age, gender, activityLevel, goal } = formData; const weightKg = parseFloat(weight); const heightCm = parseFloat(height); const ageYears = parseInt(age, 10); if (!weightKg || !heightCm || !ageYears) return 2000; let bmr = (gender === 'male') ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5) : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161); const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 }; const tdee = bmr * (activityMultipliers[activityLevel] || 1.55); const goalAdjustments = { cut: -500, maintain: 0, bulk: 500 }; return Math.round(tdee + (goalAdjustments[goal] || 0)); }
async function callGeminiAPI(payload, logger, maxRetries = 2) { const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`; for (let attempt = 1; attempt <= maxRetries; attempt++) { try { const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(`Upstream API Error: HTTP ${response.status}`); const result = await response.json(); const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text; if (!jsonText) throw new Error("LLM response was empty or malformed."); logger.log('INFO', 'Meal plan blueprint received successfully.', { phase: 1, service: 'AIClient' }); return JSON.parse(jsonText); } catch (error) { logger.log('WARN', `Blueprint AI call failed (attempt ${attempt})`, { service: 'AIClient', error: error.message }); if (attempt === maxRetries) throw new Error(`AI API call failed after ${maxRetries} attempts.`); } } }


