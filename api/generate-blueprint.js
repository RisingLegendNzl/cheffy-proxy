// --- API ENDPOINT: GENERATE BLUEPRINT (PHASE 1) - FIXED ---
const fetch = require('node-fetch');
const crypto = require('crypto');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';

/**
 * A simple utility for creating structured JSON logs.
 */
class Logger {
    constructor(traceId, initialLogs = []) {
        this.traceId = traceId;
        this.logs = [...initialLogs];
    }
    log(level, message, details = {}) {
        const logEntry = JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            message,
            traceId: this.traceId,
            ...details
        });
        console.log(logEntry); // For Vercel's real-time console
        this.logs.push(logEntry);
    }
    getLogs() { return this.logs; }
}

async function callGeminiAPI(payload, logger, maxRetries = 2) {
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
            logger.log('WARN', `Blueprint AI call failed (attempt ${attempt})`, { service: 'AIClient', error: error.message });
            if (attempt === maxRetries) throw new Error(`AI API call failed after ${maxRetries} attempts.`);
        }
    }
}

module.exports = async function handler(request, response) {
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
        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan.");
        }
        logger.log('INFO', 'Blueprint generated successfully.', { phase: 1, details: { ingredientCount: ingredientPlan.length } });

        // Trigger background worker (fire and forget)
        const workerPayload = {
            jobId,
            store: formData.store,
            ingredientPlan,
            logs: logger.getLogs() // Pass the initial logs to the worker
        };
        
        const host = request.headers.host;
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const workerUrl = `${protocol}://${host}/api/market-run-worker`;

        fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(workerPayload)
        }).catch(err => {
            // This is a critical failure that needs visibility.
            console.error(`[${jobId}] CRITICAL: Failed to trigger market run worker:`, err.message);
        });

        // Immediately respond to the user with the initial plan
        const initialResponse = {
            jobId,
            status: 'processing',
            message: 'Blueprint generated. Market run is now in progress.',
            mealPlan,
            uniqueIngredients: ingredientPlan,
            calorieTarget,
            results: {},
            logs: logger.getLogs() // Send initial logs to frontend
        };
        
        return response.status(202).json(initialResponse);

    } catch (error) {
        logger.log('CRITICAL', 'Blueprint generation failed with an unrecoverable error.', { error: error.message, stack: error.stack });
        return response.status(500).json({ message: "An error occurred during blueprint generation.", error: error.message, logs: logger.getLogs() });
    }
}

// --- Helper Functions ---
async function generateLLMPlanAndMeals(formData, calorieTarget, logger) {
    const { days, name } = formData;
    logger.log('INFO', 'Sending request for meal plan blueprint.', { phase: 1, service: 'AIClient' });
    const systemPrompt = `You are an expert dietitian...`; // Omitted for brevity
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}...`; // Omitted for brevity
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: { /* Same schema */ } }
    };
    return callGeminiAPI(payload, logger);
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


