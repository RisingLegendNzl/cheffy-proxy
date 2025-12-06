/**
 * api/plan/generate-full-plan.js
 * 
 * Multi-Day Orchestration Wrapper with SSE Streaming
 * V16.1 - Added strict meals array validation
 * 
 * CHANGES V16.1:
 * - Added normalizeMealsArray() to guarantee array output
 * - Added validateMealsSchema() for strict schema validation
 * - Cache retrieval now validates structure before use
 * - Pipeline entry point validates rawMeals is iterable
 * - Malformed structures emit plan:error immediately
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@vercel/kv');

// --- Existing Shared Modules ---
const { executePipeline, generateTraceId, createTracedLogger } = require('../../utils/pipeline.js');
const { validateLLMOutput } = require('../../utils/llmValidator.js');
const { emitAlert, ALERT_LEVELS } = require('../../utils/alerting.js');
const { createTrace, completeTrace, traceStageStart, traceStageEnd, traceError } = require('../trace.js');
const { recordPipelineStats } = require('../metrics.js');

// --- SSE Streaming Modules ---
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
const CACHE_PREFIX = 'cheffy:plan';
const TTL_PLAN_MS = 1000 * 60 * 60 * 24;

// --- Pipeline Configuration ---
const PIPELINE_CONFIG = {
    abortOnDayError: false,
    maxDayRetries: 1,
    emitIngredientEvents: true
};

// ═══════════════════════════════════════════════════════════════════════════
// STRICT SCHEMA VALIDATION (V16.1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalizes any input into a valid meals array.
 * Handles: undefined, null, object with meals property, raw array, malformed data.
 * 
 * @param {any} input - Raw input from cache or LLM
 * @param {Function} log - Logger function
 * @returns {{ meals: Array, normalized: boolean, source: string }}
 */
function normalizeMealsArray(input, log) {
    // Case 1: null or undefined
    if (input === null || input === undefined) {
        log('WARN', 'NORMALIZE', 'Input is null/undefined, returning empty array');
        return { meals: [], normalized: true, source: 'null_input' };
    }
    
    // Case 2: Already an array
    if (Array.isArray(input)) {
        log('DEBUG', 'NORMALIZE', `Input is array with ${input.length} items`);
        return { meals: input, normalized: false, source: 'direct_array' };
    }
    
    // Case 3: Object with meals property
    if (typeof input === 'object' && input !== null) {
        // Check for meals array
        if (Array.isArray(input.meals)) {
            log('DEBUG', 'NORMALIZE', `Extracted meals array with ${input.meals.length} items`);
            return { meals: input.meals, normalized: false, source: 'object_meals_property' };
        }
        
        // Check for days array (multi-day structure)
        if (Array.isArray(input.days)) {
            const allMeals = input.days.flatMap(day => {
                if (Array.isArray(day?.meals)) return day.meals;
                if (Array.isArray(day)) return day;
                return [];
            });
            log('DEBUG', 'NORMALIZE', `Extracted ${allMeals.length} meals from days array`);
            return { meals: allMeals, normalized: true, source: 'days_array_flattened' };
        }
        
        // Check for mealPlan property
        if (Array.isArray(input.mealPlan)) {
            log('DEBUG', 'NORMALIZE', `Extracted mealPlan array with ${input.mealPlan.length} items`);
            return { meals: input.mealPlan, normalized: true, source: 'mealPlan_property' };
        }
        
        // Object exists but no recognizable meals structure
        log('WARN', 'NORMALIZE', `Object has no meals/days/mealPlan array. Keys: ${Object.keys(input).join(', ')}`);
        return { meals: [], normalized: true, source: 'object_no_meals' };
    }
    
    // Case 4: Primitive or unrecognized type
    log('ERROR', 'NORMALIZE', `Unrecognized input type: ${typeof input}`);
    return { meals: [], normalized: true, source: 'invalid_type' };
}

/**
 * Validates meals array against strict schema requirements.
 * 
 * @param {Array} meals - Meals array to validate
 * @returns {{ valid: boolean, errors: string[], meals: Array }}
 */
function validateMealsSchema(meals) {
    const errors = [];
    
    // Guard: must be array
    if (!Array.isArray(meals)) {
        return { 
            valid: false, 
            errors: ['meals is not an array'], 
            meals: [] 
        };
    }
    
    // Guard: empty array is valid but flagged
    if (meals.length === 0) {
        return { 
            valid: true, 
            errors: ['meals array is empty'], 
            meals: [] 
        };
    }
    
    const validatedMeals = [];
    
    for (let i = 0; i < meals.length; i++) {
        const meal = meals[i];
        
        // Each meal must be an object
        if (typeof meal !== 'object' || meal === null) {
            errors.push(`meals[${i}] is not an object`);
            continue;
        }
        
        // Meal must have items array
        if (!Array.isArray(meal.items)) {
            // Attempt recovery: wrap meal in items if it looks like an item
            if (meal.key && meal.qty_value !== undefined) {
                errors.push(`meals[${i}] appears to be an item, not a meal - wrapping`);
                validatedMeals.push({
                    name: `Recovered Meal ${i + 1}`,
                    type: 'meal',
                    items: [meal]
                });
                continue;
            }
            
            errors.push(`meals[${i}].items is not an array`);
            continue;
        }
        
        // Validate each item in meals
        const validatedItems = [];
        for (let j = 0; j < meal.items.length; j++) {
            const item = meal.items[j];
            
            if (typeof item !== 'object' || item === null) {
                errors.push(`meals[${i}].items[${j}] is not an object`);
                continue;
            }
            
            // Item must have key
            if (!item.key || typeof item.key !== 'string') {
                errors.push(`meals[${i}].items[${j}].key is missing or invalid`);
                continue;
            }
            
            // Item must have qty_value
            if (item.qty_value === undefined || item.qty_value === null) {
                errors.push(`meals[${i}].items[${j}].qty_value is missing`);
                continue;
            }
            
            // Normalize qty_value to number
            const qtyValue = Number(item.qty_value);
            if (isNaN(qtyValue) || qtyValue <= 0) {
                errors.push(`meals[${i}].items[${j}].qty_value is invalid: ${item.qty_value}`);
                continue;
            }
            
            validatedItems.push({
                ...item,
                key: String(item.key).toLowerCase().trim(),
                qty_value: qtyValue,
                qty_unit: item.qty_unit || 'g',
                stateHint: item.stateHint || 'raw',
                methodHint: item.methodHint || 'none'
            });
        }
        
        // Only include meals with valid items
        if (validatedItems.length > 0) {
            validatedMeals.push({
                ...meal,
                name: meal.name || `Meal ${i + 1}`,
                type: meal.type || 'meal',
                items: validatedItems
            });
        } else {
            errors.push(`meals[${i}] has no valid items after validation`);
        }
    }
    
    return {
        valid: validatedMeals.length > 0,
        errors,
        meals: validatedMeals
    };
}

/**
 * Validates and normalizes raw day plan output.
 * Combines normalization and schema validation.
 * 
 * @param {any} rawOutput - Raw output from cache or LLM
 * @param {number} dayNumber - Day number for logging
 * @param {Function} log - Logger function
 * @returns {{ valid: boolean, meals: Array, errors: string[] }}
 */
function validateAndNormalizeDayPlan(rawOutput, dayNumber, log) {
    // Step 1: Normalize to array
    const { meals: normalizedMeals, normalized, source } = normalizeMealsArray(rawOutput, log);
    
    if (normalized) {
        log('INFO', 'VALIDATE', `Day ${dayNumber}: Normalized meals from ${source}`);
    }
    
    // Step 2: Schema validation
    const validation = validateMealsSchema(normalizedMeals);
    
    if (validation.errors.length > 0) {
        log('WARN', 'VALIDATE', `Day ${dayNumber}: ${validation.errors.length} validation issues: ${validation.errors.slice(0, 3).join('; ')}`);
    }
    
    return {
        valid: validation.valid,
        meals: validation.meals,
        errors: validation.errors,
        source
    };
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
// SINGLE DAY GENERATION (V16.1 - with strict validation)
// ═══════════════════════════════════════════════════════════════════════════

async function generateMealPlan_Single(day, formData, nutritionalTargets, log, perMealTargets, sse) {
    const { name, height, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, cuisine } = formData;
    const { calories } = nutritionalTargets;

    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets, perMealTargets }));
    const cacheKey = `${CACHE_PREFIX}:meals:day${day}:${profileHash}`;
    
    // Try cache first
    const cached = await cacheGet(cacheKey, log);
    
    if (cached) {
        if (sse) sse.log('INFO', 'CACHE', `Day ${day} meals loaded from cache`);
        
        // V16.1: Validate cached data before returning
        const validation = validateAndNormalizeDayPlan(cached, day, log);
        
        if (!validation.valid) {
            log(`Cache data invalid for Day ${day}: ${validation.errors.join('; ')}`, 'WARN', 'CACHE');
            if (sse) sse.log('WARN', 'CACHE', `Day ${day} cache data invalid, regenerating...`);
            // Fall through to LLM generation
        } else {
            return { dayNumber: day, meals: validation.meals };
        }
    }

    // Generate via LLM
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

    // V16.1: Validate LLM output before caching
    const validation = validateAndNormalizeDayPlan(parsedResult, day, log);
    
    if (!validation.valid) {
        const errorMsg = `LLM output invalid for Day ${day}: ${validation.errors.slice(0, 3).join('; ')}`;
        log(errorMsg, 'ERROR', 'LLM');
        throw new Error(errorMsg);
    }
    
    // Cache validated result
    if (validation.meals.length > 0) {
        await cacheSet(cacheKey, { meals: validation.meals }, TTL_PLAN_MS, log);
    }
    
    return { dayNumber: day, meals: validation.meals };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER (V16.1)
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
                sse.log('INFO', 'LLM', `Day ${day}: Generating meal plan...`);
                const rawDayPlan = await generateMealPlan_Single(
                    day, formData, nutritionalTargets, log, targetsPerMealType, sse
                );

                // V16.1: Double-check meals is valid array before proceeding
                if (!rawDayPlan || !Array.isArray(rawDayPlan.meals)) {
                    throw new Error(`Day ${day} returned invalid structure: meals is not an array`);
                }
                
                if (rawDayPlan.meals.length === 0) {
                    throw new Error(`Day ${day} returned empty meals array`);
                }

                // Legacy validator (optional, for logging)
                const validation = validateLLMOutput(rawDayPlan, 'MEALS_ARRAY');
                if (!validation.valid) {
                    log(`Day ${day} LLM Output validation: ${validation.corrected ? 'auto-corrected' : 'issues found'}`, 'WARN', 'VALIDATOR');
                    sse.log('WARN', 'VALIDATOR', `Day ${day}: LLM output validated`);
                }

                sse.log('INFO', 'PIPELINE', `Day ${day}: Processing nutrition and macros...`);
                
                // V16.1: Final guard before pipeline
                const mealsForPipeline = rawDayPlan.meals;
                if (!Array.isArray(mealsForPipeline)) {
                    throw new Error(`Pre-pipeline check failed: meals is ${typeof mealsForPipeline}, not array`);
                }
                
                const processedDayResult = await executePipeline({
                    rawMeals: mealsForPipeline,
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

                processedDays.push(processedDayResult.data);
                if (processedDayResult.stats) allStats.push(processedDayResult.stats);
                
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