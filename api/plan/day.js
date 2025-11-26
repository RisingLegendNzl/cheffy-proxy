// --- Cheffy API: /api/plan/day.js ---
// [MODIFIED V12.2] Switched all imports to CommonJS (require) to fix module errors.
// Implements a "Four-Agent" AI system + Deterministic Calorie Calculation

/// ===== IMPORTS-START ===== \\\\
const fetch = require('node-fetch');
const crypto = require('crypto'); // For run_id and hashing
// --- [NEW] Import Vercel KV client ---
const { createClient } = require('@vercel/kv');
// Import cache-wrapped microservices
const { fetchPriceData } = require('../price-search.js'); // Relative path (api/price-search.js) - This is CORRECT
const { fetchNutritionData } = require('../nutrition-search.js'); // Relative path (api/nutrition-search.js) - This is CORRECT

// --- [FIX] Corrected relative paths for Vercel bundling ---
// These files are at the root of the /var/task/ bundle, so we go up two levels.
const { reconcileNonProtein } = require('../../utils/reconcileNonProtein.js');
const { normalizeKey } = require('../../scripts/normalize.js');
const { toAsSold, getAbsorbedOil, TRANSFORM_VERSION, normalizeToGramsOrMl } = require('../../utils/transforms.js');
// --- [END FIX] ---

// --- [NEW] Import validation helper (Task 1) ---
const { validateDayPlan } = require('../../utils/validation');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---
/// ===== CONFIG-START ===== \\\\
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use TRANSFORM_VERSION imported from transforms.js
const TRANSFORM_CONFIG_VERSION = TRANSFORM_VERSION || 'v12.2-commonjs'; // Use updated version

// --- Using gemini-2.5-flash as the primary model ---
const PLAN_MODEL_NAME_PRIMARY = 'gemini-2.5-flash';
// --- Using gemini-2.5-pro as the fallback ---
const PLAN_MODEL_NAME_FALLBACK = 'gemini-2.5-pro'; // Fallback model

// --- Create a function to get the URL ---
const getGeminiApiUrl = (modelName) => `https://generativelanguage
.googleapis.com/v1beta/models/${modelName}:generateContent`;

// --- [NEW] Vercel KV Client ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
// [MODIFIED] Bump cache version to account for new transforms
const CACHE_PREFIX = `cheffy:plan:v2:t:${TRANSFORM_CONFIG_VERSION}`;
const TTL_PLAN_MS = 1000 * 60 * 60 * 24; // 24 hours

const MAX_LLM_RETRIES = 3; // Retries specifically for the LLM call
const LLM_REQUEST_TIMEOUT_MS = 90000; // 90 seconds

// --- [PERF] Add new performance constants ---
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60;
const SKIP_STRONG_MATCH_THRESHOLD = 0.80;
const MARKET_RUN_CONCURRENCY = 6;
const NUTRITION_CONCURRENCY = 6;
const TOKEN_BUCKET_CAPACITY = 10;
const TOKEN_BUCKET_REFILL_PER_SEC = 10;
const TOKEN_BUCKET_MAX_WAIT_MS = 250;
// --- [END PERF] ---

// --- [PERF] Update concurrency limits to use new constants ---
const MAX_NUTRITION_CONCURRENCY = NUTRITION_CONCURRENCY;
const MAX_MARKET_RUN_CONCURRENCY = MARKET_RUN_CONCURRENCY;
// --- [END PERF] ---

const BANNED_KEYWORDS = [
    'cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy',
    'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder',
    'folder', 'stationery', 'lighter', 'shampoo', 'conditioner', 'soap', 'lotion',
    'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum'
];
// --- [PERF] Use new constant for score threshold ---
const SKIP_HEURISTIC_SCORE_THRESHOLD = SKIP_STRONG_MATCH_THRESHOLD;
// --- [END PERF] ---
const PRICE_OUTLIER_Z_SCORE = 2.0;
const PANTRY_CATEGORIES = ["pantry", "grains", "canned", "spreads", "condiments", "drinks"];
// --- [PERF] Add fail-fast categories ---
const FAIL_FAST_CATEGORIES = ["produce", "meat", "dairy", "veg", "fruit", "seafood"];

// --- [NEW] Solution 2: Defensive Sanity Check Limit ---
const MAX_CALORIES_PER_ITEM = 1200; // 1360 kcal for an egg was the bug. 1200 is a safe cap.
// --- [END NEW] ---

// --- [NEW] Conservative Nutrition Fallback Data (per 100g) ---
const GENERIC_FALLBACK_NUTRITION = {
    // Very basic macros for common food groups if API fails
    grain_generic: { protein: 8, fat: 2, carbs: 70, kcal: 322, source: 'FALLBACK_GRAIN' }, // E.g., uncooked rice/pasta
    meat_generic: { protein: 25, fat: 10, carbs: 0, kcal: 190, source: 'FALLBACK_MEAT' }, // E.g., raw chicken breast/mince
    vegetable_generic: { protein: 2, fat: 0.5, carbs: 5, kcal: 35, source: 'FALLBACK_VEG' }, // E.g., broccoli/carrot
    fruit_generic: { protein: 0.5, fat: 0.5, carbs: 12, kcal: 50, source: 'FALLBACK_FRUIT' }, // E.g., apple/banana
    dairy_generic: { protein: 3, fat: 3, carbs: 5, kcal: 60, source: 'FALLBACK_DAIRY' }, // E.g., milk/yogurt
    oil_generic: { protein: 0, fat: 100, carbs: 0, kcal: 900, source: 'FALLBACK_OIL' } // E.g., olive oil
};
// --- [END NEW] ---

/// ===== CONFIG-END ===== ////

/// ===== MOCK-START ===== \\\\
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const MOCK_RECIPE_FALLBACK = {
    description: "Meal description could not be generated.",
    instructions: ["Cooking instructions could not be generated for this meal. Please rely on standard cooking methods for the ingredients listed."]
};
/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\

// --- Cache Helpers (Unchanged) ---
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
// --- End Cache Helpers ---


// --- Logger (SSE Aware - Unchanged) ---
function createLogger(run_id, day, responseStream = null) {
    const logs = [];
    
    /**
     * Writes a Server-Sent Event (SSE) to the response stream.
     * @param {string} eventType - The event type (e.g., 'message', 'finalData').
     * @param {object} data - The JSON-serializable data payload.
     */
    const writeSseEvent = (eventType, data) => {
        if (!responseStream || responseStream.writableEnded) {
            // console.warn(`[SSE Logger] Attempted to write event '${eventType}' but stream is null or ended.`); // Optional: Log attempts to write to closed stream
            return; // Can't write to a closed or non-existent stream
        }
        try {
            const dataString = JSON.stringify(data);
            responseStream.write(`event: ${eventType}\n`);
            responseStream.write(`data: ${dataString}\n\n`);
        } catch (e) {
            // This might fail if the client disconnected
            console.error(`[SSE Logger] Failed to write event ${eventType} to stream: ${e.message}`);
            // Attempt to close the stream gracefully if write fails
             try { if (!responseStream.writableEnded) responseStream.end(); } catch {}
        }
    };

    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        let logEntry;
        try {
            logEntry = {
                timestamp: new Date().toISOString(),
                run_id: run_id, // Add run_id
                day: day,       // Add day context
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                data: data ? JSON.parse(JSON.stringify(data, (key, value) => // Basic serialization
                    (typeof value === 'string' && value.length > 300) ? value.substring(0, 300) + '...' : value
                )) : null
            };
            logs.push(logEntry);
            
            writeSseEvent('message', logEntry);

            // Also log to console for server visibility
             const time = new Date(logEntry.timestamp).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Brisbane' });
             console.log(`Day ${day} ${time} [${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
             if (data && (level !== 'DEBUG' || ['ERROR', 'CRITICAL', 'WARN'].includes(level))) {
                 try {
                     const truncatedData = JSON.stringify(data, (k, v) => typeof v === 'string' && v.length > 150 ? v.substring(0, 150) + '...' : v, 2);
                     console.log("  Data:", truncatedData.length > 500 ? truncatedData.substring(0, 500) + '...' : truncatedData);
                 } catch { console.log("  Data: [Serialization Error]"); }
             }
            return logEntry;
        } catch (error) {
             const fallbackEntry = { timestamp: new Date().toISOString(), run_id: run_id, day:day, level: 'ERROR', tag: 'LOGGING', message: `Log serialization failed: ${message}`, data: { error: error.message }}
             logs.push(fallbackEntry);
             console.error(JSON.stringify(fallbackEntry));
             
             writeSseEvent('message', fallbackEntry);

             return fallbackEntry;
        }
    };

    const logErrorAndClose = (errorMessage, errorCode = "SERVER_FAULT_DAY") => {
        log(errorMessage, 'CRITICAL', 'SYSTEM'); // Log it normally first
        writeSseEvent('error', {
            message: errorMessage,
            code: errorCode
        });
        if (responseStream && !responseStream.writableEnded) {
            try { responseStream.end(); } catch (e) { console.error("[SSE Logger] Error closing stream after error event:", e.message); }
        }
    };
    
    const sendFinalDataAndClose = (data) => {
        writeSseEvent('finalData', data);
        if (responseStream && !responseStream.writableEnded) {
            log(`Generation complete, closing stream.`, 'DEBUG', 'SSE');
            try { responseStream.end(); } catch (e) { console.error("[SSE Logger] Error closing stream after final data:", e.message); }
        }
    };
    
    // --- [NEW] Add warnings array for final payload (Logger part) ---
    const PRE_RESPONSE_WARNINGS = [];

    const addWarning = (type, message, data = null) => {
        const warning = { type, message, data: data ? JSON.parse(JSON.stringify(data)) : null };
        PRE_RESPONSE_WARNINGS.push(warning);
        log(`Warning Added: ${type} - ${message}`, 'WARN', 'VALIDATION', data);
    }
    // --- [END NEW] ---

    // [MODIFIED] Return new functions
    return { log, getLogs: () => logs, logErrorAndClose, sendFinalDataAndClose, writeSseEvent, addWarning, getWarnings: () => PRE_RESPONSE_WARNINGS };
}
// --- End Logger ---


// --- Other Helpers (Unchanged) ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// --- [DELETED] Old local normalizeKey function (now imported) ---

function getSanitizedFormData(formData) {
    try {
        if (!formData || typeof formData !== 'object') return { error: "Invalid form data received." };
        const { name, height, weight, age, bodyFat, ...rest } = formData;
        return { ...rest, user_profile: "[REDACTED]" };
    } catch (e) { return { error: "Failed to sanitize form data." }; }
}

async function concurrentlyMap(array, limit, asyncMapper) {
    const results = [];
    const executing = [];
    for (const item of array) {
        const promise = asyncMapper(item)
            .then(result => {
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                return result;
            })
            .catch(error => {
                // Ensure error logging even in concurrent map
                console.error(`Error in concurrentlyMap item "${item?.originalIngredient || 'unknown'}":`, error);
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                return { _error: true, message: error.message || 'Unknown concurrent map error', itemKey: item?.originalIngredient || 'unknown' };
            });
        executing.push(promise);
        results.push(promise);
        if (executing.length >= limit) { await Promise.race(executing); }
    }
    return Promise.all(results).then(res => res.filter(r => r != null));
}

// --- fetchLLMWithRetry (Unchanged) ---
async function fetchLLMWithRetry(url, options, log, attemptPrefix = "LLM") {
    for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

        try {
            log(`${attemptPrefix} Attempt ${attempt}: Fetching from ${url} (Timeout: ${LLM_REQUEST_TIMEOUT_MS}ms)`, 'DEBUG', 'HTTP');
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);

            if (response.ok) return response;

            if (response.status === 429 || response.status >= 500) {
                log(`${attemptPrefix} Attempt ${attempt}: Received retryable error ${response.status}. Retrying...`, 'WARN', 'HTTP');
            } else {
                const errorBody = await response.text();
                log(`${attemptPrefix} Attempt ${attempt}: Non-retryable error ${response.status}.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`${attemptPrefix} call failed with status ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
             clearTimeout(timeout);
             if (error.name === 'AbortError') {
                 log(`${attemptPrefix} Attempt ${attempt}: Fetch timed out after ${LLM_REQUEST_TIMEOUT_MS}ms. Retrying...`, 'WARN', 'HTTP');
             } else if (!error.message?.startsWith(`${attemptPrefix} call failed with status`)) {
                log(`${attemptPrefix} Attempt ${attempt}: Fetch failed: ${error.message}. Retrying...`, 'WARN', 'HTTP');
             } else {
                 throw error; // Rethrow non-retryable or final attempt errors
             }
        }

        if (attempt < MAX_LLM_RETRIES) {
            const delayTime = Math.pow(2, attempt -1) * 3000 + Math.random() * 1000;
            log(`Waiting ${delayTime.toFixed(0)}ms before ${attemptPrefix} retry...`, 'DEBUG', 'HTTP');
            await delay(delayTime);
        }
    }
    log(`${attemptPrefix} call failed definitively after ${MAX_LLM_RETRIES} attempts.`, 'CRITICAL', 'HTTP');
    throw new Error(`${attemptPrefix} call to ${url} failed after ${MAX_LLM_RETRIES} attempts.`);
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
    return price; // Fallback
};

function parseSize(sizeString) {
    if (typeof sizeString !== 'string') return null;
    const sizeLower = sizeString.toLowerCase().replace(/\s/g, '');
    const match = sizeLower.match(/(\d+\.?\d*)\s*(g|kg|ml|l)/);
    if (match) {
        const value = parseFloat(match[1]);
        let unit = match[2];
        let valueInBaseUnits = value;
        if (unit === 'kg') { valueInBaseUnits *= 1000; unit = 'g'; }
        else if (unit === 'l') { valueInBaseUnits *= 1000; unit = 'ml'; }
        return { value: valueInBaseUnits, unit: unit };
    }
    return null;
}

// --- passRequiredWords (Unchanged) ---
function passRequiredWords(title = '', required = []) {
  if (!required || required.length === 0) return true;
  const t = title.toLowerCase();
  return required.every(w => {
    if (!w) return true;
    const base = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b${base}s?\\b`, 'i');
    return rx.test(t);
  });
}

const mean = (arr) => arr.length > 0 ? arr.reduce((acc, val) => acc + val, 0) / arr.length : 0;
const stdev = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
};

function applyPriceOutlierGuard(products, log, ingredientKey) {
    if (products.length < 3) return products;
    const prices = products.map(p => p.product.unit_price_per_100).filter(p => p > 0);
    if (prices.length < 3) return products;
    const m = mean(prices);
    const s = stdev(prices);
    if (s === 0) return products;

    return products.filter(p => {
        const price = p.product.unit_price_per_100;
        if (price <= 0) return true;
        const zScore = (price - m) / s;
        if (zScore > PRICE_OUTLIER_Z_SCORE) {
            log(`[${ingredientKey}] Demoting Price Outlier: "${p.product.name}" ($${price.toFixed(2)}/100) vs avg $${m.toFixed(2)}/100 (z=${zScore.toFixed(2)})`, 'INFO', 'PRICE_OUTLIER');
            return false;
        }
        return true;
    });
}

function passCategory(product = {}, allowed = []) {
  if (!allowed || allowed.length === 0 || !product.product_category) return true;
  const pc = product.product_category.toLowerCase();
  return allowed.some(a => pc.includes(a.toLowerCase()));
}

function sizeOk(productSizeParsed, targetSize, allowedCategories = [], log, ingredientKey, checkLogPrefix) {
    if (!productSizeParsed || !targetSize || !targetSize.value || !targetSize.unit) return true;
    if (productSizeParsed.unit !== targetSize.unit) {
        log(`${checkLogPrefix}: WARN (Size Unit Mismatch ${productSizeParsed.unit} vs ${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
        return false;
    }
    const prodValue = productSizeParsed.value;
    const targetValue = targetSize.value;
    const isPantry = PANTRY_CATEGORIES.some(c => allowedCategories?.some(ac => ac.toLowerCase() === c));
    const maxMultiplier = isPantry ? 3.0 : 2.0;
    const minMultiplier = 0.5;
    const lowerBound = targetValue * minMultiplier;
    const upperBound = targetValue * maxMultiplier;

    if (prodValue >= lowerBound && prodValue <= upperBound) return true;

    log(`${checkLogPrefix}: FAIL (Size ${prodValue}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit} for ${isPantry ? 'pantry' : 'perishable'})`, 'DEBUG', 'CHECKLIST');
    return false;
}

// --- [PERF] Modified runSmarterChecklist to return a score ---
// We'll keep the logic simple: pass = 1.0, fail = 0.
// The ladder logic will handle the thresholds.
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) return { pass: false, score: 0 };
    if (!ingredientData || typeof ingredientData !== 'object' || !ingredientData.originalIngredient) {
        log(`Checklist: Invalid/missing ingredientData for "${product.product_name}"`, 'ERROR', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    const { originalIngredient, requiredWords = [], negativeKeywords = [], targetSize, allowedCategories = [] } = ingredientData;
    const checkLogPrefix = `Checklist [${originalIngredient}] for "${product.product_name}"`;

    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    if ((negativeKeywords ?? []).length > 0) {
        const negativeWordFound = negativeKeywords.find(kw => kw && productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }
    if (!passRequiredWords(productNameLower, requiredWords ?? [])) {
        log(`${checkLogPrefix}: FAIL (Required words missing: [${(requiredWords ?? []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    if (!passCategory(product, allowedCategories)) {
         log(`${checkLogPrefix}: FAIL (Category Mismatch: "${product.product_category}" not in [${(allowedCategories || []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
         return { pass: false, score: 0 };
    }
    const isProduceOrFruit = (allowedCategories || []).some(c => c === 'fruit' || c === 'produce' || c === 'veg');
    const productSizeParsed = parseSize(product.product_size);
    if (!isProduceOrFruit && !sizeOk(productSizeParsed, targetSize, allowedCategories, log, originalIngredient, checkLogPrefix)) {
        return { pass: false, score: 0 };
    } else if (isProduceOrFruit) {
         log(`${checkLogPrefix}: INFO (Bypassing size check for fruit/produce)`, 'DEBUG', 'CHECKLIST');
    }

    log(`${checkLogPrefix}: PASS`, 'DEBUG', 'CHECKLIST');
    // --- [PERF] Return 1.0 on pass to work with ladder logic ---
    return { pass: true, score: 1.0 };
}
// --- [END PERF] ---

// --- Synthesis functions (Unchanged) ---
function synthTight(ing, store) {
  if (!ing || !store) return null;
  const size = ing.targetSize?.value && ing.targetSize?.unit ? ` ${ing.targetSize.value}${ing.targetSize.unit}` : "";
  const original = typeof ing.originalIngredient === 'string' ? ing.originalIngredient : '';
  return `${store} ${original}${size}`.toLowerCase().trim();
}
function synthWide(ing, store) {
  if (!ing || !store) return null;
  const noun = (Array.isArray(ing.requiredWords) && ing.requiredWords.length > 0 && typeof ing.requiredWords[0] === 'string')
    ? ing.requiredWords[0]
    : (typeof ing.originalIngredient === 'string' ? ing.originalIngredient.split(" ")[0] : '');
  if (!noun) return null;
  return `${store} ${noun}`.toLowerCase().trim();
}

// --- [NEW] State Hint Normalizer ---
function normalizeStateHintForItem(item, log) {
    const key = (item.key || '').toLowerCase();
    let hint = (item.stateHint || '').toLowerCase().trim();
    let originalHint = hint;

    // 1. Validate hint
    const validHints = ['dry', 'raw', 'cooked', 'as_pack'];
    if (!validHints.includes(hint)) {
        hint = '';
    }

    // 2. Apply defaults if hint is empty/invalid
    if (!hint) {
        // Grain / pasta default: DRY
        const isGrain =
            key.includes('oat') ||
            key.includes('rice') ||
            key.includes('pasta') ||
            key.includes('noodle') ||
            key.includes('quinoa') ||
            key.includes('couscous') ||
            key.includes('barley') ||
            key.includes('bulgur') ||
            key.includes('polenta') ||
            key.includes('buckwheat') ||
            key.includes('millet') ||
            key.includes('lentil');

        if (isGrain) {
            hint = 'dry';
        }

        // Meat / fish default: RAW
        const isMeatOrFish =
            key.includes('chicken') ||
            key.includes('beef') ||
            key.includes('pork') ||
            key.includes('lamb') ||
            key.includes('fish') ||
            key.includes('salmon') ||
            key.includes('tuna') ||
            key.includes('mince') ||
            key.includes('egg');

        if (!hint && isMeatOrFish) {
            hint = 'raw';
        }

        // Dairy / bread / packaged default: AS_PACK
        const isPackaged =
            key.includes('milk') ||
            key.includes('yogurt') ||
            key.includes('yoghurt') ||
            key.includes('bread') ||
            key.includes('cheese') ||
            key.includes('wrap') ||
            key.includes('tortilla');

        if (!hint && isPackaged) {
            hint = 'as_pack';
        }
    }

    // 3. Logging
    if (originalHint && originalHint !== hint) {
        log(`StateHint corrected for '${item.key}': Invalid '${originalHint}' changed to '${hint}'`, 'WARN', 'STATE_HINT');
    } else if (!originalHint && hint) {
        log(`StateHint inferred for '${item.key}': Defaulted to '${hint}'`, 'DEBUG', 'STATE_HINT');
    } else if (!hint && log) {
        log(`No stateHint for '${item.key}', leaving empty (will use transforms fallback).`, 'DEBUG', 'STATE_HINT');
    }

    // Mutate item in place
    item.stateHint = hint;
    return item;
}
// --- [END NEW] ---

/// ===== HELPERS-END ===== ////


/// ===== API-CALLERS-START ===== \\\\

// --- [MODIFIED] Meal Planner Prompt (Solution 3) ---
const MEAL_PLANNER_SYSTEM_PROMPT = (weight, calories, mealMax, day) => `
You are an expert dietitian. Your SOLE task is to generate the \`meals\` for ONE day (Day ${day}).
RULES:
1.  Generate meals ('meals') & items ('items') used TODAY.
2.  **CRITICAL PROTEIN CAP: Never exceed 3 g/kg total daily protein (User weight: ${weight}kg).**
3.  MEAL PORTIONS: For each meal, populate 'items' with:
    a) 'key': (string) The generic ingredient name.
    b) 'qty_value': (number) The portion size for the user.
    c) 'qty_unit': (string) e.g., 'g', 'ml', 'slice', 'egg'.
    d) 'stateHint': (string) MANDATORY. The state of the ingredient. Must be one of: "dry", "raw", "cooked", "as_pack".
    e) 'methodHint': (string | null) MANDATORY. Cooking method if state is "cooked". Must be one of: "boiled", "pan_fried", "grilled", "baked", "steamed", or null.
4.  **CRITICAL UNIT RULE:** You MUST provide quantities in **'g'** (grams), **'ml'** (milliliters), or a specific single unit like **'egg'** or **'slice'**. You **MUST NOT** use ambiguous units like 'medium', 'large', or 'piece' for any item.
5.  TARGETS: Aim for the protein target. The code will calculate calories based on your plan; you do NOT need to estimate them.
6.  Adhere to all user constraints.
7.  'meals' array is MANDATORY. Do NOT include 'ingredients' array.
8.  Do NOT include calorie estimates in your response.

Output ONLY the valid JSON object described below. ABSOLUTELY NO PROSE OR MARKDOWN.

JSON Structure:
{
  "meals": [
    {
      "type": "string",
      "name": "string",
      "items": [
        {
          "key": "string",
          "qty_value": number,
          "qty_unit": "string",
          "stateHint": "string",
          "methodHint": "string|null"
        }
      ]
    }
  ]
}
`;
// --- [END MODIFICATION] ---

// --- Grocery Optimizer Prompt (Unchanged) ---
const GROCERY_OPTIMIZER_SYSTEM_PROMPT = (store, australianTermNote) => `
You are an expert grocery query optimizer for store: ${store}.
Your SOLE task is to take a JSON array of ingredient names and generate the full query/validation JSON for each.
RULES:
1.  'originalIngredient' MUST match the input ingredient name exactly.
2.  'normalQuery' (REQUIRED): 2-4 generic words, STORE-PREFIXED. CRITICAL: Use MOST COMMON GENERIC NAME. DO NOT include brands, sizes, fat content, specific forms (sliced/grated), or dryness unless ESSENTIAL.${australianTermNote}
3.  'tightQuery' (OPTIONAL, string | null): Hyper-specific, STORE-PREFIXED. Return null if 'normalQuery' is sufficient.
4.  'wideQuery' (OPTIONAL, string | null): 1-2 broad words, STORE-PREFIXED. Return null if 'normalQuery' is sufficient.
5.  'requiredWords' (REQUIRED): Array[1-2] ESSENTIAL CORE NOUNS ONLY, lowercase singular. NO adjectives, forms, plurals. These words MUST exist in product names.
6.  'negativeKeywords' (REQUIRED): Array[1-3] lowercase words for INCORRECT product. Be concise.
7.  'targetSize' (REQUIRED): Object {value: NUM, unit: "g"|"ml"} | null. Null if N/A. Prefer common package sizes.
8.  'totalGramsRequired' (REQUIRED): BEST ESTIMATE total g/ml for THIS DAY. **Since you only have the ingredient list, estimate a common portion (e.g., 200g for a meal protein, 100g for carbs).** This is a rough estimate.
9.  'quantityUnits' (REQUIRED): A string describing the common purchase unit (e.g., "1kg Bag", "250g Punnet", "500ml Bottle").
10. 'allowedCategories' (REQUIRED): Array[1-2] precise, lowercase categories from this exact set: ["produce","fruit","veg","dairy","bakery","meat","seafood","pantry","frozen","drinks","canned","grains","spreads","condiments","snacks"].

Output ONLY the valid JSON object described below. ABSOLUTELY NO PROSE OR MARKDOWN.

JSON Structure:
{
  "ingredients": [
    {
      "originalIngredient": "string",
      "category": "string",
      "tightQuery": "string|null",
      "normalQuery": "string",
      "wideQuery": "string|null",
      "requiredWords": ["string"],
      "negativeKeywords": ["string"],
      "targetSize": { "value": number, "unit": "g"|"ml" }|null,
      "totalGramsRequired": number,
      "quantityUnits": "string",
      "allowedCategories": ["string"]
    }
  ]
}
`;

// --- tryGenerateLLMPlan (Unchanged) ---
async function tryGenerateLLMPlan(modelName, payload, log, logPrefix, expectedJsonShape) {
    log(`${logPrefix}: Attempting model: ${modelName}`, 'INFO', 'LLM');
    const apiUrl = getGeminiApiUrl(modelName);

    const response = await fetchLLMWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload)
    }, log, logPrefix);

    const result = await response.json();
    const candidate = result.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason === 'MAX_TOKENS') {
        log(`${logPrefix}: Model ${modelName} failed with finishReason: MAX_TOKENS.`, 'WARN', 'LLM');
        throw new Error(`Model ${modelName} failed: MAX_TOKENS.`);
    }
    if (finishReason !== 'STOP') {
         log(`${logPrefix}: Model ${modelName} failed with non-STOP finishReason: ${finishReason}`, 'WARN', 'LLM', { result });
         throw new Error(`Model ${modelName} failed: FinishReason was ${finishReason}.`);
    }

    const content = candidate?.content;
    if (!content || !content.parts || content.parts.length === 0 || !content.parts[0].text) {
        log(`${logPrefix}: Model ${modelName} response missing content or text part.`, 'CRITICAL', 'LLM', { result });
        throw new Error(`Model ${modelName} failed: Response missing content.`);
    }

    const jsonText = content.parts[0].text;
    log(`${logPrefix} Raw JSON Text`, 'DEBUG', 'LLM', { raw: jsonText.substring(0, 300) + '...' });

    try {
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object') throw new Error("Parsed response is not a valid object.");
        for (const key in expectedJsonShape) {
            if (!parsed.hasOwnProperty(key)) {
                throw new Error(`Parsed JSON missing required top-level key: '${key}'.`);
            }
            if (Array.isArray(expectedJsonShape[key]) && !Array.isArray(parsed[key])) {
                throw new Error(`Parsed JSON key '${key}' was not an array.`);
            }
        }
        log(`${logPrefix}: Model ${modelName} succeeded.`, 'SUCCESS', 'LLM');
        return parsed;
    } catch (parseError) {
        log(`Failed to parse/validate ${logPrefix} JSON from ${modelName}: ${parseError.message}`, 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 300) });
        throw new Error(`Model ${modelName} failed: Invalid JSON response. ${parseError.message}`);
    }
}

// --- generateMealPlan (MODIFIED to call stateHint normalization) ---
async function generateMealPlan(day, formData, nutritionalTargets, log) {
    const { name, height, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const { calories, protein, fat, carbs } = nutritionalTargets;

    if (!day || isNaN(parseInt(day)) || parseInt(day) < 1 || parseInt(day) > 7) {
        throw new Error("Invalid 'day' parameter provided.");
    }
    if (!nutritionalTargets || typeof nutritionalTargets !== 'object' || !calories || !protein || !fat || !carbs) {
        throw new Error("Invalid or missing 'nutritionalTargets' provided.");
    }

    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets }));
    const cacheKey = `${CACHE_PREFIX}:meals:day${day}:${profileHash}`;
    const cached = await cacheGet(cacheKey, log);
    if (cached) return cached;
    log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');

    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']};
    const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus: ${cuisine}.` : 'Neutral.';

    const numMeals = parseInt(eatingOccasions, 10) || 3;
    const mealAvg = Math.round(calories / numMeals);
    const mealMax = Math.round(mealAvg * 1.5);

    const systemPrompt = MEAL_PLANNER_SYSTEM_PROMPT(weight, calories, mealMax, day);
    let userQuery = `Gen plan Day ${day} for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Day ${day} Target: ~${calories} kcal (P ~${protein}g, F ~${fat}g, C ~${carbs}g). Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority}. Cuisine: ${cuisineInstruction}.`;

    const logPrefix = `MealPlannerDay${day}`;
    log(`Meal Planner AI Prompt for Day ${day}`, 'INFO', 'LLM_PROMPT', {
        systemPromptStart: systemPrompt.substring(0, 200) + '...',
        userQuery: userQuery,
        targets: nutritionalTargets,
    });

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.3, topK: 32, topP: 0.9, responseMimeType: "application/json",
        }
    };
    const expectedShape = { "meals": [] };
    let parsedResult;
    try {
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_PRIMARY, payload, log, logPrefix, expectedShape);
    } catch (primaryError) {
        log(`${logPrefix}: PRIMARY Model ${PLAN_MODEL_NAME_PRIMARY} failed: ${primaryError.message}. Attempting FALLBACK.`, 'WARN', 'LLM');
        try {
            parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_FALLBACK, payload, log, logPrefix, expectedShape);
        } catch (fallbackError) {
            log(`${logPrefix}: FALLBACK Model ${PLAN_MODEL_NAME_FALLBACK} also failed: ${fallbackError.message}.`, 'CRITICAL', 'LLM');
            throw new Error(`Meal Plan generation failed for Day ${day}: Both AI models failed. Last error: ${fallbackError.message}`);
        }
    }
    
    // --- [NEW] Post-LLM stateHint normalization (Task 2) ---
    if (parsedResult && parsedResult.meals) {
        parsedResult.meals.forEach(meal => {
            if (meal && meal.items) {
                meal.items.forEach(item => {
                    // Normalize/default stateHint immediately after parsing
                    normalizeStateHintForItem(item, log);
                });
            }
        });
    }
    // --- [END NEW] ---

    if (parsedResult && parsedResult.meals && parsedResult.meals.length > 0) {
        await cacheSet(cacheKey, parsedResult, TTL_PLAN_MS, log);
    }
    return parsedResult;
}

// --- generateGroceryQueries (Unchanged) ---
async function generateGroceryQueries(uniqueIngredientKeys, store, log) {
    if (!uniqueIngredientKeys || uniqueIngredientKeys.length === 0) {
        log("generateGroceryQueries called with no ingredients. Returning empty.", 'WARN', 'LLM');
        return { ingredients: [] };
    }

    const keysHash = hashString(JSON.stringify(uniqueIngredientKeys));
    const cacheKey = `${CACHE_PREFIX}:queries:${store}:${keysHash}`;
    const cached = await cacheGet(cacheKey, log);
    if (cached) return cached;
    log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');
    
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion', 'capsicum')." : "";

    const systemPrompt = GROCERY_OPTIMIZER_SYSTEM_PROMPT(store, australianTermNote);
    let userQuery = `Generate query JSON for the following ingredients:\n${JSON.stringify(uniqueIngredientKeys)}`;

    const logPrefix = `GroceryOptimizerDay`;
    log(`Grocery Optimizer AI Prompt`, 'INFO', 'LLM_PROMPT', {
        systemPromptStart: systemPrompt.substring(0, 200) + '...',
        userQuery: userQuery,
    });

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.1, topK: 32, topP: 0.9, responseMimeType: "application/json",
        }
    };
    const expectedShape = { "ingredients": [] };
    let parsedResult;
    try {
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_PRIMARY, payload, log, logPrefix, expectedShape);
    } catch (primaryError) {
        log(`${logPrefix}: PRIMARY Model ${PLAN_MODEL_NAME_PRIMARY} failed: ${primaryError.message}. Attempting FALLBACK.`, 'WARN', 'LLM');
        try {
            parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_FALLBACK, payload, log, logPrefix, expectedShape);
        } catch (fallbackError) {
            log(`${logPrefix}: FALLBACK Model ${PLAN_MODEL_NAME_FALLBACK} also failed: ${fallbackError.message}.`, 'CRITICAL', 'LLM');
            throw new Error(`Grocery Query generation failed: Both AI models failed. Last error: ${fallbackError.message}`);
        }
    }
    if (parsedResult && parsedResult.ingredients && parsedResult.ingredients.length > 0) {
        await cacheSet(cacheKey, parsedResult, TTL_PLAN_MS, log);
    }
    return parsedResult;
}

// --- Chef AI Prompt (Unchanged) ---
const CHEF_SYSTEM_PROMPT = (store) => `
You are an expert chef for ${store} shoppers. You write clear, safe, and appetizing recipes.
RULES:
1.  You will be given a meal name and a list of ingredients with quantities.
2.  Your job is to generate an appetizing 1-sentence 'description' for the meal.
3.  You MUST also generate a 'instructions' array, with each element being one step.
4.  Instructions MUST be safe, clear, and logical.
5.  **FOOD SAFETY IS CRITICAL:**
    * ALWAYS include a step to "cook chicken/pork thoroughly until no longer pink and juices run clear."
    * ALWAYS include a step to "wash all produce (vegetables/fruit) thoroughly."
6.  Be concise. Aim for 4-7 steps.
7.  Do NOT add any ingredients not in the provided list, except for "salt, pepper, and water" which are assumed.

Output ONLY the valid JSON object described below. ABSOLUTELY NO PROSE OR MARKDOWN.

JSON Structure:
{
  "description": "string",
  "instructions": ["string"]
}
`;

// --- tryGenerateChefRecipe (Unchanged) ---
async function tryGenerateChefRecipe(modelName, payload, mealName, log) {
    log(`Chef AI [${mealName}]: Attempting model: ${modelName}`, 'INFO', 'LLM_CHEF');
    const apiUrl = getGeminiApiUrl(modelName);

    const response = await fetchLLMWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload)
    }, log, `Chef-${mealName}`);

    const result = await response.json();
    const candidate = result.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason !== 'STOP') {
        log(`Chef AI [${mealName}]: Model ${modelName} failed with non-STOP finishReason: ${finishReason}`, 'WARN', 'LLM_CHEF', { result });
        throw new Error(`Model ${modelName} failed: FinishReason was ${finishReason}.`);
    }

    const content = candidate?.content;
    if (!content || !content.parts || content.parts.length === 0 || !content.parts[0].text) {
        log(`Chef AI [${mealName}]: Model ${modelName} response missing content or text part.`, 'CRITICAL', 'LLM_CHEF', { result });
        throw new Error(`Model ${modelName} failed: Response missing content.`);
    }

    const jsonText = content.parts[0].text;
    try {
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed.description !== 'string' || !Array.isArray(parsed.instructions) || parsed.instructions.length === 0) {
             throw new Error("Invalid JSON structure: 'description' (string) or 'instructions' (array) missing/empty.");
        }
        log(`Chef AI [${mealName}]: Model ${modelName} succeeded.`, 'SUCCESS', 'LLM_CHEF');
        return parsed;
    } catch (parseError) {
        log(`Failed to parse/validate Chef AI JSON for [${mealName}] from ${modelName}: ${parseError.message}`, 'CRITICAL', 'LLM_CHEF', { jsonText: jsonText.substring(0, 300) });
        throw new Error(`Model ${modelName} failed: Invalid JSON response. ${parseError.message}`);
    }
}

// --- generateChefInstructions (Unchanged) ---
async function generateChefInstructions(meal, store, log) {
    const mealName = meal.name || 'Unnamed Meal';
    try {
        const mealHash = hashString(JSON.stringify(meal.items || []));
        const cacheKey = `${CACHE_PREFIX}:recipe:${mealHash}`;
        const cached = await cacheGet(cacheKey, log);
        if (cached) return cached;
        log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');

        const systemPrompt = CHEF_SYSTEM_PROMPT(store);
        const ingredientList = meal.items.map(item => `- ${item.qty_value}${item.qty_unit} ${item.key}`).join('\n');
        const userQuery = `Generate a recipe for "${meal.name}" using only these ingredients:\n${ingredientList}`;
        
        log(`Chef AI Prompt for [${mealName}]`, 'INFO', 'LLM_PROMPT', {
            systemPromptStart: systemPrompt.substring(0, 200) + '...',
            userQuery: userQuery
        });

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0.4, topK: 32, topP: 0.9, responseMimeType: "application/json", 
            }
        };

        let recipeResult;
        try {
            recipeResult = await tryGenerateChefRecipe(PLAN_MODEL_NAME_PRIMARY, payload, mealName, log);
        } catch (primaryError) {
            log(`Chef AI [${mealName}]: PRIMARY Model ${PLAN_MODEL_NAME_PRIMARY} failed: ${primaryError.message}. Attempting FALLBACK.`, 'WARN', 'LLM_CHEF');
            try {
                recipeResult = await tryGenerateChefRecipe(PLAN_MODEL_NAME_FALLBACK, payload, mealName, log);
            } catch (fallbackError) {
                log(`Chef AI [${mealName}]: FALLBACK Model ${PLAN_MODEL_NAME_FALLBACK} also failed: ${fallbackError.message}.`, 'CRITICAL', 'LLM_CHEF');
                throw new Error(`Recipe generation failed for [${mealName}]: Both AI models failed. Last error: ${fallbackError.message}`);
            }
        }
        if (recipeResult && recipeResult.description) {
            await cacheSet(cacheKey, recipeResult, TTL_PLAN_MS, log);
        }
        return recipeResult;
    } catch (error) {
        log(`CRITICAL Error in generateChefInstructions for [${mealName}]: ${error.message}`, 'CRITICAL', 'LLM_CHEF');
        return MOCK_RECIPE_FALLBACK;
    }
}

// --- extractUniqueIngredientKeys (Unchanged) ---
function extractUniqueIngredientKeys(meals) {
    const keys = new Set();
    if (Array.isArray(meals)) {
        for (const meal of meals) {
            if (meal && Array.isArray(meal.items)) {
                for (const item of meal.items) {
                    if (item && item.key) {
                        keys.add(item.key);
                    }
                }
            }
        }
    }
    return Array.from(keys).sort();
}

/// ===== API-CALLERS-END ===== ////

/// ===== MAIN-HANDLER-START ===== \\\\

module.exports = async (request, response) => {
    // --- [PERF] Start total plan timer ---
    const planStartTime = Date.now();
    let dietitian_ms = 0, market_run_ms = 0, nutrition_ms = 0;
    // --- [END PERF] ---

    const run_id = crypto.randomUUID();
    const day = request.query.day ? parseInt(request.query.day, 10) : null;

    // --- Setup SSE Stream (Unchanged) ---
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); 
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    
    // [MODIFIED] Destructure new logger functions
    const { log, getLogs, logErrorAndClose, sendFinalDataAndClose, addWarning, getWarnings } = createLogger(run_id, day || 'unknown', response);
    // --- End SSE Setup ---

    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight.", 'INFO', 'HTTP');
        response.status(200).end(); 
        return;
    }

    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        response.setHeader('Allow', 'POST, OPTIONS');
        logErrorAndClose(`Method ${request.method} Not Allowed.`, "METHOD_NOT_ALLOWED");
        return;
    }

    // --- Main Logic ---
    let scaleFactor = null; 
    let finalDayTotals = {}; // Initialize here for wider scope

    try {
        log(`Generating plan for Day ${day}...`, 'INFO', 'SYSTEM');

        // --- Input Validation (Unchanged) ---
        if (!day || day < 1 || day > 7) {
             throw new Error("Invalid or missing 'day' parameter in query string.");
        }
        const { formData, nutritionalTargets } = request.body;
        if (!formData || typeof formData !== 'object' || Object.keys(formData).length < 5) {
            throw new Error("Missing or invalid 'formData' in request body.");
        }
        if (!nutritionalTargets || typeof nutritionalTargets !== 'object' || !nutritionalTargets.calories) {
            throw new Error("Missing or invalid 'nutritionalTargets' in request body.");
        }
        const { store } = formData;
        if (!store) throw new Error("'store' missing in formData.");

        // --- Phase 1a: Generate Day Plan ---
        log("Phase 1: Generating Day Plan (Meal Planner AI)...", 'INFO', 'PHASE');
        const dietitianStartTime = Date.now();
        const mealPlanResult = await generateMealPlan(day, formData, nutritionalTargets, log);
        dietitian_ms = Date.now() - dietitianStartTime; // [PERF] Log time
        
        const { meals: dayMeals = [] } = mealPlanResult;
        if (dayMeals.length === 0) {
            throw new Error(`Plan generation failed for Day ${day}: Meal Planner AI returned empty meals.`);
        }
        log(`Meal Planner AI success for Day ${day}: ${dayMeals.length} meals.`, 'SUCCESS', 'PHASE');
        
        // --- [PERF] Extract keys immediately for Market Run ---
        const mealKeys = extractUniqueIngredientKeys(dayMeals);

        // --- [PERF] Phase 1.5: Run Chef AI and Market Run in parallel ---
        log("Phase 1.5: Starting parallel Chef AI and Market Run...", 'INFO', 'PHASE');

        // Start Chef AI promise
        const recipePromise = Promise.allSettled(
            dayMeals.map(meal => generateChefInstructions(meal, store, log))
        );

        // Start Market Run promise (which itself contains the grocery query generation)
        const marketRunPromise = (async () => {
            const marketStartTime = Date.now();
            log("Phase 1.5b: Generating Grocery Queries (for Market Run)...", 'INFO', 'PHASE');
            const groceryResult = await generateGroceryQueries(mealKeys, store, log);
            const { ingredients: rawDayIngredients = [] } = groceryResult;
            
            if (rawDayIngredients.length === 0) {
                 throw new Error(`Plan generation failed for Day ${day}: Grocery Optimizer AI returned empty ingredients.`);
            }
            log(`Grocery Optimizer AI success: ${rawDayIngredients.length} ingredients.`, 'SUCCESS', 'PHASE');

            // [MODIFIED] Normalize Ingredient Keys (Use shared normalizer)
            const dayIngredientsPlan = rawDayIngredients.map(ing => ({
                ...ing,
                normalizedKey: normalizeKey(ing.originalIngredient) // <-- Use shared function
            }));

            // --- Phase 2: Market Run ---
            log("Phase 2: Market Run (Day " + day + ")...", 'INFO', 'PHASE');
            
            // --- [PERF] This is the new Market Run Ladder Logic ---
            const processSingleIngredientOptimized = async (ingredient) => {
                // [PERF] Add telemetry object
                let telemetry = { name: ingredient.originalIngredient, used: 'none', score: 0, page: 1 };
                 try {
                     if (!ingredient || !ingredient.originalIngredient) {
                         log(`Market Run: Skipping invalid ingredient data`, 'WARN', 'MARKET_RUN', { ingredient });
                         return { _error: true, itemKey: 'unknown_invalid', message: 'Invalid ingredient data' };
                     }
                    const ingredientKey = ingredient.originalIngredient;
                     if (!ingredient.normalQuery || !Array.isArray(ingredient.requiredWords) || !Array.isArray(ingredient.negativeKeywords) || !Array.isArray(ingredient.allowedCategories) || ingredient.allowedCategories.length === 0) {
                         log(`[${ingredientKey}] Skipping: Missing critical fields (normalQuery/validation)`, 'ERROR', 'MARKET_RUN', ingredient);
                         return { [ingredientKey]: { ...ingredient, source: 'error', error: 'Missing critical query/validation fields', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url } };
                     }
                    const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
                    const qn = ingredient.normalQuery;
                    const qt = (ingredient.tightQuery && ingredient.tightQuery.trim()) ? ingredient.tightQuery : synthTight(ingredient, store);
                    const qw = (ingredient.wideQuery && ingredient.wideQuery.trim()) ? ingredient.wideQuery : synthWide(ingredient, store);
                    
                    // --- [PERF] Define queries in order, but logic will control execution ---
                    const queriesToTry = [ { type: 'tight', query: qt }, { type: 'normal', query: qn }, { type: 'wide', query: qw } ].filter(q => q.query && q.query.trim());
                    
                    log(`[${ingredientKey}] Queries: Tight (${qt ? (ingredient.tightQuery ? 'AI' : 'Synth') : 'N/A'}), Normal (AI), Wide (${qw ? (ingredient.wideQuery ? 'AI' : 'Synth') : 'N/A'})`, 'DEBUG', 'MARKET_RUN');
                    
                    let acceptedQueryType = 'none';
                    let bestScore = 0;

                    for (const [index, { type, query }] of queriesToTry.entries()) {
                        
                        // --- [PERF] Ladder Logic ---
                        if (type === 'normal' && acceptedQueryType !== 'none') {
                            // Already found a match (e.g., strong tight), skip 'normal'
                            continue; 
                        }
                        if (type === 'wide') {
                            if (acceptedQueryType !== 'none') continue; // Skip if 'tight' or 'normal' succeeded
                            
                            // Fail-fast rule for fresh items
                            const isFailFastCategory = ingredient.allowedCategories.some(c => FAIL_FAST_CATEGORIES.includes(c));
                            if (isFailFastCategory) {
                                log(`[${ingredientKey}] Skipping "wide" query due to fail-fast category.`, 'DEBUG', 'MARKET_RUN');
                                continue;
                            }
                        }
                        // --- [END PERF] ---

                        log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
                        result.searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0});
                        const currentAttemptLog = result.searchAttempts.at(-1);

                        // --- [PERF] Instruction: Keep page=1 only ---
                        const { data: priceData } = await fetchPriceData(store, query, 1, log); // Hardcoded page=1

                        if (priceData.error) {
                            log(`[${ingredientKey}] Fetch failed (${type}): ${priceData.error.message}`, 'WARN', 'HTTP', { status: priceData.error.status });
                            currentAttemptLog.status = 'fetch_error'; continue;
                        }
                        
                        const rawProducts = priceData.results || [];
                        currentAttemptLog.rawCount = rawProducts.length;
                        const validProductsOnPage = [];
                        
                        for (const rawProduct of rawProducts) {
                            if (!rawProduct || !rawProduct.product_name) continue;
                            const checklistResult = runSmarterChecklist(rawProduct, ingredient, log);
                            if (checklistResult.pass) {
                                validProductsOnPage.push({ 
                                    product: { 
                                        name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, 
                                        size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, 
                                        unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size) 
                                    }, 
                                    score: checklistResult.score // Use the score from checklist
                                });
                            }
                        }
                        
                        const filteredProducts = applyPriceOutlierGuard(validProductsOnPage, log, ingredientKey);
                        currentAttemptLog.foundCount = filteredProducts.length;
                        const currentBestScore = filteredProducts.length > 0 ? filteredProducts.reduce((max, p) => Math.max(max, p.score), 0) : 0;
                        currentAttemptLog.bestScore = currentBestScore;

                        if (filteredProducts.length > 0) {
                            log(`[${ingredientKey}] Found ${filteredProducts.length} valid (${type}).`, 'INFO', 'DATA');
                            const currentUrls = new Set(result.allProducts.map(p => p.url));
                            filteredProducts.forEach(vp => { if (!currentUrls.has(vp.product.url)) { result.allProducts.push(vp.product); } });

                            if (result.allProducts.length > 0) {
                                 // Always update to the best-priced product from all found so far
                                 const foundProduct = result.allProducts.reduce((best, current) => (current.unit_price_per_100 ?? Infinity) < (best.unit_price_per_100 ?? Infinity) ? current : best, result.allProducts[0]);
                                 result.currentSelectionURL = foundProduct.url;
                                 result.source = 'discovery';
                                 currentAttemptLog.status = 'success';
                                 
                                 // Update telemetry *only if* this is the first successful query type
                                 if (acceptedQueryType === 'none') {
                                     acceptedQueryType = type;
                                     bestScore = currentBestScore;
                                 }

                                 // --- [PERF] Ladder Logic Stop Conditions ---
                                 // 1. Strong tight match
                                 if (type === 'tight' && currentBestScore >= SKIP_STRONG_MATCH_THRESHOLD) {
                                     log(`[${ingredientKey}] Skip heuristic hit (Strong tight match).`, 'INFO', 'MARKET_RUN');
                                     break; 
                                 }
                                 // 2. Any valid 'normal' match
                                 if (type === 'normal') {
                                     log(`[${ingredientKey}] Found valid 'normal' match. Stopping search.`, 'DEBUG', 'MARKET_RUN');
                                     break;
                                 }
                                 // --- [END PERF] ---
                            } else { currentAttemptLog.status = 'no_match_post_filter'; }
                        } else { log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA'); currentAttemptLog.status = 'no_match'; }
                    } // end query loop
                    
                    if (result.source === 'failed') { 
                        log(`[${ingredientKey}] Market Run failed after trying all queries.`, 'WARN', 'MARKET_RUN'); 
                    } else { 
                        log(`[${ingredientKey}] Market Run success via '${acceptedQueryType}' query.`, 'DEBUG', 'MARKET_RUN'); 
                    }

                    // --- [PERF] Emit Telemetry ---
                    telemetry.used = acceptedQueryType;
                    telemetry.score = bestScore;
                    log(`[${ingredientKey}] Market Run Telemetry`, 'INFO', 'MARKET_RUN', telemetry);
                    // --- [END PERF] ---

                    return { [ingredientKey]: result };

                } catch(e) {
                    log(`CRITICAL Error in processSingleIngredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                     return { _error: true, itemKey: ingredient?.originalIngredient || 'unknown_error', message: `Internal Market Run Error: ${e.message}` };
                }
            };
            // --- [END PERF] Market Run Ladder Logic ---

            const parallelResultsArray = await concurrentlyMap(dayIngredientsPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
            
            const dayResultsMap = new Map();
            parallelResultsArray.forEach(currentResult => {
                 if (currentResult._error) {
                     log(`Market Run Item Error (Day ${day}) for "${currentResult.itemKey}": ${currentResult.message}`, 'WARN', 'MARKET_RUN');
                     const planItem = dayIngredientsPlan.find(i => i.originalIngredient === currentResult.itemKey);
                     const baseData = planItem || { originalIngredient: currentResult.itemKey, normalizedKey: normalizeKey(currentResult.itemKey) };
                     dayResultsMap.set(baseData.normalizedKey, { ...baseData, source: 'error', error: currentResult.message, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
                     return;
                 }
                 const ingredientKey = Object.keys(currentResult)[0];
                 const resultData = currentResult[ingredientKey];
                 const normalizedKey = normalizeKey(ingredientKey);
                 const planItem = dayIngredientsPlan.find(i => i.normalizedKey === normalizedKey);
                 
                 // --- [NEW] Orphan Key Check (Task 4) ---
                 if (!planItem) {
                     log(`Market run key "${ingredientKey}" (norm: "${normalizedKey}") not found in day plan. Orphan key detected. Skipping item but logging warning.`, 'ERROR', 'SYSTEM'); 
                     addWarning('ORPHAN_KEY', `Ingredient "${ingredientKey}" was found in market results but not linked back to the meal plan.`, { normalizedKey });
                     return;
                 }
                 // --- [END NEW] ---

                 if (resultData && typeof resultData === 'object') {
                     dayResultsMap.set(normalizedKey, { ...planItem, ...resultData, normalizedKey: planItem.normalizedKey });
                 } else {
                      log(`Invalid market result structure for "${ingredientKey}"`, 'ERROR', 'SYSTEM', { resultData });
                      dayResultsMap.set(normalizedKey, { ...planItem, source: 'error', error: 'Invalid market result structure', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
                 }
            });
            
            market_run_ms = Date.now() - marketStartTime; // [PERF] Log time
            log(`Market Run (Day ${day}) took ${(market_run_ms / 1000).toFixed(3)}s`, 'INFO', 'SYSTEM');
            log(`Market Run complete for Day ${day}.`, 'SUCCESS', 'PHASE');
            
            // Return the results for Promise.all
            return { dayResultsMap, dayIngredientsPlan }; 

        })(); // --- [PERF] End of marketRunPromise IIFE ---


        // --- [PERF] Wait for both parallel tracks to finish ---
        const [recipeSettledResults, marketRunResults] = await Promise.all([
            recipePromise, 
            marketRunPromise
        ]);
        
        // Process Market Run results
        const { dayResultsMap, dayIngredientsPlan } = marketRunResults;

        // Process Chef results
        const finalDayMeals = dayMeals.map((meal, index) => {
            const result = recipeSettledResults[index];
            if (result.status === 'fulfilled' && result.value) {
                return { ...meal, ...result.value };
            } else {
                log(`Chef AI failed for meal "${meal.name}": ${result.reason?.message || 'Unknown error'}`, 'ERROR', 'LLM_CHEF');
                return { ...meal, ...MOCK_RECIPE_FALLBACK };
            }
        });
        log(`Chef AI complete for Day ${day}.`, 'SUCCESS', 'PHASE');
        // --- [END PERF] Parallelism changes ---


        // --- Phase 3: Nutrition Fetch ---
        log("Phase 3: Nutrition Fetch (Day " + day + ")...", 'INFO', 'PHASE');
        const nutritionStartTime = Date.now(); // [PERF] Log time
        const itemsToFetchNutrition = [];
        const nutritionDataMap = new Map();

        for (const [normalizedKey, result] of dayResultsMap.entries()) {
            if (result.source === 'discovery' && result.currentSelectionURL && Array.isArray(result.allProducts)) {
                const selected = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                if (selected) {
                    itemsToFetchNutrition.push({ ingredientKey: result.originalIngredient, normalizedKey: normalizedKey, barcode: selected.barcode, query: selected.name });
                }
            }
        }
        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition for ${itemsToFetchNutrition.length} items (Day ${day})...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, async (item) => {
                 try {
                     const nut = (item.barcode || item.query) ? await fetchNutritionData(item.barcode, item.query, log) : { status: 'not_found', source: 'no_query' };
                     return { ...item, nut };
                 } catch (err) {
                     log(`Nutrition fetch error for ${item.ingredientKey}: ${err.message}`, 'WARN', 'HTTP');
                     return { ...item, nut: { status: 'not_found', source: 'error', error: `Nutrition fetch failed: ${err.message}` } };
                 }
             });
            nutrition_ms = Date.now() - nutritionStartTime; // [PERF] Log time
            log(`Nutrition fetch complete for Day ${day}.`, 'SUCCESS', 'HTTP');
            nutritionResults.forEach(item => {
                 if (item && item.normalizedKey && item.nut) {
                    nutritionDataMap.set(item.normalizedKey, item.nut);
                     const result = dayResultsMap.get(item.normalizedKey);
                     if (result && result.source === 'discovery' && Array.isArray(result.allProducts)) {
                         let productToAttach = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                         if (productToAttach) productToAttach.nutrition = item.nut;
                     }
                 } else { log(`Invalid item in nutrition results loop (Day ${day})`, 'WARN', 'CALC', {item}); }
            });
        } else { 
            nutrition_ms = Date.Now() - nutritionStartTime; // [PERF] Log time
            log(`No items require nutrition fetching for Day ${day}.`, 'INFO', 'CALC'); 
        }


        // --- Phase 4: Validation & Reconciliation (Unchanged) ---
        log("Phase 4: Validation & Reconciliation (Day " + day + ")...", 'INFO', 'PHASE');
        let canonicalHitsToday = 0;
        for (const [normalizedKey, result] of dayResultsMap.entries()) {
             const hasNutri = nutritionDataMap.has(normalizedKey) && nutritionDataMap.get(normalizedKey).status === 'found';
             if (!hasNutri && (result.source === 'failed' || result.source === 'error')) {
                 const canonicalNutrition = await fetchNutritionData(null, result.originalIngredient, log);
                 // [MODIFIED] Updated check for canonical source
                 if (canonicalNutrition?.status === 'found' && (canonicalNutrition.source === 'CANON' || canonicalNutrition.source === 'nutrition-search-internal')) {
                     log(`[${result.originalIngredient}] Using CANONICAL fallback (Day ${day}).`, 'DEBUG', 'CALC');
                     nutritionDataMap.set(normalizedKey, canonicalNutrition); canonicalHitsToday++;
                     const finalResult = dayResultsMap.get(normalizedKey); if(finalResult) finalResult.source = 'canonical_fallback';
                 }
             }
         }
        if (canonicalHitsToday > 0) log(`Used ${canonicalHitsToday} canonical fallbacks for Day ${day}.`, 'INFO', 'CALC');

        // --- [MODIFIED] computeItemMacros (Task 3, 5, 6 logic hardening) ---
        // This is the function used as the `getMacros` input for validation later (Task 3)
        const computeItemMacros = (item, mealItems, isReconciliation = false) => {
             if (!item || !item.key || typeof item.qty_value !== 'number' || !item.qty_unit) {
                log(`[computeItemMacros] Invalid item structure received (Day ${day}).`, 'ERROR', 'CALC', item);
                throw new Error(`Plan generation failed for Day ${day}: Invalid item structure during calculation for "${item?.key || 'unknown'}".`);
             }
             // [MODIFIED] Use shared normalizer & guarantee item is normalized
             const normalizedKey = item.normalizedKey || normalizeKey(item.key);
             item.normalizedKey = normalizedKey;
             // State hint is guaranteed to be normalized by generateMealPlan, but run again just in case reconciliation adjusted it
             if(isReconciliation) normalizeStateHintForItem(item, log); 

             const { value: gramsOrMl, unit: normalizedUnit } = normalizeToGramsOrMl(item, log);
             
             // --- [NEW] Quantity Sanity Check (Task 5) ---
             if (!Number.isFinite(gramsOrMl) || gramsOrMl < 0) {
                 log(`[computeItemMacros] CRITICAL: Invalid quantity for item '${item.key}'.`, 'CRITICAL', 'CALC', { item, gramsOrMl });
                 throw new Error(`Calculation error: Invalid quantity for item "${item.key}"`);
             }
             if (gramsOrMl < 10 && item.qty_unit !== 'ml' && item.qty_unit !== 'tsp' && item.qty_unit !== 'tbsp') { // Allow small quantities for liquids/spices
                 addWarning('LOW_QTY', `Item '${item.key}' portion is extremely small (${gramsOrMl.toFixed(1)}g). Check for unit conversion issues.`, { item });
             }
             const MAX_QUANTITY_G = 5000;
             if (gramsOrMl > MAX_QUANTITY_G) {
                 log(`[computeItemMacros] WARNING: Absurd quantity ${gramsOrMl.toFixed(0)}g for '${item.key}'. Capping to ${MAX_QUANTITY_G}g.`, 'WARN', 'CALC', { item });
                 addWarning('ABSURD_QTY_CAPPED', `Item '${item.key}' portion (${gramsOrMl.toFixed(0)}g) capped at ${MAX_QUANTITY_G}g.`, { item, originalQty: gramsOrMl });
                 item.qty_value = MAX_QUANTITY_G; // Mutate the item quantity for calculation purposes
             }
             // --- [END NEW] ---

             if (gramsOrMl === 0) { return { p: 0, f: 0, c: 0, kcal: 0, key: item.key, densityHeuristicUsed: false }; }
             
             // --- [MODIFIED] Yield Conversion Correctness (Task 6: Logic moved to toAsSold/transforms.js) ---
             // toAsSold is responsible for all yield conversions and respects stateHint.
             const { grams_as_sold, log_msg: transform_log, inferredState, inferredMethod } = toAsSold(item, gramsOrMl, log);
             const nutritionData = nutritionDataMap.get(normalizedKey);
             let grams = grams_as_sold;
             let p = 0, f = 0, c = 0, kcal = 0;
             let densityHeuristicUsed = false; 
             let nutritionSource = 'None';
             let nutritionRef = {}; // for logging

             if (nutritionData && nutritionData.status === 'found') {
                 // Use real data
                 const proteinPer100 = Number(nutritionData.protein || nutritionData.protein_g_per_100g) || 0;
                 const fatPer100 = Number(nutritionData.fat || nutritionData.fat_g_per_100g) || 0;
                 const carbsPer100 = Number(nutritionData.carbs || nutritionData.carb_g_per_100g) || 0;
                 p = (proteinPer100 / 100) * grams;
                 f = (fatPer100 / 100) * grams;
                 c = (carbsPer100 / 100) * grams;
                 nutritionSource = nutritionData.source;
                 nutritionRef = { p: proteinPer100, f: fatPer100, c: carbsPer100 };
             } else { 
                // --- [NEW] Conservative Fallback Logic (Task 3) ---
                let fallback = null;
                const keyLower = item.key.toLowerCase();
                // Safe check for dayResultsMap entry
                const dayResult = dayResultsMap.get(normalizedKey);
                const category = dayResult?.allowedCategories?.[0] || 'unknown';

                if (keyLower.includes('oil') || keyLower.includes('butter') || keyLower.includes('ghee')) {
                    fallback = GENERIC_FALLBACK_NUTRITION.oil_generic;
                } else if (category.includes('grain') || keyLower.includes('rice') || keyLower.includes('pasta') || keyLower.includes('oat')) {
                    fallback = GENERIC_FALLBACK_NUTRITION.grain_generic;
                } else if (category.includes('meat') || category.includes('seafood') || keyLower.includes('chicken') || keyLower.includes('fish')) {
                    fallback = GENERIC_FALLBACK_NUTRITION.meat_generic;
                } else if (category.includes('dairy') || keyLower.includes('milk') || keyLower.includes('yogurt') || keyLower.includes('cheese')) {
                    fallback = GENERIC_FALLBACK_NUTRITION.dairy_generic;
                } else if (category.includes('fruit')) {
                    fallback = GENERIC_FALLBACK_NUTRITION.fruit_generic;
                } else if (category.includes('veg') || category.includes('produce')) {
                    fallback = GENERIC_FALLBACK_NUTRITION.vegetable_generic;
                }
                
                if (fallback) {
                    p = (fallback.protein / 100) * grams;
                    f = (fallback.fat / 100) * grams;
                    c = (fallback.carbs / 100) * grams;
                    nutritionSource = fallback.source;
                    nutritionRef = { p: fallback.protein, f: fallback.fat, c: fallback.carbs };
                    log(`[computeItemMacros] WARNING: Using conservative fallback nutrition (${fallback.source}) for '${item.key}'.`, 'WARN', 'CALC', { normalizedKey });
                } else {
                    log(`[computeItemMacros] CRITICAL: No nutrition found for '${item.key}'. Macros set to 0.`, 'CRITICAL', 'CALC', { normalizedKey });
                    addWarning('ZERO_KCAL_ITEM', `Item '${item.key}' has no nutrition data and fell through the generic fallback.`, { item });
                }
                // --- [END NEW] ---
             }
             
             const { absorbed_oil_g, log_msg: oil_log_msg } = getAbsorbedOil(item, inferredMethod, mealItems, log);
             if (absorbed_oil_g > 0) { f += absorbed_oil_g; }
             
             // Calculate final kcal based on the 4/9/4 model
             const calculatedKcal = (p * 4) + (f * 9) + (c * 4);
             
             // --- [NEW] Kcal Comparison for Warning (Task 7) ---
             // This warning tier is only relevant if we used real nutrition data (or a good fallback)
             if (nutritionData && nutritionData.status === 'found') {
                const apiKcal = Number(nutritionData.kcal || nutritionData.kcal_per_100g) || 0;
                // Compare our calculated kcal per 100g vs API reported kcal per 100g
                const pPer100 = nutritionRef.p || (p / grams) * 100;
                const fPer100 = nutritionRef.f || (f / grams) * 100;
                const cPer100 = nutritionRef.c || (c / grams) * 100;
                const calculatedKcalPer100 = (pPer100 * 4) + (fPer100 * 9) + (cPer100 * 4);
                
                if (apiKcal > 0) {
                    const deviation = Math.abs(calculatedKcalPer100 - apiKcal) / apiKcal;
                    if (deviation > 0.10) {
                         addWarning('KCAL_DEV_HIGH', `4/9/4 model for '${item.key}' deviates from API kcal by >10% (${calculatedKcalPer100.toFixed(0)} vs ${apiKcal.toFixed(0)} per 100g).`, { item, apiKcal, calculatedKcalPer100 });
                    }
                }
             }
             kcal = calculatedKcal; // Use the 4/9/4 calculated value

             // --- [NEW] Sanity Check for Item Kcal (Task 7) ---
             if (kcal > 1500 && !item.key.toLowerCase().includes('oil') && !item.key.toLowerCase().includes('butter') && !item.key.toLowerCase().includes('ghee')) {
                 addWarning('HIGH_KCAL_ITEM', `Item '${item.key}' calculates to ${kcal.toFixed(0)} kcal (>=1500 kcal).`, { item });
             }
             if (kcal > MAX_CALORIES_PER_ITEM) {
                log(`CRITICAL: Item '${item.key}' calculated to ${kcal.toFixed(0)} kcal, exceeding sanity limit.`, 'CRITICAL', 'CALC', { item, grams, p, f, c });
                // This is a non-recoverable data error. Fail fast.
                throw new Error(`Calculation error: Item "${item.key}" has an impossibly high calorie count (${kcal.toFixed(0)} kcal). Check unit conversion.`);
             }
             // --- [END NEW] ---

             log(`[computeItemMacros] ${item.key} (${nutritionSource}): ${transform_log} | ${oil_log_msg} | Final: ${kcal.toFixed(0)}kcal`, 'DEBUG', 'CALC', {
                 item, gramsOrMl_user: gramsOrMl, grams_as_sold: grams_as_sold, abs_oil_g: absorbed_oil_g, final_p: p, final_f: f, final_c: c, final_kcal: kcal
             });

             return { p, f, c, kcal, key: item.key, densityHeuristicUsed: false }; 
         };
         // --- End Modification ---

        // --- Calculate Initial Totals (Unchanged) ---
        log(`Calculating initial totals for Day ${day}...`, 'INFO', 'CALC');
        let initialDayKcal = 0, initialDayP = 0, initialDayF = 0, initialDayC = 0;
        let mealHasInvalidItems = false;
        let densityHeuristicsToday = 0;
        // [MODIFIED] Use shared normalizer
        finalDayMeals.forEach(meal => { if (meal && Array.isArray(meal.items)) { meal.items.forEach(item => { if(item && item.key) { item.normalizedKey = normalizeKey(item.key); } }); } });
        for (const meal of finalDayMeals) {
            if (!meal || !Array.isArray(meal.items) || meal.items.length === 0) {
                 log(`Validation Error: Meal "${meal?.name || 'Unnamed'}" has no items (Day ${day}).`, 'CRITICAL', 'CALC');
                 mealHasInvalidItems = true; meal.subtotal_kcal = 0; continue;
            }
            const mealSpecificGetItemMacros = (item) => computeItemMacros(item, meal.items);
            const mergedItemsMap = new Map();
            for(const item of meal.items) {
                 if (!item || !item.normalizedKey || !item.key) { log(`Validation Error: Invalid item structure in meal "${meal.name}" (Day ${day}).`, 'ERROR', 'CALC', item); mealHasInvalidItems = true; continue; }
                 const existing = mergedItemsMap.get(item.normalizedKey); if (existing) { existing.qty_value += (item.qty_value || 0); } else { mergedItemsMap.set(item.normalizedKey, { ...item }); }
             }
            meal.items = Array.from(mergedItemsMap.values());
            let mealKcal = 0, mealP = 0, mealF = 0, mealC = 0;
            for (const item of meal.items) {
                 try {
                     const macros = computeItemMacros(item, meal.items);
                     mealKcal += macros.kcal; mealP += macros.p; mealF += macros.f; mealC += macros.c;
                     if (macros.densityHeuristicUsed) densityHeuristicsToday++;
                 } catch (itemError) { 
                    // --- [MODIFIED] Check if this error came from our new sanity check ---
                    if (itemError.message.startsWith('Calculation error:')) {
                        log(`[computeItemMacros] Failing fast due to sanity check: ${itemError.message}`, 'CRITICAL', 'CALC');
                        throw itemError; // Re-throw the specific error
                    }
                    log(`Error calculating macros for item "${item.key}" in meal "${meal.name}" (Day ${day}): ${itemError.message}`, 'CRITICAL', 'CALC'); 
                    mealHasInvalidItems = true; mealKcal = NaN; break; 
                }
            }
            meal.subtotal_kcal = mealKcal; meal.subtotal_protein = mealP; meal.subtotal_fat = mealF; meal.subtotal_carbs = mealC;
            if (!isNaN(mealKcal)) { initialDayKcal += mealKcal; initialDayP += mealP; initialDayF += mealF; initialDayC += mealC; } else { mealHasInvalidItems = true; }
            if (!isNaN(mealKcal) && mealKcal <= 0) { log(`Validation Error: Meal "${meal.name}" has zero or negative calculated calories (Day ${day}).`, 'CRITICAL', 'CALC', { meal }); mealHasInvalidItems = true; }
            meal.getItemMacros = mealSpecificGetItemMacros;
        }
        if (mealHasInvalidItems) { throw new Error(`Plan generation failed for Day ${day}: One or more meals contain invalid items or calculate to zero/negative calories.`); }
        
        // --- [NEW] Meal Kcal Sanity Check (Task 7) ---
        for (const meal of finalDayMeals) {
            if (meal.subtotal_kcal > 2500) {
                 addWarning('HIGH_KCAL_MEAL', `Meal '${meal.name}' calculates to ${meal.subtotal_kcal.toFixed(0)} kcal (>=2500 kcal).`, { meal: meal.name, kcal: meal.subtotal_kcal });
            }
        }
        // --- [END NEW] ---

        log(`Initial Day ${day} Totals (Float): Kcal=${initialDayKcal.toFixed(1)}, P=${initialDayP.toFixed(1)}g, F=${initialDayF.toFixed(1)}g, C=${initialDayC.toFixed(1)}g`, 'INFO', 'CALC');

        // --- Run Reconciliation (Unchanged) ---
        const targetCalories = nutritionalTargets.calories;
        const initialDeviation = (targetCalories > 0) ? (initialDayKcal - targetCalories) / targetCalories : 0;
        const RECONCILE_FLAG = process.env.CHEFFY_RECONCILE_NONPROTEIN === '1';
        let reconciledMeals = finalDayMeals;
        finalDayTotals = { calories: initialDayKcal, protein: initialDayP, fat: initialDayF, carbs: initialDayC };
        
        // [MODIFIED] Pass isReconciliation=true to computeItemMacros
        const reconcilerGetItemMacros = (item) => {
            const meal = finalDayMeals.find(m => m.items.some(i => i.key === item.key && i.qty_value === item.qty_value && i.stateHint === item.stateHint));
            if (meal && meal.getItemMacros) { return meal.getItemMacros(item); }
            log(`[RECON] Could not find meal context for item ${item.key}. Using context-less calc.`, 'WARN', 'CALC'); 
            return computeItemMacros(item, [], true); // <--- Pass true for reconciliation
        };
        if (RECONCILE_FLAG && Math.abs(initialDeviation) > 0.05) {
            log(`[RECON Day ${day}] Deviation ${(initialDeviation * 100).toFixed(1)}% > 5%. Attempting reconciliation.`, 'WARN', 'CALC');
            const mealsForReconciler = finalDayMeals.map(m => ({ ...m, items: m.items.map(i => ({ ...i, qty: i.qty_value, unit: i.qty_unit })) }));
            const { adjusted, factor, meals: scaledMeals } = reconcileNonProtein({ meals: mealsForReconciler, targetKcal: targetCalories, getItemMacros: reconcilerGetItemMacros, tolPct: 5 });
            if (adjusted) {
                reconciledMeals = scaledMeals.map(m => ({ ...m, items: m.items.map(i => ({ ...i, qty_value: i.qty, qty_unit: i.unit })) }));
                scaleFactor = factor;
                let scaledKcal = 0, scaledP = 0, scaledF = 0, scaledC = 0;
                 for (const meal of reconciledMeals) {
                     let mealKcal = 0, mealP = 0, mealF = 0, mealC = 0; if (!meal || !Array.isArray(meal.items)) continue;
                     for (const item of meal.items) { 
                        try { 
                            // [MODIFIED] Pass true for reconciliation
                            const macros = computeItemMacros(item, meal.items, true); 
                            mealKcal += macros.kcal; mealP += macros.p; mealF += macros.f; mealC += macros.c; 
                        } catch (reconItemError) { 
                         // --- [MODIFIED] Also catch sanity check errors here ---
                         log(`Error recalculating macros post-reconciliation for "${item.key}" (Day ${day}): ${reconItemError.message}`, 'CRITICAL', 'CALC'); 
                         if (reconItemError.message.startsWith('Calculation error:')) throw reconItemError;
                         scaledKcal=NaN; break; 
                        } 
                    }
                     meal.subtotal_kcal = mealKcal; meal.subtotal_protein = mealP; meal.subtotal_fat = mealF; meal.subtotal_carbs = mealC; if(isNaN(scaledKcal)) break;
                     scaledKcal += mealKcal; scaledP += mealP; scaledF += mealF; scaledC += mealC;
                 }
                finalDayTotals = { calories: scaledKcal, protein: scaledP, fat: scaledF, carbs: scaledC };
                log(`[RECON Day ${day}] Reconciliation complete. Factor: ${factor.toFixed(3)}`, 'INFO', 'CALC', { pre: { kcal: initialDayKcal.toFixed(1) }, post: { kcal: finalDayTotals.calories.toFixed(1) } });
            } else { log(`[RECON Day ${day}] Reconciliation ran but no adjustment needed.`, 'INFO', 'CALC'); }
        } else { log(`Reconciliation skipped for Day ${day}. Flag: ${RECONCILE_FLAG}, Deviation: ${(initialDeviation * 100).toFixed(1)}%`, 'INFO', 'CALC'); }

        // --- Final Validation (Unchanged) ---
        const finalDeviation = (targetCalories > 0) ? (finalDayTotals.calories - targetCalories) / targetCalories : 0;
        const finalDeviationPct = finalDeviation * 100;
        const FINAL_TOLERANCE = 0.10;
        log(`Final Validation (Day ${day}): Target=${targetCalories}, Final=${finalDayTotals.calories.toFixed(1)}, Deviation=${finalDeviationPct.toFixed(1)}% (Tolerance: ${FINAL_TOLERANCE*100}%)`, 'INFO', 'CALC');
        if (isNaN(finalDayTotals.calories) || Math.abs(finalDeviation) > FINAL_TOLERANCE) {
            throw new Error(`Plan generation failed for Day ${day}: Calculated calories (${finalDayTotals.calories.toFixed(0)}) deviate too much from target (${targetCalories}). [Code: E_MACRO_MISMATCH]`);
        }

        // --- Round final values (Unchanged) ---
        reconciledMeals.forEach(meal => {
            if (meal) {
                meal.subtotal_kcal = Math.round(meal.subtotal_kcal || 0); meal.subtotal_protein = Math.round(meal.subtotal_protein || 0);
                meal.subtotal_fat = Math.round(meal.subtotal_fat || 0); meal.subtotal_carbs = Math.round(meal.subtotal_carbs || 0);
                 if(Array.isArray(meal.items)){
                     meal.items.forEach(item => { if(item) { item.qty = item.qty_value; item.unit = item.qty_unit; delete item.normalizedKey; delete item.getItemMacros; delete item.qty_value; delete item.qty_unit; } });
                 } delete meal.getItemMacros;
            }
        });

        // --- Phase 5: Assemble Day Response (Task 2, 3, 4, 5) ---
        log("Phase 5: Assembling Response (Day " + day + ")...", 'INFO', 'PHASE');
        const plan_total_ms = Date.now() - planStartTime; // [PERF] Log time
        
        log("Day Telemetry:", 'INFO', 'SYSTEM', { 
            canonical_hits: canonicalHitsToday, 
            density_heuristics: densityHeuristicsToday, 
            scaleFactor: scaleFactor ? parseFloat(scaleFactor.toFixed(3)) : null, 
            final_deviation_pct: parseFloat(finalDeviationPct.toFixed(1)),
            // --- [PERF] Add final telemetry ---
            plan_total_ms,
            dietitian_ms,
            market_run_ms,
            nutrition_ms
            // --- [END PERF] ---
        });

        // --- [NEW] Run Validation (Task 3) ---
        const validationResult = validateDayPlan({
          meals: reconciledMeals,
          dayTotals: finalDayTotals,
          targets: nutritionalTargets,
          nutritionDataMap: nutritionDataMap,
          getMacros: (item) => computeItemMacros(item, []), // Use computeItemMacros
          log: log
        });

        // --- [NEW] Log Validation Issues (Task 5) ---
        if (validationResult && validationResult.hasIssues && validationResult.hasIssues()) {
          log(
            `[VALIDATION] Day ${day}: ${validationResult.issues.length} issues detected (confidence=${validationResult.confidenceScore.toFixed(2)})`,
            'WARN',
            'CALC'
          );
        }
        
        const responseData = {
            message: `Successfully generated plan for Day ${day}.`, day: day,
            mealPlanForDay: { day: day, meals: reconciledMeals },
            dayResults: Object.fromEntries(dayResultsMap.entries()),
            dayUniqueIngredients: dayIngredientsPlan.map(({ normalizedKey, ...rest }) => rest),
            // --- [NEW] Add warnings to final payload (Task 7) ---
            warnings: getWarnings(),
            // --- [NEW] Add validation result to final payload (Task 4) ---
            validation: validationResult.toJSON()
            // --- [END NEW] ---
        };

        log(`Successfully completed generation for Day ${day}.`, 'SUCCESS', 'SYSTEM');
        
        sendFinalDataAndClose(responseData);
        return; 

    } catch (error) {
        log(`CRITICAL Orchestrator ERROR (Day ${day}): ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error(`DAY ${day} UNHANDLED ERROR:`, error);
        
        // --- [MODIFIED] Check for our new sanity check error ---
        const isSanityCheckError = error.message.startsWith('Calculation error:');
        const isPlanError = error.message.startsWith('Plan generation failed');
        const errorCode = isSanityCheckError ? "PLAN_CALC_FAULT" : (isPlanError ? "PLAN_INVALID_DAY" : "SERVER_FAULT_DAY");
        // --- [END MODIFIED] ---

        logErrorAndClose(error.message, errorCode);
        return; 
    }
    // Ensure the stream is closed if execution somehow reaches here without returning (should not happen)
    finally {
        if (response && !response.writableEnded) {
            try { response.end(); } catch {}
        }
    }
};

/// ===== MAIN-HANDLER-END ===== ////

