// --- Cheffy API: /api/plan/generate-full-plan.js ---
// [NEW] Hybrid Batched Orchestrator (V14.0 - Ingredient-Centric Architecture)
// Implements the "full plan" architecture:
// 1. Compute Targets (passed in)
// 2. Generate ALL meals
// 3. Aggregate/Dedupe ALL ingredients
// 4. Run ONE Market Run
// 5. [NEW] Separate Price Extraction (Mod Zone 3)
// 6. [NEW] Run ONE Ingredient-Centric Nutrition Fetch (Mod Zone 1 & 2)
// 7. Run Solver (V1) in SHADOW mode / Reconciler (V0) as LIVE path
// 8. Assemble and return

/// ===== IMPORTS-START ===== \\
const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@vercel/kv');

// Import cache-wrapped microservices
const { fetchPriceData } = require('../price-search.js');
// MOD ZONE 1.1: Import new ingredient-centric function
const { fetchNutritionData, lookupIngredientNutrition } = require('../nutrition-search.js'); 

// Import utils
// Note: Vercel bundles these relative to the project root, hence the `../`
try {
    var { normalizeKey } = require('../scripts/normalize.js');
    var { toAsSold, getAbsorbedOil, TRANSFORM_VERSION, normalizeToGramsOrMl } = require('../utils/transforms.js');
    var { reconcileNonProtein, reconcileMealLevel } = require('../utils/reconcileNonProtein.js'); // FIX: Import reconcileMealLevel
} catch (e) {
    console.error("CRITICAL: Failed to import utils. Using local fallbacks.", e.message);
    var { normalizeKey } = require('../../scripts/normalize.js');
    var { toAsSold, getAbsorbedOil, TRANSFORM_VERSION, normalizeToGramsOrMl } = require('../../utils/transforms.js');
    var { reconcileNonProtein, reconcileMealLevel } = require('../../utils/reconcileNonProtein.js'); // FIX: Import reconcileMealLevel
}

// --- [NEW] Import validation helper (Task 1) ---
const { validateDayPlan } = require('../../utils/validation');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---
/// ===== CONFIG-START ===== \\
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TRANSFORM_CONFIG_VERSION = TRANSFORM_VERSION || 'v13.3-hybrid';

const USE_SOLVER_V1 = process.env.CHEFFY_USE_SOLVER === '1'; // Default to false (use legacy reconcile)
const ALLOW_PROTEIN_SCALING = process.env.CHEFFY_SCALE_PROTEIN === '1'; // D3: New feature flag for protein scaling

const PLAN_MODEL_NAME_PRIMARY = 'gemini-2.0-flash';
const PLAN_MODEL_NAME_FALLBACK = 'gemini-2.5-flash';

const getGeminiApiUrl = (modelName) => `https://generativelanguage
.googleapis.com/v1beta/models/${modelName}:generateContent`;

// --- Vercel KV Client ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const CACHE_PREFIX = `cheffy:plan:v3:t:${TRANSFORM_CONFIG_VERSION}`;
const TTL_PLAN_MS = 1000 * 60 * 60 * 24; // 24 hours

// --- Performance & API Constants ---
const MAX_LLM_RETRIES = 3;
const LLM_REQUEST_TIMEOUT_MS = 90000; // 90 seconds
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60;
const SKIP_STRONG_MATCH_THRESHOLD = 0.80;
const MARKET_RUN_CONCURRENCY = 6;
const NUTRITION_CONCURRENCY = 6;
const TOKEN_BUCKET_CAPACITY = 10;
const TOKEN_BUCKET_REFILL_PER_SEC = 10;
const TOKEN_BUCKET_MAX_WAIT_MS = 250;
const FAIL_FAST_CATEGORIES = ["produce", "meat", "dairy", "veg", "fruit", "seafood"];

const BANNED_KEYWORDS = [
    'cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy',
    'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder',
    'folder', 'stationery', 'lighter', 'shampoo', 'conditioner', 'soap', 'lotion',
    'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum'
];
const PRICE_OUTLIER_Z_SCORE = 2.0;
const PANTRY_CATEGORIES = ["pantry", "grains", "canned", "spreads", "condiments", "drinks"];
const MAX_CALORIES_PER_ITEM = 1200; // Sanity check

/// ===== CONFIG-END ===== ////

/// ===== MOCK-START ===== \\
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const MOCK_RECIPE_FALLBACK = {
    description: "Meal description could not be generated.",
    instructions: ["Cooking instructions could not be generated for this meal. Please rely on standard cooking methods for the ingredients listed."]
};
/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\

// --- Cache Helpers ---
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


// --- Logger (SSE Aware for Batched Plan) ---
function createLogger(run_id, responseStream = null) {
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
            // Ensure data is always an object, even if a simple string is passed
            const payload = (typeof data === 'string') ? { message: data } : data;
            const dataString = JSON.stringify(payload);
            responseStream.write(`event: ${eventType}\n`);
            responseStream.write(`data: ${dataString}\n\n`);
        } catch (e) {
            // This might fail if the client disconnected
            console.error(`[SSE Logger] Failed to write event ${eventType} to stream: ${e.message}`);
            // Attempt to close the stream gracefully if write fails
             try { if (!responseStream.writableEnded) responseStream.end(); } catch {}
        }
    };

    /**
     * Creates a log entry, sends it via SSE, and logs it to the console.
     * @param {string} message - The log message.
     * @param {string} [level='INFO'] - Log level (e.g., 'INFO', 'WARN', 'ERROR').
     * @param {string} [tag='SYSTEM'] - A tag for categorizing the log (e.g., 'LLM', 'MARKET_RUN').
     * @param {object} [data=null] - Optional serializable data.
     */
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        let logEntry;
        try {
            logEntry = {
                timestamp: new Date().toISOString(),
                run_id: run_id,
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                data: data ? JSON.parse(JSON.stringify(data, (key, value) => // Basic serialization
                    (typeof value === 'string' && value.length > 300) ? value.substring(0, 300) + '...' : value
                )) : null
            };
            logs.push(logEntry);
            
            // Send log message over SSE
            writeSseEvent('log_message', logEntry);

            // Also log to console for server visibility
             const time = new Date(logEntry.timestamp).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Brisbane' });
             console.log(`${time} [${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
             // Only log data blobs for non-debug or high-severity levels
             if (data && (level !== 'DEBUG' || ['ERROR', 'CRITICAL', 'WARN'].includes(level))) {
                 try {
                     // Truncate long strings within data for console logging
                     const truncatedData = JSON.stringify(data, (k, v) => typeof v === 'string' && v.length > 150 ? v.substring(0, 150) + '...' : v, 2);
                     console.log("  Data:", truncatedData.length > 500 ? truncatedData.substring(0, 500) + '...' : truncatedData);
                 } catch { console.log("  Data: [Serialization Error]"); }
             }
            return logEntry;
        } catch (error) {
             // Fallback if logging itself fails
             const fallbackEntry = { timestamp: new Date().toISOString(), run_id: run_id, level: 'ERROR', tag: 'LOGGING', message: `Log serialization failed: ${message}`, data: { error: error.message }}
             logs.push(fallbackEntry);
             console.error(JSON.stringify(fallbackEntry));
             // Try to send this critical error over SSE
             writeSseEvent('log_message', fallbackEntry);
             return fallbackEntry;
        }
    };

    /**
     * Logs a critical error, sends an 'error' event, and closes the stream.
     * @param {string} errorMessage - The final error message.
     * @param {string} [errorCode="SERVER_FAULT_PLAN"] - A machine-readable error code.
     */
    const logErrorAndClose = (errorMessage, errorCode = "SERVER_FAULT_PLAN") => {
        log(errorMessage, 'CRITICAL', 'SYSTEM'); // Log it normally first
        writeSseEvent('error', {
            code: errorCode,
            message: errorMessage
        });
        if (responseStream && !responseStream.writableEnded) {
            try { responseStream.end(); } catch (e) { console.error("[SSE Logger] Error closing stream after error event:", e.message); }
        }
    };
    
    /**
     * Sends the final 'plan:complete' event and closes the stream.
     * @param {object} data - The final plan data payload.
     */
    const sendFinalDataAndClose = (data) => {
        log(`Generation complete, sending final payload and closing stream.`, 'INFO', 'SYSTEM');
        writeSseEvent('plan:complete', data);
        if (responseStream && !responseStream.writableEnded) {
            try { responseStream.end(); } catch (e) { console.error("[SSE Logger] Error closing stream after final data:", e.message); }
        }
    };
    
    /**
     * Sends a generic SSE event.
     * @param {string} eventType - The event name.
     * @param {object} data - The JSON-serializable data payload.
     */
    const sendEvent = (eventType, data) => {
        writeSseEvent(eventType, data);
    };

    // [FIX] Explicitly define getLogs as a function returning the logs array
    return { log, getLogs: () => logs, logErrorAndClose, sendFinalDataAndClose, sendEvent };
}
// --- End Logger ---


// --- Other Helpers ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getSanitizedFormData(formData) {
    try {
        if (!formData || typeof formData !== 'object') return { error: "Invalid form data received." };
        // Redact PII
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
                // Remove this promise from the executing list once it's done
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                return result;
            })
            .catch(error => {
                // Handle errors gracefully
                console.error(`Error in concurrentlyMap item "${item?.originalIngredient || item?.name || 'unknown'}":`, error);
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                // Return an error object to be handled by the caller
                return { _error: true, message: error.message || 'Unknown concurrent map error', itemKey: item?.originalIngredient || item?.name || 'unknown' };
            });
        executing.push(promise);
        results.push(promise);
        if (executing.length >= limit) {
            // Wait for at least one promise to resolve before adding more
            await Promise.race(executing);
        }
    }
    return Promise.all(results).then(res => res.filter(r => r != null)); // Filter out null/undefined results
}

// --- fetchLLMWithRetry with JSON Guard ---
async function fetchLLMWithRetry(url, options, log, attemptPrefix = "LLM") {
    for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

        try {
            log(`${attemptPrefix} Attempt ${attempt}: Fetching from ${url} (Timeout: ${LLM_REQUEST_TIMEOUT_MS}ms)`, 'DEBUG', 'HTTP');
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout); // Clear the timeout as the request completed

            if (response.ok) {
                // [FIX] Read as text first to check for non-JSON
                const rawText = await response.text();
                if (!rawText || rawText.trim() === "") {
                    // This can happen. Treat as a retryable error.
                    throw new Error("Response was 200 OK but body was empty.");
                }
                
                const trimmedText = rawText.trim();
                // [FIX] Check if the text *looks* like JSON before parsing
                if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
                    // It looks like JSON, return a new response-like object
                    return {
                        ok: true,
                        status: response.status,
                        json: () => Promise.resolve(JSON.parse(trimmedText)), // Parse the text we already read
                        text: () => Promise.resolve(trimmedText)
                    };
                } else {
                    // This is a 200 OK with a non-JSON body (e.g., "I cannot..." safety refusal)
                    log(`${attemptPrefix} Attempt ${attempt}: 200 OK with non-JSON body. Retrying...`, 'WARN', 'HTTP', { body: trimmedText.substring(0, 100) });
                    throw new Error(`200 OK with non-JSON body: ${trimmedText.substring(0, 100)}`);
                }
            }

            // Handle non-OK statuses
            if (response.status === 429 || response.status >= 500) {
                // Retryable server errors
                log(`${attemptPrefix} Attempt ${attempt}: Received retryable error ${response.status}. Retrying...`, 'WARN', 'HTTP');
            } else {
                // Client errors (400, 401, etc.) - not retryable
                const errorBody = await response.text();
                log(`${attemptPrefix} Attempt ${attempt}: Non-retryable error ${response.status}.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`${attemptPrefix} call failed with status ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
             clearTimeout(timeout); // Clear timeout on error
             
             if (error.name === 'AbortError') {
                 // Request timed out
                 log(`${attemptPrefix} Attempt ${attempt}: Fetch timed out after ${LLM_REQUEST_TIMEOUT_MS}ms. Retrying...`, 'WARN', 'HTTP');
             } else if (error instanceof SyntaxError) {
                 // This shouldn't happen with the new guard, but as a safety net
                log(`${attemptPrefix} Attempt ${attempt}: Failed to parse response as JSON. Retrying...`, 'WARN', 'HTTP', { error: error.message });
             } else if (!error.message?.startsWith(`${attemptPrefix} call failed with status`)) {
                 // General network error or the 200-non-JSON error
                log(`${attemptPrefix} Attempt ${attempt}: Fetch failed: ${error.message}. Retrying...`, 'WARN', 'HTTP');
             } else {
                 // This was a non-retryable error (e.g., 400)
                 throw error; // Rethrow non-retryable or final attempt errors
             }
        }

        // Wait before retrying
        if (attempt < MAX_LLM_RETRIES) {
            const delayTime = Math.pow(2, attempt -1) * 3000 + Math.random() * 1000; // Exponential backoff
            log(`Waiting ${delayTime.toFixed(0)}ms before ${attemptPrefix} retry...`, 'DEBUG', 'HTTP');
            await delay(delayTime);
        }
    }
    
    // All retries failed
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
            // Convert to base unit (g or ml)
            let totalUnits = (unit === 'kg' || unit === 'l') ? numericSize * 1000 : numericSize;
            if (totalUnits >= 100) {
                // Calculate price per 100 units
                return (price / totalUnits) * 100;
            }
        }
    }
    return price; // Fallback to item price if unit parse fails
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

// --- Validation Helpers ---
function passRequiredWords(title = '', required = []) {
  if (!required || required.length === 0) return true;
  const t = title.toLowerCase();
  return required.every(w => {
    if (!w) return true; // Handle empty strings in requiredWords array
    const base = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
    // Match whole word, allow optional 's' for plural
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
    if (products.length < 3) return products; // Not enough data to check for outliers
    const prices = products.map(p => p.product.unit_price_per_100).filter(p => p > 0);
    if (prices.length < 3) return products;
    
    const m = mean(prices);
    const s = stdev(prices);
    if (s === 0) return products; // All prices are identical

    return products.filter(p => {
        const price = p.product.unit_price_per_100;
        if (price <= 0) return true; // Keep items with no price data
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
    // If no target size is specified, or we can't parse the product size, it passes
    if (!productSizeParsed || !targetSize || !targetSize.value || !targetSize.unit) return true;
    
    // If units mismatch (e.g., 'g' vs 'ml'), fail
    if (productSizeParsed.unit !== targetSize.unit) {
        log(`${checkLogPrefix}: WARN (Size Unit Mismatch ${productSizeParsed.unit} vs ${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
        return false;
    }
    
    const prodValue = productSizeParsed.value;
    const targetValue = targetSize.value;
    
    // Set multipliers based on category
    const isPantry = PANTRY_CATEGORIES.some(c => allowedCategories?.some(ac => ac.toLowerCase() === c));
    const maxMultiplier = 3.0; // Allow buying larger pantry items
    const minMultiplier = 0.5; // Don't buy less than half the target size
    
    const lowerBound = targetValue * minMultiplier;
    const upperBound = targetValue * maxMultiplier;

    if (prodValue >= lowerBound && prodValue <= upperBound) return true;

    // Fails size check
    log(`${checkLogPrefix}: FAIL (Size ${prodValue}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit} for ${isPantry ? 'pantry' : 'perishable'})`, 'DEBUG', 'CHECKLIST');
    return false;
}

/**
 * Runs a comprehensive checklist against a single product.
 */
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) return { pass: false, score: 0 };
    
    if (!ingredientData || typeof ingredientData !== 'object' || !ingredientData.originalIngredient) {
        log(`Checklist: Invalid/missing ingredientData for "${product.product_name}"`, 'ERROR', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    
    const { originalIngredient, requiredWords = [], negativeKeywords = [], targetSize, allowedCategories = [] } = ingredientData;
    const checkLogPrefix = `Checklist [${originalIngredient}] for "${product.product_name}"`;

    // 1. Global Banned List
    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    
    // 2. Negative Keywords
    if ((negativeKeywords ?? []).length > 0) {
        const negativeWordFound = negativeKeywords.find(kw => kw && productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }
    
    // 3. Required Words
    if (!passRequiredWords(productNameLower, requiredWords ?? [])) {
        log(`${checkLogPrefix}: FAIL (Required words missing: [${(requiredWords ?? []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // 4. Category (Not yet implemented in API response - keeping day.js logic for now)
    // In day.js, the LLM provides allowedCategories which we use here.
    if (!passCategory(product, allowedCategories)) {
         log(`${checkLogPrefix}: FAIL (Category Mismatch: "${product.product_category}" not in [${(allowedCategories || []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
         return { pass: false, score: 0 };
    }
    
    // 5. Size Check (skip for produce/fruit/veg)
    const isProduceOrFruit = (allowedCategories || []).some(c => c === 'fruit' || c === 'produce' || c === 'veg');
    const productSizeParsed = parseSize(product.product_size);
    
    if (!isProduceOrFruit && !sizeOk(productSizeParsed, targetSize, allowedCategories, log, originalIngredient, checkLogPrefix)) {
        return { pass: false, score: 0 }; // Failed size check
    } else if (isProduceOrFruit) {
         log(`${checkLogPrefix}: INFO (Bypassing size check for fruit/produce)`, 'DEBUG', 'CHECKLIST');
    }

    log(`${checkLogPrefix}: PASS`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: 1.0 }; // Simple score
}

// --- State Hint Normalizer (New function for step 4) ---
function normalizeStateHintForItem(item, log) {
  const key = (item.key || '').toLowerCase();
  let hint = (item.stateHint || '').toLowerCase().trim();

  // If hint is invalid, drop it to force defaulting
  const validHints = ['dry', 'raw', 'cooked', 'as_pack'];
  if (!validHints.includes(hint)) {
    if (hint) {
      log(`Invalid stateHint '${hint}' for '${item.key}'. Clearing hint to force default/fallback.`, 'WARN', 'STATE_HINT');
    }
    hint = '';
  }

  // If the hint is still empty, apply defaults based on key:
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
      key.includes('millet');

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
      key.includes('mince');

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

    // Final fallback: leave empty, transforms will still handle it
    if (!hint && log) {
      log(`No stateHint for '${item.key}', leaving undefined (will use transforms fallback).`, 'WARN', 'STATE_HINT');
    }
  }

  // Mutate item in place so downstream code uses normalized stateHint
  item.stateHint = hint;

  return item;
}

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
/// ===== HELPERS-END ===== ////


/// ===== API-CALLERS-START ===== \\

// --- LLM System Prompt (Step A1, A2, A3) ---
const MEAL_PLANNER_SYSTEM_PROMPT = (weight, calories, mealMax, day, perMealTargets) => `
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
5.  **PER-MEAL TARGETS (A2):** Each MAIN meal (Breakfast, Lunch, Dinner) should aim for ~${perMealTargets.main.calories} kcal, ~${perMealTargets.main.protein}g protein. Each SNACK should aim for ~${perMealTargets.snack.calories} kcal, ~${perMealTargets.snack.protein}g protein.
6.  **PORTION SCALING (A3):** CRITICAL: Scale protein portions to match per-meal targets. Example: If per-meal protein target is 40g, use ~120-130g chicken breast (not 200g).
7.  The code will calculate total calories based on your plan; you do NOT need to estimate them.
8.  Adhere to all user constraints.
9.  'meals' array is MANDATORY. Do NOT include 'ingredients' array.
10. Do NOT include calorie estimates in your response.

CRITICAL STATE HINT RULES:
- "dry": Quantity refers to dry or uncooked weight (oats, rice, pasta, noodles, lentils, quinoa, other grains).
- "raw": Quantity refers to raw weight (meat, poultry, fish, eggs, raw vegetables).
- "cooked": Quantity refers to cooked or prepared weight (only if the user explicitly says "cooked" or the food is eaten cooked and measured after cooking).
- "as_pack": Quantity refers to packaged or ready-to-eat form (yogurt, milk, bread, cheese, ready-to-eat snacks).

DEFAULT BY CATEGORY:
- Grains and pasta (oats, rice, pasta, noodles, couscous, quinoa, bulgur, barley, polenta, etc.) → "dry" unless the user explicitly specifies cooked weight.
- Meats and fish (chicken, beef, pork, lamb, fish, mince, etc.) → "raw" unless explicitly cooked.
- Dairy, bread and packaged foods → "as_pack" unless clearly prepared differently.

You MUST return a valid "stateHint" for every ingredient. Do NOT leave it null or empty.
Valid values are only: "dry", "raw", "cooked", "as_pack".

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

// --- Grocery Optimizer Prompt ---
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

// --- Chef AI Prompt (Consolidated Definition) ---
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

/**
 * Tries to generate a plan from an LLM, retrying on failure.
 * Includes a guard against non-JSON responses.
 */
async function tryGenerateLLMPlan(modelName, payload, log, logPrefix, expectedJsonShape) {
    log(`${logPrefix}: Attempting model: ${modelName}`, 'INFO', 'LLM');
    const apiUrl = getGeminiApiUrl(modelName);

    const response = await fetchLLMWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload)
    }, log, logPrefix); // FIX: Passed logPrefix instead of undefined attemptPrefix

    const result = await response.json(); // Safe to call .json() because of the guard in fetchLLMWithRetry
    const candidate = result.candidates?.[0];
    const finishReason = candidate?.finishReason;

    // These checks are now for *after* a successful, JSON-parsed response
    if (finishReason === 'MAX_TOKENS') {
        log(`${logPrefix}: Model ${modelName} failed with finishReason: MAX_TOKENS.`, 'WARN', 'LLM'); // FIX: Used logPrefix
        throw new Error(`Model ${modelName} failed: MAX_TOKENS.`);
    }
    if (finishReason !== 'STOP') {
         log(`${logPrefix}: Model ${modelName} failed with non-STOP finishReason: ${finishReason}`, 'WARN', 'LLM', { result }); // FIX: Used logPrefix
         throw new Error(`Model ${modelName} failed: FinishReason was ${finishReason}.`);
    }

    const content = candidate?.content;
    if (!content || !content.parts || content.parts.length === 0 || !content.parts[0].text) {
        log(`${logPrefix}: Model ${modelName} response missing content or text part.`, 'CRITICAL', 'LLM', { result }); // FIX: Used logPrefix
        throw new Error(`Model ${modelName} failed: Response missing content.`);
    }

    // At this point, content.parts[0].text *is* the JSON string (already parsed once in fetchLLMWithRetry)
    const jsonText = content.parts[0].text;
    log(`${logPrefix} Raw JSON Text`, 'DEBUG', 'LLM', { raw: jsonText.substring(0, 300) + '...' }); // FIX: Used logPrefix

    try {
        // Re-parse (this is cheap) to validate shape
        const parsed = JSON.parse(jsonText.trim());
        
        if (!parsed || typeof parsed !== 'object') {
            throw new Error("Parsed response is not a valid object.");
        }
        
        // Check if the parsed object matches the expected structure
        for (const key in expectedJsonShape) {
            if (!parsed.hasOwnProperty(key)) {
                throw new Error(`Parsed JSON missing required top-level key: '${key}'.`);
            }
            if (Array.isArray(expectedJsonShape[key]) && !Array.isArray(parsed[key])) {
                throw new Error(`Parsed JSON key '${key}' was not an array.`);
            }
        }
        
        log(`${logPrefix}: Model ${modelName} succeeded.`, 'SUCCESS', 'LLM'); // FIX: Used logPrefix
        return parsed; // Return the parsed object

    } catch (parseError) {
        log(`Failed to parse/validate ${logPrefix} JSON from ${modelName}: ${parseError.message}`, 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 300) }); // FIX: Used logPrefix
        throw new Error(`Model ${modelName} failed: Invalid JSON response. ${parseError.message}`);
    }
}


/**
 * Generates a meal plan for a *single* day.
 * (Step A1, A4: Update signature and user query)
 */
async function generateMealPlan_Single(day, formData, nutritionalTargets, log, perMealTargets) {
    const { name, height, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const { calories, protein, fat, carbs } = nutritionalTargets;
    
    const mainMealCal = Math.round(perMealTargets.main.calories);
    const mainMealP = Math.round(perMealTargets.main.protein);
    const snackCal = Math.round(perMealTargets.snack.calories);
    const snackP = Math.round(perMealTargets.snack.protein);

    // 1. Check Cache
    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets, perMealTargets })); // Include targets in cache key
    const cacheKey = `${CACHE_PREFIX}:meals:day${day}:${profileHash}`;
    const cached = await cacheGet(cacheKey, log);
    if (cached) {
        return { dayNumber: day, meals: cached.meals }; // Return the full day object
    }
    log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');

    // 2. Prepare Prompt
    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']};
    const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus: ${cuisine}.` : 'Neutral.';

    // Removed outdated mealAvg/mealMax calculation

    const systemPrompt = MEAL_PLANNER_SYSTEM_PROMPT(weight, calories, 0, day, perMealTargets); // mealMax parameter is now obsolete, passed 0
    let userQuery = `Gen plan Day ${day} for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Day ${day} Targets: DAILY ~${calories} kcal. PER MAIN MEAL: ~${mainMealCal} kcal, ~${mainMealP}g protein. PER SNACK: ~${snackCal} kcal, ~${snackP}g protein. Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority}. Cuisine: ${cuisineInstruction}.`;

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
    
    // 3. Execute LLM Call
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
    
    // 4. Cache and Return
    if (parsedResult && parsedResult.meals && parsedResult.meals.length > 0) {
        await cacheSet(cacheKey, parsedResult, TTL_PLAN_MS, log);
    }
    return { dayNumber: day, meals: parsedResult.meals || [] };
}


/**
 * Generates grocery query details for the *entire* aggregated list.
 */
async function generateGroceryQueries_Batched(aggregatedIngredients, store, log) {
// ... (omitted)
    if (!aggregatedIngredients || aggregatedIngredients.length === 0) {
        log("generateGroceryQueries_Batched called with no ingredients. Returning empty.", 'WARN', 'LLM');
        return { ingredients: [] };
    }

    // 1. Check Cache
    const keysHash = hashString(JSON.stringify(aggregatedIngredients));
    const cacheKey = `${CACHE_PREFIX}:queries-batched:${store}:${keysHash}`;
    const cached = await cacheGet(cacheKey, log);
    if (cached) return cached;
    log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');
    
    // 2. Prepare Prompt
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion', 'capsicum')." : "";

    const systemPrompt = GROCERY_OPTIMIZER_SYSTEM_PROMPT(store, australianTermNote);
    
    // Map aggregated list to the format the LLM needs
    const llmInput = aggregatedIngredients.map(item => ({
        originalIngredient: item.originalIngredient,
        requested_total_g: item.requested_total_g
    }));
    let userQuery = `Generate query JSON for the following ingredients:\n${JSON.stringify(llmInput)}`;

    const logPrefix = `GroceryOptimizerFullPlan`;
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

    // 3. Execute LLM Call
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
    
    // 4. Post-process and Cache
    if (parsedResult && parsedResult.ingredients && parsedResult.ingredients.length > 0) {
        // --- Sanity Check & Fix ---
        // The LLM sometimes ignores the 'totalGramsRequired' from the prompt.
        // We must overwrite its estimate with our *actual* aggregated total.
        const inputMap = new Map(aggregatedIngredients.map(item => [item.originalIngredient, item.requested_total_g]));
        parsedResult.ingredients.forEach(ing => {
            const requestedGrams = inputMap.get(ing.originalIngredient);
            if (requestedGrams && ing.totalGramsRequired !== requestedGrams) {
                log(`Grocery Optimizer mismatch for "${ing.originalIngredient}". LLM returned ${ing.totalGramsRequired}g, but plan needs ${requestedGrams}g. Overwriting.`, 'DEBUG', 'LLM');
                ing.totalGramsRequired = requestedGrams;
            }
        });
        // --- End Sanity Check ---
        
        await cacheSet(cacheKey, parsedResult, TTL_PLAN_MS, log);
    }
    
    return parsedResult;
}

/**
 * Tries to generate a recipe from an LLM, retrying on failure.
 * Includes a guard against non-JSON responses.
 */
async function tryGenerateChefRecipe(modelName, payload, mealName, log) {
    log(`Chef AI [${mealName}]: Attempting model: ${modelName}`, 'INFO', 'LLM_CHEF');
    const apiUrl = getGeminiApiUrl(modelName);

    const response = await fetchLLMWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload)
    }, log, `Chef-${mealName}`);

    const result = await response.json(); // Safe due to guard
    const candidate = result.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason !== 'STOP') {
        log(`Chef AI [${mealName}]: Model ${modelName} failed with non-STOP finishReason: ${finishReason}`, 'WARN', 'LLM_CHEF', { result });
        throw new Error(`Model ${modelName} failed: FinishReason was ${finishReason}.`);
    }

    const content = candidate?.content;
    if (!content || !content.parts || !content.parts.length === 0 || !content.parts[0].text) {
        log(`Chef AI [${mealName}]: Model ${modelName} response missing content or text part.`, 'CRITICAL', 'LLM_CHEF', { result });
        throw new Error(`Model ${modelName} failed: Response missing content.`);
    }

    const jsonText = content.parts[0].text;
    try {
        // [FIX] Add JSON guard
        const trimmedText = jsonText.trim();
        if (!trimmedText.startsWith('{') || !trimmedText.endsWith('}')) {
             throw new Error(`Response text was not a JSON object. (Likely a safety refusal)`);
        }
        
        const parsed = JSON.parse(trimmedText); 
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

async function generateChefInstructions(meal, store, log) {
    const mealName = meal.name || 'Unnamed Meal';
    try {
        // 1. Check Cache
        const mealHash = hashString(JSON.stringify(meal.items || []));
        const cacheKey = `${CACHE_PREFIX}:recipe:${mealHash}`;
        const cached = await cacheGet(cacheKey, log);
        if (cached) return { ...meal, ...cached }; // Return merged object
        log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');

        // 2. Prepare Prompt
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

        // 3. Execute LLM Call
        let recipeResult;
        try {
            recipeResult = await tryGenerateChefRecipe(PLAN_MODEL_NAME_PRIMARY, payload, mealName, log);
        } catch (primaryError) {
            log(`Chef AI [${mealName}]: PRIMARY Model ${PLAN_MODEL_NAME_PRIMARY} failed: ${primaryError.message}. Attempting FALLBACK.`, 'WARN', 'LLM_CHEF');
            try {
                recipeResult = await tryGenerateChefRecipe(PLAN_MODEL_NAME_FALLBACK, payload, mealName, log);
            } catch (fallbackError) {
                log(`Chef AI [${mealName}]: FALLBACK Model ${PLAN_MODEL_NAME_FALLBACK} also failed: ${fallbackError.message}.`, 'CRITICAL', 'LLM_CHEF');
                // Don't throw; return mock data
                recipeResult = MOCK_RECIPE_FALLBACK;
            }
        }
        
        // 4. Cache and Return
        if (recipeResult && recipeResult.description) {
            await cacheSet(cacheKey, recipeResult, TTL_PLAN_MS, log);
        }
        return { ...meal, ...recipeResult }; // Return the modified meal object
    } catch (error) {
        log(`CRITICAL Error in generateChefInstructions for [${mealName}]: ${error.message}`, 'CRITICAL', 'LLM_CHEF');
        return { ...meal, ...MOCK_RECIPE_FALLBACK };
    }
}


/// ===== API-CALLERS-END ===== ////


// --- Market Run Logic (Copied from day.js) ---
/* The processSingleIngredientOptimized function was here but has been moved
   inside the main handler (module.exports) where the 'log' and 'store' variables
   are correctly scoped to fix the "log is not defined" error. 
*/

// --- End Market Run Logic ---


/// ===== MAIN-HANDLER-START ===== \\
module.exports = async (request, response) => {
    const planStartTime = Date.now();
    let dietitian_ms = 0, market_run_ms = 0, nutrition_ms = 0, solver_ms = 0, writer_ms = 0; // Telemetry timers
    
    const run_id = crypto.randomUUID();

    // --- Setup SSE Stream ---
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); 
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    
    // [FIX] Pass `run_id` to logger
    const { log, getLogs, logErrorAndClose, sendFinalDataAndClose, sendEvent } = createLogger(run_id, response);
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

    let finalMealPlan = []; // This will hold the final, processed meals
    let store = ''; // Must be defined outside try block for market run logic scope

    try {
        const { formData, nutritionalTargets } = request.body;
        const numDays = parseInt(formData.days, 10) || 7;
        log(`Plan generation starting for ${numDays} days.`, 'INFO', 'SYSTEM');
        sendEvent('plan:start', { days: numDays, formData: getSanitizedFormData(formData) });

        // --- Input Validation ---
        if (!formData || typeof formData !== 'object' || Object.keys(formData).length < 5) {
            throw new Error("Missing or invalid 'formData' in request body.");
        }
        if (!nutritionalTargets || typeof nutritionalTargets !== 'object' || !nutritionalTargets.calories) {
            throw new Error("Missing or invalid 'nutritionalTargets' in request body.");
        }
        // CRITICAL: Define store variable
        store = formData.store;
        if (!store) throw new Error("'store' missing in formData.");

        // --- Phase B: Implement Realistic Meal-Type Target Distribution (B2, B3, B4) ---
        const eatingOccasions = parseInt(formData.eatingOccasions, 10) || 3;
        const mainMealCount = Math.min(eatingOccasions, 3); // B, L, D
        const snackCount = Math.max(0, eatingOccasions - mainMealCount);

        let mainRatio, snackRatio;

        if (eatingOccasions === 4) {
            // B=28%, L=28%, D=28%, S1=16%. Total Main: 84%, Total Snack: 16%
            mainRatio = 0.84;
            snackRatio = 0.16;
        } else if (eatingOccasions >= 5) {
            // B=25%, L=25%, D=25%, S1=12.5%, S2=12.5%. Total Main: 75%, Total Snack: 25%
            mainRatio = 0.75;
            snackRatio = 0.25;
        } else {
            // 3 meals: B=33.3%, L=33.3%, D=33.3%. Total Main: 100%, Total Snack: 0%
            mainRatio = 1.0;
            snackRatio = 0.0;
        }
        
        const mainMealSplit = mainMealCount > 0 ? mainRatio / mainMealCount : 0;
        const snackSplit = snackCount > 0 ? snackRatio / snackCount : 0;

        const targetsPerMealType = {
            main: {
                calories: nutritionalTargets.calories * mainMealSplit,
                protein: nutritionalTargets.protein * mainMealSplit,
                fat: nutritionalTargets.fat * mainMealSplit,
                carbs: nutritionalTargets.carbs * mainMealSplit,
            },
            snack: {
                calories: nutritionalTargets.calories * snackSplit,
                protein: nutritionalTargets.protein * snackSplit,
                fat: nutritionalTargets.fat * snackSplit,
                carbs: nutritionalTargets.carbs * snackSplit,
            },
            // Used for solver macro logging (Phase 5)
            mainCount: mainMealCount,
            snackCount: snackCount
        };


        // --- Phase 1: Generate ALL Meals (Sequentially) ---
        sendEvent('phase:start', { name: 'meals', description: `Generating ${numDays}-day meal plan...` });
        const dietitianStartTime = Date.now();
        const fullMealPlan = []; // This is the master list of day objects
        
        for (let day = 1; day <= numDays; day++) {
            try {
                // Send progress *before* starting the call
                sendEvent('plan:progress', { pct: (day / numDays) * 25, message: `Generating meal plan for Day ${day}...` });
                // Step A1: Pass the new meal targets
                const dayPlan = await generateMealPlan_Single(day, formData, nutritionalTargets, log, targetsPerMealType);
                if (!dayPlan || !dayPlan.meals || dayPlan.meals.length === 0) {
                    throw new Error(`Meal Planner AI returned no meals for Day ${day}.`);
                }
                fullMealPlan.push(dayPlan);
            } catch (dayError) {
                 log(`Failed to generate meals for Day ${day}: ${dayError.message}`, 'ERROR', 'LLM');
                 // If one day fails, we can't continue.
                 throw new Error(`Meal plan generation failed: ${dayError.message}`);
            }
        }
        
        dietitian_ms = Date.now() - dietitianStartTime;
        sendEvent('phase:end', { name: 'meals', duration_ms: dietitian_ms, mealCount: fullMealPlan.reduce((acc, day) => acc + day.meals.length, 0) });
        
        // This check is now robust
        if (fullMealPlan.length !== numDays) {
            throw new Error(`Meal Planner AI failed: Expected ${numDays} days, but only received ${fullMealPlan.length}.`);
        }

        // --- Phase 2: Aggregate Ingredients ---
        sendEvent('phase:start', { name: 'aggregate', description: 'Aggregating ingredient list...' });
        const aggregateStartTime = Date.now();
        const ingredientMap = new Map(); // Use normalizedKey as the key

        for (const day of fullMealPlan) {
            for (const meal of day.meals) {
                // Add normalizedKey to all items *early*
                meal.items.forEach(item => { if(item && item.key) { item.normalizedKey = normalizeKey(item.key); } });

                for (const item of meal.items) {
                    // [Step 5] Ensure stateHint is normalized before use in quantity normalization
                    normalizeStateHintForItem(item, log);
                    
                    // This is a "dry run" to get quantities. No log needed.
                    // This function respects item.stateHint now that it is normalized
                    const { value: gramsOrMl } = normalizeToGramsOrMl(item, () => {}); 
                    
                    const existing = ingredientMap.get(item.normalizedKey);
                    if (existing) {
                        existing.requested_total_g += gramsOrMl;
                        existing.dayRefs.add(day.dayNumber);
                        // Carry forward stateHint if not yet set
                        if (!existing.stateHint) existing.stateHint = item.stateHint; 
                    } else {
                        ingredientMap.set(item.normalizedKey, {
                            originalIngredient: item.key, // Use the first-seen name as the "original"
                            normalizedKey: item.normalizedKey,
                            requested_total_g: gramsOrMl,
                            dayRefs: new Set([day.dayNumber]),
                            stateHint: item.stateHint // MOD ZONE 1.3: Pass stateHint
                        });
                    }
                }
            }
        }
        const aggregatedIngredients = Array.from(ingredientMap.values());
        sendEvent('phase:end', { name: 'aggregate', duration_ms: Date.now() - aggregateStartTime, uniqueIngredients: aggregatedIngredients.length });


        // --- Phase 3: Generate Queries & Run Market (Batched) ---
        sendEvent('phase:start', { name: 'market', description: `Querying ${store} for ${aggregatedIngredients.length} items...` });
        sendEvent('plan:progress', { pct: 35, message: `Running market search...` });
        const marketStartTime = Date.now();

        // 3a. Generate Queries (LLM call)
        const groceryQueryData = await generateGroceryQueries_Batched(aggregatedIngredients, store, log);
        const { ingredients: ingredientPlan } = groceryQueryData;
        if (!ingredientPlan || ingredientPlan.length === 0) {
             throw new Error(`Grocery Optimizer AI returned empty ingredients.`);
        }
        
        // Map aggregated plan to full plan details
        const fullIngredientPlan = aggregatedIngredients.map(aggItem => {
            const planDetails = ingredientPlan.find(p => p.originalIngredient === aggItem.originalIngredient);
            if (!planDetails) {
                 log(`No plan details from LLM for "${aggItem.originalIngredient}". Using fallback.`, 'WARN', 'LLM');
                 return {
                     ...aggItem,
                     category: 'misc',
                     normalQuery: `${store} ${aggItem.originalIngredient}`,
                     requiredWords: aggItem.originalIngredient.split(' ').slice(0,1),
                     negativeKeywords: [],
                     allowedCategories: ['pantry', 'produce', 'meat', 'dairy', 'frozen']
                 };
            }
            // CRITICAL: Ensure the store is included in the ingredient object for the market runner's synthTight/synthWide to work
            return {
                ...planDetails, // Contains LLM-generated query data
                normalizedKey: aggItem.normalizedKey,
                totalGramsRequired: aggItem.requested_total_g, // Overwrite LLM estimate with our sum
                dayRefs: aggItem.dayRefs,
                stateHint: aggItem.stateHint, // MOD ZONE 1.3: Pass stateHint
                store: store, // Pass store name explicitly
                category: planDetails.category || 'Uncategorized' // FIX: Ensure category always exists for FE grouping
            };
        });
        
        // --- Market Run Logic (Moved inside handler for proper scoping) ---
        /**
         * Runs market search logic for a single ingredient.
         * Note: 'log' and 'store' are now correctly in scope from the enclosing handler.
         */
        const processSingleIngredientOptimized = async (ingredient) => {
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
                const qt = (ingredient.tightQuery && ingredient.tightQuery.trim()) ? ingredient.tightQuery : synthTight(ingredient, ingredient.store); // Use ingredient.store (passed from LLM) or infer from outer scope
                const qw = (ingredient.wideQuery && ingredient.wideQuery.trim()) ? ingredient.wideQuery : synthWide(ingredient, ingredient.store);
                
                const queriesToTry = [ { type: 'tight', query: qt }, { type: 'normal', query: qn }, { type: 'wide', query: qw } ].filter(q => q.query && q.query.trim());
                
                log(`[${ingredientKey}] Queries: Tight (${qt ? (ingredient.tightQuery ? 'AI' : 'Synth') : 'N/A'}), Normal (AI), Wide (${qw ? (ingredient.wideQuery ? 'AI' : 'Synth') : 'N/A'})`, 'DEBUG', 'MARKET_RUN');
                
                let acceptedQueryType = 'none';
                let bestScore = 0;

                for (const [index, { type, query }] of queriesToTry.entries()) {
                    if (type === 'normal' && acceptedQueryType !== 'none') {
                        continue; 
                    }
                    if (type === 'wide') {
                        if (acceptedQueryType !== 'none') continue;
                        const isFailFastCategory = ingredient.allowedCategories.some(c => FAIL_FAST_CATEGORIES.includes(c));
                        if (isFailFastCategory) {
                            log(`[${ingredientKey}] Skipping "wide" query due to fail-fast category.`, 'DEBUG', 'MARKET_RUN');
                            continue;
                        }
                    }

                    log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
                    result.searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0});
                    const currentAttemptLog = result.searchAttempts.at(-1);

                    // NOTE: The store variable from the outer scope is correctly captured here.
                    const { data: priceData } = await fetchPriceData(store, query, 1, log);

                    if (priceData.error) {
                        log(`[${ingredientKey}] Fetch failed (${type}): ${priceData.error.message}`, 'WARN', 'HTTP', { status: priceData.error.status });
                        currentAttemptLog.status = 'fetch_error'; 
                        continue;
                    }
                    
                    const rawProducts = priceData.results || [];
                    currentAttemptLog.rawCount = rawProducts.length;
                    const validProductsOnPage = [];
                    
                    for (const rawProduct of rawProducts) {
                        if (!rawProduct || !rawProduct.product_name) continue;
                        // log is correctly scoped here
                        const checklistResult = runSmarterChecklist(rawProduct, ingredient, log); 
                        if (checklistResult.pass) {
                            validProductsOnPage.push({ 
                                product: { 
                                    name: rawProduct.product_name, 
                                    brand: rawProduct.product_brand, 
                                    price: rawProduct.current_price, 
                                    size: rawProduct.product_size, 
                                    url: rawProduct.url, 
                                    barcode: rawProduct.barcode, 
                                    // calculateUnitPrice is module-scoped, fine
                                    unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size) 
                                }, 
                                score: checklistResult.score
                            });
                        }
                    }
                    
                    // log is correctly scoped here
                    const filteredProducts = applyPriceOutlierGuard(validProductsOnPage, log, ingredientKey); 
                    // Syntax Fix applied previously: (max, p => Math.max...) -> (max, p) => Math.max...
                    const currentBestScore = filteredProducts.length > 0 ? filteredProducts.reduce((max, p) => Math.max(max, p.score), 0) : 0;
                    currentAttemptLog.bestScore = currentBestScore;

                    if (filteredProducts.length > 0) {
                        log(`[${ingredientKey}] Found ${filteredProducts.length} valid (${type}).`, 'INFO', 'DATA');
                        const currentUrls = new Set(result.allProducts.map(p => p.url));
                        filteredProducts.forEach(vp => { 
                            if (!currentUrls.has(vp.product.url)) { 
                                result.allProducts.push(vp.product); 
                            } 
                        });

                        if (result.allProducts.length > 0) {
                            const foundProduct = result.allProducts.reduce((best, current) => (current.unit_price_per_100 ?? Infinity) < (best.unit_price_per_100 ?? Infinity) ? current : best, result.allProducts[0]);
                            result.currentSelectionURL = foundProduct.url;
                            result.source = 'discovery';
                            currentAttemptLog.status = 'success';
                            
                            if (acceptedQueryType === 'none') {
                                acceptedQueryType = type;
                                bestScore = currentBestScore;
                            }

                            if (type === 'tight' && currentBestScore >= SKIP_STRONG_MATCH_THRESHOLD) {
                                log(`[${ingredientKey}] Skip heuristic hit (Strong tight match).`, 'INFO', 'MARKET_RUN');
                                break; 
                            }
                            if (type === 'normal') {
                                log(`[${ingredientKey}] Found valid 'normal' match. Stopping search.`, 'DEBUG', 'MARKET_RUN');
                                break;
                            }
                        } else { 
                            currentAttemptLog.status = 'no_match_post_filter'; 
                        }
                    } else { 
                        log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA'); 
                        currentAttemptLog.status = 'no_match'; 
                    }
                }
                
                if (result.source === 'failed') { 
                    log(`[${ingredientKey}] Market Run failed after trying all queries.`, 'WARN', 'MARKET_RUN'); 
                } else { 
                    log(`[${ingredientKey}] Market Run success via '${acceptedQueryType}' query.`, 'DEBUG', 'MARKET_RUN'); 
                }

                telemetry.used = acceptedQueryType;
                telemetry.score = bestScore;
                log(`[${ingredientKey}] Market Run Telemetry`, 'INFO', 'MARKET_RUN', telemetry);

                return { [ingredientKey]: result };

            } catch(e) {
                log(`CRITICAL Error in processSingleIngredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                return { _error: true, itemKey: ingredient?.originalIngredient || 'unknown_error', message: `Internal Market Run Error: ${e.message}` };
            }
        };
        // --- End Market Run Logic ---

        // 3b. Execute market run in parallel
        const parallelResultsArray = await concurrentlyMap(fullIngredientPlan, MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        sendEvent('plan:progress', { pct: 50, message: `Market search complete...` });
        
        // Collate market results (fullResultsMap still needed to map key to selected product)
        const fullResultsMap = new Map(); // Map<normalizedKey, result>
        parallelResultsArray.forEach(currentResult => {
             // FIX 1 & 2: Derive normalized key and look up plan item
             const ingredientKey = Object.keys(currentResult)[0];
             const normalizedKey = normalizeKey(ingredientKey);
             const resultData = currentResult[ingredientKey];
             
             // Look up the enriched plan item using the normalized key
             const planItem = fullIngredientPlan.find(i => i.normalizedKey === normalizedKey);

             if (currentResult._error) {
                 log(`Market Run Item Error for "${currentResult.itemKey}": ${currentResult.message}`, 'WARN', 'MARKET_RUN');
                 const baseData = planItem || { originalIngredient: currentResult.itemKey, normalizedKey: normalizeKey(currentResult.itemKey) };
                 fullResultsMap.set(normalizedKey, { ...baseData, source: 'error', error: currentResult.message, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
                 return;
             }
             
             if (resultData && typeof resultData === 'object' && planItem) {
                 // FIX 3: Merge resultData with the enriched planItem to carry over fields like 'category'
                 fullResultsMap.set(normalizedKey, { ...planItem, ...resultData, normalizedKey: planItem.normalizedKey });
             } else {
                  log(`Invalid market result structure or missing plan item for "${normalizedKey}"`, 'ERROR', 'SYSTEM', { resultData, planItemExists: !!planItem });
                  const baseData = planItem || { originalIngredient: ingredientKey, normalizedKey: normalizedKey };
                  fullResultsMap.set(normalizedKey, { ...baseData, source: 'error', error: 'Invalid market result structure', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
             }
        });
        
        market_run_ms = Date.now() - marketStartTime;
        sendEvent('phase:end', { name: 'market', duration_ms: market_run_ms, itemsFound: Array.from(fullResultsMap.values()).filter(v => v.source === 'discovery').length });


        // --- Phase 3.5: Price Extraction (Mod Zone 3) ---
        sendEvent('phase:start', { name: 'price_extract', description: 'Extracting price data...' });
        const priceExtractStartTime = Date.now();
        const priceDataMap = new Map(); 

        for (const [normalizedKey, result] of fullResultsMap.entries()) {
            const selected = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
            
            if (selected) {
                priceDataMap.set(normalizedKey, {
                    price: selected.price || 0,
                    url: selected.url,
                    store: store,
                    packSize: selected.size, 
                    unitPrice: selected.unit_price_per_100 || 0,
                    productName: selected.name || result.originalIngredient
                });
            } else {
                 // Even if no product was found, create an entry with zero price data
                 priceDataMap.set(normalizedKey, {
                    price: 0,
                    url: MOCK_PRODUCT_TEMPLATE.url,
                    store: store,
                    packSize: 'N/A', 
                    unitPrice: 0,
                    productName: result.originalIngredient
                });
            }
        }
        sendEvent('phase:end', { name: 'price_extract', duration_ms: Date.now() - priceExtractStartTime });


        // --- Phase 4: Nutrition Fetch (Mod Zone 1 & 2: Ingredient-Centric) ---
        sendEvent('phase:start', { name: 'nutrition', description: 'Fetching ingredient nutrition data...' });
        sendEvent('plan:progress', { pct: 75, message: `Fetching nutrition data...` });
        const nutritionStartTime = Date.now();
        const nutritionDataMap = new Map(); // Map<normalizedKey, nutritionData>
        let canonicalHitsToday = 0; // Keep tracking canonical fallbacks

        // MOD ZONE 1.1: Gather items for ingredient lookup (ALL aggregated ingredients)
        const itemNutritionRequests = aggregatedIngredients.map(item => ({
            normalizedKey: item.normalizedKey,
            query: item.originalIngredient,
            stateHint: item.stateHint // MOD ZONE 1.3: Pass stateHint
        }));
        
        // 4b. Fetch in parallel using the ingredient-centric lookup
        if (itemNutritionRequests.length > 0) {
            log(`Fetching nutrition for ${itemNutritionRequests.length} unique ingredients...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemNutritionRequests, NUTRITION_CONCURRENCY, async (item) => {
                 try {
                     // MOD ZONE 2.1, 2.2, 2.3: Call lookupIngredientNutrition with only ingredientKey
                     const nut = await lookupIngredientNutrition(item.query, log); 
                     
                     // Check if it's a Canonical hit for telemetry
                     if (nut?.source === 'canonical') canonicalHitsToday++;
                     
                     return { ...item, nut };
                 } catch (err) {
                     log(`Nutrition fetch error for ${item.query}: ${err.message}`, 'WARN', 'HTTP');
                     return { ...item, nut: { status: 'not_found', source: 'error', error: `Nutrition fetch failed: ${err.message}` } };
                 }
             });
            // 4c. Collate nutrition results
            nutritionResults.forEach(item => {
                 if (item && item.normalizedKey && item.nut) {
                    nutritionDataMap.set(item.normalizedKey, item.nut);
                 }
            });
        }
        
        // 4d. Canonical Fallback count is now tracked inside the lookup, so we log the total here
        if (canonicalHitsToday > 0) log(`Used ${canonicalHitsToday} canonical fallbacks.`, 'INFO', 'CALC');
        
        nutrition_ms = Date.now() - nutritionStartTime;
        sendEvent('phase:end', { name: 'nutrition', duration_ms: nutrition_ms, itemsFetched: nutritionDataMap.size });


        // --- Phase 5: Solver (Calculate Final Macros) ---
        sendEvent('phase:start', { name: 'solver', description: 'Calculating final macros...' });
        sendEvent('plan:progress', { pct: 85, message: `Calculating final macros...` });
        const solverStartTime = Date.now();
        finalMealPlan = []; // Reset final plan, will be rebuilt here

        // [NEW] Macro Debug Data Initialization
        // Removed outdated targetsPerMeal calculation (B1)
        
        const macroDebugDaysData = [];

        /**
         * Calculates the macros for a single item using the master nutrition map.
         * This function returns a detailed object including debug information required for the macroDebug payload.
         */
        const computeDetailedItemMacros = (item, mealItems) => { // Relies on closure 'log' and 'nutritionDataMap'
             const normalizedKey = item.normalizedKey; 
             
             // 1. Get user-facing quantity
             const { value: gramsOrMl } = normalizeToGramsOrMl(item, log);
             const gramsInput = gramsOrMl; // Normalized grams/ml before transforms

             // Initialize debug item structure
             const debugItem = {
                key: item.key,
                displayName: item.key, // Using key as fallback
                qtyValue: item.qty_value || null,
                qtyUnit: item.qty_unit || null,
                stateHint: item.stateHint || null,
                methodHint: item.methodHint || null,
                gramsInput: gramsInput,
                gramsAsSold: null,
                nutritionKey: normalizedKey,
                per100: { kcal: null, protein: null, fat: null, carbs: null },
                computedMacros: { calories: 0, protein: 0, fat: 0, carbs: 0 },
                source: 'missing',
                notes: null,
                lookupMethod: 'ingredient-centric' // MOD ZONE 4.3: Add ingredient-centric flag
             };
             
             // ... (rest of initial checks) ...
             if (!Number.isFinite(gramsInput) || gramsInput < 0 || gramsInput === 0) {
                 if (gramsInput !== 0) {
                    log(`[MACRO_DEBUG] Invalid quantity for item '${item.key}'.`, 'ERROR', 'CALC', { item, gramsInput });
                 }
                 return { p: 0, f: 0, c: 0, kcal: 0, key: item.key, debugItem };
             }
             
             // 2. Convert to 'as_sold' (e.g., 200g cooked rice -> 67g dry rice)
             const { grams_as_sold, inferredMethod } = toAsSold(item, gramsInput, log);
             
             debugItem.gramsAsSold = grams_as_sold;
             debugItem.methodHint = item.methodHint || inferredMethod || null;
             
             // 3. Get nutrition data (per 100g)
             const nutritionData = nutritionDataMap.get(normalizedKey);
             let grams = grams_as_sold;
             let p = 0, f = 0, c = 0, kcal = 0;
             
             let source = 'missing';

             if (nutritionData && nutritionData.status === 'found') {
                 // Use real data
                 const proteinPer100 = Number(nutritionData.protein || nutritionData.protein_g_per_100g) || 0;
                 const fatPer100 = Number(nutritionData.fat || nutritionData.fat_g_per_100g) || 0;
                 const carbsPer100 = Number(nutritionData.carbs || nutritionData.carb_g_per_100g) || 0;

                 // RFC-001: calories is the primary field from nutrition-search.js
                 // Fallback chain: calories → kcal → kcal_per_100g → reconstruct from macros
                 const kcalPer100 = 
                     Number(nutritionData.calories) ||
                     Number(nutritionData.kcal) || 
                     Number(nutritionData.kcal_per_100g) || 
                     ((proteinPer100 * 4) + (fatPer100 * 9) + (carbsPer100 * 4));


                 // Populate debug per100
                 debugItem.per100.kcal = kcalPer100;
                 debugItem.per100.protein = proteinPer100;
                 debugItem.per100.fat = fatPer100;
                 debugItem.per100.carbs = carbsPer100;
                 
                 p = (proteinPer100 / 100) * grams;
                 f = (fatPer100 / 100) * grams;
                 c = (carbsPer100 / 100) * grams;
                 
                 source = nutritionData.source.toLowerCase();
                 debugItem.source = source;
                 
                 // MOD ZONE 4.2: Log warning if an external API was used
                 // In the ingredient-centric flow, the only valid sources are HOT_PATH, CANONICAL, or FALLBACK
                 if (source !== 'hot_path' && source !== 'canonical' && source !== 'fallback' && gramsInput > 0) {
                     log(`[MACRO_DEBUG] WARNING: External API used for '${item.key}'. Potential for macro drift. Source: ${nutritionData.source}`, 'WARN', 'CALC');
                 }
             } else { 
                if (gramsInput > 0) {
                   log(`[MACRO_DEBUG] No nutrition found for '${item.key}'. Macros set to 0.`, 'WARN', 'CALC', { normalizedKey }); 
                }
                debugItem.notes = 'Nutrition data missing or not found.';
             }
             
             // 4. Add extras (e.g., oil absorption)
             const { absorbed_oil_g } = getAbsorbedOil(item, debugItem.methodHint, mealItems, log);
             if (absorbed_oil_g > 0) { 
                 f += absorbed_oil_g; 
                 debugItem.notes = (debugItem.notes ? debugItem.notes + '; ' : '') + `Added ${absorbed_oil_g.toFixed(1)}g fat from absorbed oil.`;
             }
             
             // 5. Calculate final kcal
             kcal = (p * 4) + (f * 9) + (c * 4);

             // Populate debug computed macros
             debugItem.computedMacros.calories = kcal;
             debugItem.computedMacros.protein = p;
             debugItem.computedMacros.fat = f;
             debugItem.computedMacros.carbs = c;
             
             // 6. Set Final Source and Log Anomalies
             
             if (kcal === 0 && gramsInput > 0) {
                 // Log anomaly: Zero-calorie item with non-zero quantity (Rule 4)
                 log(`[MACRO_DEBUG] Zero-calorie item with non-zero qty: '${item.key}' (${gramsInput.toFixed(0)}g). Source: ${source}`, 'WARN', 'CALC');
             }
             
             if (source === 'canonical' && gramsInput > 0) {
                 // Log anomaly: Canonical fallback used (Rule 4)
                 log(`[MACRO_DEBUG] Canonical fallback used for '${item.key}'.`, 'INFO', 'CALC');
             }

             if (kcal > MAX_CALORIES_PER_ITEM && !item.key.toLowerCase().includes('oil')) {
                log(`CRITICAL: Item '${item.key}' calculated to ${kcal.toFixed(0)} kcal, exceeding sanity limit.`, 'CRITICAL', 'CALC', { item, grams, p, f, c });
                // Nullify macros to prevent breaking the plan
                kcal = 0; p = 0; f = 0; c = 0;
                debugItem.computedMacros = { calories: 0, protein: 0, fat: 0, carbs: 0 };
                debugItem.notes = (debugItem.notes ? debugItem.notes + '; ' : '') + 'Macros nullified due to sanity check failure.';
             }

             return { p, f, c, kcal, key: item.key, debugItem };
        };


        // Redefine the simple helper that calculateTotals and reconcilerGetItemMacros expects.
        // This function replaces the original `computeItemMacros` but maintains the simple return structure.
        const computeItemMacros = (item, mealItems) => {
             const result = computeDetailedItemMacros(item, mealItems);
             return { p: result.p, f: result.f, c: result.c, kcal: result.kcal, key: result.key };
        };


        // Helper to calculate totals for a list of meals
        const calculateTotals = (mealList, dayNum) => {
            let totalKcal = 0, totalP = 0, totalF = 0, totalC = 0;
            let planHasInvalidItems = false;
            for (const meal of mealList) {
                 let mealKcal = 0, mealP = 0, mealF = 0, mealC = 0;
                 for (const item of meal.items) {
                     // Attach normalizedKey again as it was lost in deep copy
                     item.normalizedKey = normalizeKey(item.key); 
                     
                     // Ensure stateHint is normalized before macro calculation
                     normalizeStateHintForItem(item, log);
                     
                     // This is the call to the macro calculator (the getMacros function for validation)
                     const macros = computeItemMacros(item, meal.items);
                     mealKcal += macros.kcal; mealP += macros.p; mealF += macros.f; mealC += macros.c;
                 }
                 meal.subtotal_kcal = mealKcal; meal.subtotal_protein = mealP; meal.subtotal_fat = mealF; meal.subtotal_carbs = mealC;
                 if (meal.subtotal_kcal <= 0 && meal.items.length > 0) { // Only log if not an empty meal
                     log(`[Solver] Meal "${meal.name}" (Day ${dayNum}) has zero/negative kcal.`, 'WARN', 'CALC', { items: meal.items.map(i => i.key) });
                     planHasInvalidItems = true;
                 }
                 totalKcal += mealKcal; totalP += mealP; totalF += mealF; totalC += mealC;
            }
            // Return total object, which serves as the dayTotals input for validation
            return { totalKcal, totalP, totalF, totalC, planHasInvalidItems };
        };


        // --- Run Solver V1 (Shadow) vs Reconciler V0 (Live) ---
        for (const day of fullMealPlan) {
            let mealsForThisDay = JSON.parse(JSON.stringify(day.meals)); // Deep copy for safety
            // nutritionalTargets is the targets object for the current day
            const targetCalories = nutritionalTargets.calories;
            
            // Determine per meal targets for logging (Phase 5)
            const targetsPerMeal = (meal) => {
                const isSnack = meal.type && meal.type.toLowerCase().includes('snack');
                return isSnack ? targetsPerMealType.snack : targetsPerMealType.main;
            };

            // Phase C5 & C6: Per-meal reconciliation loop
            let reconciliationHappened = false;
            
            for (let i = 0; i < mealsForThisDay.length; i++) {
                const meal = mealsForThisDay[i];
                const mealTargets = targetsPerMeal(meal);
                
                // Use a deep copy for the reconciliation input as it mutates the meal object internally
                const mealCopy = JSON.parse(JSON.stringify(meal));

                const { adjusted, factor, meal: reconciledMeal } = reconcileMealLevel({
                    meal: mealCopy,
                    targetKcal: mealTargets.calories,
                    targetProtein: mealTargets.protein,
                    getItemMacros: computeItemMacros,
                    log: log,
                    tolPct: 15 // Use 15% tolerance for individual meal adjustment
                });
                
                if (adjusted) {
                    reconciliationHappened = true;
                    // Replace the original meal with the reconciled one
                    mealsForThisDay[i] = reconciledMeal; 
                }
            }

            if (reconciliationHappened) {
                 log(`[MEAL_RECON] Per-meal reconciliation applied on Day ${day.dayNumber}. Recalculating day totals.`, 'INFO', 'SOLVER');
            }

            // --- 1. Run Solver V1 (Shadow Path) ---
            const solverV1Meals = JSON.parse(JSON.stringify(mealsForThisDay)); // Fresh deep copy (start from possibly reconciled state)
            const solverV1Totals = calculateTotals(solverV1Meals, day.dayNumber);

            // --- 2. Run Reconciler V0 (Live Path by default) ---
            const reconcilerGetItemMacros = (item) => {
                item.normalizedKey = normalizeKey(item.key); // Ensure key is normalized
                // State hint is normalized inside calculateTotals, but we must ensure consistency here too
                normalizeStateHintForItem(item, log);
                
                const mealContext = mealsForThisDay.find(m => m.items.some(i => i.key === item.key))?.items || [];
                return computeItemMacros(item, mealContext);
            };

            const { adjusted, factor, meals: scaledMeals } = reconcileNonProtein({
                meals: mealsForThisDay.map(m => ({ ...m, items: m.items.map(i => ({ ...i, qty: i.qty_value, unit: i.qty_unit })) })),
                targetKcal: targetCalories,
                getItemMacros: reconcilerGetItemMacros, // Use our master calculator
                tolPct: 5,
                // D1, D2, D3: Pass parameters for protein scaling logic
                allowProteinScaling: ALLOW_PROTEIN_SCALING,
                targetProtein: nutritionalTargets.protein,
                log: log
            });

            // Re-format scaled meals and calculate their *final* totals
            const reconcilerV0Meals = scaledMeals.map(m => ({ ...m, items: m.items.map(i => ({ ...i, qty_value: i.qty, qty_unit: i.unit })) }));
            const reconcilerV0Totals = calculateTotals(reconcilerV0Meals, day.dayNumber);
            
            // --- Determine which meal/total set to use ---
            let selectedMeals = USE_SOLVER_V1 ? solverV1Meals : reconcilerV0Meals;
            let selectedTotals = USE_SOLVER_V1 ? solverV1Totals : reconcilerV0Totals;

            // --- 3. Log Comparison ---
            log(`[Solver] Day ${day.dayNumber} Shadow Mode Comparison:`, 'INFO', 'SOLVER', {
                day: day.dayNumber,
                target: targetCalories,
                solver_v1_kcal: solverV1Totals.totalKcal.toFixed(0),
                reconciler_v0_kcal: reconcilerV0Totals.totalKcal.toFixed(0),
                reconciler_adjusted: adjusted,
                reconciler_factor: factor
            });

            // --- 4. Validation (Task 3) ---
            const validationResult = validateDayPlan({
              meals: selectedMeals,
              dayTotals: {
                calories: selectedTotals.totalKcal,
                protein: selectedTotals.totalP,
                fat: selectedTotals.totalF,
                carbs: selectedTotals.totalC
              },
              targets: nutritionalTargets, 
              nutritionDataMap: nutritionDataMap,
              getMacros: computeItemMacros,
              log: log
            });

            // --- 5. Optional Log Validation Issues (Task 5) ---
            if (validationResult && validationResult.hasIssues && validationResult.hasIssues()) {
              log(
                `[VALIDATION] Day ${day.dayNumber}: ${validationResult.issues.length} issues (confidence=${validationResult.confidenceScore.toFixed(2)})`,
                'WARN',
                'CALC'
              );
            }
            // --- End Validation ---

            // --- 6. Select Path and Finalize Day Object (Task 4) ---
            log(`[Solver] Using ${USE_SOLVER_V1 ? 'SOLVER_V1' : 'RECONCILER_V0'} for Day ${day.dayNumber}`, 'INFO', 'SOLVER');

            // --- [NEW] Collect Macro Debug Data for this Day ---
            const dayDebug = {
                dayIndex: day.dayNumber - 1, // 0-based
                dayLabel: `Day ${day.dayNumber}`,
                meals: []
            };
            
            for (const meal of selectedMeals) {
                // Use per-meal target function for logging (Phase 5)
                const targetMacros = targetsPerMeal(meal); 

                const mealDebug = {
                    mealName: meal.name,
                    mealId: null, // Not available
                    targetMacros: {
                        calories: targetMacros.calories ? Math.round(targetMacros.calories) : null,
                        protein: targetMacros.protein ? Math.round(targetMacros.protein) : null,
                        fat: targetMacros.fat ? Math.round(targetMacros.fat) : null,
                        carbs: targetMacros.carbs ? Math.round(targetMacros.carbs) : null
                    },
                    computedTotals: {
                        calories: Math.round(meal.subtotal_kcal || 0),
                        protein: Math.round(meal.subtotal_protein || 0),
                        fat: Math.round(meal.subtotal_fat || 0),
                        carbs: Math.round(meal.subtotal_carbs || 0)
                    },
                    deviation: {
                        caloriesDiff: targetMacros.calories ? Math.round((meal.subtotal_kcal || 0) - targetMacros.calories) : null,
                        proteinDiff: targetMacros.protein ? Math.round((meal.subtotal_protein || 0) - targetMacros.protein) : null,
                        fatDiff: targetMacros.fat ? Math.round((meal.subtotal_fat || 0) - targetMacros.fat) : null,
                        carbsDiff: targetMacros.carbs ? Math.round((meal.subtotal_carbs || 0) - targetMacros.carbs) : null
                    },
                    items: []
                };

                for (const item of meal.items) {
                    // Recalculate item macros using the detailed function to get the debug object
                    const { debugItem } = computeDetailedItemMacros(item, meal.items);
                    // Round the final computed macros in the debug item
                    debugItem.computedMacros.calories = Math.round(debugItem.computedMacros.calories);
                    debugItem.computedMacros.protein = Math.round(debugItem.computedMacros.protein);
                    debugItem.computedMacros.fat = Math.round(debugItem.computedMacros.fat);
                    debugItem.computedMacros.carbs = Math.round(debugItem.computedMacros.carbs);
                    
                    mealDebug.items.push(debugItem);
                }
                dayDebug.meals.push(mealDebug);
            }
            macroDebugDaysData.push(dayDebug);
            
            
            finalMealPlan.push({ 
                dayNumber: day.dayNumber, 
                meals: selectedMeals, 
                totals: {
                    calories: selectedTotals.totalKcal,
                    protein: selectedTotals.totalP,
                    fat: selectedTotals.totalF,
                    carbs: selectedTotals.totalC
                },
                // [NEW] Attach validation result (Task 4)
                validation: validationResult.toJSON()
            });
        }
        solver_ms = Date.now() - solverStartTime;
        sendEvent('phase:end', { name: 'solver', duration_ms: solver_ms, using_solver_v1: USE_SOLVER_V1 });


        // --- Phase 6: Chef AI (Writer) ---
        // This phase runs *after* the solver, so it has the *final* scaled quantities
        sendEvent('phase:start', { name: 'writer', description: 'Writing recipes...' });
        sendEvent('plan:progress', { pct: 95, message: `Writing final recipes...` });
        const writerStartTime = Date.now();
        
        const allMeals = finalMealPlan.flatMap(day => day.meals);
        // Run recipe generation in parallel for all meals across all days
        const recipeResults = await concurrentlyMap(allMeals, 6, (meal) => generateChefInstructions(meal, store, log));
        
        // Create a map to re-assemble the plan
        const recipeMap = new Map();
        recipeResults.forEach((result, index) => {
            if (result && !result._error) {
                const originalMeal = allMeals[index];
                // Find which day this meal belonged to
                const dayNumber = finalMealPlan.find(d => d.meals.includes(originalMeal))?.dayNumber;
                recipeMap.set(`${dayNumber}:${originalMeal.name}`, result);
            }
        });

        // Re-inject recipes into the final plan
        for (const day of finalMealPlan) {
            day.meals = day.meals.map(meal => {
                const recipe = recipeMap.get(`${day.dayNumber}:${meal.name}`);
                return recipe || { ...meal, ...MOCK_RECIPE_FALLBACK }; // Fallback if chef failed
            });
        }
        writer_ms = Date.now() - writerStartTime;
        sendEvent('phase:end', { name: 'writer', duration_ms: writer_ms, recipesGenerated: recipeMap.size });

        // --- Phase 7: Finalize ---
        sendEvent('phase:start', { name: 'finalize', description: 'Assembling final plan...' });
        
        // Clean up meal objects for the frontend
        let totalCalories = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0;
        
        // 1. Create the final unique ingredient ARRAY (for uniqueIngredients field)
        const finalUniqueIngredients = aggregatedIngredients.map(({ normalizedKey, dayRefs, ...rest }) => {
             const priceData = priceDataMap.get(normalizedKey) || {};
             const marketResult = fullResultsMap.get(normalizedKey) || {}; // GET THE FULL RESULT
             
             // Merge market data (which contains allProducts, currentSelectionURL, source, etc.)
             // then override with the cleaner priceData structure where available.
             return {
                 ...rest, // originalIngredient, requested_total_g, stateHint
                 normalizedKey,  // Keep normalizedKey for frontend lookups
                 dayRefs: Array.from(dayRefs), // Convert Set to Array
                 // Include ALL market result data (allProducts, currentSelectionURL, source)
                 ...marketResult,
                 // Include price data (overwrites for cleaner structure)
                 ...priceData
             };
        });

        // 2. Convert the array to an OBJECT keyed by normalizedKey (for the 'results' field)
        const resultsObject = {};
        finalUniqueIngredients.forEach(item => {
            if (item.normalizedKey) {
                resultsObject[item.normalizedKey] = item;
            }
        });


        finalMealPlan.forEach(day => {
            // Store rounded totals separately for frontend consumption
            const dayTotals = day.totals;
            day.totals = {
                calories: Math.round(dayTotals.calories || 0),
                protein: Math.round(dayTotals.protein || 0),
                fat: Math.round(dayTotals.fat || 0),
                carbs: Math.round(dayTotals.carbs || 0),
            }
            // Aggregate totals for the summary (Rule 3)
            totalCalories += dayTotals.calories;
            totalProtein += dayTotals.protein;
            totalFat += dayTotals.fat;
            totalCarbs += dayTotals.carbs;


            day.meals.forEach(meal => {
                // Round meal macros
                meal.subtotal_kcal = Math.round(meal.subtotal_kcal || 0);
                meal.subtotal_protein = Math.round(meal.subtotal_protein || 0);
                meal.subtotal_fat = Math.round(meal.subtotal_fat || 0);
                meal.subtotal_carbs = Math.round(meal.subtotal_carbs || 0);
                // Simplify item structure
                meal.items = meal.items.map(item => ({
                    key: item.key,
                    qty: item.qty_value,
                    unit: item.qty_unit,
                    stateHint: item.stateHint,
                    methodHint: item.methodHint
                }));
            });
        });

        // [NEW] Calculate Summary Debug Data (Rule 3)
        const macroDebugSummary = {
            totalDays: numDays,
            totalCalories: Math.round(totalCalories),
            totalProtein: Math.round(totalProtein),
            totalFat: Math.round(totalFat),
            totalCarbs: Math.round(totalCarbs),
            avgCaloriesPerDay: numDays > 0 ? Math.round(totalCalories / numDays) : null,
            avgProteinPerDay: numDays > 0 ? Math.round(totalProtein / numDays) : null,
        };
        
        // Prepare the final payload
        const responseData = {
            message: `Successfully generated full ${numDays}-day plan.`,
            mealPlan: finalMealPlan,
            // FIX: Use the OBJECT structure for 'results' expected by the ShoppingList component
            results: resultsObject,           
            // Keep the ARRAY structure for 'uniqueIngredients' (used by list views)
            uniqueIngredients: finalUniqueIngredients,
            // [NEW] Macro Debug Payload (Rule 1)
            macroDebug: {
                days: macroDebugDaysData,
                summary: macroDebugSummary
            }
        };

        const plan_total_ms = Date.now() - planStartTime;
        log(`Plan Generation Telemetry:`, 'INFO', 'SYSTEM', { 
            plan_total_ms,
            dietitian_ms,
            market_run_ms,
            nutrition_ms,
            solver_ms,
            writer_ms,
            total_items: aggregatedIngredients.length,
            canonical_hits: canonicalHitsToday,
            solver_path_live: USE_SOLVER_V1 ? 'SOLVER_V1' : 'RECONCILER_V0'
        });

        sendFinalDataAndClose(responseData);

    } catch (error) {
        log(`CRITICAL Orchestrator ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error(`FULL PLAN UNHANDLED ERROR:`, error);
        
        const isPlanError = error.message.startsWith('Meal Planner AI failed');
        const errorCode = isPlanError ? "PLAN_INVALID" : "SERVER_FAULT_PLAN";

        logErrorAndClose(error.message, errorCode);
        return; 
    }
    finally {
        // Ensure the stream is closed if execution somehow reaches here
        if (response && !response.writableEnded) {
            log('Stream not ended, forcing close.', 'WARN', 'SYSTEM');
            try { response.end(); } catch {}
        }
    }
};

/// ===== MAIN-HANDLER-END ===== ////

