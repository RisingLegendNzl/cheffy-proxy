// --- Cheffy API: /api/plan/generate-full-plan.js ---
// [NEW] Batched Orchestrator (V13.2 - JSON Guard)
// Implements the "full plan" architecture:
// 1. Compute Targets (passed in)
// 2. Generate ALL meals (batched)
// 3. Aggregate/Dedupe ALL ingredients
// 4. Run ONE Market Run
// 5. Run ONE Nutrition Fetch
// 6. [MODIFIED] Run Solver (V1) in SHADOW mode
// 7. [MODIFIED] Run Reconciler (V0) as LIVE path
// 8. Assemble and return

/// ===== IMPORTS-START ===== \\\\
const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@vercel/kv');

// Import cache-wrapped microservices
// --- [FIX] Corrected path. These are in /api, so we go up ONE level. ---
const { fetchPriceData } = require('../price-search.js');
const { fetchNutritionData } = require('../nutrition-search.js');

// Import utils
// --- [FIX] Corrected path. These are at the root, so we go up TWO levels. ---
try {
    var { normalizeKey } = require('../../scripts/normalize.js');
    var { toAsSold, getAbsorbedOil, TRANSFORM_VERSION, normalizeToGramsOrMl } = require('../../utils/transforms.js');
    // --- [PERF] Re-importing reconcileNonProtein for shadow mode ---
    var { reconcileNonProtein } = require('../../utils/reconcileNonProtein.js');
} catch (e) {
    console.error("CRITICAL: Failed to import utils. Using local fallbacks.", e.message);
    // Fallbacks in case relative paths fail in some environments
    // --- [FIX] Corrected fallback paths to ../../ ---
    var { normalizeKey } = require('../../scripts/normalize.js');
    var { toAsSold, getAbsorbedOil, TRANSFORM_VERSION, normalizeToGramsOrMl } = require('../../utils/transforms.js');
    var { reconcileNonProtein } = require('../../utils/reconcileNonProtein.js');
}

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---
/// ===== CONFIG-START ===== \\\\
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TRANSFORM_CONFIG_VERSION = TRANSFORM_VERSION || 'v13.1-shadow';

// --- [PERF] Add feature flag for solver ---
const USE_SOLVER_V1 = process.env.CHEFFY_USE_SOLVER === '1'; // Default to false (use legacy reconcile)
// --- [END PERF] ---

const PLAN_MODEL_NAME_PRIMARY = 'gemini-2.5-flash';
const PLAN_MODEL_NAME_FALLBACK = 'gemini-2.5-pro';

// --- [FIX] Added missing '=>' arrow for the function definition ---
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

/// ===== MOCK-START ===== \\\\
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const MOCK_RECIPE_FALLBACK = {
    description: "Meal description could not be generated.",
    instructions: ["Cooking instructions could not be generated for this meal. Please rely on standard cooking methods for the ingredients listed."]
};
/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\

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


// --- [NEW] Logger (SSE Aware for Batched Plan) ---
function createLogger(run_id, responseStream = null) {
    const logs = [];
    
    const writeSseEvent = (eventType, data) => {
        if (!responseStream || responseStream.writableEnded) {
            return; 
        }
        try {
            const payload = (typeof data === 'string') ? { message: data } : data;
            const dataString = JSON.stringify(payload);
            responseStream.write(`event: ${eventType}\n`);
            responseStream.write(`data: ${dataString}\n\n`);
        } catch (e) {
            console.error(`[SSE Logger] Failed to write event ${eventType} to stream: ${e.message}`);
             try { if (!responseStream.writableEnded) responseStream.end(); } catch {}
        }
    };

    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        let logEntry;
        try {
            logEntry = {
                timestamp: new Date().toISOString(),
                run_id: run_id,
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                data: data ? JSON.parse(JSON.stringify(data, (key, value) => 
                    (typeof value === 'string' && value.length > 300) ? value.substring(0, 300) + '...' : value
                )) : null
            };
            logs.push(logEntry);
            
            writeSseEvent('log_message', logEntry);

             const time = new Date(logEntry.timestamp).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Brisbane' });
             console.log(`${time} [${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
             if (data && (level !== 'DEBUG' || ['ERROR', 'CRITICAL', 'WARN'].includes(level))) {
                 try {
                     const truncatedData = JSON.stringify(data, (k, v) => typeof v === 'string' && v.length > 150 ? v.substring(0, 150) + '...' : v, 2);
                     console.log("  Data:", truncatedData.length > 500 ? truncatedData.substring(0, 500) + '...' : truncatedData);
                 } catch { console.log("  Data: [Serialization Error]"); }
             }
            return logEntry;
        } catch (error) {
             const fallbackEntry = { timestamp: new Date().toISOString(), run_id: run_id, level: 'ERROR', tag: 'LOGGING', message: `Log serialization failed: ${message}`, data: { error: error.message }}
             logs.push(fallbackEntry);
             console.error(JSON.stringify(fallbackEntry));
             writeSseEvent('log_message', fallbackEntry);
             return fallbackEntry;
        }
    };

    const logErrorAndClose = (errorMessage, errorCode = "SERVER_FAULT_PLAN") => {
        log(errorMessage, 'CRITICAL', 'SYSTEM');
        writeSseEvent('error', {
            code: errorCode,
            message: errorMessage
        });
        if (responseStream && !responseStream.writableEnded) {
            try { responseStream.end(); } catch (e) { console.error("[SSE Logger] Error closing stream after error event:", e.message); }
        }
    };
    
    const sendFinalDataAndClose = (data) => {
        log(`Generation complete, sending final payload and closing stream.`, 'INFO', 'SYSTEM');
        writeSseEvent('plan:complete', data);
        if (responseStream && !responseStream.writableEnded) {
            try { responseStream.end(); } catch (e) { console.error("[SSE Logger] Error closing stream after final data:", e.message); }
        }
    };
    
    const sendEvent = (eventType, data) => {
        writeSseEvent(eventType, data);
    };

    // --- [FIX] Removed 'getLogs' which was undefined and not used ---
    return { log, logErrorAndClose, sendFinalDataAndClose, sendEvent };
}
// --- End Logger ---


// --- Other Helpers ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
                console.error(`Error in concurrentlyMap item "${item?.originalIngredient || item?.name || 'unknown'}":`, error);
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                return { _error: true, message: error.message || 'Unknown concurrent map error', itemKey: item?.originalIngredient || item?.name || 'unknown' };
            });
        executing.push(promise);
        results.push(promise);
        if (executing.length >= limit) { await Promise.race(executing); }
    }
    return Promise.all(results).then(res => res.filter(r => r != null));
}

async function fetchLLMWithRetry(url, options, log, attemptPrefix = "LLM") {
    for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

        try {
            log(`${attemptPrefix} Attempt ${attempt}: Fetching from ${url} (Timeout: ${LLM_REQUEST_TIMEOUT_MS}ms)`, 'DEBUG', 'HTTP');
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);

            if (response.ok) {
                // --- [SOLUTION 2 START] ---
                // We must read the response as text first to check for non-JSON body
                // This prevents response.json() from throwing on a 200 OK with text/html
                const rawText = await response.text();
                if (!rawText || rawText.trim() === "") {
                    throw new Error("Response was 200 OK but body was empty.");
                }
                
                // Check if it's likely JSON before parsing
                const trimmedText = rawText.trim();
                if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
                    // It looks like JSON, return a new "mock" response object
                    // with a .json() method that parses the text we already read.
                    return {
                        ok: true,
                        status: response.status,
                        json: () => Promise.resolve(JSON.parse(trimmedText)), // This can still throw, but it's now caught below
                        text: () => Promise.resolve(trimmedText)
                    };
                } else {
                    // It's text, not JSON. This is an API error (e.g., rate limit, safety)
                    log(`${attemptPrefix} Attempt ${attempt}: 200 OK with non-JSON body. Retrying...`, 'WARN', 'HTTP', { body: trimmedText.substring(0, 100) });
                    // Throw an error to trigger the retry logic
                    throw new Error(`200 OK with non-JSON body: ${trimmedText.substring(0, 100)}`);
                }
                // --- [SOLUTION 2 END] ---
            }

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
             } else if (error instanceof SyntaxError) {
                // This catches JSON.parse() errors from our new mock response
                log(`${attemptPrefix} Attempt ${attempt}: Failed to parse response as JSON. Retrying...`, 'WARN', 'HTTP', { error: error.message });
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
    return { pass: true, score: 1.0 }; // Simple score
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


/// ===== API-CALLERS-START ===== \\\\

const MEAL_PLANNER_SYSTEM_PROMPT = (weight, calories, mealMax, dayStart, dayEnd) => `
You are an expert dietitian. Your SOLE task is to generate the \`meals\` for multiple days (Day ${dayStart} to Day ${dayEnd}).
RULES:
1.  Generate a top-level array \`days\`. Each object in this array represents ONE day.
2.  Each day object MUST have a \`dayNumber\` (e.g., ${dayStart}, ${dayStart + 1}...) and a \`meals\` array.
3.  **CRITICAL PROTEIN CAP: Never exceed 3 g/kg total daily protein (User weight: ${weight}kg).**
4.  MEAL PORTIONS: For each meal, populate 'items' with:
    a) 'key': (string) The generic ingredient name.
    b) 'qty_value': (number) The portion size for the user.
    c) 'qty_unit': (string) e.g., 'g', 'ml', 'slice', 'egg'.
    d) 'stateHint': (string) MANDATORY. The state of the ingredient. Must be one of: "dry", "raw", "cooked", "as_pack".
    e) 'methodHint': (string | null) MANDATORY. Cooking method if state is "cooked". Must be one of: "boiled", "pan_fried", "grilled", "baked", "steamed", or null.
5.  **CRITICAL UNIT RULE:** You MUST provide quantities in **'g'** (grams), **'ml'** (milliliters), or a specific single unit like **'egg'** or **'slice'**. You **MUST NOT** use ambiguous units like 'medium', 'large', or 'piece' for any item.
6.  TARGETS: Aim for the protein target. The code will calculate calories based on your plan; you do NOT need to estimate them.
7.  Adhere to all user constraints.
8.  Do NOT include calorie estimates in your response.

Output ONLY the valid JSON object described below. ABSOLUTELY NO PROSE OR MARKDOWN.

JSON Structure:
{
  "days": [
    {
      "dayNumber": ${dayStart},
      "meals": [
        {
          "type": "string",
          "name": "string",
          "items": [
            { "key": "string", "qty_value": number, "qty_unit": "string", "stateHint": "string", "methodHint": "string|null" }
          ]
        }
      ]
    }
  ]
}
`;

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
8.  'totalGramsRequired' (REQUIRED): This is the TOTAL grams/ml requested for the FULL plan. Use the value from the \`requested_total_g\` input.
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

// --- [MODIFIED] tryGenerateLLMPlan with JSON Guard ---
async function tryGenerateLLMPlan(modelName, payload, log, logPrefix, expectedJsonShape) {
    log(`${logPrefix}: Attempting model: ${modelName}`, 'INFO', 'LLM');
    const apiUrl = getGeminiApiUrl(modelName);

    // fetchLLMWithRetry now returns a response object with a .json() method
    const response = await fetchLLMWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload)
    }, log, logPrefix);

    const result = await response.json(); // This .json() is now safe from non-JSON 200 OKs
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
        // --- [SOLUTION 2 START] ---
        // Add a guard before parsing the *text* from the LLM, in case it refused.
        const trimmedText = jsonText.trim();
        if (!trimmedText.startsWith('{') || !trimmedText.endsWith('}')) {
             throw new Error(`Response text was not a JSON object. (Likely a safety refusal)`);
        }
        // --- [SOLUTION 2 END] ---

        const parsed = JSON.parse(trimmedText); // Use trimmedText
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

async function generateMealPlan_Batched(dayStart, dayEnd, formData, nutritionalTargets, log) {
    const { name, height, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const { calories, protein, fat, carbs } = nutritionalTargets;

    const profileHash = hashString(JSON.stringify({ formData, nutritionalTargets }));
    const cacheKey = `${CACHE_PREFIX}:meals:days${dayStart}-${dayEnd}:${profileHash}`;
    
    // --- [FIX 1] Check cache and return the array from the object if it exists ---
    const cached = await cacheGet(cacheKey, log);
    if (cached) return cached; // We will now cache *only* the array
    log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');

    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']};
    const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus: ${cuisine}.` : 'Neutral.';

    const numMeals = parseInt(eatingOccasions, 10) || 3;
    const mealAvg = Math.round(calories / numMeals);
    const mealMax = Math.round(mealAvg * 1.5);

    const systemPrompt = MEAL_PLANNER_SYSTEM_PROMPT(weight, calories, mealMax, dayStart, dayEnd);
    let userQuery = `Gen plan Days ${dayStart}-${dayEnd} for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Daily Target: ~${calories} kcal (P ~${protein}g, F ~${fat}g, C ~${carbs}g). Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority}. Cuisine: ${cuisineInstruction}.`;

    const logPrefix = `MealPlannerDays${dayStart}-${dayEnd}`;
    log(`Meal Planner AI Prompt for Days ${dayStart}-${dayEnd}`, 'INFO', 'LLM_PROMPT', {
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
    const expectedShape = { "days": [] };
    let parsedResult;
    try {
        parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_PRIMARY, payload, log, logPrefix, expectedShape);
    } catch (primaryError) {
        log(`${logPrefix}: PRIMARY Model ${PLAN_MODEL_NAME_PRIMARY} failed: ${primaryError.message}. Attempting FALLBACK.`, 'WARN', 'LLM');
        try {
            parsedResult = await tryGenerateLLMPlan(PLAN_MODEL_NAME_FALLBACK, payload, log, logPrefix, expectedShape);
        } catch (fallbackError) {
            log(`${logPrefix}: FALLBACK Model ${PLAN_MODEL_NAME_FALLBACK} also failed: ${fallbackError.message}.`, 'CRITICAL', 'LLM');
            throw new Error(`Meal Plan generation failed for Days ${dayStart}-${dayEnd}: Both AI models failed. Last error: ${fallbackError.message}`);
        }
    }
    
    // --- [FIX 1] Cache *only* the days array ---
    const daysArray = parsedResult.days || [];
    if (daysArray.length > 0) {
        await cacheSet(cacheKey, daysArray, TTL_PLAN_MS, log);
    }
    return daysArray; // Return just the array of days
}

async function generateGroceryQueries_Batched(aggregatedIngredients, store, log) {
    if (!aggregatedIngredients || aggregatedIngredients.length === 0) {
        log("generateGroceryQueries_Batched called with no ingredients. Returning empty.", 'WARN', 'LLM');
        return { ingredients: [] };
    }

    const keysHash = hashString(JSON.stringify(aggregatedIngredients));
    const cacheKey = `${CACHE_PREFIX}:queries-batched:${store}:${keysHash}`;
    const cached = await cacheGet(cacheKey, log);
    if (cached) return cached;
    log(`Cache MISS for key: ${cacheKey.split(':').pop()}`, 'INFO', 'CACHE');
    
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion', 'capsicum')." : "";

    const systemPrompt = GROCERY_OPTIMIZER_SYSTEM_PROMPT(store, australianTermNote);
    
    let userQuery = `Generate query JSON for the following ingredients:\n${JSON.stringify(aggregatedIngredients)}`;

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
        const inputMap = new Map(aggregatedIngredients.map(item => [item.originalIngredient, item.requested_total_g]));
        parsedResult.ingredients.forEach(ing => {
            const requestedGrams = inputMap.get(ing.originalIngredient);
            if (requestedGrams && ing.totalGramsRequired !== requestedGrams) {
                log(`Grocery Optimizer mismatch for "${ing.originalIngredient}". LLM returned ${ing.totalGramsRequired}g, but plan needs ${requestedGrams}g. Overwriting.`, 'DEBUG', 'LLM');
                ing.totalGramsRequired = requestedGrams;
            }
        });
        
        await cacheSet(cacheKey, parsedResult, TTL_PLAN_MS, log);
    }
    
    return parsedResult;
}

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

// --- [MODIFIED] tryGenerateChefRecipe with JSON Guard ---
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
        // --- [SOLUTION 2 START] ---
        // Add a guard before parsing the *text* from the LLM, in case it refused.
        const trimmedText = jsonText.trim();
        if (!trimmedText.startsWith('{') || !trimmedText.endsWith('}')) {
             throw new Error(`Response text was not a JSON object. (Likely a safety refusal)`);
        }
        // --- [SOLUTION 2 END] ---
        
        const parsed = JSON.parse(trimmedText); // Use trimmedText
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
        return { ...meal, ...recipeResult }; // Return the modified meal object
    } catch (error) {
        log(`CRITICAL Error in generateChefInstructions for [${mealName}]: ${error.message}`, 'CRITICAL', 'LLM_CHEF');
        return { ...meal, ...MOCK_RECIPE_FALLBACK };
    }
}

/// ===== API-CALLERS-END ===== ////

/// ===== MAIN-HANDLER-START ===== \\\\
module.exports = async (request, response) => {
    const planStartTime = Date.now();
    let dietitian_ms = 0, market_run_ms = 0, nutrition_ms = 0, solver_ms = 0; // Telemetry timers
    
    const run_id = crypto.randomUUID();

    // --- Setup SSE Stream ---
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); 
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); 
    
    const { log, logErrorAndClose, sendFinalDataAndClose, sendEvent } = createLogger(run_id, response);
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

    try {
        const { formData, nutritionalTargets } = request.body;
        const numDays = parseInt(formData.days, 10) || 7;
        log(`Plan generation starting for ${numDays} days.`, 'INFO', 'SYSTEM');
        sendEvent('plan:start', { days: numDays, formData: getSanitizedFormData(formData) });

        // --- Input Validation ---
        if (!formData || typeof formData !== 'object' || Object.keys(formData).length < 5) {
            throw.new Error("Missing or invalid 'formData' in request body.");
        }
        if (!nutritionalTargets || typeof nutritionalTargets !== 'object' || !nutritionalTargets.calories) {
            throw new Error("Missing or invalid 'nutritionalTargets' in request body.");
        }
        const { store } = formData;
        if (!store) throw new Error("'store' missing in formData.");


        // --- Phase 1: Generate ALL Meals (Batched) ---
        sendEvent('phase:start', { name: 'meals', description: `Generating ${numDays}-day meal plan...` });
        const dietitianStartTime = Date.now();
        const mealPlanBatches = [];

        // --- [FIX] Batch 1: Days 1 up to (numDays or 3, whichever is smaller) ---
        const firstBatchEnd = Math.min(numDays, 3);
        mealPlanBatches.push(generateMealPlan_Batched(1, firstBatchEnd, formData, nutritionalTargets, log));

        // Batch 2: Days 4-7 (if needed)
        if (numDays > 3) {
            mealPlanBatches.push(generateMealPlan_Batched(4, numDays, formData, nutritionalTargets, log));
        }
        // --- [END FIX] ---

        const dailyMealPlansArrays = await Promise.all(mealPlanBatches);
        const fullMealPlan = dailyMealPlansArrays.flat(); // This is the master list of day objects
        
        dietitian_ms = Date.now() - dietitianStartTime;
        
        // --- [FIX 2] Add optional chaining to safely count meals ---
        const mealCount = fullMealPlan.reduce((acc, day) => acc + (day?.meals?.length || 0), 0);
        sendEvent('phase:end', { name: 'meals', duration_ms: dietitian_ms, mealCount: mealCount });
        
        if (fullMealPlan.length !== numDays) {
            throw new Error(`Meal Planner AI failed: Expected ${numDays} days, but only received ${fullMealPlan.length}.`);
        }

        // --- Phase 2: Aggregate Ingredients ---
        sendEvent('phase:start', { name: 'aggregate', description: 'Aggregating ingredient list...' });
        const aggregateStartTime = Date.now();
        const ingredientMap = new Map(); // Use normalizedKey as the key

        for (const day of fullMealPlan) {
            // --- [FIX 2] Add optional chaining safety check ---
            if (!day || !day.meals) continue; 
            
            for (const meal of day.meals) {
                // Add normalizedKey to all items *early*
                meal.items.forEach(item => { if(item && item.key) { item.normalizedKey = normalizeKey(item.key); } });

                for (const item of meal.items) {
                    const { value: gramsOrMl } = normalizeToGramsOrMl(item, log);
                    
                    const existing = ingredientMap.get(item.normalizedKey);
                    if (existing) {
                        existing.requested_total_g += gramsOrMl;
                        existing.dayRefs.add(day.dayNumber);
                    } else {
                        ingredientMap.set(item.normalizedKey, {
                            originalIngredient: item.key, // Use the first-seen name as the "original"
                            normalizedKey: item.normalizedKey,
                            requested_total_g: gramsOrMl,
                            dayRefs: new Set([day.dayNumber])
                        });
                    }
                }
            }
        }
        const aggregatedIngredients = Array.from(ingredientMap.values());
        sendEvent('phase:end', { name: 'aggregate', duration_ms: Date.now() - aggregateStartTime, uniqueIngredients: aggregatedIngredients.length });


        // --- Phase 3: Generate Queries & Run Market (Batched) ---
        sendEvent('phase:start', { name: 'market', description: `Querying ${store} for ${aggregatedIngredients.length} items...` });
        const marketStartTime = Date.now();

        // 3a. Generate Queries
        const groceryQueryData = await generateGroceryQueries_Batched(aggregatedIngredients, store, log);
        const { ingredients: ingredientPlan } = groceryQueryData;
        if (!ingredientPlan || ingredientPlan.length === 0) {
             throw new Error(`Grocery Optimizer AI returned empty ingredients.`);
        }
        
        // 3b. Run Market
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
                     return { [ingredient.normalizedKey]: { ...ingredient, source: 'error', error: 'Missing critical query/validation fields', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url } };
                 }
                const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
                const qn = ingredient.normalQuery;
                const qt = (ingredient.tightQuery && ingredient.tightQuery.trim()) ? ingredient.tightQuery : synthTight(ingredient, store);
                const qw = (ingredient.wideQuery && ingredient.wideQuery.trim()) ? ingredient.wideQuery : synthWide(ingredient, store);
                
                const queriesToTry = [ { type: 'tight', query: qt }, { type: 'normal', query: qn }, { type: 'wide', query: qw } ].filter(q => q.query && q.query.trim());
                log(`[${ingredientKey}] Queries: Tight (${qt ? (ingredient.tightQuery ? 'AI' : 'Synth') : 'N/A'}), Normal (AI), Wide (${qw ? (ingredient.wideQuery ? 'AI' : 'Synth') : 'N/A'})`, 'DEBUG', 'MARKET_RUN');
                
                let acceptedQueryType = 'none';
                let bestScore = 0;

                for (const [index, { type, query }] of queriesToTry.entries()) {
                    if (type === 'normal' && acceptedQueryType !== 'none') continue; 
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
                                score: checklistResult.score
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
                        } else { currentAttemptLog.status = 'no_match_post_filter'; }
                    } else { log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA'); currentAttemptLog.status = 'no_match'; }
                } // end query loop
                
                if (result.source === 'failed') { 
                    log(`[${ingredientKey}] Market Run failed after trying all queries.`, 'WARN', 'MARKET_RUN');
                    sendEvent('ingredient:failed', { key: ingredient.normalizedKey, reason: 'No product match found.' });
                } else { 
                    log(`[${ingredientKey}] Market Run success via '${acceptedQueryType}' query.`, 'DEBUG', 'MARKET_RUN');
                    sendEvent('ingredient:found', { key: ingredient.normalizedKey, data: { ...ingredient, ...result } });
                }

                telemetry.used = acceptedQueryType;
                telemetry.score = bestScore;
                log(`[${ingredientKey}] Market Run Telemetry`, 'INFO', 'MARKET_RUN_TELEMETRY', telemetry);

                return { [ingredient.normalizedKey]: result };

            } catch(e) {
                log(`CRITICAL Error in processSingleIngredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                 sendEvent('ingredient:failed', { key: ingredient.normalizedKey, reason: e.message });
                 return { _error: true, itemKey: ingredient?.originalIngredient || 'unknown_error', message: `Internal Market Run Error: ${e.message}` };
            }
        };
        
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
            return {
                ...planDetails,
                normalizedKey: aggItem.normalizedKey,
                totalGramsRequired: aggItem.requested_total_g, 
                dayRefs: aggItem.dayRefs
            };
        });
        
        // --- [FIX] Changed 'MAX_MARKET_RUN_CONCURRENCY' to 'MARKET_RUN_CONCURRENCY' ---
        const parallelResultsArray = await concurrentlyMap(fullIngredientPlan, MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        
        const fullResultsMap = new Map(); // Map<normalizedKey, result>
        parallelResultsArray.forEach(currentResult => {
             if (currentResult._error) {
                 log(`Market Run Item Error for "${currentResult.itemKey}": ${currentResult.message}`, 'WARN', 'MARKET_RUN');
                 const planItem = fullIngredientPlan.find(i => i.originalIngredient === currentResult.itemKey);
                 const baseData = planItem || { originalIngredient: currentResult.itemKey, normalizedKey: normalizeKey(currentResult.itemKey) };
                 fullResultsMap.set(baseData.normalizedKey, { ...baseData, source: 'error', error: currentResult.message, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
                 return;
             }
             const normalizedKey = Object.keys(currentResult)[0];
             const resultData = currentResult[normalizedKey];
             
             if (resultData && typeof resultData === 'object') {
                 fullResultsMap.set(normalizedKey, { ...resultData });
             } else {
                  log(`Invalid market result structure for "${normalizedKey}"`, 'ERROR', 'SYSTEM', { resultData });
                  const planItem = fullIngredientPlan.find(i => i.normalizedKey === normalizedKey);
                  fullResultsMap.set(normalizedKey, { ...planItem, source: 'error', error: 'Invalid market result structure', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
             }
        });
        
        market_run_ms = Date.now() - marketStartTime;
        sendEvent('phase:end', { name: 'market', duration_ms: market_run_ms, itemsFound: Array.from(fullResultsMap.values()).filter(v => v.source === 'discovery').length });


        // --- Phase 4: Nutrition Fetch ---
        sendEvent('phase:start', { name: 'nutrition', description: 'Fetching nutrition data...' });
        const nutritionStartTime = Date.now();
        const itemsToFetchNutrition = [];
        const nutritionDataMap = new Map(); // Map<normalizedKey, nutritionData>

        for (const [normalizedKey, result] of fullResultsMap.entries()) {
            if (result.source === 'discovery' && result.currentSelectionURL && Array.isArray(result.allProducts)) {
                const selected = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                if (selected) {
                    itemsToFetchNutrition.push({ ingredientKey: result.originalIngredient, normalizedKey: normalizedKey, barcode: selected.barcode, query: selected.name });
                }
            }
        }
        
        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition for ${itemsToFetchNutrition.length} items...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, NUTRITION_CONCURRENCY, async (item) => {
                 try {
                     const nut = (item.barcode || item.query) ? await fetchNutritionData(item.barcode, item.query, log) : { status: 'not_found', source: 'no_query' };
                     return { ...item, nut };
                 } catch (err) {
                     log(`Nutrition fetch error for ${item.ingredientKey}: ${err.message}`, 'WARN', 'HTTP');
                     return { ...item, nut: { status: 'not_found', source: 'error', error: `Nutrition fetch failed: ${err.message}` } };
                 }
             });
            nutritionResults.forEach(item => {
                 if (item && item.normalizedKey && item.nut) {
                    nutritionDataMap.set(item.normalizedKey, item.nut);
                     const result = fullResultsMap.get(item.normalizedKey);
                     if (result && result.source === 'discovery' && Array.isArray(result.allProducts)) {
                         let productToAttach = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                         if (productToAttach) productToAttach.nutrition = item.nut;
                     }
                 }
            });
        }
        
        // --- Nutrition Fallback (Canonical) ---
        let canonicalHitsToday = 0;
        for (const [normalizedKey, result] of fullResultsMap.entries()) {
             const hasNutri = nutritionDataMap.has(normalizedKey) && nutritionDataMap.get(normalizedKey).status === 'found';
             if (!hasNutri) {
                 const canonicalNutrition = await fetchNutritionData(null, result.originalIngredient, log);
                 if (canonicalNutrition?.status === 'found' && canonicalNutrition.source === 'CANON') {
                     log(`[${result.originalIngredient}] Using CANONICAL fallback.`, 'DEBUG', 'CALC');
                     nutritionDataMap.set(normalizedKey, canonicalNutrition); 
                     canonicalHitsToday++;
                     if (result.source !== 'discovery') {
                         result.source = 'canonical_fallback';
                     }
                 }
             }
         }
        if (canonicalHitsToday > 0) log(`Used ${canonicalHitsToday} canonical fallbacks.`, 'INFO', 'CALC');
        
        nutrition_ms = Date.now() - nutritionStartTime;
        sendEvent('phase:end', { name: 'nutrition', duration_ms: nutrition_ms, itemsFetched: nutritionDataMap.size });


        // --- Phase 5: Solver (Calculate Final Macros) ---
        sendEvent('phase:start', { name: 'solver', description: 'Calculating final macros...' });
        const solverStartTime = Date.now();
        finalMealPlan = []; // Reset final plan

        const computeItemMacros = (item, mealItems) => {
             const normalizedKey = item.normalizedKey; 
             const { value: gramsOrMl } = normalizeToGramsOrMl(item, log);
             if (!Number.isFinite(gramsOrMl) || gramsOrMl < 0) {
                 log(`[Solver] Invalid quantity for item '${item.key}'.`, 'ERROR', 'CALC', { item, gramsOrMl });
                 return { p: 0, f: 0, c: 0, kcal: 0, key: item.key };
             }
             if (gramsOrMl === 0) { return { p: 0, f: 0, c: 0, kcal: 0, key: item.key }; }
             
             const { grams_as_sold, inferredMethod } = toAsSold(item, gramsOrMl, log);
             const nutritionData = nutritionDataMap.get(normalizedKey);
             let grams = grams_as_sold;
             let p = 0, f = 0, c = 0, kcal = 0;

             if (nutritionData && nutritionData.status === 'found') {
                 const proteinPer100 = Number(nutritionData.protein || nutritionData.protein_g_per_100g) || 0;
                 const fatPer100 = Number(nutritionData.fat || nutritionData.fat_g_per_100g) || 0;
                 const carbsPer100 = Number(nutritionData.carbs || nutritionData.carb_g_per_100g) || 0;
                 p = (proteinPer100 / 100) * grams;
                 f = (fatPer100 / 100) * grams;
                 c = (carbsPer100 / 100) * grams;
             } else { 
                log(`[Solver] No nutrition for '${item.key}'. Macros set to 0.`, 'WARN', 'CALC', { normalizedKey }); 
             }
             
             const { absorbed_oil_g } = getAbsorbedOil(item, inferredMethod, mealItems, log);
             if (absorbed_oil_g > 0) { f += absorbed_oil_g; }
             
             kcal = (p * 4) + (f * 9) + (c * 4);
             
             if (kcal > MAX_CALORIES_PER_ITEM && !item.key.toLowerCase().includes('oil')) {
                log(`CRITICAL: Item '${item.key}' calculated to ${kcal.toFixed(0)} kcal, exceeding sanity limit.`, 'CRITICAL', 'CALC', { item, grams, p, f, c });
                kcal = 0; p = 0; f = 0; c = 0;
             }
             return { p, f, c, kcal, key: item.key }; 
         };

        // --- Run Solver V1 (Shadow) vs Reconciler V0 (Live) ---
        for (const day of fullMealPlan) {
            let mealsForThisDay = JSON.parse(JSON.stringify(day.meals)); // Deep copy for safety
            const targetCalories = nutritionalTargets.calories;
            
            const calculateTotals = (mealList, dayNum) => {
                let totalKcal = 0, totalP = 0, totalF = 0, totalC = 0;
                let planHasInvalidItems = false;
                for (const meal of mealList) {
                     let mealKcal = 0, mealP = 0, mealF = 0, mealC = 0;
                     // --- [FIX 2] Add optional chaining safety check ---
                     if (meal && meal.items) {
                         for (const item of meal.items) {
                             const macros = computeItemMacros(item, meal.items);
                             mealKcal += macros.kcal; mealP += macros.p; mealF += macros.f; mealC += macros.c;
                         }
                     }
                     meal.subtotal_kcal = mealKcal; meal.subtotal_protein = mealP; meal.subtotal_fat = mealF; meal.subtotal_carbs = mealC;
                     if (meal.subtotal_kcal <= 0 && meal.items?.length > 0) { // Only log if not an empty meal
                         log(`[Solver] Meal "${meal.name}" (Day ${dayNum}) has zero/negative kcal.`, 'WARN', 'CALC', { items: meal.items.map(i => i.key) });
                         planHasInvalidItems = true;
                     }
                     totalKcal += mealKcal; totalP += mealP; totalF += mealF; totalC += mealC;
                }
                return { totalKcal, totalP, totalF, totalC, planHasInvalidItems };
            };

            // --- 1. Run Solver V1 (Shadow Path) ---
            const solverV1Meals = JSON.parse(JSON.stringify(mealsForThisDay));
            const solverV1Totals = calculateTotals(solverV1Meals, day.dayNumber);

            // --- 2. Run Reconciler V0 (Live Path by default) ---
            const reconcilerGetItemMacros = (item) => computeItemMacros(item, mealsForThisDay.find(m => m.items.some(i => i.key === item.key))?.items || []);
            const { adjusted, factor, meals: scaledMeals } = reconcileNonProtein({
                // --- [FIX 2] Add optional chaining safety check ---
                meals: mealsForThisDay.map(m => ({ ...m, items: (m.items || []).map(i => ({ ...i, qty: i.qty_value, unit: i.qty_unit })) })),
                targetKcal: targetCalories,
                getItemMacros: reconcilerGetItemMacros,
                tolPct: 5
            });
            const reconcilerV0Meals = scaledMeals.map(m => ({ ...m, items: m.items.map(i => ({ ...i, qty_value: i.qty, qty_unit: i.unit, normalizedKey: normalizeKey(i.key) })) }));
            const reconcilerV0Totals = calculateTotals(reconcilerV0Meals, day.dayNumber);

            // --- 3. Log Comparison ---
            log(`[Solver] Day ${day.dayNumber} Shadow Mode Comparison:`, 'INFO', 'SOLVER', {
                day: day.dayNumber,
                target: targetCalories,
                solver_v1_kcal: solverV1Totals.totalKcal.toFixed(0),
                reconciler_v0_kcal: reconcilerV0Totals.totalKcal.toFixed(0),
                reconciler_adjusted: adjusted,
                reconciler_factor: factor
            });

            // --- 4. Select Path based on Feature Flag ---
            if (USE_SOLVER_V1) {
                log(`[Solver] Using SOLVER_V1 (Deterministic Calc) for Day ${day.dayNumber}`, 'INFO', 'SOLVER');
                finalMealPlan.push({ ...day, meals: solverV1Meals });
            } else {
                log(`[Solver] Using RECONCILER_V0 (Legacy Scaling) for Day ${day.dayNumber}`, 'INFO', 'SOLVER');
                finalMealPlan.push({ ...day, meals: reconcilerV0Meals });
            }
        }
        solver_ms = Date.now() - solverStartTime;
        sendEvent('phase:end', { name: 'solver', duration_ms: solver_ms, using_solver_v1: USE_SOLVER_V1 });


        // --- Phase 6: Chef AI (Writer) ---
        sendEvent('phase:start', { name: 'writer', description: 'Writing recipes...' });
        const writerStartTime = Date.now();
        
        // --- [FIX 2] Add optional chaining safety check ---
        const allMeals = finalMealPlan.flatMap(day => day?.meals || []);
        const recipeResults = await concurrentlyMap(allMeals, 6, (meal) => generateChefInstructions(meal, store, log));
        
        const recipeMap = new Map();
        recipeResults.forEach((result, index) => {
            if (result && !result._error) {
                const originalMeal = allMeals[index];
                // --- [FIX 2] Add optional chaining safety check ---
                const dayNumber = finalMealPlan.find(d => d?.meals?.includes(originalMeal))?.dayNumber;
                if (dayNumber) {
                    recipeMap.set(`${dayNumber}:${originalMeal.name}`, result);
                }
            }
        });

        for (const day of finalMealPlan) {
            // --- [FIX 2] Add optional chaining safety check ---
            if (day && day.meals) {
                day.meals = day.meals.map(meal => {
                    const recipe = recipeMap.get(`${day.dayNumber}:${meal.name}`);
                    return recipe || { ...meal, ...MOCK_RECIPE_FALLBACK };
                });
            }
        }
        const writer_ms = Date.now() - writerStartTime;
        sendEvent('phase:end', { name: 'writer', duration_ms: writer_ms, recipesGenerated: recipeMap.size });

        // --- Phase 7: Finalize ---
        sendEvent('phase:start', { name: 'finalize', description: 'Assembling final plan...' });
        
        finalMealPlan.forEach(day => {
            // --- [FIX 2] Add optional chaining safety check ---
            if (day && day.meals) {
                day.meals.forEach(meal => {
                    meal.subtotal_kcal = Math.round(meal.subtotal_kcal || 0);
                    meal.subtotal_protein = Math.round(meal.subtotal_protein || 0);
                    meal.subtotal_fat = Math.round(meal.subtotal_fat || 0);
                    meal.subtotal_carbs = Math.round(meal.subtotal_carbs || 0);
                    // --- [FIX 2] Add optional chaining safety check ---
                    meal.items = (meal.items || []).map(item => ({
                        key: item.key,
                        qty: item.qty_value,
                        unit: item.qty_unit,
                        stateHint: item.stateHint,
                        methodHint: item.methodHint
                    }));
                });
            }
        });

        const responseData = {
            message: `Successfully generated full ${numDays}-day plan.`,
            mealPlan: finalMealPlan,
            results: Object.fromEntries(fullResultsMap.entries()),
            uniqueIngredients: fullIngredientPlan.map(({ normalizedKey, dayRefs, ...rest }) => ({
                ...rest,
                dayRefs: Array.from(dayRefs) 
            })),
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
        
        const isPlanError = error.message.startsWith('Plan generation failed');
        const errorCode = isPlanError ? "PLAN_INVALID" : "SERVER_FAULT_PLAN";

        logErrorAndClose(error.message, errorCode);
        return; 
    }
    finally {
        if (response && !response.writableEnded) {
            try { response.end(); } catch {}
        }
    }
};

/// ===== MAIN-HANDLER-END ===== ////


