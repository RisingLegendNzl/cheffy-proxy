/**
 * api/plan/day.js
 * 
 * Single-Day Meal Plan Generation Endpoint
 * V15.6 - Added output validation before response
 * 
 * CHANGES V15.6:
 * - Added validateOutputBeforeSend() to ensure frontend receives valid data
 * - Output validation before response.json()
 * - Compatible with pipeline V3.3 (macro enhancement + sanitization)
 * 
 * CHANGES V15.5:
 * - extractMealsFromCache now validates every meal has items array
 * - Prevents "meal.items is not iterable" error from malformed cache entries
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
const { executePipeline, generateTraceId, createTracedLogger, sanitizeNumber } = require('../../utils/pipeline.js');
const { validateLLMOutput } = require('../../utils/llmValidator.js');
const { emitAlert, ALERT_LEVELS } = require('../../utils/alerting.js');
const { createTrace, completeTrace, traceStageStart, traceStageEnd, traceError } = require('../trace.js');
const { recordPipelineStats } = require('../metrics.js');

// --- Error Handling ---
const { PipelineError } = require('../../utils/errors.js');
const { ERROR_CODES, getErrorCode, getSafeErrorMessage } = require('../../utils/sseHelper.js');

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
// V15.5: Bumped version to invalidate stale cache with old schema
const CACHE_VERSION = 'v3';
const CACHE_PREFIX = `cheffy:plan:${CACHE_VERSION}`;
const TTL_PLAN_MS = 1000 * 60 * 60 * 24; // 24 hours

// ═══════════════════════════════════════════════════════════════════════════
// V15.5: CACHE EXTRACTION HELPER - Validates ALL meals
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates that a single meal object has required structure
 * @param {any} meal - Meal object to validate
 * @param {number} index - Index for logging
 * @returns {Object} { valid: boolean, reason: string }
 */
function validateSingleMeal(meal, index) {
    if (!meal) {
        return { valid: false, reason: `meal_${index}_is_null_or_undefined` };
    }
    if (typeof meal !== 'object') {
        return { valid: false, reason: `meal_${index}_is_not_object` };
    }
    if (!Array.isArray(meal.items)) {
        return { valid: false, reason: `meal_${index}_items_is_not_array` };
    }
    if (meal.items.length === 0) {
        return { valid: false, reason: `meal_${index}_items_is_empty` };
    }
    return { valid: true, reason: 'valid' };
}

/**
 * Safely extracts meals array from cached data regardless of schema version.
 * V15.5: Now validates ALL meals, not just the first one.
 * 
 * Handles:
 * - Old format: raw array [{ name, type, items }]
 * - New format: { meals: [...] }
 * - LLM format: { dayNumber, meals: [...] }
 * - Invalid/corrupt: returns { valid: false }
 * 
 * @param {any} cached - Raw value from KV cache
 * @param {Function} log - Logger function
 * @returns {{ valid: boolean, meals: Array, reason: string, invalidMeals: Array }}
 */
function extractMealsFromCache(cached, log) {
    // Case 1: null/undefined - cache miss
    if (cached === null || cached === undefined) {
        return { valid: false, meals: [], reason: 'cache_miss', invalidMeals: [] };
    }
    
    let mealsArray = null;
    let formatReason = '';
    
    // Case 2: Direct array (OLD schema - pre-V15.4)
    if (Array.isArray(cached)) {
        mealsArray = cached;
        formatReason = 'legacy_direct_array';
    }
    // Case 3: Object wrapper with meals property
    else if (typeof cached === 'object' && Array.isArray(cached.meals)) {
        mealsArray = cached.meals;
        formatReason = 'standard_object';
    }
    // Case 4: Unexpected structure
    else {
        const keys = typeof cached === 'object' ? Object.keys(cached).slice(0, 5).join(', ') : 'N/A';
        log(`Cache object has unexpected structure. Keys: [${keys}]`, 'WARN', 'CACHE');
        return { valid: false, meals: [], reason: 'invalid_structure', invalidMeals: [] };
    }
    
    // Validate we have an array with at least one element
    if (mealsArray.length === 0) {
        log(`Cache meals array is empty`, 'WARN', 'CACHE');
        return { valid: false, meals: [], reason: 'meals_empty', invalidMeals: [] };
    }
    
    // V15.5: Validate ALL meals, not just first one
    const invalidMeals = [];
    for (let i = 0; i < mealsArray.length; i++) {
        const validation = validateSingleMeal(mealsArray[i], i);
        if (!validation.valid) {
            invalidMeals.push({
                index: i,
                mealName: mealsArray[i]?.name || mealsArray[i]?.type || `meal_${i}`,
                reason: validation.reason
            });
        }
    }
    
    if (invalidMeals.length > 0) {
        log(`Cache contains ${invalidMeals.length} invalid meals: ${invalidMeals.map(m => m.reason).join(', ')}`, 'WARN', 'CACHE');
        return { 
            valid: false, 
            meals: [], 
            reason: 'some_meals_invalid', 
            invalidMeals 
        };
    }
    
    // All meals valid
    log(`Cache valid (${formatReason}), ${mealsArray.length} meals`, 'DEBUG', 'CACHE');
    return { valid: true, meals: mealsArray, reason: formatReason, invalidMeals: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// V15.6: OUTPUT VALIDATION - Ensure frontend receives valid data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates a single item has all required fields for frontend
 * @param {Object} item - Item to validate
 * @returns {Object} { valid: boolean, issues: Array }
 */
function validateItemForFrontend(item) {
    const issues = [];
    
    if (!item || typeof item !== 'object') {
        return { valid: false, issues: ['item_is_null_or_not_object'] };
    }
    
    // Required fields
    if (!item.key || typeof item.key !== 'string') {
        issues.push('missing_or_invalid_key');
    }
    
    if (typeof item.qty_value !== 'number' || isNaN(item.qty_value)) {
        issues.push('missing_or_invalid_qty_value');
    }
    
    // Macro fields - must be numbers (0 is valid)
    if (typeof item.kcal !== 'number' || isNaN(item.kcal)) {
        issues.push('missing_or_invalid_kcal');
    }
    
    if (typeof item.protein !== 'number' || isNaN(item.protein)) {
        issues.push('missing_or_invalid_protein');
    }
    
    if (typeof item.fat !== 'number' || isNaN(item.fat)) {
        issues.push('missing_or_invalid_fat');
    }
    
    if (typeof item.carbs !== 'number' || isNaN(item.carbs)) {
        issues.push('missing_or_invalid_carbs');
    }
    
    return { valid: issues.length === 0, issues };
}

/**
 * Validates output data before sending to frontend (single day version)
 * @param {Object} dayData - Day data object with meals
 * @param {Function} log - Logger function
 * @returns {Object} { valid: boolean, stats: Object, issues: Array }
 */
function validateOutputBeforeSend(dayData, log) {
    const stats = {
        totalMeals: 0,
        totalItems: 0,
        itemsWithMacros: 0,
        itemsWithIssues: 0
    };
    const issues = [];
    
    if (!dayData || typeof dayData !== 'object') {
        return { valid: false, stats, issues: ['dayData_is_null_or_not_object'] };
    }
    
    const meals = dayData.meals || [];
    if (!Array.isArray(meals)) {
        return { valid: false, stats, issues: ['meals_is_not_array'] };
    }
    
    for (let mealIndex = 0; mealIndex < meals.length; mealIndex++) {
        const meal = meals[mealIndex];
        stats.totalMeals++;
        
        if (!meal || typeof meal !== 'object') {
            issues.push(`meal_${mealIndex}_is_null`);
            continue;
        }
        
        const items = meal.items || [];
        if (!Array.isArray(items)) {
            issues.push(`meal_${mealIndex}_items_is_not_array`);
            continue;
        }
        
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            stats.totalItems++;
            
            const itemValidation = validateItemForFrontend(item);
            if (itemValidation.valid) {
                stats.itemsWithMacros++;
            } else {
                stats.itemsWithIssues++;
                // Only log first few issues to avoid spam
                if (issues.length < 10) {
                    issues.push(`meal_${mealIndex}_item_${itemIndex}: ${itemValidation.issues.join(', ')}`);
                }
            }
        }
    }
    
    const valid = stats.totalItems > 0 && stats.itemsWithIssues === 0;
    
    log('info', 'Output validation complete', {
        valid,
        ...stats,
        issueCount: issues.length
    });
    
    return { valid, stats, issues };
}

/**
 * Repairs items that are missing macros by setting defaults
 * @param {Object} dayData - Day data object with meals
 * @param {Function} log - Logger function
 * @returns {Object} Repaired day data
 */
function repairOutputIfNeeded(dayData, log) {
    if (!dayData || typeof dayData !== 'object') {
        return dayData;
    }
    
    const meals = dayData.meals || [];
    if (!Array.isArray(meals)) {
        return dayData;
    }
    
    let repairCount = 0;
    
    const repairedMeals = meals.map(meal => {
        if (!meal || typeof meal !== 'object') return meal;
        
        const items = meal.items || [];
        if (!Array.isArray(items)) return meal;
        
        const repairedItems = items.map(item => {
            if (!item || typeof item !== 'object') return item;
            
            let needsRepair = false;
            
            // Check if macros are missing or invalid
            if (typeof item.kcal !== 'number' || isNaN(item.kcal)) needsRepair = true;
            if (typeof item.protein !== 'number' || isNaN(item.protein)) needsRepair = true;
            if (typeof item.fat !== 'number' || isNaN(item.fat)) needsRepair = true;
            if (typeof item.carbs !== 'number' || isNaN(item.carbs)) needsRepair = true;
            
            if (needsRepair) {
                repairCount++;
                return {
                    ...item,
                    kcal: sanitizeNumber(item.kcal, 0),
                    protein: sanitizeNumber(item.protein, 0),
                    fat: sanitizeNumber(item.fat, 0),
                    carbs: sanitizeNumber(item.carbs, 0),
                    _repaired: true
                };
            }
            
            return item;
        });
        
        return { ...meal, items: repairedItems };
    });
    
    if (repairCount > 0) {
        log('warning', 'Repaired items with missing macros', { repairCount });
    }
    
    return { ...dayData, meals: repairedMeals };
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
// SINGLE DAY GENERATION (V15.5 - fixed cache extraction)
// ═══════════════════════════════════════════════════════════════════════════

async function generateMealPlan(day, formData, nutritionalTargets, log, perMealTargets) {
    const { name, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, cuisine } = formData;
    const { calories } = nutritionalTargets;

    // Build cache key with version prefix
    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets }));
    const cacheKey = `${CACHE_PREFIX}:meals:day${day}:${profileHash}`;
    
    // V15.5: Try cache with defensive extraction that validates ALL meals
    const cached = await cacheGet(cacheKey, log);
    const extraction = extractMealsFromCache(cached, log);
    
    if (extraction.valid) {
        log(`Day ${day} cache valid (${extraction.reason})`, 'DEBUG', 'CACHE');
        return { dayNumber: day, meals: extraction.meals };
    }
    
    // Cache miss or invalid - regenerate via LLM
    if (cached !== null) {
        log(`Day ${day} cache invalid (${extraction.reason}), regenerating...`, 'WARN', 'CACHE');
        
        // Log which meals were invalid
        if (extraction.invalidMeals && extraction.invalidMeals.length > 0) {
            log(`Invalid meals: ${JSON.stringify(extraction.invalidMeals)}`, 'DEBUG', 'CACHE');
        }
    }

    // Prepare Targets
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

    // V15.5: Extract and validate meals from LLM result
    const llmExtraction = extractMealsFromCache(parsedResult, log);
    
    if (!llmExtraction.valid) {
        throw new Error(`LLM returned invalid structure for Day ${day}: ${llmExtraction.reason}`);
    }
    
    // Cache with consistent schema
    await cacheSet(cacheKey, { meals: llmExtraction.meals }, TTL_PLAN_MS, log);
    
    return { dayNumber: day, meals: llmExtraction.meals };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER (V15.6)
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
    
    try {
        const { formData, nutritionalTargets, dayNumber = 1 } = request.body;
        
        if (!formData || !nutritionalTargets) {
            return response.status(400).json({
                success: false,
                error: 'Missing formData or nutritionalTargets in request body',
                code: ERROR_CODES.UNKNOWN_ERROR,
                traceId
            });
        }
        
        const store = formData.store;
        const day = parseInt(dayNumber, 10) || 1;

        createTrace(traceId, { 
            planType: 'single-day', 
            dayNumber: day,
            store, 
            targets: nutritionalTargets 
        });

        log('info', 'Starting Single-Day Plan Generation', { day, store });

        // Calculate per-meal targets
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

        traceStageStart(traceId, `Day_${day}_Generation`);

        // A. Generate Meals (with cache extraction fix)
        log('info', `Day ${day}: Generating meal plan...`, {}, 'LLM');
        const rawDayPlan = await generateMealPlan(
            day, formData, nutritionalTargets, log, targetsPerMealType
        );

        // V15.5: PRE-PIPELINE GUARD - Ensure meals is array before any processing
        if (!rawDayPlan || !Array.isArray(rawDayPlan.meals)) {
            throw new PipelineError(
                ERROR_CODES.PIPELINE_EXECUTION_FAILED,
                `Day ${day} meals is not an array: got ${typeof rawDayPlan?.meals}`,
                { stage: 'pre_pipeline_guard', traceId, dayNumber: day }
            );
        }
        
        if (rawDayPlan.meals.length === 0) {
            throw new PipelineError(
                ERROR_CODES.PIPELINE_EXECUTION_FAILED,
                `Day ${day} meals array is empty`,
                { stage: 'pre_pipeline_guard', traceId, dayNumber: day }
            );
        }

        // B. Validate LLM Output (now validates the ARRAY, not wrapper object)
        const validation = validateLLMOutput(rawDayPlan.meals, 'MEALS_ARRAY');
        if (!validation.valid) {
            log('warning', `Day ${day} LLM Output validation issues`, { errors: validation.errors });
            // Apply corrections if available
            if (validation.correctedOutput && Array.isArray(validation.correctedOutput)) {
                rawDayPlan.meals = validation.correctedOutput;
            }
        }

        // C. Execute Pipeline (V3.3 - includes macro enhancement + sanitization)
        log('info', `Day ${day}: Processing nutrition and macros...`, {}, 'PIPELINE');
        
        const processedDayResult = await executePipeline({
            rawMeals: rawDayPlan.meals,
            targets: {
                kcal: nutritionalTargets.calories,
                protein: nutritionalTargets.protein,
                fat: nutritionalTargets.fat,
                carbs: nutritionalTargets.carbs
            },
            llmRetryFn: null, // No retry for single-day endpoint
            config: {
                traceId,
                dayNumber: day,
                store: store,
                scaleProtein: true,
                allowReconciliation: true,
                generateRecipes: true
            }
        });

        traceStageEnd(traceId, `Day_${day}_Generation`);

        // Collect unique ingredients
        const uniqueIngredientsMap = new Map();
        if (processedDayResult.data?.meals) {
            processedDayResult.data.meals.forEach(meal => {
                if (meal && Array.isArray(meal.items)) {
                    meal.items.forEach(item => {
                        if (item && item.key) {
                            const normalizedKey = item.key.toLowerCase().trim();
                            if (!uniqueIngredientsMap.has(normalizedKey)) {
                                uniqueIngredientsMap.set(normalizedKey, {
                                    originalIngredient: item.key,
                                    normalizedKey
                                });
                            }
                        }
                    });
                }
            });
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // V15.6: OUTPUT VALIDATION - Ensure frontend receives valid data
        // ═══════════════════════════════════════════════════════════════════════════
        let outputData = processedDayResult.data;
        const outputValidation = validateOutputBeforeSend(outputData, log);
        
        if (!outputValidation.valid) {
            log('warning', 'Output validation found issues, attempting repair', {
                issues: outputValidation.issues.slice(0, 5),
                stats: outputValidation.stats
            });
            
            // Attempt to repair
            outputData = repairOutputIfNeeded(outputData, log);
            
            // Re-validate after repair
            const revalidation = validateOutputBeforeSend(outputData, log);
            
            if (!revalidation.valid && revalidation.stats.totalItems === 0) {
                throw new PipelineError(
                    ERROR_CODES.PIPELINE_EXECUTION_FAILED,
                    'Output validation failed: No valid items in response',
                    {
                        traceId,
                        stage: 'output_validation',
                        dayNumber: day,
                        context: { 
                            stats: revalidation.stats,
                            issues: revalidation.issues.slice(0, 10)
                        }
                    }
                );
            }
        }
        
        log('info', 'Output validation passed', { stats: outputValidation.stats });
        // ═══════════════════════════════════════════════════════════════════════════

        // Record stats
        if (processedDayResult.stats) {
            await recordPipelineStats(traceId, [processedDayResult.stats], log);
        }

        completeTrace(traceId, { 
            status: 'success',
            dayNumber: day
        });

        log('info', 'Single-Day Plan Generation Complete', { day });

        const uniqueIngredients = Array.from(uniqueIngredientsMap.values());

        return response.status(200).json({
            success: true,
            traceId,
            dayNumber: day,
            meals: outputData.meals || [],
            dayTotals: outputData.dayTotals || {},
            validation: outputData.validation || {},
            uniqueIngredients,
            stats: {
                outputValidation: outputValidation.stats
            },
            macroDebug: processedDayResult.stats ? [processedDayResult.stats] : []
        });

    } catch (error) {
        const pipelineError = PipelineError.from(error, { traceId, stage: 'day_handler' });
        
        log('error', 'Single-Day Plan Generation Failed', { error: pipelineError.message });
        traceError(traceId, 'DAY_HANDLER', pipelineError);

        emitAlert(ALERT_LEVELS.CRITICAL, 'day_pipeline_failure', {
            traceId,
            error: pipelineError.message,
            code: pipelineError.code
        });

        completeTrace(traceId, { 
            status: 'error', 
            error: pipelineError.message 
        });

        return response.status(500).json({
            success: false,
            traceId,
            error: pipelineError.message,
            code: pipelineError.code,
            stage: pipelineError.stage
        });
    }
};