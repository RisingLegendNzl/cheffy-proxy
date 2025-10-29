// --- Cheffy API: /api/plan/day.js ---
// Implements a "Two-Agent" AI system:
// 1. "Dietitian" AI: Generates the macro-perfect meal plan and shopping list.
// 2. "Chef" AI: Generates descriptions and cooking instructions for each meal.

/// ===== IMPORTS-START ===== \\\\
const fetch = require('node-fetch');
const crypto = require('crypto'); // For run_id
// Import cache-wrapped microservices
const { fetchPriceData } = require('../price-search.js'); // Relative path
const { fetchNutritionData } = require('../nutrition-search.js'); // Relative path
// Import the reconciler utility
const { reconcileNonProtein } = require('../../utils/reconcileNonProtein.js'); // Relative path
/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---
/// ===== CONFIG-START ===== \\\\
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Using gemini-2.5-flash as the primary model ---
const PLAN_MODEL_NAME_PRIMARY = 'gemini-2.5-flash';
// --- Using gemini-2.5-pro as the fallback ---
const PLAN_MODEL_NAME_FALLBACK = 'gemini-2.5-pro'; // Fallback model

// --- Create a function to get the URL ---
const getGeminiApiUrl = (modelName) => `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;


const MAX_LLM_RETRIES = 3; // Retries specifically for the LLM call
const MAX_NUTRITION_CONCURRENCY = 5;
const MAX_MARKET_RUN_CONCURRENCY = 5;
const BANNED_KEYWORDS = [
    'cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 
    'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 
    'folder', 'stationery', 'lighter', 'shampoo', 'conditioner', 'soap', 'lotion', 
    'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum'
];
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0; // Keep for market run optimization
const PRICE_OUTLIER_Z_SCORE = 2.0; // Keep for market run guardrail
const PANTRY_CATEGORIES = ["pantry", "grains", "canned", "spreads", "condiments", "drinks"];

// --- V11 Unit Normalization Maps (Copied) ---
const CANONICAL_UNIT_WEIGHTS_G = {
    'egg': 50, 'slice': 35, 'piece': 150, 'banana': 120, 'potato': 200
};
const DENSITY_MAP = {
    'milk': 1.03, 'cream': 1.01, 'oil': 0.92, 'sauce': 1.05, 'water': 1.0,
    'juice': 1.04, 'yogurt': 1.05, 'wine': 0.98, 'beer': 1.01
};
/// ===== CONFIG-END ===== ////

/// ===== MOCK-START ===== \\\\
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const MOCK_RECIPE_FALLBACK = {
    description: "Meal description could not be generated.",
    instructions: ["Cooking instructions could not be generated for this meal. Please rely on standard cooking methods for the ingredients listed."]
};
/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\

// --- Logger (Copied and Simplified) ---
function createLogger(run_id, day) {
    const logs = [];
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        try {
            const logEntry = {
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
             return fallbackEntry;
        }
    };
    return { log, getLogs: () => logs };
}

// --- Other Helpers (Copied from generate-full-plan.js) ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeKey = (s = '') => s.toString().toLowerCase().trim().replace(/\s+/g, ' ');

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

// --- fetchWithRetry specifically for LLM calls (Adjusted Timeout) ---
async function fetchLLMWithRetry(url, options, log, attemptPrefix = "LLM") {
    const LLM_REQUEST_TIMEOUT_MS = 75000; // 75 seconds

    for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

        try {
            log(`${attemptPrefix} Attempt ${attempt}: Fetching from ${url} (Timeout: ${LLM_REQUEST_TIMEOUT_MS}ms)`, 'DEBUG', 'HTTP');
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);

            if (response.ok) return response;

            // Handle specific status codes
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
            // Exponential backoff with jitter
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

// --- [MODIFIED] passRequiredWords ---
// Updated to handle simple plurals (adding 's')
function passRequiredWords(title = '', required = []) {
  if (!required || required.length === 0) return true;
  const t = title.toLowerCase();
  return required.every(w => {
    if (!w) return true; // Ignore empty strings in requiredWords
    const base = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars
    // Create a regex that matches the base word with an optional 's' at the end,
    // ensuring it's a whole word boundary (\b) at the start.
    const rx = new RegExp(`\\b${base}s?\\b`, 'i'); // Added s? and \b at the end
    return rx.test(t);
  });
}
// --- END: passRequiredWords Modification ---

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
    // --- Uses the [MODIFIED] passRequiredWords function ---
    if (!passRequiredWords(productNameLower, requiredWords ?? [])) {
        log(`${checkLogPrefix}: FAIL (Required words missing: [${(requiredWords ?? []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    // --- End Modification Check ---
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
    return { pass: true, score: 1.0 }; // Simplified score for now
}

// --- V11 Unit Normalization (Copied) ---
function normalizeToGramsOrMl(item, log) {
    if (!item || typeof item !== 'object') {
        log(`[Unit Conversion] Invalid item received: ${item}`, 'ERROR', 'CALC');
        return { value: 0, unit: 'g' }; // Default to 0g on error
    }
    let { qty, unit, key } = item;
     // Basic validation
     if (typeof qty !== 'number' || isNaN(qty) || typeof unit !== 'string' || typeof key !== 'string') {
        log(`[Unit Conversion] Invalid fields in item:`, 'ERROR', 'CALC', item);
        return { value: 0, unit: 'g' };
     }

    unit = unit.toLowerCase().trim().replace(/s$/, '');
    key = key.toLowerCase();

    if (unit === 'g' || unit === 'ml') return { value: qty, unit: unit };
    if (unit === 'kg') return { value: qty * 1000, unit: 'g' };
    if (unit === 'l') return { value: qty * 1000, unit: 'ml' };

    let weightPerUnit = CANONICAL_UNIT_WEIGHTS_G[unit];
    let usedHeuristic = true;

    if (!weightPerUnit) {
        if (key.includes('egg')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['egg'];
        else if (key.includes('bread') || key.includes('toast')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['slice'];
        else if (key.includes('banana')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['banana'];
        else if (key.includes('potato')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['potato'];
        else weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['piece']; // Default
    } else {
        usedHeuristic = false;
    }
     // Final check for weightPerUnit
     if (typeof weightPerUnit !== 'number' || isNaN(weightPerUnit) || weightPerUnit <= 0) {
         log(`[Unit Conversion] Could not determine valid weight for unit '${unit}' key '${key}'. Defaulting to 150g.`, 'WARN', 'CALC', item);
         weightPerUnit = 150; // Use a reasonable default if lookup fails
         usedHeuristic = true;
     }

    const grams = qty * weightPerUnit;

    if (!['g', 'ml', 'kg', 'l'].includes(unit)) { // Log only non-standard conversions
        log(`[Unit Conversion] Converting ${qty} ${unit} of '${key}' to ${grams}g using ${weightPerUnit}g/unit.`, 'DEBUG', 'CALC', { key, fromUnit: unit, qty, toGrams: grams, heuristic: usedHeuristic });
    }
    return { value: grams, unit: 'g' };
}

// --- Add synthesis functions ---
function synthTight(ing, store) {
  if (!ing || !store) return null;
  const size = ing.targetSize?.value && ing.targetSize?.unit ? ` ${ing.targetSize.value}${ing.targetSize.unit}` : "";
  // Ensure originalIngredient is a string before calling methods
  const original = typeof ing.originalIngredient === 'string' ? ing.originalIngredient : '';
  return `${store} ${original}${size}`.toLowerCase().trim();
}

function synthWide(ing, store) {
  if (!ing || !store) return null;
  // Ensure requiredWords exists and has at least one element, or fallback safely
  const noun = (Array.isArray(ing.requiredWords) && ing.requiredWords.length > 0 && typeof ing.requiredWords[0] === 'string')
    ? ing.requiredWords[0]
    : (typeof ing.originalIngredient === 'string' ? ing.originalIngredient.split(" ")[0] : ''); // Fallback to first word or empty string

  // Handle case where noun might still be undefined or empty
  if (!noun) return null;

  return `${store} ${noun}`.toLowerCase().trim();
}

/// ===== HELPERS-END ===== ////


/// ===== API-CALLERS-START ===== \\\\

// --- AGENT 1: "DIETITIAN" SYSTEM PROMPT ---
// --- START: MODIFICATION (Pass 'day' as argument) ---
const DIETITIAN_SYSTEM_PROMPT = (store, weight, calories, mealMax, australianTermNote, day) => `
Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate meals ('meals') & ingredients used TODAY ('ingredients'). **Never exceed 3 g/kg total daily protein (User weight: ${weight}kg).** 2. QUERIES: For each NEW ingredient TODAY: a. 'normalQuery' (REQUIRED): 2-4 generic words, STORE-PREFIXED. CRITICAL: Use MOST COMMON GENERIC NAME. DO NOT include brands, sizes, fat content, specific forms (sliced/grated), or dryness unless ESSENTIAL.${australianTermNote} b. 'tightQuery' (OPTIONAL, string | null): Hyper-specific, STORE-PREFIXED. Return null if 'normalQuery' is sufficient. c. 'wideQuery' (OPTIONAL, string | null): 1-2 broad words, STORE-PREFIXED. Return null if 'normalQuery' is sufficient. 3. 'requiredWords' (REQUIRED): Array[1-2] ESSENTIAL CORE NOUNS ONLY, lowercase singular. NO adjectives, forms, plurals. These words MUST exist in product names. 4. 'negativeKeywords' (REQUIRED): Array[1-3] lowercase words for INCORRECT product. Be concise. 5. 'targetSize' (REQUIRED): Object {value: NUM, unit: "g"|"ml"} | null. Null if N/A. Prefer common package sizes. 6. 'totalGramsRequired' (REQUIRED): BEST ESTIMATE total g/ml for THIS DAY ONLY. MUST accurately reflect sum of meal portions for Day ${day}. 7. Adhere to constraints. 8. 'ingredients' MANDATORY (only those used today). 'meals' MANDATORY (only for today). 9. 'allowedCategories' (REQUIRED): Array[1-2] precise, lowercase categories from this exact set: ["produce","fruit","veg","dairy","bakery","meat","seafood","pantry","frozen","drinks","canned","grains","spreads","condiments","snacks"]. 10. MEAL PORTIONS: For each meal in 'meals': a) MUST populate 'items' array with 'key' (matching 'originalIngredient'), 'qty', and 'unit' ('g', 'ml', 'slice', 'egg'). b) **STRONGLY AIM** for the sum of estimated calories from ALL 'items' across ALL meals for Day ${day} to be **close (ideally within +/- 15%)** to the **${calories} kcal** target. Adjust 'qty' values (esp. carbs/fats) generally towards this goal, but prioritize generating the correct meal structure. c) No single meal's 'items' should sum > **${mealMax} kcal**.
Output ONLY the valid JSON object described below. ABSOLUTELY NO PROSE OR MARKDOWN.

JSON Structure:
{
  "ingredients": [ { "originalIngredient": "string", "category": "string", "tightQuery": "string|null", "normalQuery": "string", "wideQuery": "string|null", "requiredWords": ["string"], "negativeKeywords": ["string"], "targetSize": { "value": number, "unit": "g"|"ml" }|null, "totalGramsRequired": number, "quantityUnits": "string", "allowedCategories": ["string"] } ],
  "meals": [ { "type": "string", "name": "string", "items": [ { "key": "string", "qty": number, "unit": "string" } ] } ]
}
`;
// --- END: MODIFICATION ---


/**
 * Tries to generate AND validate a plan from a single model.
 * Throws an error if generation or validation fails, allowing fallback.
 */
async function tryGenerateDietitianPlan(modelName, payload, log, day) {
    log(`Dietitian AI Day ${day}: Attempting model: ${modelName}`, 'INFO', 'LLM');
    const apiUrl = getGeminiApiUrl(modelName);
    
    // 1. Fetch (with retries for network/5xx errors)
    const response = await fetchLLMWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload)
    }, log, `DietitianDay${day}`);

    // 2. Parse response body
    const result = await response.json();

    // 3. Validate candidate and finishReason
    const candidate = result.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason === 'MAX_TOKENS') {
        log(`Dietitian AI Day ${day}: Model ${modelName} failed with finishReason: MAX_TOKENS.`, 'WARN', 'LLM');
        throw new Error(`Model ${modelName} failed: MAX_TOKENS.`);
    }
    if (finishReason !== 'STOP') {
         log(`Dietitian AI Day ${day}: Model ${modelName} failed with non-STOP finishReason: ${finishReason}`, 'WARN', 'LLM', { result });
         throw new Error(`Model ${modelName} failed: FinishReason was ${finishReason}.`);
    }

    // 4. Validate content
    const content = candidate?.content;
    if (!content || !content.parts || content.parts.length === 0 || !content.parts[0].text) {
        log(`Dietitian AI Day ${day}: Model ${modelName} response missing content or text part.`, 'CRITICAL', 'LLM', { result });
        throw new Error(`Model ${modelName} failed: Response missing content.`);
    }

    // 5. Validate JSON parsing
    const jsonText = content.parts[0].text;
    log("Dietitian AI Raw JSON Text (Day " + day + ")", 'DEBUG', 'LLM', { raw: jsonText.substring(0, 300) + '...' });

    try {
        const parsed = JSON.parse(jsonText);
        log("Parsed Dietitian AI JSON (Day " + day + ")", 'INFO', 'DATA', { ingreds: parsed.ingredients?.length || 0, meals: parsed.meals?.length || 0 });

        // --- Basic Validation ---
        if (!parsed || typeof parsed !== 'object') throw new Error("Parsed response is not a valid object.");
        if (!parsed.ingredients || !Array.isArray(parsed.ingredients)) throw new Error("'ingredients' missing or not an array.");
        if (!parsed.meals || !Array.isArray(parsed.meals) || parsed.meals.length === 0) throw new Error("'meals' missing, empty, or not an array.");

        // --- Detailed Validation (Essential Fields) ---
         for(const meal of parsed.meals) {
             // 'description' is NO LONGER required from this AI
             if (!meal || !meal.type || !meal.name || !Array.isArray(meal.items)) throw new Error(`Meal invalid: Missing fields in ${meal?.name || 'Unnamed Meal'}.`);
             for(const item of meal.items) {
                 if (!item || !item.key || typeof item.qty !== 'number' || !item.unit) throw new Error(`Meal item invalid in ${meal.name}: Missing key, qty, or unit.`);
             }
         }
         for(const ing of parsed.ingredients) {
             if (!ing || !ing.originalIngredient || !ing.normalQuery || !Array.isArray(ing.requiredWords) || !Array.isArray(ing.negativeKeywords) || !Array.isArray(ing.allowedCategories) || ing.allowedCategories.length === 0 || typeof ing.totalGramsRequired !== 'number' || !ing.quantityUnits) {
                   log(`Validation Error: Ingredient "${ing?.originalIngredient || 'unknown'}" missing required fields or invalid types.`, 'WARN', 'LLM', ing);
                   throw new Error(`Ingredient validation failed (required fields): "${ing?.originalIngredient || 'unknown'}"`);
             }
             if (ing.tightQuery !== null && typeof ing.tightQuery !== 'string') throw new Error(`Ingredient validation failed (tightQuery type): "${ing?.originalIngredient || 'unknown'}"`);
             if (ing.wideQuery !== null && typeof ing.wideQuery !== 'string') throw new Error(`Ingredient validation failed (wideQuery type): "${ing?.originalIngredient || 'unknown'}"`);
         }

        log(`Dietitian AI Day ${day}: Model ${modelName} succeeded.`, 'SUCCESS', 'LLM');
        return parsed; // Return the fully parsed and validated data

    } catch (parseError) {
        log(`Failed to parse/validate Dietitian AI JSON for Day ${day} from ${modelName}: ${parseError.message}`, 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 300) });
        throw new Error(`Model ${modelName} failed: Invalid JSON response. ${parseError.message}`);
    }
}


async function generateDietitianPlan(day, formData, nutritionalTargets, log) {
    const { name, height, weight, age, gender, goal, dietary, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const { calories, protein, fat, carbs } = nutritionalTargets; // Use pre-calculated targets

    // --- Validate inputs ---
    if (!day || isNaN(parseInt(day)) || parseInt(day) < 1 || parseInt(day) > 7) {
        throw new Error("Invalid 'day' parameter provided.");
    }
    if (!nutritionalTargets || typeof nutritionalTargets !== 'object' || !calories || !protein || !fat || !carbs) {
        throw new Error("Invalid or missing 'nutritionalTargets' provided.");
    }

    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']};
    const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const cuisineInstruction = cuisine && cuisine.trim() ? `Focus: ${cuisine}.` : 'Neutral.';
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion', 'capsicum')." : "";

    const numMeals = parseInt(eatingOccasions, 10) || 3;
    const mealAvg = Math.round(calories / numMeals);
    const mealMax = Math.round(mealAvg * 1.5); // 50% variance allowed per meal

    // --- Get the specific system prompt for the Dietitian AI ---
    // --- START: MODIFICATION (Pass 'day' correctly) ---
    const systemPrompt = DIETITIAN_SYSTEM_PROMPT(store, weight, calories, mealMax, australianTermNote, day);
    // --- END: MODIFICATION ---
    
    let userQuery = `Gen plan Day ${day} for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Day ${day} Target: ~${calories} kcal (P ~${protein}g, F ~${fat}g, C ~${carbs}g). Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority}. Cuisine: ${cuisineInstruction}.`;

    log(`Dietitian AI Prompt for Day ${day}`, 'INFO', 'LLM_PROMPT', {
        systemPromptStart: systemPrompt.substring(0, 200) + '...', // Log start only
        userQuery: userQuery,
        targets: nutritionalTargets,
        sanitizedData: getSanitizedFormData(formData)
    });

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.3, 
            topK: 32,
            topP: 0.9,
            responseMimeType: "application/json", 
        }
    };

    // --- Use the helper with fallback (Logic unchanged here) ---
    let parsedResult;
    try {
        parsedResult = await tryGenerateDietitianPlan(PLAN_MODEL_NAME_PRIMARY, payload, log, day);
    } catch (primaryError) {
        log(`Dietitian AI Day ${day}: PRIMARY Model ${PLAN_MODEL_NAME_PRIMARY} failed: ${primaryError.message}. Attempting FALLBACK.`, 'WARN', 'LLM');

        try {
            parsedResult = await tryGenerateDietitianPlan(PLAN_MODEL_NAME_FALLBACK, payload, log, day);
        } catch (fallbackError) {
            log(`Dietitian AI Day ${day}: FALLBACK Model ${PLAN_MODEL_NAME_FALLBACK} also failed: ${fallbackError.message}.`, 'CRITICAL', 'LLM');
            throw new Error(`Plan generation failed for Day ${day}: Both primary (${PLAN_MODEL_NAME_PRIMARY}) and fallback (${PLAN_MODEL_NAME_FALLBACK}) AI models failed to produce a valid plan. Last error: ${fallbackError.message}`);
        }
    }
    return parsedResult;
}


// --- AGENT 2: "CHEF" AI ---

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
 * Tries to generate AND validate a recipe from a single model.
 */
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
        
        // --- Validation ---
        if (!parsed || typeof parsed.description !== 'string' || !Array.isArray(parsed.instructions) || parsed.instructions.length === 0) {
             throw new Error("Invalid JSON structure: 'description' (string) or 'instructions' (array) missing/empty.");
        }
        
        log(`Chef AI [${mealName}]: Model ${modelName} succeeded.`, 'SUCCESS', 'LLM_CHEF');
        return parsed; // { description, instructions }
    
    } catch (parseError) {
        log(`Failed to parse/validate Chef AI JSON for [${mealName}] from ${modelName}: ${parseError.message}`, 'CRITICAL', 'LLM_CHEF', { jsonText: jsonText.substring(0, 300) });
        throw new Error(`Model ${modelName} failed: Invalid JSON response. ${parseError.message}`);
    }
}


/**
 * Generates cooking instructions for a single meal by calling the "Chef" AI.
 */
async function generateChefInstructions(meal, store, log) {
    const mealName = meal.name || 'Unnamed Meal';
    try {
        const systemPrompt = CHEF_SYSTEM_PROMPT(store);

        // Format ingredients for the query
        const ingredientList = meal.items.map(item => `- ${item.qty}${item.unit} ${item.key}`).join('\n');
        const userQuery = `Generate a recipe for "${meal.name}" using only these ingredients:\n${ingredientList}`;
        
        log(`Chef AI Prompt for [${mealName}]`, 'INFO', 'LLM_PROMPT', {
            systemPromptStart: systemPrompt.substring(0, 200) + '...',
            userQuery: userQuery
        });

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0.4, // Slightly more creative for cooking
                topK: 32,
                topP: 0.9,
                responseMimeType: "application/json", 
            }
        };

        // --- Try Primary, then Fallback ---
        try {
            return await tryGenerateChefRecipe(PLAN_MODEL_NAME_PRIMARY, payload, mealName, log);
        } catch (primaryError) {
            log(`Chef AI [${mealName}]: PRIMARY Model ${PLAN_MODEL_NAME_PRIMARY} failed: ${primaryError.message}. Attempting FALLBACK.`, 'WARN', 'LLM_CHEF');
            try {
                return await tryGenerateChefRecipe(PLAN_MODEL_NAME_FALLBACK, payload, mealName, log);
            } catch (fallbackError) {
                log(`Chef AI [${mealName}]: FALLBACK Model ${PLAN_MODEL_NAME_FALLBACK} also failed: ${fallbackError.message}.`, 'CRITICAL', 'LLM_CHEF');
                throw new Error(`Recipe generation failed for [${mealName}]: Both AI models failed. Last error: ${fallbackError.message}`);
            }
        }
    } catch (error) {
        log(`CRITICAL Error in generateChefInstructions for [${mealName}]: ${error.message}`, 'CRITICAL', 'LLM_CHEF');
        return MOCK_RECIPE_FALLBACK; // Return fallback on unhandled error
    }
}


/// ===== API-CALLERS-END ===== ////

/// ===== MAIN-HANDLER-START ===== \\\\

module.exports = async (request, response) => {
    const run_id = crypto.randomUUID(); // Unique ID for this specific day's run
    const day = request.query.day ? parseInt(request.query.day, 10) : null;
    const { log, getLogs } = createLogger(run_id, day || 'unknown'); // Pass day to logger

    // Set CORS headers
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS
    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight.", 'INFO', 'HTTP');
        return response.status(200).end();
    }

    // Handle non-POST methods
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        response.setHeader('Allow', 'POST, OPTIONS');
        return response.status(405).json({ message: `Method ${request.method} Not Allowed.`, code: "METHOD_NOT_ALLOWED", logs: getLogs() });
    }

    // --- Main Logic ---
    let scaleFactor = null; // For reconciliation telemetry

    try {
        log(`Generating plan for Day ${day}...`, 'INFO', 'SYSTEM');

        // --- Input Validation ---
        if (!day || day < 1 || day > 7) {
             throw new Error("Invalid or missing 'day' parameter in query string.");
        }
        const { formData, nutritionalTargets } = request.body;
        if (!formData || typeof formData !== 'object' || Object.keys(formData).length < 5) { // Basic check
            throw new Error("Missing or invalid 'formData' in request body.");
        }
        if (!nutritionalTargets || typeof nutritionalTargets !== 'object' || !nutritionalTargets.calories) {
            throw new Error("Missing or invalid 'nutritionalTargets' in request body.");
        }
        const { store } = formData;
        if (!store) throw new Error("'store' missing in formData.");


        // --- Phase 1: Generate Day Plan (DIETITIAN AI) ---
        log("Phase 1: Generating Day Plan (Dietitian AI)...", 'INFO', 'PHASE');
        const llmResult = await generateDietitianPlan(day, formData, nutritionalTargets, log);
        const { ingredients: rawDayIngredients = [], meals: dayMeals = [] } = llmResult; // 'dayMeals' now lacks descriptions

        if (rawDayIngredients.length === 0 || dayMeals.length === 0) {
            log("Dietitian AI failed: Empty ingredients or meals returned after validation.", 'CRITICAL', 'LLM');
            throw new Error(`Plan generation failed for Day ${day}: Dietitian AI returned empty meals or ingredients.`);
        }
        log(`Dietitian AI success for Day ${day}: ${rawDayIngredients.length} ingredients, ${dayMeals.length} meals.`, 'SUCCESS', 'PHASE');

        
        // --- Phase 1.5: Generate Recipes (CHEF AI) ---
        log("Phase 1.5: Generating Recipes (Chef AI)...", 'INFO', 'PHASE');
        
        // Create an array of promises, one for each meal
        const mealPromises = dayMeals.map(meal => 
            generateChefInstructions(meal, store, log)
        );

        // Run all "Chef AI" calls in parallel
        const settledResults = await Promise.allSettled(mealPromises);

        // Merge recipes back into the meal plan
        const finalDayMeals = dayMeals.map((meal, index) => {
            const result = settledResults[index];
            if (result.status === 'fulfilled' && result.value) {
                // Success: Merge the description and instructions
                return { ...meal, ...result.value }; // result.value is { description, instructions }
            } else {
                // Failure: Log the error and use a fallback
                log(`Chef AI failed for meal "${meal.name}": ${result.reason?.message || 'Unknown error'}`, 'ERROR', 'LLM_CHEF');
                return { ...meal, ...MOCK_RECIPE_FALLBACK };
            }
        });

        log(`Chef AI complete for Day ${day}.`, 'SUCCESS', 'PHASE');

        // --- Normalize Ingredient Keys ---
        const dayIngredientsPlan = rawDayIngredients.map(ing => ({
            ...ing,
            normalizedKey: normalizeKey(ing.originalIngredient)
        }));


        // --- Phase 2: Market Run (for this day's ingredients) ---
        log("Phase 2: Market Run (Day " + day + ")...", 'INFO', 'PHASE');

        const processSingleIngredientOptimized = async (ingredient) => {
             try {
                 if (!ingredient || !ingredient.originalIngredient) {
                     log(`Market Run: Skipping invalid ingredient data`, 'WARN', 'MARKET_RUN', { ingredient });
                     return { _error: true, itemKey: 'unknown_invalid', message: 'Invalid ingredient data' };
                 }
                const ingredientKey = ingredient.originalIngredient;
                 // Validation: normalQuery is essential now
                 if (!ingredient.normalQuery || !Array.isArray(ingredient.requiredWords) || !Array.isArray(ingredient.negativeKeywords) || !Array.isArray(ingredient.allowedCategories) || ingredient.allowedCategories.length === 0) {
                     log(`[${ingredientKey}] Skipping: Missing critical fields (normalQuery/validation)`, 'ERROR', 'MARKET_RUN', ingredient);
                     return { [ingredientKey]: { ...ingredient, source: 'error', error: 'Missing critical query/validation fields', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url } };
                 }

                const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
                let foundProduct = null;

                const qn = ingredient.normalQuery; // Always required from LLM
                const qt = (ingredient.tightQuery && ingredient.tightQuery.trim()) ? ingredient.tightQuery : synthTight(ingredient, store);
                const qw = (ingredient.wideQuery && ingredient.wideQuery.trim()) ? ingredient.wideQuery : synthWide(ingredient, store);

                const queriesToTry = [
                    { type: 'tight', query: qt },
                    { type: 'normal', query: qn },
                    { type: 'wide', query: qw }
                ].filter(q => q.query && q.query.trim()); // Only keep valid queries

                log(`[${ingredientKey}] Queries: Tight (${qt ? (ingredient.tightQuery ? 'AI' : 'Synth') : 'N/A'}), Normal (AI), Wide (${qw ? (ingredient.wideQuery ? 'AI' : 'Synth') : 'N/A'})`, 'DEBUG', 'MARKET_RUN');
                
                let acceptedQueryType = 'none';

                for (const [index, { type, query }] of queriesToTry.entries()) {
                    log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
                    result.searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0});
                    const currentAttemptLog = result.searchAttempts.at(-1);

                    const { data: priceData, waitMs } = await fetchPriceData(store, query, 1, log); // Use imported function

                    if (priceData.error) {
                        log(`[${ingredientKey}] Fetch failed (${type}): ${priceData.error.message}`, 'WARN', 'HTTP', { status: priceData.error.status });
                        currentAttemptLog.status = 'fetch_error';
                        continue; // Try next query type
                    }

                    const rawProducts = priceData.results || [];
                    currentAttemptLog.rawCount = rawProducts.length;
                    const validProductsOnPage = [];
                    for (const rawProduct of rawProducts) {
                        if (!rawProduct || !rawProduct.product_name) continue; // Skip invalid data
                        const checklistResult = runSmarterChecklist(rawProduct, ingredient, log);
                        if (checklistResult.pass) {
                            validProductsOnPage.push({
                                product: { // Map to consistent structure
                                    name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size)
                                },
                                score: checklistResult.score
                            });
                        }
                    }

                    const filteredProducts = applyPriceOutlierGuard(validProductsOnPage, log, ingredientKey);
                    currentAttemptLog.foundCount = filteredProducts.length;
                    currentAttemptLog.bestScore = filteredProducts.length > 0 ? filteredProducts.reduce((max, p) => Math.max(max, p.score), 0) : 0;

                    if (filteredProducts.length > 0) {
                        log(`[${ingredientKey}] Found ${filteredProducts.length} valid (${type}).`, 'INFO', 'DATA');
                        const currentUrls = new Set(result.allProducts.map(p => p.url));
                        filteredProducts.forEach(vp => { if (!currentUrls.has(vp.product.url)) { result.allProducts.push(vp.product); } });

                        if (result.allProducts.length > 0) {
                             foundProduct = result.allProducts.reduce((best, current) =>
                                 (current.unit_price_per_100 ?? Infinity) < (best.unit_price_per_100 ?? Infinity) ? current : best,
                             result.allProducts[0]);
                             result.currentSelectionURL = foundProduct.url;
                             result.source = 'discovery';
                             currentAttemptLog.status = 'success';
                             acceptedQueryType = type;

                             if (type === 'tight' && currentAttemptLog.bestScore >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                                log(`[${ingredientKey}] Skip heuristic hit (Tight query OK).`, 'INFO', 'MARKET_RUN');
                                break;
                             }
                             if (type === 'normal') {
                                 const remainingQueries = queriesToTry.slice(index + 1);
                                 if (!remainingQueries.some(q => q.type === 'wide')) {
                                      break;
                                 }
                             }
                        } else {
                             currentAttemptLog.status = 'no_match_post_filter';
                        }
                    } else {
                        log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA');
                        currentAttemptLog.status = 'no_match';
                    }
                } // End query loop

                if (result.source === 'failed') { log(`[${ingredientKey}] Market Run failed after trying all queries.`, 'WARN', 'MARKET_RUN'); }
                else { log(`[${ingredientKey}] Market Run success via '${acceptedQueryType}' query.`, 'DEBUG', 'MARKET_RUN'); }

                return { [ingredientKey]: result };

            } catch(e) {
                log(`CRITICAL Error in processSingleIngredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                 return { _error: true, itemKey: ingredient?.originalIngredient || 'unknown_error', message: `Internal Market Run Error: ${e.message}` };
            }
        };

        const startMarketTime = Date.now();
        const parallelResultsArray = await concurrentlyMap(dayIngredientsPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        const endMarketTime = Date.now();
        log(`Market Run (Day ${day}) took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

        // --- Consolidate Market Run results ---
        const dayResultsMap = new Map(); // Use Map with normalized keys
        parallelResultsArray.forEach(currentResult => {
             if (currentResult._error) {
                 log(`Market Run Item Error (Day ${day}) for "${currentResult.itemKey}": ${currentResult.message}`, 'WARN', 'MARKET_RUN'); // Downgrade to WARN
                 const planItem = dayIngredientsPlan.find(i => i.originalIngredient === currentResult.itemKey);
                 const baseData = planItem || { originalIngredient: currentResult.itemKey, normalizedKey: normalizeKey(currentResult.itemKey) };
                 dayResultsMap.set(baseData.normalizedKey, { ...baseData, source: 'error', error: currentResult.message, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
                 return;
             }
             const ingredientKey = Object.keys(currentResult)[0];
             const resultData = currentResult[ingredientKey];
             const normalizedKey = normalizeKey(ingredientKey); // Use helper for consistency
             const planItem = dayIngredientsPlan.find(i => i.normalizedKey === normalizedKey);
             if (!planItem) {
                 log(`Market run key "${ingredientKey}" (norm: "${normalizedKey}") not found in day plan. Skipping.`, 'ERROR', 'SYSTEM');
                 return;
             }
             if (resultData && typeof resultData === 'object') {
                 // Ensure normalizedKey from plan is preserved during merge
                 dayResultsMap.set(normalizedKey, { ...planItem, ...resultData, normalizedKey: planItem.normalizedKey });
             } else {
                  log(`Invalid market result structure for "${ingredientKey}"`, 'ERROR', 'SYSTEM', { resultData });
                  dayResultsMap.set(normalizedKey, { ...planItem, source: 'error', error: 'Invalid market result structure', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
             }
        });
        log(`Market Run complete for Day ${day}.`, 'SUCCESS', 'PHASE');


        // --- Phase 3: Nutrition Fetch (for this day's selected products) ---
        log("Phase 3: Nutrition Fetch (Day " + day + ")...", 'INFO', 'PHASE');
        const itemsToFetchNutrition = [];
        const nutritionDataMap = new Map(); // Local map for this day's nutrition

        for (const [normalizedKey, result] of dayResultsMap.entries()) {
            if (result.source === 'discovery' && result.currentSelectionURL && Array.isArray(result.allProducts)) {
                const selected = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                if (selected) {
                    itemsToFetchNutrition.push({
                        ingredientKey: result.originalIngredient, // Original for logs
                        normalizedKey: normalizedKey, // Normalized for map key
                        barcode: selected.barcode,
                        query: selected.name
                    });
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
            log(`Nutrition fetch complete for Day ${day}.`, 'SUCCESS', 'HTTP');

            nutritionResults.forEach(item => {
                 if (item && item.normalizedKey && item.nut) {
                    nutritionDataMap.set(item.normalizedKey, item.nut); // Store by normalized key
                     const result = dayResultsMap.get(item.normalizedKey);
                     if (result && result.source === 'discovery' && Array.isArray(result.allProducts)) {
                         let productToAttach = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                         if (productToAttach) productToAttach.nutrition = item.nut;
                     }
                 } else {
                      log(`Invalid item in nutrition results loop (Day ${day})`, 'WARN', 'CALC', {item});
                 }
            });
        } else {
            log(`No items require nutrition fetching for Day ${day}.`, 'INFO', 'CALC');
        }


        // --- Phase 4: Validation & Reconciliation (for this day) ---
        log("Phase 4: Validation & Reconciliation (Day " + day + ")...", 'INFO', 'PHASE');

         let canonicalHitsToday = 0;
         for (const [normalizedKey, result] of dayResultsMap.entries()) {
             const hasNutri = nutritionDataMap.has(normalizedKey) && nutritionDataMap.get(normalizedKey).status === 'found';
             if (!hasNutri && (result.source === 'failed' || result.source === 'error')) {
                 const canonicalNutrition = await fetchNutritionData(null, result.originalIngredient, log); // Use imported func
                 if (canonicalNutrition?.status === 'found' && (canonicalNutrition.source?.startsWith('canonical') || canonicalNutrition.source === 'nutrition-search-internal')) {
                     log(`[${result.originalIngredient}] Using CANONICAL fallback (Day ${day}).`, 'DEBUG', 'CALC');
                     nutritionDataMap.set(normalizedKey, canonicalNutrition);
                     canonicalHitsToday++;
                     const finalResult = dayResultsMap.get(normalizedKey);
                     if(finalResult) finalResult.source = 'canonical_fallback';
                 }
             }
         }
         if (canonicalHitsToday > 0) log(`Used ${canonicalHitsToday} canonical fallbacks for Day ${day}.`, 'INFO', 'CALC');

        // --- Define getItemMacros specific to this day's context ---
        const computeItemMacros = (item) => {
             if (!item || !item.key || typeof item.qty !== 'number' || !item.unit) {
                log(`[computeItemMacros] Invalid item structure received (Day ${day}).`, 'ERROR', 'CALC', item);
                throw new Error(`Plan generation failed for Day ${day}: Invalid item structure during calculation for "${item?.key || 'unknown'}".`);
             }
             const normalizedKey = item.normalizedKey || normalizeKey(item.key);
             item.normalizedKey = normalizedKey; // Ensure it's attached

             const { value: gramsOrMl, unit: normalizedUnit } = normalizeToGramsOrMl(item, log);

             if (!Number.isFinite(gramsOrMl) || gramsOrMl < 0 || gramsOrMl > 5000) {
                 log(`[computeItemMacros] CRITICAL: Invalid quantity for item '${item.key}' (Day ${day}).`, 'CRITICAL', 'CALC', { item, gramsOrMl });
                 throw new Error(`Plan generation failed for Day ${day}: Invalid quantity (${item.qty} ${item.unit} -> ${gramsOrMl}${normalizedUnit}) for item: "${item.key}"`);
             }
             if (gramsOrMl === 0) {
                 // Return 0 if the quantity resulted in 0 grams/ml
                 return { p: 0, f: 0, c: 0, kcal: 0, key: item.key, densityHeuristicUsed: false };
             }

             const nutritionData = nutritionDataMap.get(normalizedKey);
             let grams = gramsOrMl;
             let p = 0, f = 0, c = 0, kcal = 0;
             let densityHeuristicUsed = false;

             if (normalizedUnit === 'ml') {
                 let density = 1.0;
                 const keyLower = item.key.toLowerCase();
                 const foundDensityKey = Object.keys(DENSITY_MAP).find(k => keyLower.includes(k));
                 if (foundDensityKey) {
                     density = DENSITY_MAP[foundDensityKey];
                 } else {
                      densityHeuristicUsed = true;
                 }
                 grams = gramsOrMl * density;
             }

             if (nutritionData && nutritionData.status === 'found') {
                 const proteinPer100 = Number(nutritionData.protein) || 0;
                 const fatPer100 = Number(nutritionData.fat) || 0;
                 const carbsPer100 = Number(nutritionData.carbs) || 0;
                 p = (proteinPer100 / 100) * grams;
                 f = (fatPer100 / 100) * grams;
                 c = (carbsPer100 / 100) * grams;
                 kcal = (p * 4) + (f * 9) + (c * 4);
             } else {
                  log(`[computeItemMacros] No valid nutrition found for '${item.key}' (Day ${day}). Macros set to 0.`, 'WARN', 'CALC', { normalizedKey });
             }
             return { p, f, c, kcal, key: item.key, densityHeuristicUsed };
         };

        // --- Calculate Initial Totals for the Day ---
        log(`Calculating initial totals for Day ${day}...`, 'INFO', 'CALC');
        let initialDayKcal = 0;
        let initialDayP = 0;
        let initialDayF = 0;
        let initialDayC = 0;
        let mealHasInvalidItems = false;
        let densityHeuristicsToday = 0;

         finalDayMeals.forEach(meal => { // Use finalDayMeals (with recipes)
             if (meal && Array.isArray(meal.items)) {
                 meal.items.forEach(item => {
                     if(item && item.key) {
                         item.normalizedKey = normalizeKey(item.key);
                     }
                 });
             }
         });


        for (const meal of finalDayMeals) { // Use finalDayMeals
            if (!meal || !Array.isArray(meal.items) || meal.items.length === 0) {
                 log(`Validation Error: Meal "${meal?.name || 'Unnamed'}" has no items (Day ${day}).`, 'CRITICAL', 'CALC');
                 mealHasInvalidItems = true;
                 meal.subtotal_kcal = 0;
                 continue;
            }
             const mergedItemsMap = new Map();
             for(const item of meal.items) {
                 if (!item || !item.normalizedKey || !item.key) {
                     log(`Validation Error: Invalid item structure in meal "${meal.name}" (Day ${day}).`, 'ERROR', 'CALC', item);
                     mealHasInvalidItems = true; continue;
                 }
                 const existing = mergedItemsMap.get(item.normalizedKey);
                 if (existing) {
                     existing.qty += (item.qty || 0);
                 } else {
                     mergedItemsMap.set(item.normalizedKey, { ...item });
                 }
             }
             meal.items = Array.from(mergedItemsMap.values());


            let mealKcal = 0, mealP = 0, mealF = 0, mealC = 0;
            for (const item of meal.items) {
                 try {
                     const macros = computeItemMacros(item);
                     mealKcal += macros.kcal;
                     mealP += macros.p;
                     mealF += macros.f;
                     mealC += macros.c;
                     if (macros.densityHeuristicUsed) densityHeuristicsToday++;
                 } catch (itemError) {
                      log(`Error calculating macros for item "${item.key}" in meal "${meal.name}" (Day ${day}): ${itemError.message}`, 'CRITICAL', 'CALC');
                      mealHasInvalidItems = true;
                      mealKcal = NaN; mealP = NaN; mealF = NaN; mealC = NaN;
                      break;
                 }
            }

            meal.subtotal_kcal = mealKcal;
            meal.subtotal_protein = mealP;
            meal.subtotal_fat = mealF;
            meal.subtotal_carbs = mealC;

            if (!isNaN(mealKcal)) {
                 initialDayKcal += mealKcal;
                 initialDayP += mealP;
                 initialDayF += mealF;
                 initialDayC += mealC;
            } else {
                 mealHasInvalidItems = true;
            }

             if (!isNaN(mealKcal) && mealKcal <= 0) {
                  log(`Validation Error: Meal "${meal.name}" has zero or negative calculated calories (Day ${day}).`, 'CRITICAL', 'CALC', { meal });
                  mealHasInvalidItems = true;
             }
        } // End meal loop

        if (mealHasInvalidItems) {
             throw new Error(`Plan generation failed for Day ${day}: One or more meals contain invalid items or calculate to zero/negative calories.`);
        }

        log(`Initial Day ${day} Totals (Float): Kcal=${initialDayKcal.toFixed(1)}, P=${initialDayP.toFixed(1)}g, F=${initialDayF.toFixed(1)}g, C=${initialDayC.toFixed(1)}g`, 'INFO', 'CALC');

        // --- Run Reconciliation if Needed ---
        const targetCalories = nutritionalTargets.calories;
        const initialDeviation = (targetCalories > 0) ? (initialDayKcal - targetCalories) / targetCalories : 0;
        const RECONCILE_FLAG = process.env.CHEFFY_RECONCILE_NONPROTEIN === '1';
        let reconciledMeals = finalDayMeals; // Use the meals that already have recipes
        let finalDayTotals = { calories: initialDayKcal, protein: initialDayP, fat: initialDayF, carbs: initialDayC };

        if (RECONCILE_FLAG && Math.abs(initialDeviation) > 0.05) { // 5% tolerance
            log(`[RECON Day ${day}] Deviation ${(initialDeviation * 100).toFixed(1)}% > 5%. Attempting reconciliation.`, 'WARN', 'CALC');

            const { adjusted, factor, meals: scaledMeals } = reconcileNonProtein({
                meals: finalDayMeals, // Pass the meals *with* recipe data
                targetKcal: targetCalories,
                getItemMacros: computeItemMacros,
                tolPct: 5
            });

            if (adjusted) {
                reconciledMeals = scaledMeals; // Use the scaled meals
                scaleFactor = factor;

                let scaledKcal = 0, scaledP = 0, scaledF = 0, scaledC = 0;
                 for (const meal of reconciledMeals) {
                     let mealKcal = 0, mealP = 0, mealF = 0, mealC = 0;
                      if (!meal || !Array.isArray(meal.items)) continue;
                     for (const item of meal.items) {
                          try {
                             const macros = computeItemMacros(item);
                             mealKcal += macros.kcal; mealP += macros.p; mealF += macros.f; mealC += macros.c;
                          } catch (reconItemError) {
                              log(`Error recalculating macros post-reconciliation for "${item.key}" (Day ${day}): ${reconItemError.message}`, 'CRITICAL', 'CALC');
                              scaledKcal=NaN; break;
                          }
                     }
                     meal.subtotal_kcal = mealKcal; meal.subtotal_protein = mealP; meal.subtotal_fat = mealF; meal.subtotal_carbs = mealC;
                     if(isNaN(scaledKcal)) break;
                     scaledKcal += mealKcal; scaledP += mealP; scaledF += mealF; scaledC += mealC;
                 }


                finalDayTotals = { calories: scaledKcal, protein: scaledP, fat: scaledF, carbs: scaledC };

                log(`[RECON Day ${day}] Reconciliation complete. Factor: ${factor.toFixed(3)}`, 'INFO', 'CALC', {
                    pre: { kcal: initialDayKcal.toFixed(1) },
                    post: { kcal: finalDayTotals.calories.toFixed(1) }
                });
            } else {
                 log(`[RECON Day ${day}] Reconciliation ran but no adjustment needed.`, 'INFO', 'CALC');
            }
        } else {
             log(`Reconciliation skipped for Day ${day}. Flag: ${RECONCILE_FLAG}, Deviation: ${(initialDeviation * 100).toFixed(1)}%`, 'INFO', 'CALC');
        }

        // --- Final Validation (for this day) ---
        const finalDeviation = (targetCalories > 0) ? (finalDayTotals.calories - targetCalories) / targetCalories : 0;
        const finalDeviationPct = finalDeviation * 100;
        const FINAL_TOLERANCE = 0.10; // Increased tolerance to 10%

        log(`Final Validation (Day ${day}): Target=${targetCalories}, Final=${finalDayTotals.calories.toFixed(1)}, Deviation=${finalDeviationPct.toFixed(1)}% (Tolerance: ${FINAL_TOLERANCE*100}%)`, 'INFO', 'CALC');

        if (isNaN(finalDayTotals.calories) || Math.abs(finalDeviation) > FINAL_TOLERANCE) {
            log(`CRITICAL: Final validation failed for Day ${day}. Kcal: ${finalDayTotals.calories.toFixed(0)}, Target: ${targetCalories}`, 'CRITICAL', 'CALC');
            throw new Error(`Plan generation failed for Day ${day}: Calculated calories (${finalDayTotals.calories.toFixed(0)}) deviate too much from target (${targetCalories}). [Code: E_MACRO_MISMATCH]`);
        }

        // --- Round final values for the day ---
        reconciledMeals.forEach(meal => {
            if (meal) {
                meal.subtotal_kcal = Math.round(meal.subtotal_kcal || 0);
                meal.subtotal_protein = Math.round(meal.subtotal_protein || 0);
                meal.subtotal_fat = Math.round(meal.subtotal_fat || 0);
                meal.subtotal_carbs = Math.round(meal.subtotal_carbs || 0);
                 if(Array.isArray(meal.items)){
                     meal.items.forEach(item => { if(item) delete item.normalizedKey; });
                 }
            }
        });


        // --- Phase 5: Assemble Day Response ---
        log("Phase 5: Assembling Response (Day " + day + ")...", 'INFO', 'PHASE');

         log("Day Telemetry:", 'INFO', 'SYSTEM', {
            canonical_hits: canonicalHitsToday,
            density_heuristics: densityHeuristicsToday,
            scaleFactor: scaleFactor ? parseFloat(scaleFactor.toFixed(3)) : null,
            final_deviation_pct: parseFloat(finalDeviationPct.toFixed(1)),
        });

        const responseData = {
            message: `Successfully generated plan for Day ${day}.`,
            day: day,
            mealPlanForDay: {
                day: day,
                meals: reconciledMeals // Send the final meals *with* descriptions and instructions
            },
            // --- [MODIFIED] Convert Map back to Object for JSON response ---
            dayResults: Object.fromEntries(dayResultsMap.entries()),
            // --- End Modification ---
            dayUniqueIngredients: dayIngredientsPlan.map(({ normalizedKey, ...rest }) => rest),
            logs: getLogs()
        };

        log(`Successfully completed generation for Day ${day}.`, 'SUCCESS', 'SYSTEM');
        return response.status(200).json(responseData);

    } catch (error) {
        log(`CRITICAL Orchestrator ERROR (Day ${day}): ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error(`DAY ${day} UNHANDLED ERROR:`, error);

        const isPlanError = error.message.startsWith('Plan generation failed');
        const statusCode = isPlanError ? 422 : 500;
        const errorCode = isPlanError ? "PLAN_INVALID_DAY" : "SERVER_FAULT_DAY";

        return response.status(statusCode).json({
            message: error.message || "An internal server error occurred.",
            day: day,
            code: errorCode,
            error: error.message,
            logs: getLogs()
        });
    }
};

/// ===== MAIN-HANDLER-END ===== ////

