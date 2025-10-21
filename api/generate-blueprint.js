// --- API ENDPOINT: GENERATE BLUEPRINT (PHASE 1) ---
const fetch = require('node-fetch');
const crypto = require('crypto');

// This is the initial, fast-running endpoint that the user's browser calls.
// It generates the meal plan and then triggers the slow "market run" as a background task.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';

// This is a helper to call the AI with basic retry logic for this initial step.
async function callGeminiAPI(payload, maxRetries = 2) {
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`Upstream API Error: HTTP ${response.status}`);
            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("LLM response was empty or malformed.");
            return JSON.parse(jsonText);
        } catch (error) {
            console.error(`Blueprint AI call failed (attempt ${attempt}):`, error.message);
            if (attempt === maxRetries) throw new Error(`AI API call failed after ${maxRetries} attempts.`);
        }
    }
}

// Main handler for the blueprint generation.
module.exports = async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }
    
    try {
        const formData = request.body;
        const jobId = `job-${crypto.randomUUID()}`; // A unique ID for this entire plan generation job.

        // --- PHASE 1: Generate Meal Plan Blueprint ---
        const calorieTarget = calculateCalorieTarget(formData);
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget);
        
        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan.");
        }
        
        // --- TRIGGER BACKGROUND WORKER (DO NOT AWAIT) ---
        // We trigger the slow market-run-worker but don't wait for it to finish.
        // The Vercel environment will handle this request asynchronously.
        const workerPayload = {
            jobId,
            store: formData.store,
            ingredientPlan
        };
        
        // Construct the full URL for the worker endpoint
        const host = request.headers.host;
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const workerUrl = `${protocol}://${host}/api/market-run-worker`;

        fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(workerPayload)
        }).catch(err => {
            // Log if the trigger fails, but don't fail the main request.
            console.error(`[${jobId}] CRITICAL: Failed to trigger market run worker:`, err.message);
        });

        // --- IMMEDIATELY RESPOND TO USER ---
        // Send the initial data back to the frontend right away.
        const initialResponse = {
            jobId,
            status: 'processing',
            message: 'Blueprint generated. Market run is now in progress.',
            mealPlan,
            uniqueIngredients: ingredientPlan, // This is the abstract list
            calorieTarget,
            results: {} // Results will be populated later
        };
        
        return response.status(202).json(initialResponse); // 202 Accepted indicates async processing has started.

    } catch (error) {
        console.error("BLUEPRINT CRITICAL ERROR:", error);
        return response.status(500).json({ message: "An error occurred during blueprint generation.", error: error.message });
    }
}

// --- Helper Functions (copied from original orchestrator) ---
async function generateLLMPlanAndMeals(formData, calorieTarget) {
    // This function remains largely the same as in the original orchestrator
    const { days, name, age, gender, height, weight, goal, dietary, eatingOccasions, costPriority, mealVariety, cuisine, store } = formData;
    const systemPrompt = `You are an expert dietitian and chef...`; // Omitted for brevity, same as before
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}...`; // Omitted for brevity, same as before
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: { /* Same schema as before */ } }
    };
    return callGeminiAPI(payload);
}

function calculateCalorieTarget(formData) {
    // This function is identical to the one in the original orchestrator
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

