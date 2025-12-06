/**
 * api/plan/generate-full-plan.js
 * 
 * Multi-Day Orchestration Wrapper with SSE Streaming
 * V16.3 - Fixed "meals is not iterable" bug from stale cache schema
 * 
 * CHANGES V16.3:
 * - Added extractMealsFromCache() to handle old/new cache formats
 * - Cache validation: invalid cache falls through to LLM regeneration
 * - Fixed validator call: now validates meals array, not wrapper object
 * - Added pre-pipeline guard: explicit Array.isArray check before executePipeline
 * - Bumped CACHE_VERSION to invalidate old cache entries
 * 
 * ROOT CAUSE FIXED:
 * Old cache stored raw array: [{ name, items }]
 * New code expected: { meals: [...] }
 * Result: cached.meals → undefined → "meals is not iterable"
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@vercel/kv');

// --- Shared Modules ---
const { executePipeline, generateTraceId, createTracedLogger } = require('../../utils/pipeline.js');
const { validateLLMOutput } = require('../../utils/llmValidator.js');
const { emitAlert, ALERT_LEVELS } = require('../../utils/alerting.js');
const { createTrace, completeTrace, traceStageStart, traceStageEnd, traceError } = require('../trace.js');
const { recordPipelineStats } = require('../metrics.js');

// --- SSE Streaming ---
const { createSSEStream, ERROR_CODES, getErrorCode, getSafeErrorMessage } = require('../../utils/sseHelper.js');
const { PipelineError, DayGenerationError } = require('../../utils/errors.js');

// --- Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PLAN_MODEL_NAME_PRIMARY = 'gemini-2.0-flash';
const PLAN_MODEL_NAME_FALLBACK = 'gemini-2.5-flash';

const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// --- Cache Configuration ---
// V16.3: Bumped version to invalidate stale cache with old schema
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = `cheffy:plan:${CACHE_VERSION}`;
const TTL_PLAN_MS = 1000 * 60 * 60 * 24; // 24 hours

// --- Pipeline Configuration ---
const PIPELINE_CONFIG = {
    abortOnDayError: false,
    maxDayRetries: 1,
    emitIngredientEvents: true
};

// ═══════════════════════════════════════════════════════════════════════════
// V16.3: CACHE EXTRACTION HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely extracts meals array from cached data regardless of schema version.
 * 
 * Handles:
 * - Old format: raw array [{ name, type, items }]
 * - New format: { meals: [...] }
 * - LLM format: { dayNumber, meals: [...] }
 * - Invalid/corrupt: returns { valid: false }
 * 
 * @param {any} cached - Raw value from KV cache
 * @param {Function} log - Logger function
 * @returns {{ valid: boolean, meals: Array, reason: string }}
 */
function extractMealsFromCache(cached, log) {
    // Case 1: null/undefined - cache miss
    if (cached === null || cached === undefined) {
        return { valid: false, meals: [], reason: 'cache_miss' };
    }
    
    // Case 2: Direct array (OLD schema - pre-V16.3)
    if (Array.isArray(cached)) {
        // Validate structure: must have at least one meal with items array
        if (cached.length > 0 && Array.isArray(cached[0]?.items)) {
            log(`Cache contains legacy direct array format`, 'DEBUG', 'CACHE');
            return { valid: true, meals: cached, reason: 'legacy_direct_array' };
        }
        log(`Cache array invalid: missing items property`, 'WARN', 'CACHE');
        return { valid: false, meals: [], reason: 'array_missing_items' };
    }
    
    // Case 3: Object wrapper
    if (typeof cached === 'object') {
        // Standard format: { meals: [...] }
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
        
        // Object exists but no meals property
        const keys = Object.keys(cached).slice(0, 5).join(', ');
        log(`Cache object has no meals array. Keys: [${keys}]`, 'WARN', 'CACHE');
        return { valid: false, meals: [], reason: 'object_no_meals' };
    }
    
    // Case 4: Unexpected type
    log(`Cache contains unexpected type: ${typeof cached}`, 'ERROR', 'CACHE');
    return { valid: false, meals: [], reason: 'invalid_type' };
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function cacheGet(key, log) {
    if (!kvReady) return null;
    try {
        const val = await kv.get(key);
        if (val) log(`Cache HIT: ${key}`, 'INFO', 'CACHE');
        return val;
    } catch (e) {
        log(`Cache GET error: ${e.message}`, 'WARN', 'CACHE');
        return null;
    }
}

async function cacheSet(key, value, ttl, log) {
    if (!kvReady) return;
    try {
        await kv.set(key, value, { px: ttl });
        log(`Cache SET: ${key}`, 'DEBUG', 'CACHE');
    } catch (e) {
        log(`Cache SET error: ${e.message}`, 'WARN', 'CACHE');
    }
}

function hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchLLMWithRetry(payload, log, attempt = 1, maxAttempts = 3) {
    const modelName = attempt <= 2 ? PLAN_MODEL_NAME_PRIMARY : PLAN_MODEL_NAME_FALLBACK;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LLM API error (${response.status}): ${errorText.substring(0, 200)}`);
        }
        
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) {
            throw new Error('Empty response from LLM');
        }
        
        return JSON.parse(text);
    } catch (e) {
        log(`LLM attempt ${attempt} failed: ${e.message}`, 'WARN', 'LLM');
        
        if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
            return fetchLLMWithRetry(payload, log, attempt + 1, maxAttempts);
        }
        
        throw e;
    }
}

async function tryGenerateLLMPlan(modelName, payload, log, logPrefix) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    
    log(`${logPrefix}: Calling ${modelName}`, 'INFO', 'LLM');
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${modelName} API error (${response.status}): ${errorText.substring(0, 200)}`);
    }
    
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
// SINGLE DAY GENERATION (V16.3 - fixed cache extraction)
// ═══════════════════════════════════════════════════════════════════════════

async function generateMealPlan_Single(day, formData, nutritionalTargets, log, perMealTargets, sse = null) {
    const { name, height, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, cuisine } = formData;
    const { calories } = nutritionalTargets;

    // Build cache key with version prefix
    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets, perMealTargets }));
    const cacheKey = `${CACHE_PREFIX}:meals:day${day}:${profileHash}`;
    
    // V16.3: Try cache with defensive extraction
    const cached = await cacheGet(cacheKey, log);
    const extraction = extractMealsFromCache(cached, log);
    
    if (extraction.valid) {
        if (sse) sse.log('INFO', 'CACHE', `Day ${day} meals loaded from cache`);
        log(`Day ${day} cache valid (${extraction.reason})`, 'DEBUG', 'CACHE');
        return { dayNumber: day, meals: extraction.meals };
    }
    
    // Cache miss or invalid - regenerate via LLM
    if (cached !== null) {
        log(`Day ${day} cache invalid (${extraction.reason}), regenerating...`, 'WARN', 'CACHE');
        if (sse) sse.log('WARN', 'CACHE', `Day ${day} cache stale, regenerating...`);
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
    if (sse) sse.log('INFO', 'LLM', `Generating meal plan for Day ${day}...`);

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
        if (sse) sse.log('WARN', 'LLM', `Primary model failed, trying fallback...`);
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_FALLBACK, payload, log, logPrefix);
    }

    // V16.3: Extract meals from LLM result (handles { dayNumber, meals } wrapper)
    const llmExtraction = extractMealsFromCache(parsedResult, log);
    
    if (!llmExtraction.valid) {
        throw new Error(`LLM returned invalid structure for Day ${day}: ${llmExtraction.reason}`);
    }
    
    // Cache with consistent schema
    await cacheSet(cacheKey, { meals: llmExtraction.meals }, TTL_PLAN_MS, log);
    
    return { dayNumber: day, meals: llmExtraction.meals };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER (V16.3)
// ═══════════════════════════════════════════════════════════════════════════

module.exports = async (request, response) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS');
        return response.status(405).json({ error: "Method Not Allowed" });
    }

    const traceId = generateTraceId();
    const log = createTracedLogger(traceId);
    const sse = createSSEStream(response, traceId);
    
    let terminalEventSent = false;
    
    try {
        const { formData, nutritionalTargets } = request.body;
        
        if (!formData || !nutritionalTargets) {
            throw new PipelineError(
                ERROR_CODES.UNKNOWN_ERROR,
                'Missing formData or nutritionalTargets in request body',
                { stage: 'request_validation', traceId }
            );
        }
        
        const numDays = parseInt(formData.days, 10) || 7;
        const store = formData.store;

        createTrace(traceId, { 
            planType: 'multi-day', 
            dayCount: numDays, 
            store, 
            targets: nutritionalTargets 
        });

        log(`Starting Multi-Day Plan Generation for ${numDays} days`, 'INFO', 'ORCHESTRATOR');
        sse.log('INFO', 'ORCHESTRATOR', `Starting plan generation for ${numDays} days`);
        
        sse.phaseStart('initialization', 'Calculating nutritional targets...');

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

        sse.phaseEnd('initialization', { targetsPerMealType });

        const processedDays = [];
        const allStats = [];
        const failedDays = [];
        const allResults = {};
        const uniqueIngredientsMap = new Map();

        sse.phaseStart('day_generation', `Processing ${numDays} days...`);
        
        for (let day = 1; day <= numDays; day++) {
            sse.dayStart(day, numDays);
            traceStageStart(traceId, `Day_${day}_Processing`);
            
            try {
                // A. Generate Meals (with cache extraction fix)
                sse.log('INFO', 'LLM', `Day ${day}: Generating meal plan...`);
                const rawDayPlan = await generateMealPlan_Single(
                    day, formData, nutritionalTargets, log, targetsPerMealType, sse
                );

                // V16.3: PRE-PIPELINE GUARD - Ensure meals is array before any processing
                if (!rawDayPlan || !Array.isArray(rawDayPlan.meals)) {
                    throw new Error(`Day ${day} meals is not an array: got ${typeof rawDayPlan?.meals}`);
                }
                
                if (rawDayPlan.meals.length === 0) {
                    throw new Error(`Day ${day} meals array is empty`);
                }

                // B. Validate LLM Output (now validates the ARRAY, not wrapper object)
                const validation = validateLLMOutput(rawDayPlan.meals, 'MEALS_ARRAY');
                if (!validation.valid) {
                    log(`Day ${day} LLM Output validation issues: ${validation.errors.join(', ')}`, 'WARN', 'VALIDATOR');
                    sse.log('WARN', 'VALIDATOR', `Day ${day}: LLM output validated with corrections`);
                    // Apply corrections if available
                    if (validation.correctedOutput && Array.isArray(validation.correctedOutput)) {
                        rawDayPlan.meals = validation.correctedOutput;
                    }
                }

                // C. Execute Pipeline
                sse.log('INFO', 'PIPELINE', `Day ${day}: Processing nutrition and macros...`);
                
                const processedDayResult = await executePipeline({
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
                    },
                    onIngredientFound: PIPELINE_CONFIG.emitIngredientEvents 
                        ? (key, data) => sse.ingredientFound(key, data)
                        : null,
                    onIngredientFailed: PIPELINE_CONFIG.emitIngredientEvents
                        ? (key, error) => sse.ingredientFailed(key, error)
                        : null,
                    onIngredientFlagged: PIPELINE_CONFIG.emitIngredientEvents
                        ? (key, reason) => sse.ingredientFlagged(key, reason)
                        : null,
                    onInvariantWarning: (id, data) => sse.invariantWarning(id, data),
                    onValidationWarning: (msg, data) => sse.validationWarning(msg, data)
                });

                processedDays.push(processedDayResult.data);
                if (processedDayResult.stats) allStats.push(processedDayResult.stats);
                
                // Collect unique ingredients
                if (processedDayResult.data?.meals) {
                    processedDayResult.data.meals.forEach(meal => {
                        meal.items?.forEach(item => {
                            if (item.key) {
                                const normalizedKey = item.key.toLowerCase().trim();
                                if (!uniqueIngredientsMap.has(normalizedKey)) {
                                    uniqueIngredientsMap.set(normalizedKey, {
                                        originalIngredient: item.key,
                                        normalizedKey
                                    });
                                }
                            }
                        });
                    });
                }

                traceStageEnd(traceId, `Day_${day}_Processing`);
                sse.dayComplete(day, processedDayResult.data);
                sse.log('SUCCESS', 'ORCHESTRATOR', `Day ${day} completed successfully`);
                
            } catch (dayError) {
                const errorCode = getErrorCode(dayError);
                const errorMessage = getSafeErrorMessage(dayError);
                
                log(`Day ${day} failed: ${errorMessage}`, 'ERROR', 'ORCHESTRATOR');
                traceError(traceId, `Day_${day}_Processing`, dayError);
                
                if (dayError.name === 'InvariantViolationError') {
                    sse.invariantViolation(dayError.invariantId, {
                        message: errorMessage,
                        context: dayError.context
                    });
                }
                
                sse.dayError(day, errorCode, errorMessage, !PIPELINE_CONFIG.abortOnDayError);
                failedDays.push({ day, error: errorMessage, code: errorCode });
                
                if (PIPELINE_CONFIG.abortOnDayError) {
                    throw new DayGenerationError(day, errorMessage, dayError);
                }
                
                sse.log('WARN', 'ORCHESTRATOR', `Day ${day} failed, continuing to next day...`);
            }
        }
        
        sse.phaseEnd('day_generation', { 
            successfulDays: processedDays.length,
            failedDays: failedDays.length
        });

        if (processedDays.length === 0) {
            throw new PipelineError(
                ERROR_CODES.PIPELINE_EXECUTION_FAILED,
                'All days failed to generate. No plan data available.',
                {
                    traceId,
                    stage: 'day_generation',
                    context: { failedDays }
                }
            );
        }

        completeTrace(traceId, { 
            status: processedDays.length === numDays ? 'success' : 'partial',
            daysGenerated: processedDays.length,
            daysFailed: failedDays.length
        });

        if (allStats.length > 0) {
            await recordPipelineStats(traceId, allStats, log);
        }

        log(`Multi-Day Plan Generation Complete: ${processedDays.length}/${numDays} days`, 'INFO', 'ORCHESTRATOR');

        const mealPlan = processedDays.map(dayData => dayData?.meals || []).flat();
        const uniqueIngredients = Array.from(uniqueIngredientsMap.values());
        
        terminalEventSent = true;
        sse.complete({
            success: true,
            traceId,
            mealPlan,
            results: allResults,
            uniqueIngredients,
            days: processedDays,
            stats: {
                totalDays: numDays,
                successfulDays: processedDays.length,
                failedDays: failedDays.length,
                failedDayDetails: failedDays
            },
            macroDebug: allStats
        });

    } catch (error) {
        const pipelineError = PipelineError.from(error, { traceId, stage: 'orchestrator' });
        
        log(`Multi-Day Plan Generation Failed: ${pipelineError.message}`, 'ERROR', 'ORCHESTRATOR');
        traceError(traceId, 'ORCHESTRATOR', pipelineError);

        emitAlert(ALERT_LEVELS.CRITICAL, 'pipeline_failure', {
            traceId,
            error: pipelineError.message,
            code: pipelineError.code
        });

        completeTrace(traceId, { 
            status: 'error', 
            error: pipelineError.message 
        });

        terminalEventSent = true;
        sse.error(
            pipelineError.code,
            pipelineError.message,
            {
                stage: pipelineError.stage,
                context: pipelineError.context
            }
        );
        
    } finally {
        if (!terminalEventSent && !sse.isTerminated()) {
            log('Handler exiting without terminal event - sending fallback error', 'ERROR', 'ORCHESTRATOR');
            sse.error(
                ERROR_CODES.HANDLER_CRASHED,
                'Plan generation terminated unexpectedly',
                { stage: 'finally_block' }
            );
        }
        
        if (!sse.isClosed()) {
            sse.close();
        }
    }
};