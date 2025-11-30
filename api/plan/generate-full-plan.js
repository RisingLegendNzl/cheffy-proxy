// --- Cheffy API: /api/plan/generate-full-plan.js ---
// Module 1 Refactor: Multi-Day Orchestration Wrapper
// V15.5 - Strict Prompt + Error Serialization Fix

const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@vercel/kv');

// --- New Shared Modules ---
const { executePipeline, generateTraceId, createTracedLogger } = require('../../utils/pipeline.js');
const { validateLLMOutput } = require('../../utils/llmValidator.js');
const { emitAlert, ALERT_LEVELS } = require('../../utils/alerting.js');
const { createTrace, completeTrace, traceStageStart, traceStageEnd, traceError } = require('../trace.js');
const { recordPipelineStats } = require('../metrics.js');

// --- Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PLAN_MODEL_NAME_PRIMARY = 'gemini-2.0-flash';
const PLAN_MODEL_NAME_FALLBACK = 'gemini-2.5-flash';

const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const TTL_PLAN_MS = 1000 * 60 * 60 * 24; // 24 hours

const LLM_REQUEST_TIMEOUT_MS = 90000;
const MAX_LLM_RETRIES = 3;

// --- Helper: Get Gemini URL ---
const getGeminiApiUrl = (modelName) => `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

// --- Helper: Cache Wrappers ---
async function cacheGet(key, log) {
    if (!kvReady) return null;
    try {
        const hit = await kv.get(key);
        if (hit) log(`Cache HIT for key: ${key.split(':').pop()}`, 'DEBUG', 'CACHE');
        return hit;
    } catch (e) {
        log(`Cache GET Error: ${e.message}`, 'ERROR', 'CACHE');
        return null;
    }
}

async function cacheSet(key, val, ttl, log) {
    if (!kvReady) return;
    try {
        await kv.set(key, val, { px: ttl });
        log(`Cache SET for key: ${key.split(':').pop()}`, 'DEBUG', 'CACHE');
    } catch (e) {
        log(`Cache SET Error: ${e.message}`, 'ERROR', 'CACHE');
    }
}

// --- Helper: Hash ---
function hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

// --- Helper: Fetch LLM with Retry ---
async function fetchLLMWithRetry(url, options, log, attemptPrefix = "LLM") {
    for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

        try {
            log(`${attemptPrefix} Attempt ${attempt}: Fetching from ${url}`, 'DEBUG', 'HTTP');
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);

            if (response.ok) {
                const rawText = await response.text();
                const trimmedText = rawText.trim();
                // Basic JSON guard
                if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
                    return {
                        ok: true,
                        status: response.status,
                        json: () => Promise.resolve(JSON.parse(trimmedText)),
                        text: () => Promise.resolve(trimmedText)
                    };
                } else {
                    throw new Error(`200 OK with non-JSON body: ${trimmedText.substring(0, 100)}`);
                }
            }

            if (response.status !== 429 && response.status < 500) {
                const errorBody = await response.text();
                throw new Error(`${attemptPrefix} call failed with status ${response.status}. Body: ${errorBody}`);
            }
            log(`${attemptPrefix} Attempt ${attempt}: Retryable error ${response.status}.`, 'WARN', 'HTTP');

        } catch (error) {
            clearTimeout(timeout);
            log(`${attemptPrefix} Attempt ${attempt}: Error: ${error.message}`, 'WARN', 'HTTP');
            if (attempt === MAX_LLM_RETRIES) throw error;
        }

        const delayTime = Math.pow(2, attempt - 1) * 3000 + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delayTime));
    }
}

// --- Helper: Try Generate Plan ---
async function tryGenerateLLMPlan(modelName, payload, log, logPrefix, expectedJsonShape) {
    const apiUrl = getGeminiApiUrl(modelName);
    const response = await fetchLLMWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload)
    }, log, logPrefix);

    const result = await response.json();
    const candidate = result.candidates?.[0];
    const content = candidate?.content;
    
    if (!content || !content.parts?.[0]?.text) {
        throw new Error(`Model ${modelName} failed: Response missing content.`);
    }

    const jsonText = content.parts[0].text;
    try {
        const parsed = JSON.parse(jsonText.trim());
        if (!parsed || typeof parsed !== 'object') throw new Error("Parsed response is not a valid object.");
        return parsed;
    } catch (parseError) {
        throw new Error(`Model ${modelName} failed: Invalid JSON. ${parseError.message}`);
    }
}

// --- Helper: LLM System Prompt (Explicit Units + Strict Schema) ---
const MEAL_PLANNER_SYSTEM_PROMPT = (weight, calories, day, perMealTargets) => `
You are an expert dietitian. Your SOLE task is to generate the \`meals\` for ONE day (Day ${day}).
STRICTLY output valid JSON matching the schema below. No markdown, no prose, no comments.

JSON SCHEMA:
{
  "meals": [
    {
      "type": "Breakfast" | "Lunch" | "Dinner" | "Snack",
      "name": "string (Meal Name)",
      "items": [
        {
          "key": "string (Generic ingredient name, e.g. 'Oats', 'Chicken Breast')",
          "qty_value": number (Decimal or integer),
          "qty_unit": "string (MUST BE FROM ALLOWED LIST)",
          "stateHint": "dry" | "raw" | "cooked" | "as_pack",
          "methodHint": "string (Cooking method, e.g. 'boiled', or null)"
        }
      ]
    }
  ]
}

ALLOWED UNITS (qty_unit):
- Weight: "g", "kg", "oz", "lb"
- Volume: "ml", "L", "cup", "tbsp", "tsp"
- Count: "piece", "slice", "egg", "can", "tin", "packet", "sachet", "clove", "stalk", "sprig", "bunch", "fillet"

CRITICAL RULES:
1. **UNITS:** Do NOT use vague units like 'medium', 'large', 'serving', 'bowl', 'plate'. Convert to 'piece' or 'g'.
2. **PROTEIN CAP:** Never exceed 3 g/kg total daily protein (User weight: ${weight}kg).
3. **STATE HINT:**
   - "dry": grains, pasta, oats before cooking.
   - "raw": meats, veg before cooking.
   - "cooked": only if user explicitly eats pre-cooked item.
   - "as_pack": yogurt, bread, cheese.
4. **TARGETS:**
   - MAIN MEALS: ~${perMealTargets.main.calories} kcal, ~${perMealTargets.main.protein}g P
   - SNACKS: ~${perMealTargets.snack.calories} kcal, ~${perMealTargets.snack.protein}g P
5. **SCALING:** Scale portion sizes (qty_value) to hit these targets exactly.

Output ONLY the JSON.
`;

// --- Helper: Generate Single Day Plan (LLM) ---
async function generateMealPlan_Single(day, formData, nutritionalTargets, log, perMealTargets) {
    const { name, height, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, cuisine } = formData;
    const { calories } = nutritionalTargets;

    // Check Cache
    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets, perMealTargets }));
    const cacheKey = `${CACHE_PREFIX}:meals:day${day}:${profileHash}`;
    const cached = await cacheGet(cacheKey, log);
    if (cached) return { dayNumber: day, meals: cached.meals };

    // Prepare Prompt
    const mainMealCal = Math.round(perMealTargets.main.calories);
    const mainMealP = Math.round(perMealTargets.main.protein);
    const snackCal = Math.round(perMealTargets.snack.calories);
    const snackP = Math.round(perMealTargets.snack.protein);

    const systemPrompt = MEAL_PLANNER_SYSTEM_PROMPT(weight, calories, day, perMealTargets);
    const userQuery = `Gen plan Day ${day} for ${name||'Guest'}. ${age}yo ${gender}, ${weight}kg. Goal: ${goal}. Store: ${store}. Targets: ~${calories}kcal. Main: ~${mainMealCal}kcal/${mainMealP}gP. Snack: ~${snackCal}kcal/${snackP}gP. Diet: ${dietary}. Meals: ${eatingOccasions}. Spend: ${costPriority}. Cuisine: ${cuisine}.`;

    const logPrefix = `MealPlannerDay${day}`;
    log(`Prompting LLM for Day ${day}`, 'INFO', 'LLM');

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.3, responseMimeType: "application/json" }
    };

    let parsedResult;
    try {
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_PRIMARY, payload, log, logPrefix, {});
    } catch (e) {
        log(`Primary LLM failed: ${e.message}. Retrying fallback.`, 'WARN', 'LLM');
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_FALLBACK, payload, log, logPrefix, {});
    }

    if (parsedResult?.meals?.length > 0) {
        await cacheSet(cacheKey, parsedResult, TTL_PLAN_MS, log);
    }
    return { dayNumber: day, meals: parsedResult.meals || [] };
}

// --- Main Handler ---
module.exports = async (request, response) => {
    // 1. Generate Trace ID at entry
    const traceId = generateTraceId();
    
    // 2. Setup Traced Logger
    const log = createTracedLogger(traceId);

    if (request.method === 'OPTIONS') return response.status(200).end();
    if (request.method !== 'POST') return response.status(405).json({ error: "Method Not Allowed" });

    try {
        const { formData, nutritionalTargets } = request.body;
        const numDays = parseInt(formData.days, 10) || 7;
        const store = formData.store;

        // 3. Initialize Trace
        createTrace(traceId, { 
            planType: 'multi-day', 
            dayCount: numDays, 
            store, 
            targets: nutritionalTargets 
        });

        log(`Starting Multi-Day Plan Generation for ${numDays} days`, 'INFO', 'ORCHESTRATOR');

        // 4. Calculate Per-Meal Targets
        const eatingOccasions = parseInt(formData.eatingOccasions, 10) || 3;
        const mainMealCount = Math.min(eatingOccasions, 3);
        const snackCount = Math.max(0, eatingOccasions - mainMealCount);
        
        let mainRatio = 1.0, snackRatio = 0.0;
        if (eatingOccasions === 4) { mainRatio = 0.84; snackRatio = 0.16; }
        else if (eatingOccasions >= 5) { mainRatio = 0.75; snackRatio = 0.25; }

        const targetsPerMealType = {
            main: {
                calories: nutritionalTargets.calories * (mainMealCount > 0 ? mainRatio / mainMealCount : 0),
                protein: nutritionalTargets.protein * (mainMealCount > 0 ? mainRatio / mainMealCount : 0),
                fat: nutritionalTargets.fat * (mainMealCount > 0 ? mainRatio / mainMealCount : 0),
                carbs: nutritionalTargets.carbs * (mainMealCount > 0 ? mainRatio / mainMealCount : 0),
            },
            snack: {
                calories: nutritionalTargets.calories * (snackCount > 0 ? snackRatio / snackCount : 0),
                protein: nutritionalTargets.protein * (snackCount > 0 ? snackRatio / snackCount : 0),
                fat: nutritionalTargets.fat * (snackCount > 0 ? snackRatio / snackCount : 0),
                carbs: nutritionalTargets.carbs * (snackCount > 0 ? snackRatio / snackCount : 0),
            }
        };

        const processedDays = [];
        const allStats = [];

        // 5. Day Iteration Loop
        for (let day = 1; day <= numDays; day++) {
            traceStageStart(traceId, `Day_${day}_Processing`);
            
            // A. Generate Meals (Dietitian Agent)
            const rawDayPlan = await generateMealPlan_Single(day, formData, nutritionalTargets, log, targetsPerMealType);

            // B. Validate LLM Output
            const validation = validateLLMOutput(rawDayPlan, 'MEALS_ARRAY');
            if (!validation.valid) {
                log(`Day ${day} LLM Output Invalid. Auto-corrected: ${validation.corrected}`, 'WARN', 'VALIDATOR');
                // Use corrected output if available, otherwise raw
                if (validation.correctedOutput) rawDayPlan.meals = validation.correctedOutput.meals;
            }

            // C. Execute Pipeline
            const pipelineConfig = {
                traceId,
                dayNumber: day,
                store: store,
                scaleProtein: true, 
                allowReconciliation: true,
                generateRecipes: true
            };

            const processedDayResult = await executePipeline(
                rawDayPlan.meals,
                nutritionalTargets, 
                fetchLLMWithRetry,  
                pipelineConfig
            );

            // D. Collect Results
            processedDays.push(processedDayResult.data);
            if (processedDayResult.stats) allStats.push(processedDayResult.stats);

            traceStageEnd(traceId, `Day_${day}_Processing`);
        }

        // 6. Aggregate Metrics & Stats
        const aggregatedStats = allStats.reduce((acc, curr) => ({
            marketQueries: (acc.marketQueries || 0) + (curr.marketQueries || 0),
            nutritionLookups: (acc.nutritionLookups || 0) + (curr.nutritionLookups || 0),
            cacheHits: (acc.cacheHits || 0) + (curr.cacheHits || 0),
            durationMs: (acc.durationMs || 0) + (curr.durationMs || 0)
        }), {});
        
        recordPipelineStats(aggregatedStats);

        // 7. Assemble Final Response
        const responseData = {
            traceId,
            days: processedDays,
            validation: {
                overallValid: processedDays.every(d => d.validation?.isValid),
                issuesCount: processedDays.reduce((acc, d) => acc + (d.validation?.summary?.totalIssues || 0), 0)
            },
            debug: {
                traceId,
                aggregatedStats,
                timestamp: new Date().toISOString()
            }
        };

        completeTrace(traceId, 'success', { dayCount: numDays });
        log('Multi-day plan generation completed successfully', 'SUCCESS', 'ORCHESTRATOR');

        return response.status(200).json(responseData);

    } catch (error) {
        // Safe wrapping of error object for alerting
        const safeError = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
        
        // Pass sanitized message to alerts
        emitAlert(ALERT_LEVELS.CRITICAL, 'pipeline_failure', { traceId, error: safeError.message });
        
        // Use corrected traceError signature
        traceError(traceId, 'orchestrator_handler', safeError);
        
        log(`Pipeline Failure: ${safeError.message}`, 'CRITICAL', 'ORCHESTRATOR');
        
        // Return standard error shape expected by frontend
        return response.status(500).json({
            message: safeError.message,
            error: safeError.message, // Legacy support
            details: safeError.validationErrors || null,
            traceId,
            code: "PIPELINE_ERROR"
        });
    }
};


