// --- ORCHESTRATOR API for Cheffy V11 ---
//
// V11 Architecture (Mark 55+):
// 1. ELIMINATED all free-text parsing. Nutrition is 100% deterministic.
// 2. FORCES structured `meal.items[{key, qty, unit}]` from LLM schema (via prompt, best-effort).
// 3. NORMALIZES units (g, kg, ml, l, egg, slice) to g/ml via `normalizeToGramsOrMl`.
// 4. USES density map for ml->g conversion.
// 5. NORMALIZES keys (lowercase, trim) to prevent string mismatch.
// 6. GUARDS:
//    - Qty Sanity: Fails if any item qty <= 0 or > 3000.
//    - Meal Guard: Fails (422) if any meal.items is empty or subtotal_kcal <= 0.
//    - Validator Guard: Fails if scaling would drop a meal < 100 kcal.
// 7. VALIDATOR:
//    - Scales (0.9-1.1) if deviation is 5-10%.
//    - Fails (422) if deviation > 10%.
// 8. TELEMETRY: Logs run_id, v11 schema, scaling, and heuristic counters.
// 9. ERRORS: Returns 422 { code: "PLAN_INVALID" } for all plan failures.

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
const crypto = require('crypto'); // For run_id
// Now importing the CACHE-WRAPPED versions with SWR and Token Buckets
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// --- FIX: Using v1beta endpoint and correct model name ---
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // MODIFIED: Increased from 2
const MAX_NUTRITION_CONCURRENCY = 5;
const MAX_MARKET_RUN_CONCURRENCY = 5;
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery', 'filter', 'paper', 'tip', 'shampoo', 'conditioner', 'soap', 'lotion', 'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum'];
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60;
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0;
const PRICE_OUTLIER_Z_SCORE = 2.0;
const PANTRY_CATEGORIES = ["pantry", "grains", "canned", "spreads", "condiments", "drinks"];

// --- V11 Unit Normalization Maps ---
const CANONICAL_UNIT_WEIGHTS_G = {
    'egg': 50,
    'slice': 35, // Avg bread slice
    'piece': 150, // Default for "piece" of fruit/veg
    'banana': 120,
    'potato': 200
};
const DENSITY_MAP = {
    'milk': 1.03, 'cream': 1.01, 'oil': 0.92, 'sauce': 1.05, 'water': 1.0,
    'juice': 1.04, 'yogurt': 1.05, 'wine': 0.98, 'beer': 1.01
};

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeKey = (s = '') => s.toString().toLowerCase().trim().replace(/\s+/g, ' ');

function getSanitizedFormData(formData) {
    try {
        const { name, height, weight, age, bodyFat, ...rest } = formData;
        return {
            ...rest,
            user_profile: "[REDACTED]"
        };
    } catch (e) {
        return { error: "Failed to sanitize form data." };
    }
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
                console.error(`Error processing item "${item?.originalIngredient || 'unknown'}" in concurrentlyMap:`, error);
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                // Return a structured error object
                return {
                    _error: true, // Flag to identify errors
                    message: error.message || 'Unknown error during async mapping',
                    itemKey: item?.originalIngredient || 'unknown'
                };
            });

        executing.push(promise);
        results.push(promise);

        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    // Filter out potential nulls/undefined before returning
    return Promise.all(results).then(res => res.filter(r => r != null));
}


// --- START: MODIFIED fetchWithRetry ---
async function fetchWithRetry(url, options, log) {
    // Add a generous timeout for the large Gemini payload
    const REQUEST_TIMEOUT_MS = 90000; // MODIFIED: Decreased from 120000

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        
        // --- START FIX: Add AbortController for timeout ---
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, REQUEST_TIMEOUT_MS);
        // --- END FIX ---

        try {
            log(`Attempt ${attempt}: Fetching from ${url} (Timeout: ${REQUEST_TIMEOUT_MS}ms)`, 'DEBUG', 'HTTP');
            
            const response = await fetch(url, { 
                ...options,
                signal: controller.signal // Pass the abort signal
            });
            
            clearTimeout(timeout); // Clear the timeout if fetch completes

            if (response.ok) return response;
            
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status} from API. Retrying...`, 'WARN', 'HTTP');
            } else {
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from API.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
             clearTimeout(timeout); // Always clear timeout on error
             
             // --- START FIX: Handle AbortError specifically ---
             if (error.name === 'AbortError') {
                 log(`Attempt ${attempt}: Fetch timed out after ${REQUEST_TIMEOUT_MS}ms. Retrying...`, 'WARN', 'HTTP');
             } else if (!error.message?.startsWith('API call failed with client error')) {
                 // --- END FIX ---
                log(`Attempt ${attempt}: Fetch failed for API with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
                console.error(`Fetch Error Details (Attempt ${attempt}):`, error);
            } else {
                 throw error; // Rethrow client errors immediately
            }
        }
        
        if (attempt < MAX_RETRIES) {
            const delayTime = Math.pow(2, attempt - 1) * 2000;
            await delay(delayTime);
        }
    }
    log(`API call failed definitively after ${MAX_RETRIES} attempts.`, 'CRITICAL', 'HTTP');
    throw new Error(`API call to ${url} failed after ${MAX_RETRIES} attempts.`);
}
// --- END: MODIFIED fetchWithRetry ---


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
    return price; // Return original price if unit price calc fails
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
    if (!w) return true; // Skip empty required words
    const base = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
    const rx = new RegExp(`\\b${base}`, 'i'); // Word boundary at the start
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
    if (products.length < 3) return products; // Need at least 3 points for meaningful stdev
    const prices = products.map(p => p.product.unit_price_per_100).filter(p => p > 0);
    if (prices.length < 3) return products;
    const m = mean(prices);
    const s = stdev(prices);
    if (s === 0) return products; // Avoid division by zero if all prices are identical

    return products.filter(p => {
        const price = p.product.unit_price_per_100;
        if (price <= 0) return true; // Keep items with no price for now
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
  // Check if any allowed category is a substring of the product category
  return allowed.some(a => pc.includes(a.toLowerCase()));
}

// Checks if product size is within reasonable bounds (0.5x to 2x/3x) of target
function sizeOk(productSizeParsed, targetSize, allowedCategories = [], log, ingredientKey, checkLogPrefix) {
    // If no target size or product size, it passes (cannot check)
    if (!productSizeParsed || !targetSize || !targetSize.value || !targetSize.unit) return true;

    // If units don't match (e.g., g vs ml), fail immediately
    if (productSizeParsed.unit !== targetSize.unit) {
        log(`${checkLogPrefix}: WARN (Size Unit Mismatch ${productSizeParsed.unit} vs ${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
        return false;
    }

    const prodValue = productSizeParsed.value;
    const targetValue = targetSize.value;

    // Allow larger range for pantry items (3x) vs perishables (2x)
    const isPantry = PANTRY_CATEGORIES.some(c => allowedCategories?.some(ac => ac.toLowerCase() === c));
    const maxMultiplier = isPantry ? 3.0 : 2.0;
    const minMultiplier = 0.5;

    const lowerBound = targetValue * minMultiplier;
    const upperBound = targetValue * maxMultiplier;

    if (prodValue >= lowerBound && prodValue <= upperBound) {
        return true; // Size is within the acceptable range
    } else {
        log(`${checkLogPrefix}: FAIL (Size ${prodValue}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit} for ${isPantry ? 'pantry' : 'perishable'})`, 'DEBUG', 'CHECKLIST');
        return false; // Size is too small or too large
    }
}


// Runs a checklist against a product based on ingredient rules
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) return { pass: false, score: 0 }; // Cannot check without name

     if (!ingredientData || typeof ingredientData !== 'object') {
        log(`Checklist: Skipping product "${product.product_name}" due to invalid ingredientData.`, 'ERROR', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    const { originalIngredient, requiredWords = [], negativeKeywords = [], targetSize, allowedCategories = [] } = ingredientData;
     if (!originalIngredient) {
         log(`Checklist: Skipping product "${product.product_name}" due to missing originalIngredient in ingredientData.`, 'ERROR', 'CHECKLIST');
         return { pass: false, score: 0 };
     }


    const checkLogPrefix = `Checklist [${originalIngredient}] for "${product.product_name}"`;
    let score = 1.0; // Start with perfect score, deduct later if needed

    // 1. Global Banned Keywords (non-food items)
    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // 2. Ingredient-Specific Negative Keywords
    if ((negativeKeywords ?? []).length > 0) {
        const negativeWordFound = negativeKeywords.find(kw => kw && productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }

    // 3. Required Words (Must contain ALL specified words)
    if (!passRequiredWords(productNameLower, requiredWords ?? [])) {
        log(`${checkLogPrefix}: FAIL (Required words missing: [${(requiredWords ?? []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // 4. Allowed Categories
    if (!passCategory(product, allowedCategories)) {
         log(`${checkLogPrefix}: FAIL (Category Mismatch: Product category "${product.product_category}" not in allowlist [${(allowedCategories || []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
         return { pass: false, score: 0 };
    }

    // 5. Size Check (skip for loose fruit/veg)
    const isProduceOrFruit = (allowedCategories || []).some(c => c === 'fruit' || c === 'produce' || c === 'veg');
    const productSizeParsed = parseSize(product.product_size);
    
    if (!isProduceOrFruit) {
        if (!sizeOk(productSizeParsed, targetSize, allowedCategories, log, originalIngredient, checkLogPrefix)) {
            // Failed size check is non-recoverable
            return { pass: false, score: 0 };
        }
    } else {
         log(`${checkLogPrefix}: INFO (Bypassing size check for 'fruit'/'produce' category)`, 'DEBUG', 'CHECKLIST');
    }

    // If all checks passed
    log(`${checkLogPrefix}: PASS`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: score };
}


// Determines if cuisine prompt requires creative generation vs simple keyword
function isCreativePrompt(cuisinePrompt) {
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false;
    // List of simple, direct keywords that don't need creative AI
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'british', 'german', 'russian', 'brazilian', 'caribbean', 'african', 'middle eastern', 'spicy', 'mild', 'sweet', 'sour', 'savoury', 'quick', 'easy', 'simple', 'fast', 'budget', 'cheap', 'healthy', 'low carb', 'keto', 'low fat', 'high protein', 'high fiber', 'vegetarian', 'vegan', 'gluten free', 'dairy free', 'pescatarian', 'paleo'];
    const promptLower = cuisinePrompt.toLowerCase().trim();
    if (simpleKeywords.some(kw => promptLower === kw)) return false; // Is a simple keyword
    if (promptLower.startsWith("high ") || promptLower.startsWith("low ")) return false; // Simple modifier
    // Creative if long, descriptive, or uses comparative language
    return cuisinePrompt.length > 30 || cuisinePrompt.includes(' like ') || cuisinePrompt.includes(' inspired by ') || cuisinePrompt.includes(' themed ');
}


// --- V11 HELPER: Normalizes 'g', 'kg', 'ml', 'l', 'egg', 'slice', 'piece' etc. to grams or ml ---
function normalizeToGramsOrMl(item, log) {
    let { qty, unit, key } = item;
    unit = unit.toLowerCase().trim().replace(/s$/, ''); // trim, lower, de-plural
    key = key.toLowerCase(); // Use lowercase key for matching
    
    // Direct passthrough or simple conversion
    if (unit === 'g' || unit === 'ml') return { value: qty, unit: unit };
    if (unit === 'kg') return { value: qty * 1000, unit: 'g' };
    if (unit === 'l') return { value: qty * 1000, unit: 'ml' };
    
    // --- Tweak 1: Unit conversion (e.g., 'egg' -> 'g') using map as fallback ---
    // Note: Prefer SKU serving info if available later in nutrition join phase.
    let weightPerUnit = CANONICAL_UNIT_WEIGHTS_G[unit];
    let usedHeuristic = true; // Assume heuristic unless specific unit found
    
    if (!weightPerUnit) {
        // Try to infer standard weight from key name if unit is generic like 'piece'
        if (key.includes('egg')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['egg'];
        else if (key.includes('bread') || key.includes('toast')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['slice'];
        else if (key.includes('banana')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['banana'];
        else if (key.includes('potato')) weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['potato'];
        else weightPerUnit = CANONICAL_UNIT_WEIGHTS_G['piece']; // Last resort default
    } else {
        usedHeuristic = false; // Found a direct match in the map
    }

    const grams = qty * weightPerUnit;
    log(`[Unit Conversion] Converting ${qty} ${unit} of '${key}' to ${grams}g using ${weightPerUnit}g/unit.`, 'DEBUG', 'CALC', {
        key: key, fromUnit: unit, qty: qty, toGrams: grams, heuristic: usedHeuristic // Tweak 5 log
    });
    return { value: grams, unit: 'g' };
}


/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const run_id = crypto.randomUUID(); // Tweak 4
    const logs = [];
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                run_id: run_id, // Tweak 4
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    // Basic check to avoid excessive depth or circular refs
                    (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 20) ? '[Object Too Large]' :
                    (Array.isArray(value) && value.length > 50) ? `[Array(${value.length})]` :
                    (typeof value === 'string' && value.length > 500) ? value.substring(0, 500) + '...' :
                    value
                )) : null
            };
            logs.push(logEntry);
            // Simple console logging for Vercel
             const time = new Date(logEntry.timestamp).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Brisbane' });
             console.log(`${time} [${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
             // Only log data object for non-DEBUG levels to reduce noise, or if it's an error/warning
             if (data && (level !== 'DEBUG' || ['ERROR', 'CRITICAL', 'WARN'].includes(level))) { // Show data for errors/warnings too
                 try {
                     // Limit logged data size for console
                     const truncatedData = JSON.stringify(data, (k, v) => typeof v === 'string' && v.length > 200 ? v.substring(0, 200) + '...' : v, 2);
                     console.log("  Data:", truncatedData.length > 1000 ? truncatedData.substring(0, 1000) + '...' : truncatedData);
                 } catch { console.log("  Data: [Serialization Error]"); }
             }

            return logEntry;
        } catch (error) {
            const fallbackEntry = {
                 timestamp: new Date().toISOString(),
                 run_id: run_id,
                 level: 'ERROR',
                 tag: 'LOGGING',
                 message: `Failed to serialize log data for message: ${message}`,
                 data: { serializationError: error.message }
            }
            logs.push(fallbackEntry);
            console.error(JSON.stringify(fallbackEntry));
            return fallbackEntry;
        }
    };

    const schema_version = "v11"; // Tweak 1/4
    log(`Orchestrator ${schema_version} invoked.`, 'INFO', 'SYSTEM', { schema_version });
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP');
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        response.setHeader('Allow', 'POST, OPTIONS');
        return response.status(405).json({ message: `Method ${request.method} Not Allowed.` });
    }

    let scaleFactor = null; // Tweak 4
    let telemetry = { // Tweak 4
        totalMeals: 0,
        invalidMeals: 0,
        canonicalHits: 0,
        densityHeuristics: 0,
    };

    try {
        if (!request.body) {
            log("Orchestrator fail: Received empty request body.", 'CRITICAL', 'SYSTEM');
            throw new Error("Request body is missing or invalid.");
        }
        const formData = request.body;
        const { store, cuisine, days, goal, weight } = formData;
        
        if (!store || !days || !goal || isNaN(parseFloat(formData.weight)) || isNaN(parseFloat(formData.height))) {
             log("CRITICAL: Missing core form data (store, days, goal, weight, or height). Cannot calculate plan.", 'CRITICAL', 'INPUT', getSanitizedFormData(formData));
             // Tweak 7: Use specific error for missing input
             throw new Error("Plan generation failed: Missing critical profile data (store, days, goal, weight, height).");
        }
        
        const numDays = parseInt(days, 10);
        if (isNaN(numDays) || numDays < 1 || numDays > 7) {
             log(`Invalid number of days: ${days}. Using default 1.`, 'WARN', 'INPUT');
             // Consider failing here instead? For now, proceed with default.
        }
        const weightKg = parseFloat(weight);

        // --- Phase 1: Creative Router ---
        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) {
            log(`Creative prompt: "${cuisine}". Calling AI...`, 'INFO', 'LLM');
            creativeIdeas = await generateCreativeIdeas(cuisine, log);
        } else {
            log("Simple prompt. Skipping Creative AI.", 'INFO', 'SYSTEM');
        }

        // --- Phase 2: Technical Blueprint ---
        log("Phase 2: Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData, log);
        log(`Daily target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        const macroTargets = calculateMacroTargets(calorieTarget, goal, weightKg, log);

        log(`Attempting to generate ${schema_version} plan from LLM.`, 'INFO', 'LLM_CALL');
        let llmResult;
        try {
             llmResult = await generateLLMPlanAndMeals(
                 formData,
                 calorieTarget,
                 macroTargets.proteinGrams,
                 macroTargets.fatGrams,
                 macroTargets.carbGrams,
                 creativeIdeas,
                 log
             );
        } catch (llmError) {
             log(`Error during generateLLMPlanAndMeals call: ${llmError.message}`, 'CRITICAL', 'LLM_CALL', { name: llmError.name });
             throw llmError; // Let the main handler catch and return 500
        }

        const { ingredients, mealPlan = [] } = llmResult || {};
        const rawIngredientPlan = Array.isArray(ingredients) ? ingredients : [];

        if (rawIngredientPlan.length === 0) {
            log("Blueprint fail: No ingredients returned by Technical AI (array was empty or invalid).", 'CRITICAL', 'LLM', { result: llmResult });
            throw new Error("Plan generation failed: AI did not return any ingredients."); // Tweak 7 format
        }

        // --- Tweak 2: Normalize Keys ONCE at ingestion ---
        const ingredientPlan = rawIngredientPlan
            .filter(ing => ing && ing.originalIngredient && ing.normalQuery && Array.isArray(ing.requiredWords) && Array.isArray(ing.negativeKeywords) && Array.isArray(ing.allowedCategories) && ing.allowedCategories.length > 0 && typeof ing.totalGramsRequired === 'number' && ing.totalGramsRequired >= 0)
            .map(ing => ({
                ...ing,
                normalizedKey: normalizeKey(ing.originalIngredient) // Store normalized key
            }));

        if (ingredientPlan.length !== rawIngredientPlan.length) {
            log(`Sanitized ingredient list: removed ${rawIngredientPlan.length - ingredientPlan.length} invalid entries.`, 'WARN', 'DATA');
        }
        if (ingredientPlan.length === 0) {
            log("Blueprint fail: All ingredients failed sanitization.", 'CRITICAL', 'LLM');
            throw new Error("Plan generation failed: AI returned invalid ingredient data after sanitization."); // Tweak 7 format
        }

        log(`Blueprint success: ${ingredientPlan.length} valid ingredients.`, 'SUCCESS', 'PHASE');


        // --- Phase 3: Market Run (Parallel & Optimized) ---
        log("Phase 3: Parallel Market Run...", 'INFO', 'PHASE');

        // --- processSingleIngredientOptimized remains largely unchanged internally ---
        // It relies on the ingredient object passed in, which now includes normalizedKey implicitly via ingredientPlan map.
        const processSingleIngredientOptimized = async (ingredient) => {
            // ... (Internal logic remains the same, using ingredient.originalIngredient for logging/keys) ...
            // ... (It returns { [ingredient.originalIngredient]: result } structure) ...
             try {
                if (!ingredient || typeof ingredient !== 'object' || !ingredient.originalIngredient) {
                    log(`Skipping invalid ingredient data in Market Run`, 'ERROR', 'MARKET_RUN', { ingredient });
                    return { _error: true, itemKey: 'unknown_invalid_ingredient', message: 'Invalid ingredient data provided' };
                }
                const ingredientKey = ingredient.originalIngredient;
                 if (!ingredient.normalQuery || !Array.isArray(ingredient.requiredWords) || !Array.isArray(ingredient.negativeKeywords) || !Array.isArray(ingredient.allowedCategories) || ingredient.allowedCategories.length === 0) {
                    log(`[${ingredientKey}] Skipping due to missing critical fields`, 'ERROR', 'MARKET_RUN', { ingredient });
                    return { [ingredientKey]: { ...ingredient, source: 'error', error: 'Missing critical query/validation fields from AI', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url } };
                 }

                const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
                let foundProduct = null;
                let bestScoreSoFar = -1;
                const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];

                let acceptedQueryIdx = -1;
                let acceptedQueryType = 'none';
                let pagesTouched = 0;
                let priceZ = null;
                let bucketWaitMs = 0;
                const mode = 'speed';
                let keptCount = 0;

                for (const [index, { type, query }] of queriesToTry.entries()) {
                    // ... (rest of the loop logic is unchanged) ...
                     if (!query || query.toLowerCase() === 'null') {
                         result.searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0});
                         log(`[${ingredientKey}] Skipping "${type}" query because it was null/empty.`, 'DEBUG', 'HTTP');
                         continue;
                    }

                    log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
                    pagesTouched = 1;

                    const { data: priceData, waitMs: currentWaitMs } = await fetchPriceData(store, query, 1, log);
                    bucketWaitMs = Math.max(bucketWaitMs, currentWaitMs);

                    result.searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0, rawCount: 0, bestScore: 0});
                    const currentAttemptLog = result.searchAttempts.at(-1);

                    if (priceData.error) {
                        log(`[${ingredientKey}] Fetch failed (${type}): ${priceData.error.message}`, 'WARN', 'HTTP', { status: priceData.error.status });
                        currentAttemptLog.status = 'fetch_error';
                        continue;
                    }

                    const rawProducts = priceData.results || [];
                    currentAttemptLog.rawCount = rawProducts.length;

                    const validProductsOnPage = [];
                    for (const rawProduct of rawProducts) {
                         if (!rawProduct || !rawProduct.product_name) {
                             log(`[${ingredientKey}] Skipping invalid raw product data`, 'WARN', 'DATA', { rawProduct });
                             continue;
                         }
                        const productWithCategory = { ...rawProduct, product_category: rawProduct.product_category };
                        const checklistResult = runSmarterChecklist(productWithCategory, ingredient, log);

                        if (checklistResult.pass) {
                             validProductsOnPage.push({ product: { name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size) }, score: checklistResult.score });
                        }
                    }

                    const filteredProducts = applyPriceOutlierGuard(validProductsOnPage, log, ingredientKey);

                    currentAttemptLog.foundCount = filteredProducts.length;
                    currentAttemptLog.bestScore = filteredProducts.length > 0 ? filteredProducts.reduce((max, p) => Math.max(max, p.score), 0) : 0;

                    if (filteredProducts.length > 0) {
                        log(`[${ingredientKey}] Found ${filteredProducts.length} valid (${type}).`, 'INFO', 'DATA');
                        const currentUrls = new Set(result.allProducts.map(p => p.url));
                        filteredProducts.forEach(vp => { if (!currentUrls.has(vp.product.url)) { result.allProducts.push(vp.product); currentUrls.add(vp.product.url); } });

                        if (result.allProducts.length > 0) {
                            foundProduct = result.allProducts.reduce((best, current) =>
                                (current.unit_price_per_100 ?? Infinity) < (best.unit_price_per_100 ?? Infinity) ? current : best,
                             result.allProducts[0]);
                            result.currentSelectionURL = foundProduct.url;
                        } else {
                             log(`[${ingredientKey}] No products available after filtering/price guard (${type}).`, 'WARN', 'DATA');
                             currentAttemptLog.status = 'no_match_post_filter';
                             continue;
                        }

                        result.source = 'discovery';
                        currentAttemptLog.status = 'success';
                        bestScoreSoFar = Math.max(bestScoreSoFar, currentAttemptLog.bestScore);

                        acceptedQueryIdx = index;
                        acceptedQueryType = type;
                        keptCount = result.allProducts.length;


                        priceZ = null;
                        if (result.allProducts.length >= 3 && foundProduct.unit_price_per_100 != null && foundProduct.unit_price_per_100 > 0) {
                            const prices = result.allProducts.map(p => p.unit_price_per_100).filter(p => p != null && p > 0);
                             if (prices.length >= 2) {
                                const m = mean(prices);
                                const s = stdev(prices);
                                priceZ = (s > 0) ? ((foundProduct.unit_price_per_100 - m) / s) : 0;
                            }
                        }

                        if (typeof acceptedQueryIdx === 'number' && acceptedQueryIdx >= 0) {
                            log(`[${ingredientKey}] Success Telemetry`, 'INFO', 'LADDER_TELEMETRY', {
                                 ingredientKey,
                                 acceptedQueryIdx,
                                 acceptedQueryType,
                                 pagesTouched,
                                 keptCount,
                                 price_z: priceZ !== null ? parseFloat(priceZ.toFixed(2)) : null,
                                 mode,
                                 bucketWaitMs
                             });
                        } else {
                             log(`[${ingredientKey}] CRITICAL Error: Telemetry skipped due to invalid acceptedQueryIdx: ${acceptedQueryIdx}`, 'CRITICAL', 'MARKET_RUN_ERROR', {
                                ingredientKey, index, type, success: true
                             });
                        }


                        if (type === 'tight' && bestScoreSoFar >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                            log(`[${ingredientKey}] Skip heuristic hit (Tight query successful with score >= ${SKIP_HEURISTIC_SCORE_THRESHOLD}).`, 'INFO', 'MARKET_RUN');
                            break;
                        }
                        break; // Mode is 'speed'

                    } else {
                        log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA');
                        currentAttemptLog.status = 'no_match';
                    }
                } // End query loop


                if (result.source === 'failed') { log(`[${ingredientKey}] Definitive fail after trying all queries.`, 'WARN', 'MARKET_RUN'); }
                return { [ingredientKey]: result };

            } catch(e) {
                log(`CRITICAL Error processing single ingredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                 // Return error structure consistent with concurrentlyMap's catch block
                 return { _error: true, itemKey: ingredient?.originalIngredient || 'unknown_error', message: e.message };
            }
        };

        log(`Market Run: ${ingredientPlan.length} ingredients, K=${MAX_MARKET_RUN_CONCURRENCY}...`, 'INFO', 'MARKET_RUN');
        const startMarketTime = Date.now();
        const parallelResultsArray = await concurrentlyMap(ingredientPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        const endMarketTime = Date.now();
        log(`Market Run parallel took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

        // --- Tweak 2: Consolidate results into a Map using normalized keys ---
        const normalizedFinalResults = new Map();
        parallelResultsArray.forEach(currentResult => {
             // Handle errors reported by concurrentlyMap's catch block or processSingleIngredientOptimized's catch
             if (currentResult._error) {
                 log(`Market Run Error for "${currentResult.itemKey}": ${currentResult.message}`, 'CRITICAL', 'MARKET_RUN');
                 const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === currentResult.itemKey);
                 const baseData = typeof failedIngredientData === 'object' && failedIngredientData !== null ? failedIngredientData : { originalIngredient: currentResult.itemKey, normalizedKey: normalizeKey(currentResult.itemKey) };
                 normalizedFinalResults.set(baseData.normalizedKey, { ...baseData, source: 'error', error: `Market run processing failed: ${currentResult.message}`, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
                 return;
             }
             
             // Process successful results (which are objects like { "Original Key": {...} })
             const ingredientKey = Object.keys(currentResult)[0];
             if (!ingredientKey || ingredientKey.startsWith('unknown_')) {
                 log(`Received result with invalid key from concurrentlyMap`, 'ERROR', 'SYSTEM', { currentResult });
                 return;
             }
             const resultData = currentResult[ingredientKey];
             const normalizedKey = normalizeKey(ingredientKey); // Normalize here for lookup

             // Find the original plan item to ensure normalizedKey is consistent
             const planItem = ingredientPlan.find(i => i.normalizedKey === normalizedKey);
             if (!planItem) {
                  log(`CRITICAL: Market run result key "${ingredientKey}" (normalized: "${normalizedKey}") not found in initial plan.`, 'ERROR', 'SYSTEM');
                  return; // Skip if key doesn't match anything
             }

             if(resultData?.source === 'error') {
                 log(`Processing Error logged for "${ingredientKey}": ${resultData.error}`, 'WARN', 'MARKET_RUN'); // Downgraded to WARN as it's handled
                 normalizedFinalResults.set(normalizedKey, { ...planItem, source: 'error', error: resultData.error, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
             } else if (typeof resultData === 'object' && resultData !== null) {
                // Merge plan item defaults with market run results
                normalizedFinalResults.set(normalizedKey, { ...planItem, ...resultData });
             } else {
                  log(`Received invalid result structure for key "${ingredientKey}"`, 'ERROR', 'SYSTEM', { result: resultData });
                  // Store error state using planItem as base
                  normalizedFinalResults.set(normalizedKey, { ...planItem, source: 'error', error: 'Invalid result structure from market run', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url });
             }
        });

        log("Market Run complete.", 'SUCCESS', 'PHASE');


        // --- Phase 4: Nutrition Fetch ---
        log("Phase 4: Nutrition Data Fetch...", 'INFO', 'PHASE');
        const itemsToFetchNutrition = [];
        const nutritionDataMap = new Map(); // Use Map with normalized keys

        for (const [normalizedKey, result] of normalizedFinalResults.entries()) {
            // ... (Logic to build itemsToFetchNutrition is unchanged, uses result.originalIngredient for logs) ...
             if (!result || typeof result !== 'object') {
                 log(`Skipping invalid result object for key "${normalizedKey}"`, 'WARN', 'CALC');
                 continue;
             }
            if (result.source === 'discovery' && result.currentSelectionURL && Array.isArray(result.allProducts)) {
                const selected = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                if (selected) {
                    itemsToFetchNutrition.push({
                        ingredientKey: result.originalIngredient, // Keep original for logging
                        normalizedKey: normalizedKey, // Use normalized for map keys
                        barcode: selected.barcode,
                        query: selected.name
                    });
                } else {
                     log(`[${result.originalIngredient}] Discovery source but no selected product found. No nutrition to fetch.`, 'WARN', 'CALC');
                }
            } else {
                 log(`[${result.originalIngredient}] Market Run failed/error. No nutrition to fetch.`, 'DEBUG', 'CALC', { source: result.source, error: result.error }); // Downgraded log level
            }
        }

        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition for ${itemsToFetchNutrition.length} selected products...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, async (item) => {
                 // Wrap fetchNutritionData call in try/catch within the mapper
                 try {
                     const nut = (item.barcode || item.query)
                         ? await fetchNutritionData(item.barcode, item.query, log)
                         : { status: 'not_found', source: 'no_query' };
                     return { ...item, nut };
                 } catch (err) {
                     log(`Unhandled Nutri fetch error ${item.ingredientKey}: ${err.message}`, 'CRITICAL', 'HTTP');
                     // Return consistent error structure
                     return { ...item, nut: { status: 'not_found', source: 'error', error: 'Unhandled fetch error' } };
                 }
             });
            log("Nutrition fetch complete.", 'SUCCESS', 'HTTP');

            nutritionResults.forEach(item => {
                 if (!item || !item.normalizedKey || !item.nut) {
                    log('Skipping invalid item in nutritionResults loop.', 'ERROR', 'CALC', { item });
                    return;
                 }
                const nut = item.nut;
                const result = normalizedFinalResults.get(item.normalizedKey);

                nutritionDataMap.set(item.normalizedKey, nut); // Use normalizedKey

                 if (result) {
                     // Attach nutrition data to the selected product within the final results
                     if (result.source === 'discovery' && Array.isArray(result.allProducts)) {
                         let productToAttach = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                         if (productToAttach) productToAttach.nutrition = nut;
                         // Add to cheapest as well if different? For now, just selected.
                     }
                     // Store top-level nutrition ref in result regardless? Might be redundant.
                     // result.nutrition = nut; // Optional: if needed elsewhere
                 }
            });

        } else {
            log("No valid items found for nutrition fetching.", 'WARN', 'CALC');
        }


        // --- NEW Phase 5: Orchestrator Math Engine (V11) ---
        log("Phase 5: Orchestrator Math Engine...", 'INFO', 'PHASE');
        
        let weeklyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        const dailyTotalsList = [];

        if (!Array.isArray(mealPlan) || mealPlan.length === 0) {
            log("No meal plan provided by LLM, skipping Phase 5 math.", 'WARN', 'CALC');
        } else {
            for (const dayPlan of mealPlan) {
                if (!dayPlan || !Array.isArray(dayPlan.meals) || dayPlan.meals.length === 0) {
                     log(`Skipping invalid day or empty meals array for day ${dayPlan?.day || 'unknown'}`, 'WARN', 'CALC');
                     continue;
                }
                
                let currentDayTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 }; // Use floats

                for (const meal of dayPlan.meals) {
                     telemetry.totalMeals++;
                     if (!meal || typeof meal.description !== 'string' || !Array.isArray(meal.items) || meal.items.length === 0) {
                         log(`[${meal.name || 'Unknown Meal'}] CRITICAL: Meal is missing structured 'items' array.`, 'CRITICAL', 'CALC', { meal });
                         meal.subtotal_kcal = 0; // Mark as invalid for guard check
                         // Error will be thrown by the per-day guard
                         continue;
                     }

                    let mealSubtotals = { kcal: 0, protein: 0, fat: 0, carbs: 0 }; // Use floats
                    
                    // --- Tweak 3: Merge duplicate items ---
                    const mergedItems = new Map();
                    for (const item of meal.items) {
                        const itemKeyNormalized = normalizeKey(item.key); // Normalize once
                        const existing = mergedItems.get(itemKeyNormalized);
                        if (existing) {
                            // Basic sum - assumes units are compatible or normalization handles it
                            existing.qty += item.qty;
                            log(`[${meal.name}] Merging duplicate item: '${item.key}'`, 'DEBUG', 'CALC');
                        } else {
                            // Store with the normalized key attached for easy access later
                            mergedItems.set(itemKeyNormalized, { ...item, normalizedKey: itemKeyNormalized });
                        }
                    }

                    for (const item of mergedItems.values()) {
                        const { key, qty, unit, normalizedKey } = item;
                        
                        // --- Tweak 1: Normalize units ---
                        const { value: gramsOrMl, unit: normalizedUnit } = normalizeToGramsOrMl(item, log);

                        // --- Tweak 3: Quantity Sanity Guard ---
                        if (!Number.isFinite(gramsOrMl) || gramsOrMl <= 0 || gramsOrMl > 3000) { // Limit 3000
                             log(`[${meal.name}] CRITICAL: Invalid quantity for item '${key}'.`, 'CRITICAL', 'CALC', { item, gramsOrMl });
                             // Tweak 7: Use specific error format
                            throw new Error(`Plan generation failed: Invalid quantity (${qty} ${unit} -> ${gramsOrMl}${normalizedUnit}) for item: "${key}" in meal: "${meal.name}"`);
                        }

                        const nutritionData = nutritionDataMap.get(normalizedKey);
                        const finalResultData = normalizedFinalResults.get(normalizedKey);
                        
                        let grams = gramsOrMl; // Assume g unless converted by density
                        let nutritionSource = 'none';
                        
                        if (nutritionData && nutritionData.status === 'found') {
                            nutritionSource = nutritionData.source; // Record the source
                            const nutritionServingUnit = 'g'; // Our nutrition API standardizes to per 100g
                            
                            // --- Tweak 1: Density Conversion ---
                            if (normalizedUnit === 'ml' && nutritionServingUnit === 'g') {
                                let density = 1.0;
                                let isHeuristic = true;
                                const keyLower = key.toLowerCase();
                                const foundDensityKey = Object.keys(DENSITY_MAP).find(k => keyLower.includes(k));
                                if (foundDensityKey) {
                                    density = DENSITY_MAP[foundDensityKey];
                                    isHeuristic = false;
                                } else {
                                     telemetry.densityHeuristics++; // Count heuristic uses
                                }
                                grams = gramsOrMl * density;
                                log(`[Density] Converting ${gramsOrMl}ml to ${grams}g (density ${density}) for '${key}'.`, 'DEBUG', 'CALC', {
                                    key: key, heuristic: isHeuristic // Tweak 5 log
                                });
                            }
                            
                            // Use 'grams' for calculation against per-100g data
                            const p = (nutritionData.protein / 100) * grams;
                            const f = (nutritionData.fat / 100) * grams;
                            const c = (nutritionData.carbs / 100) * grams;
                            const kcal = (p * 4) + (f * 9) + (c * 4);
                            
                            mealSubtotals.kcal += kcal;
                            mealSubtotals.protein += p;
                            mealSubtotals.fat += f;
                            mealSubtotals.carbs += c;
                        } else {
                            // --- Tweak 5: Canonical Fallback ---
                            // Check if market run actually failed for this specific item
                            const marketFailed = finalResultData && (finalResultData.source === 'failed' || finalResultData.source === 'error');
                            if (marketFailed && (!nutritionData || nutritionData.status !== 'found')) {
                                log(`[${meal.name}] Attempting CANONICAL fallback for [${key}] (${gramsOrMl}${normalizedUnit}). Market run failed/error.`, 'WARN', 'CALC', { key });
                                const canonicalNutrition = await fetchNutritionData(null, key, log); // Pass original key

                                if (canonicalNutrition && canonicalNutrition.status === 'found' && canonicalNutrition.source.startsWith('canonical')) {
                                    telemetry.canonicalHits++; // Tweak 4 telemetry
                                    nutritionSource = 'canonical'; // Record source
                                    meal.sources = meal.sources || [];
                                    if (!meal.sources.includes('canonical')) meal.sources.push('canonical'); // Tag meal
                                    
                                    // Use 'grams' (potentially density converted) for calculation
                                    const p = (canonicalNutrition.protein / 100) * grams;
                                    const f = (canonicalNutrition.fat / 100) * grams;
                                    const c = (canonicalNutrition.carbs / 100) * grams;
                                    const kcal = (p * 4) + (f * 9) + (c * 4);
                                    mealSubtotals.kcal += kcal;
                                    mealSubtotals.protein += p;
                                    mealSubtotals.fat += f;
                                    mealSubtotals.carbs += c;
                                    log(`[${meal.name}] Applied CANONICAL (${canonicalNutrition.source}) for [${key}]`, 'DEBUG', 'CALC', { kcal: kcal.toFixed(0), p: p.toFixed(1), f: f.toFixed(1), c: c.toFixed(1) });
                                } else {
                                    log(`[${meal.name}] No CANONICAL fallback found or applicable for failed ingredient [${key}]. Skipping.`, 'WARN', 'CALC');
                                }
                            } else {
                                log(`[${meal.name}] Skipping nutrition for [${key}] (${gramsOrMl}${normalizedUnit}). No valid/found nutrition data (Market source: ${finalResultData?.source}).`, 'WARN', 'CALC', { key, nutriStatus: nutritionData?.status });
                            }
                        }
                        // Log source used for this item's nutrition
                        // log(`[${meal.name}] Nutrition source for [${key}]: ${nutritionSource}`, 'DEBUG', 'CALC');

                    } // End ingredient loop for meal

                    // --- Tweak 4: NaN Guard ---
                    if (isNaN(mealSubtotals.kcal) || isNaN(mealSubtotals.protein) || isNaN(mealSubtotals.fat) || isNaN(mealSubtotals.carbs)) {
                        log(`[${meal.name}] CRITICAL: Meal subtotal is NaN.`, 'CRITICAL', 'CALC', { meal });
                        // Tweak 7: Use specific error format
                        throw new Error(`Plan generation failed: Calculation error (NaN) for meal: "${meal.name}"`);
                    }

                    // Store subtotals as floats
                    meal.subtotal_kcal = mealSubtotals.kcal;
                    meal.subtotal_protein = mealSubtotals.protein;
                    meal.subtotal_fat = mealSubtotals.fat;
                    meal.subtotal_carbs = mealSubtotals.carbs;

                    log(`[${meal.name}] Calculated Subtotals (Float):`, 'DEBUG', 'CALC', {
                        kcal: meal.subtotal_kcal.toFixed(2),
                        p: meal.subtotal_protein.toFixed(2),
                        f: meal.subtotal_fat.toFixed(2),
                        c: meal.subtotal_carbs.toFixed(2),
                        sources: meal.sources // Log canonical sources if present
                    });

                    // Add floats to day totals
                    currentDayTotals.calories += mealSubtotals.kcal;
                    currentDayTotals.protein += mealSubtotals.protein;
                    currentDayTotals.fat += mealSubtotals.fat;
                    currentDayTotals.carbs += mealSubtotals.carbs;

                } // End meal loop for day
                
                // --- Tweak 4/7/8: Per-Day Meal Guard & Log ---
                const invalidMealList = dayPlan.meals.filter(m => !m.items || m.items.length === 0 || !Number.isFinite(m.subtotal_kcal) || m.subtotal_kcal <= 0);
                const invalidCount = invalidMealList.length;
                const validCount = dayPlan.meals.length - invalidCount;
                telemetry.invalidMeals += invalidCount;

                log(`Day ${dayPlan.day} Meal Stats: ${validCount} OK, ${invalidCount} Invalid.`, 'INFO', 'CALC', { // Tweak 8
                    meals_ok: validCount, meals_invalid: invalidCount,
                    first_invalid: invalidCount > 0 ? invalidMealList[0].name : null
                });
                
                // Tweak 4: Throw immediately if invalid meals found
                if (invalidCount > 0) {
                    const firstInvalidName = invalidMealList[0].name || 'Unnamed Meal';
                    log(`CRITICAL: Day ${dayPlan.day} contains invalid meals. Failing plan generation. First invalid: "${firstInvalidName}"`, 'CRITICAL', 'CALC');
                    // Tweak 7: Use specific error format
                    throw new Error(`Plan generation failed: Meal(s) on Day ${dayPlan.day} are invalid (missing items or zero calories). First invalid meal: "${firstInvalidName}"`);
                }
                
                dailyTotalsList.push(currentDayTotals);
                log(`Calculated Totals for Day ${dayPlan.day} (Float):`, 'INFO', 'CALC', {
                     calories: currentDayTotals.calories.toFixed(2),
                     protein: currentDayTotals.protein.toFixed(2),
                     fat: currentDayTotals.fat.toFixed(2),
                     carbs: currentDayTotals.carbs.toFixed(2),
                });
            } // End day loop

            weeklyTotals = dailyTotalsList.reduce((acc, day) => {
                acc.calories += day.calories;
                acc.protein += day.protein;
                acc.fat += day.fat;
                acc.carbs += day.carbs;
                return acc;
            }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
        }

        const validNumDays = (dailyTotalsList.length > 0) ? dailyTotalsList.length : ( (numDays >= 1 && numDays <= 7) ? numDays : 1 );
        log(`Averaging totals over ${validNumDays} days.`, 'DEBUG', 'CALC');

        const finalDailyTotals = { // Still floats at this stage
             calories: weeklyTotals.calories / validNumDays,
             protein: weeklyTotals.protein / validNumDays,
             fat: weeklyTotals.fat / validNumDays,
             carbs: weeklyTotals.carbs / validNumDays,
        };
        
        // --- Tweak 4: NaN Guard ---
        if (isNaN(finalDailyTotals.calories) || isNaN(finalDailyTotals.protein) || isNaN(finalDailyTotals.fat) || isNaN(finalDailyTotals.carbs)) {
            log(`CRITICAL: Final daily totals are NaN.`, 'CRITICAL', 'CALC', { finalDailyTotals });
             // Tweak 7: Use specific error format
            throw new Error(`Plan generation failed: Final calculation resulted in NaN.`);
        }
        
        log("ACCURATE DAILY nutrition totals calculated (Float).", 'SUCCESS', 'CALC', finalDailyTotals);


        // --- Phase 5.5: Final Validator (Tweak 6) ---
        const targetCalories = calorieTarget;
        let calculatedCalories = finalDailyTotals.calories; // Float
        let deviation = (targetCalories > 0) ? (calculatedCalories - targetCalories) / targetCalories : 0;
        let deviation_pct = deviation * 100;
        scaleFactor = null; // Reset scaleFactor for this run

        const validatorLogData = { // Tweak 8
             target: targetCalories,
             final_unscaled: parseFloat(calculatedCalories.toFixed(1)),
             deviation_pct_unscaled: parseFloat(deviation_pct.toFixed(1)),
             scaleFactor: null
        };

        // 1. Scale if deviation is > 5% and <= 10%
        if (Math.abs(deviation) > 0.05 && Math.abs(deviation) <= 0.10) {
            scaleFactor = Math.max(0.9, Math.min(1.1, targetCalories / calculatedCalories)); // Bounded 0.9-1.1
            validatorLogData.scaleFactor = parseFloat(scaleFactor.toFixed(3)); // Log the factor
            
            // --- Tweak 6: Pre-scaling Guard ---
            const anyMealTooLow = mealPlan.some(day => 
                day.meals.some(meal => (meal.subtotal_kcal * scaleFactor) < 100) // Check if scaling drops below 100
            );
            if (anyMealTooLow) {
                log(`CRITICAL: Scaling aborted. Factor ${scaleFactor.toFixed(3)} would drop a meal below 100kcal. Failing.`, 'CRITICAL', 'CALC');
                 // Tweak 7: Use specific error format
                throw new Error(`Plan generation failed: Calculated calories (${calculatedCalories.toFixed(0)}) deviate from target (${targetCalories}), and scaling would create invalid meals.`);
            }
            // --- End Guard ---

            log(`Applying bounded scaling. Factor: ${scaleFactor.toFixed(3)}`, 'WARN', 'CALC');
            
            // Scale ALL totals (floats)
            finalDailyTotals.calories *= scaleFactor;
            finalDailyTotals.protein *= scaleFactor;
            finalDailyTotals.fat *= scaleFactor;
            finalDailyTotals.carbs *= scaleFactor;
            
            // Scale ALL meal subtotals (floats) - Tweak 6
            mealPlan.forEach(day => {
                day.meals.forEach(meal => {
                    meal.subtotal_kcal *= scaleFactor;
                    meal.subtotal_protein *= scaleFactor;
                    meal.subtotal_fat *= scaleFactor;
                    meal.subtotal_carbs *= scaleFactor;
                });
            });
            
            // Recalculate deviation for logging
            calculatedCalories = finalDailyTotals.calories;
            deviation = (targetCalories > 0) ? (calculatedCalories - targetCalories) / targetCalories : 0;
            deviation_pct = deviation * 100;

             validatorLogData.final_scaled = parseFloat(calculatedCalories.toFixed(1));
             validatorLogData.deviation_pct_scaled = parseFloat(deviation_pct.toFixed(1));

            log(`Post-Scaling: Calculated=${calculatedCalories.toFixed(0)}, Deviation=${deviation_pct.toFixed(1)}%`, 'INFO', 'CALC');
        }

        // Log validator results (Tweak 8)
        log("Final Validation Result", 'INFO', 'CALC', validatorLogData);

        // 2. Fail-fast if deviation is still > 10% (after potential scaling)
        if (Math.abs(deviation) > 0.10) { 
            log(`CRITICAL: Final calculation failed hard validation. Target: ${targetCalories} kcal, Final: ${calculatedCalories.toFixed(0)} kcal.`, 'CRITICAL', 'CALC', { deviation_pct });
             // Tweak 7: Use specific error format
            throw new Error(`Plan generation failed: Calculated daily calories (${calculatedCalories.toFixed(0)}) deviate too much from target (${targetCalories}).`);
        }
        // --- END VALIDATOR ---


        // --- Phase 6: Assembling Final Response ---
        log("Phase 6: Final Response...", 'INFO', 'PHASE');
        
        // --- Tweak 4: Round all values at the very end ---
        finalDailyTotals.calories = Math.round(finalDailyTotals.calories);
        finalDailyTotals.protein = Math.round(finalDailyTotals.protein);
        finalDailyTotals.fat = Math.round(finalDailyTotals.fat);
        finalDailyTotals.carbs = Math.round(finalDailyTotals.carbs);
        
        mealPlan.forEach(day => {
            day.meals.forEach(meal => {
                meal.subtotal_kcal = Math.round(meal.subtotal_kcal);
                meal.subtotal_protein = Math.round(meal.subtotal_protein);
                meal.subtotal_fat = Math.round(meal.subtotal_fat);
                meal.subtotal_carbs = Math.round(meal.subtotal_carbs);
            });
        });

        // --- Tweak 4/8: Final Telemetry Log ---
        log("Final Telemetry:", 'INFO', 'SYSTEM', { // Tweak 8
            meals_ok: telemetry.totalMeals - telemetry.invalidMeals,
            meals_invalid: telemetry.invalidMeals,
            pct_canonical_hits: telemetry.totalMeals > 0 ? parseFloat(((telemetry.canonicalHits / telemetry.totalMeals) * 100).toFixed(1)) : 0,
            pct_density_heuristics: telemetry.totalMeals > 0 ? parseFloat(((telemetry.densityHeuristics / telemetry.totalMeals) * 100).toFixed(1)) : 0,
            scaleFactor: scaleFactor ? parseFloat(scaleFactor.toFixed(3)) : null,
            schema_version: schema_version
        });

        const finalResponseData = {
             plan_schema: schema_version, // Tweak 1
             mealPlan: mealPlan || [],
             // Remove normalizedKey before sending to frontend
             uniqueIngredients: ingredientPlan.map(({ normalizedKey, ...rest }) => rest),
             // Convert Map back to object for JSON response
             results: Object.fromEntries(normalizedFinalResults.entries()),
             nutritionalTargets: finalDailyTotals
        };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL Orchestrator ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error("ORCHESTRATOR UNHANDLED ERROR:", error);
        
        // --- Tweak 7: Return 422 for plan errors, 500 for server errors ---
        if (error.message.startsWith('Plan generation failed:')) {
            const dayMatch = error.message.match(/Day (\d+)/);
            const mealMatch = error.message.match(/meal: "([^"]+)"/);
            
            return response.status(422).json({ // Use 422
                message: error.message,
                code: "PLAN_INVALID", // Machine-readable code
                day: dayMatch ? parseInt(dayMatch[1], 10) : null,
                firstInvalidMeal: mealMatch ? mealMatch[1] : null,
                logs // Include logs for debugging
            });
        }
        
        // Default to 500 for unexpected server errors
        return response.status(500).json({ 
            message: "An unrecoverable server error occurred during plan generation.", 
            error: error.message,
            code: "SERVER_FAULT",
            logs // Include logs
        });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


async function generateCreativeIdeas(cuisinePrompt, log) {
    // --- FIX: Use v1beta endpoint and correct model name ---
    const CREATIVE_GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent'; // FIX: Use v1beta endpoint and correct model
    const sysPrompt=`Creative chef... comma-separated list.`;
    const userQuery=`Theme: "${cuisinePrompt}"...`;
    log("Creative Prompt",'INFO','LLM_PROMPT',{userQuery});
    // --- Simple payload suitable for v1 (systemInstruction works here) ---
    const payload={contents:[{parts:[{text:userQuery}]}],systemInstruction:{parts:[{text:sysPrompt}]}};
    try{
        // Using fetchWithRetry configured for the MAIN plan call (2 min timeout, 2 retries)
        const res=await fetchWithRetry(
            CREATIVE_GEMINI_API_URL, // Using the corrected v1beta URL
            { method:'POST', headers:{ 'Content-Type':'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body:JSON.stringify(payload) },
            log
        );
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string' || text.length === 0) {
             log("Creative AI returned non-string or empty text.", 'WARN', 'LLM', { result });
             throw new Error("Creative AI empty or invalid text.");
         }
        log("Creative Raw",'INFO','LLM',{raw:text.substring(0,500)});
        return text;
    } catch(e){
        log(`Creative AI failed: ${e.message}`,'CRITICAL','LLM');
        return ""; // Return empty string on failure, don't block plan generation
    }
}


async function generateLLMPlanAndMeals(formData, calorieTarget, proteinTargetGrams, fatTargetGrams, carbTargetGrams, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = GEMINI_API_URL_BASE; // Uses the corrected v1beta URL
    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']}; const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2;
    const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.');
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion' not 'scallion', 'capsicum' not 'bell pepper')." : "";

    // --- V11 System Prompt (Integrated into user query for v1 API) ---
    // --- FIX: Escaped backticks and curly braces in JSON example ---
    const systemPrompt = `Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate meal plan ('mealPlan') & shopping list ('ingredients'). 2. QUERIES: For each ingredient: a. 'tightQuery': Hyper-specific, STORE-PREFIXED. b. 'normalQuery': 2-4 generic words, STORE-PREFIXED. CRITICAL: Use MOST COMMON GENERIC NAME. DO NOT include brands, sizes, fat content, specific forms (sliced/grated), or dryness unless ESSENTIAL.${australianTermNote} c. 'wideQuery': 1-2 broad words, STORE-PREFIXED. 3. 'requiredWords': Array[1] SINGLE ESSENTIAL CORE NOUN ONLY, lowercase singular. NO adjectives, forms, plurals, or multiple words (e.g., for 'baby spinach leaves', use ['spinach']; for 'roma tomatoes', use ['tomato']). This word MUST exist in product names. 4. 'negativeKeywords': Array[1-5] lowercase words for INCORRECT product. Be thorough. Include common mismatches by type. Examples: fresh produce → ["bread","cake","sauce","canned","powder","chips","dried","frozen"], herb/spice → ["spray","cleaner","mouthwash","deodorant"], meat cuts → ["cat","dog","pet","toy"]. 5. 'targetSize': Object {value: NUM, unit: "g"|"ml"}. Null if N/A. Prefer common package sizes. 6. 'totalGramsRequired': BEST ESTIMATE total g/ml for plan. MUST accurately reflect sum of meal portions. 7. Adhere to constraints. 8. 'ingredients' MANDATORY. 'mealPlan' MANDATORY. 9. 'OR' INGREDIENTS: Use broad 'requiredWords', add relevant 'negativeKeywords'. 10. NICHE ITEMS: Set 'tightQuery' null, broaden queries/words. 11. FORM/TYPE: 'normalQuery' = generic form. 'requiredWords' = singular noun ONLY. Specify form only in 'tightQuery'. 12. NO 'nutritionalTargets' or 'aiEst...' nutrition properties in output. 13. 'allowedCategories' (MANDATORY): Provide precise, lowercase categories for each ingredient using this exact set: ["produce","fruit","veg","dairy","bakery","meat","seafood","pantry","frozen","drinks","canned","grains","spreads","condiments","snacks"]. 14. MEAL PORTIONS: For each meal in 'mealPlan.meals': a) Specify clear portion sizes for key ingredients in 'description' (e.g., '...150g chicken breast, 80g dry rice...'). b) DO NOT include 'subtotal_...' fields. 15. BULKING MACRO PRIORITY: For 'bulk' goals, prioritize carbohydrate sources over fats when adjusting portions. 16. MEAL VARIETY: Critical. User maxRepetitions=${maxRepetitions}. DO NOT repeat exact meals more than this across the entire ${days}-day plan. Ensure variety, especially if maxRepetitions < ${days}. 17. COST vs. VARIETY: User costPriority='${costPriority}'. Balance with Rule 16. Prioritize variety if needed.
18. MEAL ITEMS & TARGET ADHERENCE (ULTRA-PRECISE): For each meal in 'mealPlan.meals', you MUST populate the 'items' array. Each object in 'items' must contain a 'key' that EXACTLY matches one of the 'originalIngredient' strings from the main 'ingredients' list, the 'qty' (e.g., 150), and the 'unit' (e.g., 'g', 'ml', 'slice', 'egg'). ABSOLUTELY CRITICAL: The sum of estimated calories from ALL 'items' across ALL meals for a day MUST be within 5% of the **${calorieTarget} kcal** daily target. You MUST meticulously adjust the 'qty' values for ingredients in the 'items' arrays (especially primary carb/fat/protein sources) to achieve this precise **${calorieTarget} kcal** goal for EACH day. Do not deviate significantly. The 'description' field is for human display only; all calculations depend ONLY on the 'items' array. Output ONLY the valid JSON object described below (with 'ingredients' and 'mealPlan' keys), wrapped in \`\`\`json ... \`\`\`, nothing else.

JSON Structure:
\\{
  "ingredients": [ \\{ "originalIngredient": "string", "category": "string", "tightQuery": "string|null", "normalQuery": "string", "wideQuery": "string|null", "requiredWords": ["string"], "negativeKeywords": ["string"], "targetSize": \\{ "value": number, "unit": "g"|"ml" \\}|null, "totalGramsRequired": number, "quantityUnits": "string", "allowedCategories": ["string"] \\} /* ... more ingredients */ ],
  "mealPlan": [ \\{ "day": number, "meals": [ \\{ "type": "string", "name": "string", "description": "string", "items": [ \\{ "key": "string", "qty": number, "unit": "string" \\} /* ... more items */ ] \\} /* ... more meals */ ] \\} /* ... more days */ ]
\\}
`;
    // --- End V11 Prompt & FIX ---

    let userQuery = `Gen ${days}-day plan for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Target: ~${calorieTarget} kcal. Macro Targets: Protein ~${proteinTargetGrams}g, Fat ~${fatTargetGrams}g, Carbs ~${carbTargetGrams}g. Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}. Cuisine: ${cuisineInstruction}.`;

    // --- DO NOT Combine system prompt and user query ---
    // const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userQuery}`; // OLD

    if (userQuery.trim().length < 50) { // Check original user query length
        log("Critical Input Failure: User query is too short/empty.", 'CRITICAL', 'LLM_PAYLOAD', { userQuery, sanitizedData: getSanitizedFormData(formData) });
        // Use specific error format
        throw new Error("Plan generation failed: Cannot generate plan due to missing user input.");
    }

    log("Technical Prompt (Separated)", 'INFO', 'LLM_PROMPT', { 
        systemPromptStart: systemPrompt.substring(0, 200) + '...', 
        userQuery: userQuery,
        sanitizedData: getSanitizedFormData(formData) 
    });

    // --- FIX: Use systemInstruction payload for v1beta API ---
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }], // Send only the user query here
        systemInstruction: {
            parts: [{ text: systemPrompt }] // Send the system prompt here
        }
    };
    // --- End FIX ---


    try {
        const response = await fetchWithRetry(
            GEMINI_API_URL,
            { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(payload) },
            log
        );
        const result = await response.json();
        let jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonText) {
            log("Technical AI returned no JSON text.", 'CRITICAL', 'LLM', result);
            throw new Error("LLM response was empty or contained no text part."); // Caught as 500
        }

        // --- FIX: Extract JSON from markdown code block if necessary ---
        const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
            jsonText = jsonMatch[1];
            log("Extracted JSON from markdown block.", 'DEBUG', 'LLM');
        } else {
            log("Response was not wrapped in ```json block, attempting direct parse.", 'WARN', 'LLM');
        }
        // --- End FIX ---

        log("Technical Raw (potential JSON)", 'INFO', 'LLM', { raw: jsonText.substring(0, 200) + '...' });
        
        try {
            const parsed = JSON.parse(jsonText);
            log("Parsed Technical", 'INFO', 'DATA', { ingreds: parsed.ingredients?.length || 0, hasMealPlan: !!parsed.mealPlan?.length });

            // Validation (V11: Checks meal.items) - Remains the same
            if (!parsed || typeof parsed !== 'object') throw new Error("LLM response was not a valid object.");
             if (!parsed.ingredients || !Array.isArray(parsed.ingredients)) throw new Error("LLM response 'ingredients' is missing or not an array.");
             if (!parsed.mealPlan || !Array.isArray(parsed.mealPlan) || parsed.mealPlan.length === 0) throw new Error("LLM response is missing a valid 'mealPlan'.");
             for(const dayPlan of parsed.mealPlan) {
                if (!dayPlan || typeof dayPlan !== 'object' || !Number.isFinite(dayPlan.day)) throw new Error(`LLM response contains invalid dayPlan object or missing day number.`);
                if (!dayPlan.meals || !Array.isArray(dayPlan.meals) || dayPlan.meals.length === 0) throw new Error(`LLM response has invalid or empty meals array for day ${dayPlan.day}.`);
                for(const meal of dayPlan.meals) {
                     if (!meal || typeof meal !== 'object' || typeof meal.type !== 'string' || typeof meal.name !== 'string' || typeof meal.description !== 'string' || !Array.isArray(meal.items)) {
                          throw new Error(`LLM response has missing required fields (type, name, desc, or items) for meal on day ${dayPlan.day}.`);
                     }
                     for(const item of meal.items) {
                         if(!item || typeof item.key !== 'string' || !Number.isFinite(item.qty) || typeof item.unit !== 'string') {
                            throw new Error(`LLM response has invalid meal item for ${meal.name} on day ${dayPlan.day}.`);
                         }
                     }
                 }
            }
            for(const ing of parsed.ingredients) {
                 if (!ing || typeof ing !== 'object' || typeof ing.originalIngredient !== 'string' || typeof ing.normalQuery !== 'string' || !Array.isArray(ing.requiredWords) || !Array.isArray(ing.negativeKeywords) || !Array.isArray(ing.allowedCategories) || ing.allowedCategories.length === 0 || !Number.isFinite(Number(ing.totalGramsRequired)) || typeof ing.quantityUnits !== 'string') {
                      log(`Validation Error: Ingredient "${ing?.originalIngredient || 'unknown'}" missing fields or invalid types.`, 'CRITICAL', 'LLM', ing);
                      throw new Error(`LLM response ingredient invalid.`);
                 }
             }

            return parsed;
        } catch (e) {
            log(`Failed to parse or validate Technical AI JSON: ${e.message}`, 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 200) });
             // Ensure specific error format for plan failures
             if (e.message.includes("LLM response")) {
                 throw new Error(`Plan generation failed: ${e.message}`); // Tweak 7 format
             }
            throw new Error(`Failed to parse LLM JSON: ${e.message}`); // Caught as 500
        }
    } catch (error) {
         log(`Technical AI call failed definitively: ${error.message}`, 'CRITICAL', 'LLM');
         // Use generic 500 error for fetch failures
         throw new Error(`Technical AI call failed: ${error.message}`);
    }
}


/// ===== API-CALLERS-END ===== ////


/// ===== NUTRITION-CALC-START ===== \\\\

function calculateCalorieTarget(formData, log = console.log) {
    // ... (Unchanged) ...
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);

    if (isNaN(weightKg) || isNaN(heightCm) || isNaN(ageYears) || !gender || !activityLevel || !goal) {
        log("Missing or invalid profile data for calorie calculation, using default 2000.", 'WARN', 'CALC', getSanitizedFormData({ weight, height, age, gender, activityLevel, goal}));
        return 2000;
    }

    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);

    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    let multiplier = activityMultipliers[activityLevel] || 1.55;
     if (!activityMultipliers[activityLevel]) {
         log(`Invalid activityLevel "${activityLevel}", using default 1.55.`, 'WARN', 'CALC');
     }
    const tdee = bmr * multiplier;

    const goalAdjustments = { maintain: 0, cut_moderate: -0.15, cut_aggressive: -0.25, bulk_lean: +0.15, bulk_aggressive: +0.25 };
    let adjustmentFactor = goalAdjustments[goal];
     if (adjustmentFactor === undefined) {
         log(`Invalid goal "${goal}", using default 'maintain' (0 adjustment).`, 'WARN', 'CALC');
         adjustmentFactor = 0;
    }
    const adjustment = tdee * adjustmentFactor;

    log(`Calorie Calc: BMR=${bmr.toFixed(0)}, TDEE=${tdee.toFixed(0)}, Goal=${goal}, Adjustment=${adjustment.toFixed(0)}`, 'INFO', 'CALC');

    return Math.max(1200, Math.round(tdee + adjustment));
}


function calculateMacroTargets(calorieTarget, goal, weightKg, log) {
    // ... (Unchanged) ...
    const macroSplits = {
        'cut_aggressive': { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'cut_moderate':   { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'maintain':       { pPct: 0.30, fPct: 0.30, cPct: 0.40 },
        'bulk_lean':      { pPct: 0.25, fPct: 0.25, cPct: 0.50 },
        'bulk_aggressive':{ pPct: 0.20, fPct: 0.25, cPct: 0.55 }
    };
    const split = macroSplits[goal] || macroSplits['maintain'];
    if (!macroSplits[goal]) {
        log(`Invalid goal "${goal}" for macro split, using 'maintain' defaults.`, 'WARN', 'CALC');
    }

    let proteinGrams = (calorieTarget * split.pPct) / 4;
    let fatGrams = (calorieTarget * split.fPct) / 9;
    let carbGrams = (calorieTarget * split.cPct) / 4;

    const validWeightKg = (typeof weightKg === 'number' && weightKg > 0) ? weightKg : 75;
    let proteinPerKg = proteinGrams / validWeightKg;
    let fatPercent = (fatGrams * 9) / calorieTarget;
    let carbsNeedRecalc = false;

    const PROTEIN_MAX_G_PER_KG = 3.0;
    if (proteinPerKg > PROTEIN_MAX_G_PER_KG) {
        log(`ADJUSTMENT: Initial protein ${proteinPerKg.toFixed(1)}g/kg > ${PROTEIN_MAX_G_PER_KG}g/kg. Capping protein and recalculating carbs.`, 'WARN', 'CALC');
        proteinGrams = PROTEIN_MAX_G_PER_KG * validWeightKg;
        carbsNeedRecalc = true;
    }

    const FAT_MAX_PERCENT = 0.35;
    if (fatPercent > FAT_MAX_PERCENT) {
        log(`ADJUSTMENT: Initial fat ${fatPercent.toFixed(1)*100}% > ${FAT_MAX_PERCENT*100}%. Capping fat and recalculating carbs.`, 'WARN', 'CALC');
        fatGrams = (calorieTarget * FAT_MAX_PERCENT) / 9;
        carbsNeedRecalc = true;
    }

    if (carbsNeedRecalc) {
        const proteinCalories = proteinGrams * 4;
        const fatCalories = fatGrams * 9;
        const carbCalories = Math.max(0, calorieTarget - proteinCalories - fatCalories);
        carbGrams = carbCalories / 4;
        log(`RECALC: New Carb Target: ${carbGrams.toFixed(0)}g`, 'INFO', 'CALC');
    }

    const PROTEIN_MIN_G_PER_KG = 1.6;
    const PROTEIN_CUT_MAX_G_PER_KG = 2.4;
    proteinPerKg = proteinGrams / validWeightKg;
    if (proteinPerKg < PROTEIN_MIN_G_PER_KG) {
        log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is below the optimal ${PROTEIN_MIN_G_PER_KG}g/kg range.`, 'INFO', 'CALC');
    }
    if ((goal === 'cut_aggressive' || goal === 'cut_moderate') && proteinPerKg > PROTEIN_CUT_MAX_G_PER_KG) {
         log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is above the ${PROTEIN_CUT_MAX_G_PER_KG}g/kg recommendation for cutting.`, 'INFO', 'CALC');
    }

    const FAT_MIN_G_PER_KG = 0.8;
    const fatPerKg = fatGrams / validWeightKg;
    if (fatPerKg < FAT_MIN_G_PER_KG) {
         log(`GUIDELINE: Fat target ${fatPerKg.toFixed(1)}g/kg is below the optimal ${FAT_MIN_G_PER_KG}g/kg minimum.`, 'INFO', 'CALC');
    }

    const finalProteinGrams = Math.round(proteinGrams);
    const finalFatGrams = Math.round(fatGrams);
    const finalCarbGrams = Math.round(carbGrams);

    log(`Calculated Macro Targets (Dual-Validation) (Goal: ${goal}, Cals: ${calorieTarget}, Weight: ${validWeightKg}kg): P ${finalProteinGrams}g, F ${finalFatGrams}g, C ${finalCarbGrams}g`, 'INFO', 'CALC');

    return { proteinGrams: finalProteinGrams, fatGrams: finalFatGrams, carbGrams: finalCarbGrams };
}

/// ===== NUTRITION-CALC-END ===== \\\\

