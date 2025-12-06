/**
 * api/plan/day.js
 * 
 * Single-Day Orchestration Wrapper
 * V15.4 - Fixed "meals is not iterable" bug from stale cache schema
 * 
 * CHANGES V15.4:
 * - Added extractMealsFromCache() to handle old/new cache formats
 * - Cache validation: invalid cache falls through to LLM regeneration
 * - Fixed validator call: now validates meals array, not wrapper object
 * - Added pre-pipeline guard: explicit Array.isArray check before executePipeline
 * - Bumped CACHE_VERSION to invalidate old cache entries
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@vercel/kv');

// --- Shared Modules ---
const { executePipeline, generateTraceId, createTracedLogger } = require('../../utils/pipeline.js');
const { validateLLMOutput } = require('../../utils/llmValidator.js');
const { emitAlert, ALERT_LEVELS } = require('../../utils/alerting.js');
const { createTrace, completeTrace, traceError } = require('../trace.js');
const { recordPipelineStats } = require('../metrics.js');

// --- Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PLAN_MODEL_NAME_PRIMARY = 'gemini-2.5-flash';
const PLAN_MODEL_NAME_FALLBACK = 'gemini-2.5-pro';

const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// V15.4: Bumped version to invalidate stale cache
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = `cheffy:plan:${CACHE_VERSION}:day`;
const TTL_PLAN_MS = 1000 * 60 * 60 * 24;

const LLM_REQUEST_TIMEOUT_MS = 90000;
const MAX_LLM_RETRIES = 3;

// ═══════════════════════════════════════════════════════════════════════════
// V15.4: CACHE EXTRACTION HELPER (same as generate-full-plan.js)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely extracts meals array from cached data regardless of schema version.
 */
function extractMealsFromCache(cached, log) {
    if (cached === null || cached === undefined) {
        return { valid: false, meals: [], reason: 'cache_miss' };
    }
    
    if (Array.isArray(cached)) {
        if (cached.length > 0 && Array.isArray(cached[0]?.items)) {
            log(`Cache contains legacy direct array format`, 'DEBUG', 'CACHE');
            return { valid: true, meals: cached, reason: 'legacy_direct_array' };
        }
        log(`Cache array invalid: missing items property`, 'WARN', 'CACHE');
        return { valid: false, meals: [], reason: 'array_missing_items' };
    }
    
    if (typeof cached === 'object') {
        if (Array.isArray(cached.meals)) {
            if (cached.meals.length > 0 && Array.isArray(cached.meals[0]?.items)) {
                return { valid: true, meals: cached.meals, reason: 'standard_object' };
            }
            if (cached.meals.length === 0) {
                log(`Cache meals array is empty`, 'WARN', 'CACHE');
                return { valid: false, meals: [], reason: 'meals_empty' };
            }
            log(`Cache meals[0] missing items array`, 'WARN', 'CACHE');
            return { valid: false, meals: [], reason: 'meals_items_missing' };
        }
        
        const keys = Object.keys(cached).slice(0, 5).join(', ');
        log(`Cache object has no meals array. Keys: [${keys}]`, 'WARN', 'CACHE');
        return { valid: false, meals: [], reason: 'object_no_meals' };
    }
    
    log(`Cache contains unexpected type: ${typeof cached}`, 'ERROR', 'CACHE');
    return { valid: false, meals: [], reason: 'invalid_type' };
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

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

function hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const getGeminiApiUrl = (modelName) => `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

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
                throw new Error(`${attemptPrefix} call failed with status ${response.status}. Body: ${errorBody.substring(0, 200)}`);
            }

            log(`${attemptPrefix} Attempt ${attempt} failed with status ${response.status}. Retrying...`, 'WARN', 'HTTP');
        } catch (e) {
            clearTimeout(timeout);
            if (e.name === 'AbortError') {
                log(`${attemptPrefix} Attempt ${attempt} timed out after ${LLM_REQUEST_TIMEOUT_MS}ms`, 'WARN', 'HTTP');
            } else if (attempt === MAX_LLM_RETRIES) {
                throw e;
            } else {
                log(`${attemptPrefix} Attempt ${attempt} error: ${e.message}. Retrying...`, 'WARN', 'HTTP');
            }
        }
        
        if (attempt < MAX_LLM_RETRIES) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw new Error(`${attemptPrefix} failed after ${MAX_LLM_RETRIES} retries`);
}

async function tryGenerateLLMPlan(modelName, payload, log, logPrefix) {
    const url = `${getGeminiApiUrl(modelName)}?key=${GEMINI_API_KEY}`;
    
    log(`${logPrefix}: Calling ${modelName}`, 'INFO', 'LLM');
    
    const response = await fetchLLMWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, log, logPrefix);
    
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
        throw new Error(`${modelName} returned empty response`);
    }
    
    return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const MEAL_PLANNER_SYSTEM_PROMPT = (weight, dailyCal, dayNum, perMealTargets) => `
You are Chef-GPT, a precision meal planner. Generate Day ${dayNum} plan as JSON:
{
  "dayNumber": ${dayNum},
  "meals": [
    {
      "name": "Meal Name",
      "type": "breakfast|lunch|dinner|snack",
      "items": [
        {
          "key": "ingredient name (lowercase)",
          "qty_value": <number>,
          "qty_unit": "g|ml|piece",
          "stateHint": "dry|raw|cooked|as_pack",
          "methodHint": "boiled|grilled|fried|baked|steamed|none"
        }
      ]
    }
  ]
}

RULES:
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

// ═══════════════════════════════════════════════════════════════════════════
// MEAL GENERATION (V15.4 - fixed cache extraction)
// ═══════════════════════════════════════════════════════════════════════════

async function generateMealPlan(day, formData, nutritionalTargets, log, perMealTargets) {
    const { name, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, cuisine } = formData;
    const { calories } = nutritionalTargets;

    // Build cache key with version prefix
    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets }));
    const cacheKey = `${CACHE_PREFIX}:meals:day${day}:${profileHash}`;
    
    // V15.4: Try cache with defensive extraction
    const cached = await cacheGet(cacheKey, log);
    const extraction = extractMealsFromCache(cached, log);
    
    if (extraction.valid) {
        log(`Day ${day} cache valid (${extraction.reason})`, 'DEBUG', 'CACHE');
        return { dayNumber: day, meals: extraction.meals };
    }
    
    // Cache miss or invalid - regenerate
    if (cached !== null) {
        log(`Day ${day} cache invalid (${extraction.reason}), regenerating...`, 'WARN', 'CACHE');
    }

    // Prepare LLM prompt
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
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_PRIMARY, payload, log, logPrefix);
    } catch (e) {
        log(`Primary LLM failed: ${e.message}. Retrying fallback.`, 'WARN', 'LLM');
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_FALLBACK, payload, log, logPrefix);
    }

    // V15.4: Extract meals from LLM result
    const llmExtraction = extractMealsFromCache(parsedResult, log);
    
    if (!llmExtraction.valid) {
        throw new Error(`LLM returned invalid structure for Day ${day}: ${llmExtraction.reason}`);
    }
    
    // Cache with consistent schema
    await cacheSet(cacheKey, { meals: llmExtraction.meals }, TTL_PLAN_MS, log);
    
    return { dayNumber: day, meals: llmExtraction.meals };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER (V15.4)
// ═══════════════════════════════════════════════════════════════════════════

module.exports = async (request, response) => {
    const traceId = generateTraceId();
    const log = createTracedLogger(traceId);

    if (request.method === 'OPTIONS') return response.status(200).end();
    if (request.method !== 'POST') return response.status(405).json({ error: "Method Not Allowed" });

    try {
        const { formData, nutritionalTargets } = request.body;
        const day = parseInt(request.query.day, 10) || 1;
        const store = formData.store;

        createTrace(traceId, { 
            planType: 'single-day', 
            dayNumber: day, 
            store, 
            targets: nutritionalTargets 
        });

        log(`Starting Single-Day Plan Generation for Day ${day}`, 'INFO', 'ORCHESTRATOR');

        // Calculate Per-Meal Targets
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

        // Generate Plan
        const rawDayPlan = await generateMealPlan(day, formData, nutritionalTargets, log, targetsPerMealType);

        // V15.4: PRE-PIPELINE GUARD
        if (!rawDayPlan || !Array.isArray(rawDayPlan.meals)) {
            throw new Error(`Day ${day} meals is not an array: got ${typeof rawDayPlan?.meals}`);
        }
        
        if (rawDayPlan.meals.length === 0) {
            throw new Error(`Day ${day} meals array is empty`);
        }

        // V15.4: Validate the ARRAY, not the wrapper object
        const validation = validateLLMOutput(rawDayPlan.meals, 'MEALS_ARRAY');
        if (!validation.valid) {
            log(`LLM Output validation issues: ${validation.errors.join(', ')}`, 'WARN', 'VALIDATOR');
            if (validation.correctedOutput && Array.isArray(validation.correctedOutput)) {
                rawDayPlan.meals = validation.correctedOutput;
            }
        }

        // Execute Pipeline
        const result = await executePipeline({
            rawMeals: rawDayPlan.meals,
            targets: {
                kcal: nutritionalTargets.calories,
                protein: nutritionalTargets.protein,
                fat: nutritionalTargets.fat,
                carbs: nutritionalTargets.carbs
            },
            llmRetryFn: fetchLLMWithRetry,
            config: {
                traceId,
                dayNumber: day,
                store: store,
                scaleProtein: true,
                allowReconciliation: true,
                generateRecipes: true
            }
        });

        if (result.stats) {
            recordPipelineStats(result.stats);
        }

        completeTrace(traceId, { status: 'success' });

        log(`Single-Day Plan Generation Complete for Day ${day}`, 'INFO', 'ORCHESTRATOR');

        return response.status(200).json({
            success: true,
            traceId,
            data: result.data,
            stats: result.stats
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        log(`Single-Day Plan Generation Failed: ${errorMessage}`, 'ERROR', 'ORCHESTRATOR');
        traceError(traceId, 'ORCHESTRATOR', error);

        emitAlert(ALERT_LEVELS.CRITICAL, 'single_day_failure', {
            traceId,
            error: errorMessage
        });

        completeTrace(traceId, { status: 'error', error: errorMessage });

        return response.status(500).json({
            success: false,
            traceId,
            error: errorMessage,
            stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
        });
    }
};