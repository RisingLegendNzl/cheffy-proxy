// --- ORCHESTRATOR API for Cheffy V8 ---

// Mark 52 (CRITICAL PARSER FIX - V8 Logic):
// 1. REVERSED the matching condition in `parseIngredientsFromDescription`.
// 2. CORRECT LOGIC: Check if ALL significant words from the `description fragment`
//    (e.g., ["chicken", "breast"]) are PRESENT IN the significant words of the
//    `ingredient key` (e.g., ["chicken", "breast", "fillet"]).
// 3. Kept sorting by original key length descending to prioritize specific matches first.
// 4. This ensures fragments match even if they omit less critical words from the key.
//    THIS SHOULD FINALLY FIX THE CALORIE BUG.
//
// Mark 51 (Incorrect Parser Fix V7):
// 1. Replaced `text.includes(coreName)`. Implemented flawed `every()` check.
//
// Mark 50 (Incorrect Parser Fix V6):
// 1. Reverted Mark 49. Attempted fix using core names (still too strict).
//
// Mark 49 (Partial Fixes):
// 1. Attempted parser fix (incorrectly). Added size check bypass for produce/fruit.
//
// Mark 48 (Architectural Fix):
// 1. Moved all math out of LLM. Simplified LLM prompt.

// ... (rest of changelog)

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
// Now importing the CACHE-WRAPPED versions with SWR and Token Buckets
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // Retries for Gemini calls
const MAX_NUTRITION_CONCURRENCY = 5;
const MAX_MARKET_RUN_CONCURRENCY = 5;
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery', 'filter', 'paper', 'tip', 'shampoo', 'conditioner', 'soap', 'lotion', 'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum'];
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60;
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0;
const PRICE_OUTLIER_Z_SCORE = 2.0;
const PANTRY_CATEGORIES = ["pantry", "grains", "canned", "spreads", "condiments", "drinks"];
// --- NEW (Mark 51): Stop words for parser ---
const PARSER_STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'with', 'in', 'on', 'of', 'for', 'to', 'g', 'ml', 'approx', 'drained', 'raw', 'cooked', 'dry', 'fresh', 'sliced', 'diced', 'shredded', 'budget', 'lean', 'medium', 'large', 'small', 'post-cooking', 'or', 'minimal', 'water', 'oil', 'cans', 'can', 'standard', 'weight', 'approx', 'approximately', 'style']); // Added 'style'

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
                return {
                    error: error.message || 'Unknown error during async mapping',
                    item: item?.originalIngredient || 'unknown'
                };
            });

        executing.push(promise);
        results.push(promise);

        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}


async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log(`Attempt ${attempt}: Fetching from ${url}`, 'DEBUG', 'HTTP');
            const response = await fetch(url, options);
            if (response.ok) return response;
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status} from API. Retrying...`, 'WARN', 'HTTP');
            } else {
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from API.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
             if (!error.message?.startsWith('API call failed with client error')) {
                log(`Attempt ${attempt}: Fetch failed for API with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
                console.error(`Fetch Error Details (Attempt ${attempt}):`, error);
            } else {
                 throw error;
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

// --- MODIFICATION (Mark 48): Simplified regex for better matching ---
function passRequiredWords(title = '', required = []) {
  if (!required || required.length === 0) return true;
  const t = title.toLowerCase();
  return required.every(w => {
    if (!w) return true;
    const base = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use simpler regex: \b${base}
    // This matches "blueberry" at the start of "blueberries" or "blueberry"
    const rx = new RegExp(`\\b${base}`, 'i');
    return rx.test(t);
  });
}
// --- END MODIFICATION (Mark 48) ---

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

    if (prodValue >= lowerBound && prodValue <= upperBound) {
        return true;
    } else {
        log(`${checkLogPrefix}: FAIL (Size ${prodValue}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit} for ${isPantry ? 'pantry' : 'perishable'})`, 'DEBUG', 'CHECKLIST');
        // TODO: Implement cost-aware override later if needed (check unitPrice < expectedUnitPrice)
        return false;
    }
}


function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) {
        return { pass: false, score: 0 };
    }

    // Ensure ingredientData and its properties are valid
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
    let score = 1.0; // Use score for skip heuristic if needed later

    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // Use nullish coalescing for safety, although prompt should ensure arrays exist now
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

    // Pass allowedCategories which should now be guaranteed by prompt/validation
    if (!passCategory(product, allowedCategories)) {
         log(`${checkLogPrefix}: FAIL (Category Mismatch: Product category "${product.product_category}" not in allowlist [${(allowedCategories || []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
         return { pass: false, score: 0 };
    }

    // --- MODIFICATION (Mark 49): Bypass size check for "produce" or "fruit" ---
    const isProduceOrFruit = (allowedCategories || []).some(c => c === 'fruit' || c === 'produce' || c === 'veg');
    const productSizeParsed = parseSize(product.product_size);
    
    if (!isProduceOrFruit) {
        if (!sizeOk(productSizeParsed, targetSize, allowedCategories, log, originalIngredient, checkLogPrefix)) {
            return { pass: false, score: 0 };
        }
    } else {
         log(`${checkLogPrefix}: INFO (Bypassing size check for 'fruit'/'produce' category)`, 'DEBUG', 'CHECKLIST');
    }
    // --- END MODIFICATION (Mark 49) ---

    log(`${checkLogPrefix}: PASS`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: score }; // Return score
}


function isCreativePrompt(cuisinePrompt) {
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false;
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'british', 'german', 'russian', 'brazilian', 'caribbean', 'african', 'middle eastern', 'spicy', 'mild', 'sweet', 'sour', 'savoury', 'quick', 'easy', 'simple', 'fast', 'budget', 'cheap', 'healthy', 'low carb', 'keto', 'low fat', 'high protein', 'high fiber', 'vegetarian', 'vegan', 'gluten free', 'dairy free', 'pescatarian', 'paleo'];
    const promptLower = cuisinePrompt.toLowerCase().trim();
    if (simpleKeywords.some(kw => promptLower === kw)) return false;
    if (promptLower.startsWith("high ") || promptLower.startsWith("low ")) return false;
    return cuisinePrompt.length > 30 || cuisinePrompt.includes(' like ') || cuisinePrompt.includes(' inspired by ') || cuisinePrompt.includes(' themed ');
}

// --- NEW HELPER (Mark 51): Get significant words from a string ---
function getSignificantWords(text) {
    if (!text) return [];
    // Split, filter stop words, remove plurals, handle hyphens
    return text.toLowerCase()
               .replace(/\(.*?\)/g, '') // Remove (xyz)
               .replace(/[\d.,!?:]+/g, ' ') // Remove digits and common punctuation, replace with space
               .replace(/-/g, ' ') // Replace hyphens with space
               .split(/\s+/) // Split on whitespace
               .map(word => word.replace(/s$/, '')) // Remove trailing 's' (simple plural)
               .filter(word => word.length > 2 && !PARSER_STOP_WORDS.has(word)); // Keep words > 2 chars, not stop words
}


// --- REVISED HELPER (Mark 52): Parses ingredients using V8 fuzzy word matching ---
/**
 * @typedef {Object} IngredientObject
 * @property {string} originalIngredient - The key (e.g., "Chicken Breast Fillet (1kg)")
 * // ... other properties
 * @property {string[]} significantWords - Pre-calculated significant words for matching
 */
/**
 * Parses gram amounts from a meal description string using robust matching.
 */
function parseIngredientsFromDescription(description, ingredientPlan, log) {
    if (!description || !Array.isArray(ingredientPlan) || ingredientPlan.length === 0) {
        return [];
    }
    
    // Pre-calculate significant words and sort plan by original key length descending (prioritize specifics)
    const sortedIngredientPlan = ingredientPlan
        .map(ing => ({ ...ing, significantWords: getSignificantWords(ing.originalIngredient) }))
        .sort((a, b) => b.originalIngredient.length - a.originalIngredient.length);

    const matches = [];
    // Regex to find patterns like "150g chicken breast", "150 g chicken", "150g rice"
    const regex = /(\d+\.?\d*)\s*(g|ml)\s*([\w\s-]+)/gi;
    let match;

    while ((match = regex.exec(description)) !== null) {
        try {
            const amount = parseFloat(match[1]);
            const unit = match[2].toLowerCase();
            const textFragment = match[3].toLowerCase().trim(); // Text from description, e.g., "cooked chicken breast"

            if (isNaN(amount) || amount <= 0) continue;

            // Get significant words from the description fragment
            const fragmentWords = getSignificantWords(textFragment);
            if (fragmentWords.length === 0) {
                 log(`[MEAL_PARSE] No significant words found in fragment: "${textFragment}"`, 'DEBUG', 'CALC');
                 continue; // Cannot match if fragment has no words
            }

            let bestMatch = null;
            // Iterate through sorted plan (most specific keys first)
            for (const ing of sortedIngredientPlan) {
                // V8 Logic: Check if ALL fragment words are present IN the key words
                if (ing.significantWords && ing.significantWords.length > 0) {
                    const keyWordSet = new Set(ing.significantWords); // Use Set for efficient check
                    if (fragmentWords.every(fragWord => keyWordSet.has(fragWord))) {
                        bestMatch = ing;
                        break; // Found the best (most specific key length) match satisfying the condition
                    }
                }
            }

            if (bestMatch) {
                matches.push({
                    key: bestMatch.originalIngredient,
                    grams: amount
                });
                log(`[MEAL_PARSE] V8 MATCHED "${match[0]}" (FragW: [${fragmentWords.join(', ')}]) to [${bestMatch.originalIngredient}] (KeyW: [${bestMatch.significantWords.join(', ')}]) (${amount}${unit})`, 'DEBUG', 'CALC');
            } else {
                 log(`[MEAL_PARSE] V8 NO MATCH for "${match[0]}" (FragW: [${fragmentWords.join(', ')}])`, 'DEBUG', 'CALC');
            }
        } catch (e) {
             log(`[MEAL_PARSE] Error parsing regex match: ${e.message}`, 'WARN', 'CALC', { match });
        }
    }
    return matches;
}
// --- END REVISED HELPER (Mark 52) ---


/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    typeof value === 'object' && value !== null ? value : String(value)
                )) : null
            };
            logs.push(logEntry);
            // Simple console logging for Vercel
             const time = new Date(logEntry.timestamp).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Brisbane' });
             console.log(`${time} [${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
             // Only log data object for non-DEBUG levels to reduce noise, or if it's an error
             if (data && (level !== 'DEBUG' || level === 'ERROR' || level === 'CRITICAL' || level === 'WARN')) {
                 try { console.log("  Data:", JSON.stringify(data, null, 2)); } catch { console.log("  Data: [Serialization Error]"); }
             }

            return logEntry;
        } catch (error) {
            const fallbackEntry = {
                 timestamp: new Date().toISOString(),
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


    log("Orchestrator invoked.", 'INFO', 'SYSTEM');
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

    try {
        if (!request.body) {
            log("Orchestrator fail: Received empty request body.", 'CRITICAL', 'SYSTEM');
            throw new Error("Request body is missing or invalid.");
        }
        const formData = request.body;
        const { store, cuisine, days, goal, weight } = formData;
        
        if (!store || !days || !goal || isNaN(parseFloat(formData.weight)) || isNaN(parseFloat(formData.height))) {
             log("CRITICAL: Missing core form data (store, days, goal, weight, or height). Cannot calculate plan.", 'CRITICAL', 'INPUT', getSanitizedFormData(formData));
             throw new Error("Missing critical profile data required for plan generation (store, days, goal, weight, height).");
        }
        
        const numDays = parseInt(days, 10);
        if (isNaN(numDays) || numDays < 1 || numDays > 7) {
             log(`Invalid number of days: ${days}. Using default 1.`, 'WARN', 'INPUT');
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

        // --- MODIFICATION (Mark 48): Removed retry loop ---
        log(`Attempting to generate creative plan from LLM.`, 'INFO', 'LLM_CALL');
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
             throw llmError; // Re-throw immediately, no retry
        }
        // --- END MODIFICATION (Mark 48) ---


        const { ingredients, mealPlan = [] } = llmResult || {};
        const rawIngredientPlan = Array.isArray(ingredients) ? ingredients : [];


        if (rawIngredientPlan.length === 0) {
            log("Blueprint fail: No ingredients returned by Technical AI (array was empty or invalid).", 'CRITICAL', 'LLM', { result: llmResult });
            throw new Error("Blueprint fail: AI did not return any ingredients.");
        }

        // Ensure allowedCategories exists (as required by prompt now)
        // --- MODIFICATION (Mark 48): Removed aiEst... checks ---
        const ingredientPlan = rawIngredientPlan.filter(ing => ing && ing.originalIngredient && ing.normalQuery && Array.isArray(ing.requiredWords) && Array.isArray(ing.negativeKeywords) && Array.isArray(ing.allowedCategories) && ing.allowedCategories.length > 0 && typeof ing.totalGramsRequired === 'number' && ing.totalGramsRequired >= 0);
        if (ingredientPlan.length !== rawIngredientPlan.length) {
            log(`Sanitized ingredient list: removed ${rawIngredientPlan.length - ingredientPlan.length} invalid entries (check required fields like allowedCategories).`, 'WARN', 'DATA');
        }
        if (ingredientPlan.length === 0) {
            log("Blueprint fail: All ingredients failed sanitization.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint fail: AI returned invalid ingredient data after sanitization.");
        }

        log(`Blueprint success: ${ingredientPlan.length} valid ingredients.`, 'SUCCESS', 'PHASE');
        // --- Reduced logging noise ---
        // ingredientPlan.forEach((ing, index) => {
        //     log(`AI Ingredient ${index + 1}: ${ing.originalIngredient}`, 'DEBUG', 'DATA', ing);
        // });

        // --- Phase 3: Market Run (Parallel & Optimized) ---
        log("Phase 3: Parallel Market Run...", 'INFO', 'PHASE');

        const processSingleIngredientOptimized = async (ingredient) => {
            try {
                if (!ingredient || typeof ingredient !== 'object' || !ingredient.originalIngredient) {
                    log(`Skipping invalid ingredient data in Market Run`, 'ERROR', 'MARKET_RUN', { ingredient });
                    return { ['unknown_invalid_ingredient']: { source: 'error', error: 'Invalid ingredient data provided' } };
                }
                const ingredientKey = ingredient.originalIngredient;
                 // Added allowedCategories check here too for safety
                 if (!ingredient.normalQuery || !Array.isArray(ingredient.requiredWords) || !Array.isArray(ingredient.negativeKeywords) || !Array.isArray(ingredient.allowedCategories) || ingredient.allowedCategories.length === 0) {
                    log(`[${ingredientKey}] Skipping due to missing critical fields (normalQuery, requiredWords, negativeKeywords, or allowedCategories)`, 'ERROR', 'MARKET_RUN', { ingredient });
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
                let keptCount = 0; // Initialize keptCount here


                for (const [index, { type, query }] of queriesToTry.entries()) {
                    if (!query || query.toLowerCase() === 'null') { // Added null check
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
                    // --- Reduced logging noise ---
                    // log(`[${ingredientKey}] Raw results (${type}, ${rawProducts.length}):`, 'DEBUG', 'DATA', rawProducts.map(p => p.product_name));

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
                            // Find best product based on unit price
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

                        acceptedQueryIdx = index; // Set on success
                        acceptedQueryType = type; // Set on success
                        keptCount = result.allProducts.length; // Update keptCount on success


                        // Calculate priceZ only if needed
                        priceZ = null; // Reset priceZ for each successful query
                        if (result.allProducts.length >= 3 && foundProduct.unit_price_per_100 != null && foundProduct.unit_price_per_100 > 0) {
                            const prices = result.allProducts.map(p => p.unit_price_per_100).filter(p => p != null && p > 0);
                             if (prices.length >= 2) {
                                const m = mean(prices);
                                const s = stdev(prices);
                                priceZ = (s > 0) ? ((foundProduct.unit_price_per_100 - m) / s) : 0;
                            }
                        }

                         // --- *** MODIFICATION (Mark 47): Corrected telemetry variable names *** ---
                        if (typeof acceptedQueryIdx === 'number' && acceptedQueryIdx >= 0) {
                            log(`[${ingredientKey}] Success Telemetry`, 'INFO', 'LADDER_TELEMETRY', {
                                 ingredientKey,
                                 acceptedQueryIdx, // Use camelCase
                                 acceptedQueryType, // Use camelCase
                                 pagesTouched,      // Use camelCase
                                 keptCount,         // Use camelCase
                                 price_z: priceZ !== null ? parseFloat(priceZ.toFixed(2)) : null, // snake_case ok if consistent
                                 mode,
                                 bucketWaitMs       // Use camelCase
                             });
                        } else {
                             // This log should ideally not be hit now, but kept for safety
                             log(`[${ingredientKey}] CRITICAL Error: Telemetry skipped due to invalid acceptedQueryIdx: ${acceptedQueryIdx}`, 'CRITICAL', 'MARKET_RUN_ERROR', {
                                ingredientKey, index, type, success: true
                             });
                        }
                        // --- *** END MODIFICATION *** ---


                        if (type === 'tight' && bestScoreSoFar >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                            log(`[${ingredientKey}] Skip heuristic hit (Tight query successful with score >= ${SKIP_HEURISTIC_SCORE_THRESHOLD}).`, 'INFO', 'MARKET_RUN');
                            break;
                        }
                        // If not skipping, break because mode is 'speed'
                        break;

                    } else {
                        log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA');
                        currentAttemptLog.status = 'no_match';
                    }
                } // End query loop

                if (result.source === 'failed') { log(`[${ingredientKey}] Definitive fail after trying all queries.`, 'WARN', 'MARKET_RUN'); }
                return { [ingredientKey]: result };

            } catch(e) {
                // Log and return error structure
                log(`CRITICAL Error processing single ingredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                 const errorKey = ingredient?.originalIngredient || `unknown_error_${Date.now()}`;
                 return { [errorKey]: { source: 'error', error: e.message, originalIngredient: errorKey, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url } };
            }
        }; // End processSingleIngredient

        log(`Market Run: ${ingredientPlan.length} ingredients, K=${MAX_MARKET_RUN_CONCURRENCY}...`, 'INFO', 'MARKET_RUN');
        const startMarketTime = Date.now();
        const parallelResultsArray = await concurrentlyMap(ingredientPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        const endMarketTime = Date.now();
        log(`Market Run parallel took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

        // Consolidate results, handling potential errors from concurrentlyMap
        const finalResults = parallelResultsArray.reduce((acc, currentResult) => {
             if (!currentResult) { log(`Received null/undefined result from concurrentlyMap`, 'ERROR', 'SYSTEM'); return acc; }
             // Handle errors caught by concurrentlyMap wrapper
             if (currentResult.error && currentResult.item) {
                 log(`ConcurrentlyMap Error for "${currentResult.item}": ${currentResult.error}`, 'CRITICAL', 'MARKET_RUN');
                 const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === currentResult.item);
                 // Ensure a base object even if ingredientPlan lookup fails
                 const baseData = typeof failedIngredientData === 'object' && failedIngredientData !== null ? failedIngredientData : { originalIngredient: currentResult.item };
                 acc[currentResult.item] = { ...baseData, source: 'error', error: `ConcurrentlyMap wrapper: ${currentResult.error}`, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: currentResult.error}] };
                 return acc;
             }
             // Handle results with valid keys, including internal errors from processSingleIngredientOptimized
             const ingredientKey = Object.keys(currentResult)[0];
             if (!ingredientKey || ingredientKey.startsWith('unknown_')) {
                 log(`Received result with invalid key from concurrentlyMap`, 'ERROR', 'SYSTEM', { currentResult });
                 return acc;
             }
              // Check if the result itself indicates an error source
             if(currentResult[ingredientKey]?.source === 'error') {
                 log(`Processing Error logged for "${ingredientKey}": ${currentResult[ingredientKey].error}`, 'INFO', 'MARKET_RUN'); // Downgraded log as error is already logged in processSingleIngredientOptimized
                  const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === ingredientKey);
                 const baseData = typeof failedIngredientData === 'object' && failedIngredientData !== null ? failedIngredientData : { originalIngredient: ingredientKey };
                 // Ensure essential fields exist even on error
                 acc[ingredientKey] = { ...baseData, source: 'error', error: currentResult[ingredientKey].error, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url };
                 return acc;
             }
             // If valid result, add it
             if (typeof currentResult[ingredientKey] === 'object' && currentResult[ingredientKey] !== null) {
                acc[ingredientKey] = currentResult[ingredientKey];
             } else {
                  log(`Received invalid result structure for key "${ingredientKey}"`, 'ERROR', 'SYSTEM', { result: currentResult[ingredientKey] });
             }
             return acc;
        }, {});


        log("Market Run complete.", 'SUCCESS', 'PHASE');


        // --- Phase 4: Nutrition Fetch ---
        // --- MODIFICATION (Mark 48): Renamed phase, removed calculation logic ---
        log("Phase 4: Nutrition Data Fetch...", 'INFO', 'PHASE');
        const itemsToFetchNutrition = [];

        // Build list for nutrition fetch, carefully handling potential missing data
        for (const key in finalResults) {
            const result = finalResults[key];
             if (!result || typeof result !== 'object') {
                 log(`Skipping invalid result object for key "${key}" during nutrition phase`, 'WARN', 'CALC');
                 continue;
             }
            if (result.source === 'discovery' && result.currentSelectionURL && Array.isArray(result.allProducts)) {
                const selected = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                if (selected) {
                    itemsToFetchNutrition.push({
                        ingredientKey: key, barcode: selected.barcode, query: selected.name,
                        grams: typeof result.totalGramsRequired === 'number' && result.totalGramsRequired >= 0 ? result.totalGramsRequired : 0,
                    });
                } else {
                     log(`[${key}] Result source is 'discovery' but no selected product found for URL ${result.currentSelectionURL}. No nutrition to fetch.`, 'WARN', 'CALC');
                }
            } else {
                 log(`[${key}] Market Run failed or error, no product selected. No nutrition to fetch.`, 'WARN', 'CALC', { source: result.source, error: result.error });
            }
        } // End for loop building nutrition items


        // --- NEW (Mark 48): Create a map to store fetched nutrition data ---
        const nutritionDataMap = new Map(); // Map<ingredientKey, nutritionObject>

        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching nutrition for ${itemsToFetchNutrition.length} selected products...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, (item) =>
                (item.barcode || item.query) ?
                fetchNutritionData(item.barcode, item.query, log)
                    .then(nut => ({ ...item, nut })) // Ensure item data is carried through
                    .catch(err => {
                        log(`Unhandled Nutri fetch error ${item.ingredientKey}: ${err.message}`, 'CRITICAL', 'HTTP');
                        return { ...item, nut: { status: 'not_found', error: 'Unhandled fetch error' } }; // Return item data even on error
                    })
                : Promise.resolve({ ...item, nut: { status: 'not_found', source: 'no_query' } }) // Should not happen if logic above is correct
            );
            log("Nutrition fetch complete.", 'SUCCESS', 'HTTP');

            // --- NEW (Mark 48): Populate the nutrition map and attach data to finalResults ---
            nutritionResults.forEach(item => {
                 if (!item || !item.ingredientKey || !item.nut) {
                    log('Skipping invalid item in nutritionResults loop.', 'ERROR', 'CALC', { item });
                    return;
                 }
                const nut = item.nut;
                const result = finalResults[item.ingredientKey];

                // Store in map for Phase 5 calculation
                nutritionDataMap.set(item.ingredientKey, nut);

                 // Attach nutrition data back to the finalResults object for frontend
                 if (result) {
                     if (result.source === 'discovery' && Array.isArray(result.allProducts)) {
                         let productToAttach = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                         if (productToAttach) {
                             productToAttach.nutrition = nut;
                         } else if (result.allProducts.length > 0 && result.allProducts[0]) {
                             result.allProducts[0].nutrition = nut; // Fallback
                         }
                     } else {
                         result.nutrition = nut; // Attach to root if failed
                     }
                 }
            });
            // --- END NEW (Mark 48) ---

        } else {
            log("No valid items found for nutrition fetching (Market Run likely failed for all items).", 'WARN', 'CALC');
        }
        // --- END MODIFICATION (Mark 48) ---


        // --- NEW Phase 5: Orchestrator Math (Mark 48) ---
        log("Phase 5: Orchestrator Math Engine...", 'INFO', 'PHASE');
        
        let weeklyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        const dailyTotalsList = []; // Store totals for each day for averaging

        if (!Array.isArray(mealPlan) || mealPlan.length === 0) {
            log("No meal plan provided by LLM, skipping Phase 5 math.", 'WARN', 'CALC');
        } else {
            // Loop through each day in the meal plan
            for (const dayPlan of mealPlan) {
                if (!dayPlan || !Array.isArray(dayPlan.meals) || dayPlan.meals.length === 0) {
                     log(`Skipping invalid day or empty meals array for day ${dayPlan?.day || 'unknown'}`, 'WARN', 'CALC');
                     continue;
                }
                
                let currentDayTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };

                // Loop through each meal in the day
                for (const meal of dayPlan.meals) {
                     if (!meal || typeof meal.description !== 'string') {
                         log(`Skipping invalid meal or missing description for day ${dayPlan.day}`, 'WARN', 'CALC');
                         continue;
                     }

                    let mealSubtotals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
                    
                    // Parse ingredients from this meal's description
                    const matchedIngredients = parseIngredientsFromDescription(meal.description, ingredientPlan, log);

                    if (matchedIngredients.length === 0) {
                         log(`[${meal.name}] No ingredients parsed from description. Subtotals will be 0.`, 'WARN', 'CALC', { desc: meal.description });
                    }

                    // Calculate subtotals for this meal
                    for (const { key, grams } of matchedIngredients) {
                        const nutritionData = nutritionDataMap.get(key);
                        
                        // Check if we have valid, fetched nutrition data
                        if (nutritionData && nutritionData.status === 'found' &&
                            nutritionData.protein != null && nutritionData.fat != null && nutritionData.carbs != null && nutritionData.calories != null)
                        {
                            const p = (nutritionData.protein / 100) * grams;
                            const f = (nutritionData.fat / 100) * grams;
                            const c = (nutritionData.carbs / 100) * grams;
                            // Use calories from macros for consistency
                            const kcal = (p * 4) + (f * 9) + (c * 4); 
                            
                            mealSubtotals.kcal += kcal;
                            mealSubtotals.protein += p;
                            mealSubtotals.fat += f;
                            mealSubtotals.carbs += c;
                        } else {
                            // --- NEW (Mark 49): Add canonical fallback for items that failed market run ---
                            const ingredientData = ingredientPlan.find(ing => ing.originalIngredient === key);
                            // Only use fallback if market run failed AND nutrition wasn't found (or map lookup failed)
                            if (ingredientData && (finalResults[key]?.source === 'failed' || finalResults[key]?.source === 'error') && (!nutritionData || nutritionData.status !== 'found')) {
                                log(`[${meal.name}] Using CANONICAL fallback attempt for [${key}] (${grams}g). Market run failed/error.`, 'WARN', 'CALC', { key });
                                // Integrate nutrition-search.js canonical logic (if available, else rough fallback)
                                // const canonicalNutrition = await fetchNutritionData(null, key, log); // Or a simpler lookup
                                 const canonicalNutrition = { // Hardcoded examples, replace with actual call
                                     "Banana": { status: 'found', source: 'canonical', calories: 89, protein: 1.1, fat: 0.3, carbs: 22.8 },
                                     "Eggs": { status: 'found', source: 'canonical', calories: 143, protein: 12.6, fat: 9.5, carbs: 0.7 },
                                     "Wholemeal Wraps": { status: 'found', source: 'canonical', calories: 300, protein: 9, fat: 5, carbs: 55 }, // Example
                                     // Add more common fallbacks if needed
                                 }[key]; // Lookup by key

                                if (canonicalNutrition && canonicalNutrition.status === 'found') {
                                    const p = (canonicalNutrition.protein / 100) * grams;
                                    const f = (canonicalNutrition.fat / 100) * grams;
                                    const c = (canonicalNutrition.carbs / 100) * grams;
                                    const kcal = (p * 4) + (f * 9) + (c * 4);
                                    mealSubtotals.kcal += kcal;
                                    mealSubtotals.protein += p;
                                    mealSubtotals.fat += f;
                                    mealSubtotals.carbs += c;
                                    log(`[${meal.name}] Applied CANONICAL (${canonicalNutrition.source}) for [${key}]`, 'DEBUG', 'CALC', { kcal, p, f, c });
                                } else {
                                    log(`[${meal.name}] No CANONICAL fallback found for failed ingredient [${key}]. Skipping.`, 'WARN', 'CALC');
                                }
                            } else {
                                log(`[${meal.name}] Skipping nutrition for [${key}] (${grams}g). No valid/found nutrition data.`, 'WARN', 'CALC', { key, status: nutritionData?.status, source: finalResults[key]?.source });
                            }
                            // --- END NEW (Mark 49) ---
                        }
                    } // End ingredient loop for meal

                    // Attach accurate subtotals (rounded) to the meal object
                    meal.subtotal_kcal = Math.round(mealSubtotals.kcal);
                    meal.subtotal_protein = Math.round(mealSubtotals.protein);
                    meal.subtotal_fat = Math.round(mealSubtotals.fat);
                    meal.subtotal_carbs = Math.round(mealSubtotals.carbs);

                    log(`[${meal.name}] Calculated Subtotals:`, 'DEBUG', 'CALC', {
                        kcal: meal.subtotal_kcal,
                        p: meal.subtotal_protein,
                        f: meal.subtotal_fat,
                        c: meal.subtotal_carbs
                    });

                    // Add to the day's total
                    currentDayTotals.calories += mealSubtotals.kcal; // Use unrounded for accuracy
                    currentDayTotals.protein += mealSubtotals.protein;
                    currentDayTotals.fat += mealSubtotals.fat;
                    currentDayTotals.carbs += mealSubtotals.carbs;

                } // End meal loop for day
                
                dailyTotalsList.push(currentDayTotals); // Add this day's sum to the list
                log(`Calculated Totals for Day ${dayPlan.day}:`, 'INFO', 'CALC', {
                     calories: Math.round(currentDayTotals.calories),
                     protein: Math.round(currentDayTotals.protein),
                     fat: Math.round(currentDayTotals.fat),
                     carbs: Math.round(currentDayTotals.carbs),
                });
            } // End day loop

            // Sum all daily totals to get the weekly total
            weeklyTotals = dailyTotalsList.reduce((acc, day) => {
                acc.calories += day.calories;
                acc.protein += day.protein;
                acc.fat += day.fat;
                acc.carbs += day.carbs;
                return acc;
            }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
        }

        // Calculate the final daily average
        const validNumDays = (dailyTotalsList.length > 0) ? dailyTotalsList.length : ( (numDays >= 1 && numDays <= 7) ? numDays : 1 );
        log(`Averaging totals over ${validNumDays} days.`, 'DEBUG', 'CALC');

        const finalDailyTotals = {
             calories: Math.round(weeklyTotals.calories / validNumDays),
             protein: Math.round(weeklyTotals.protein / validNumDays),
             fat: Math.round(weeklyTotals.fat / validNumDays),
             carbs: Math.round(weeklyTotals.carbs / validNumDays),
        };
        log("ACCURATE DAILY nutrition totals calculated.", 'SUCCESS', 'CALC', finalDailyTotals);
        // --- END NEW Phase 5 (Mark 48) ---


        // --- Phase 6: Assembling Final Response ---
        log("Phase 6: Final Response...", 'INFO', 'PHASE');
        const finalResponseData = {
             mealPlan: mealPlan || [], // mealPlan now contains accurate subtotals
             uniqueIngredients: ingredientPlan,
             results: finalResults, // results now contain nutrition data
             nutritionalTargets: finalDailyTotals // Use the accurate, newly calculated totals
        };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL Orchestrator ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error("ORCHESTRATOR UNHANDLED ERROR:", error);
        return response.status(500).json({ message: "An unrecoverable server error occurred during plan generation.", error: error.message, logs });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


async function generateCreativeIdeas(cuisinePrompt, log) {
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const sysPrompt=`Creative chef... comma-separated list.`;
    const userQuery=`Theme: "${cuisinePrompt}"...`;
    log("Creative Prompt",'INFO','LLM_PROMPT',{userQuery});
    const payload={contents:[{parts:[{text:userQuery}]}],systemInstruction:{parts:[{text:sysPrompt}]}};
    try{
        const res=await fetchWithRetry(
            GEMINI_API_URL,
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
        return "";
    }
}

// --- REMOVED (Mark 48): within5 and assertDailyMacroSums are no longer needed ---


async function generateLLMPlanAndMeals(formData, calorieTarget, proteinTargetGrams, fatTargetGrams, carbTargetGrams, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']}; const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2;
    const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.');
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion' not 'scallion', 'capsicum' not 'bell pepper')." : "";

    // --- *** MODIFICATION (Mark 48): Simplified prompt, removed math rules (15b, 16, aiEst...) *** ---
    const systemPrompt = `Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate meal plan ('mealPlan') & shopping list ('ingredients'). 2. QUERIES: For each ingredient: a. 'tightQuery': Hyper-specific, STORE-PREFIXED. b. 'normalQuery': 2-4 generic words, STORE-PREFIXED. CRITICAL: Use MOST COMMON GENERIC NAME. DO NOT include brands, sizes, fat content, specific forms (sliced/grated), or dryness unless ESSENTIAL.${australianTermNote} c. 'wideQuery': 1-2 broad words, STORE-PREFIXED. 3. 'requiredWords': Array[1] SINGLE ESSENTIAL CORE NOUN ONLY, lowercase singular. NO adjectives, forms, plurals, or multiple words (e.g., for 'baby spinach leaves', use ['spinach']; for 'roma tomatoes', use ['tomato']). This word MUST exist in product names. 4. 'negativeKeywords': Array[1-5] lowercase words for INCORRECT product. Be thorough. Include common mismatches by type. Examples: fresh produce → ["bread","cake","sauce","canned","powder","chips","dried","frozen"], herb/spice → ["spray","cleaner","mouthwash","deodorant"], meat cuts → ["cat","dog","pet","toy"]. 5. 'targetSize': Object {value: NUM, unit: "g"|"ml"}. Null if N/A. Prefer common package sizes. 6. 'totalGramsRequired': BEST ESTIMATE total g/ml for plan. MUST accurately reflect sum of meal portions. 7. Adhere to constraints. 8. 'ingredients' MANDATORY. 'mealPlan' MANDATORY. 9. 'OR' INGREDIENTS: Use broad 'requiredWords', add relevant 'negativeKeywords'. 10. NICHE ITEMS: Set 'tightQuery' null, broaden queries/words. 11. FORM/TYPE: 'normalQuery' = generic form. 'requiredWords' = singular noun ONLY. Specify form only in 'tightQuery'. 12. NO 'nutritionalTargets' or 'aiEst...' nutrition properties in output. 13. 'allowedCategories' (MANDATORY): Provide precise, lowercase categories for each ingredient using this exact set: ["produce","fruit","veg","dairy","bakery","meat","seafood","pantry","frozen","drinks","canned","grains","spreads","condiments","snacks"]. 14. MEAL PORTIONS: For each meal in 'mealPlan.meals': a) Specify clear portion sizes for key ingredients in 'description' (e.g., '...150g chicken breast, 80g dry rice...'). b) DO NOT include 'subtotal_...' fields. 15. BULKING MACRO PRIORITY: For 'bulk' goals, prioritize carbohydrate sources over fats when adjusting portions. 16. MEAL VARIETY: Critical. User maxRepetitions=${maxRepetitions}. DO NOT repeat exact meals more than this across the entire ${days}-day plan. Ensure variety, especially if maxRepetitions < ${days}. 17. COST vs. VARIETY: User costPriority='${costPriority}'. Balance with Rule 16. Prioritize variety if needed. Output ONLY the valid JSON object described by the schema, nothing else.`;
    // --- *** END MODIFICATION (Mark 48) *** ---

    let userQuery = `Gen ${days}-day plan for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Target: ~${calorieTarget} kcal. Macro Targets: Protein ~${proteinTargetGrams}g, Fat ~${fatTargetGrams}g, Carbs ~${carbTargetGrams}g. Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}. Cuisine: ${cuisineInstruction}.`;

    // --- REMOVED (Mark 48): Retry logic removed ---

    if (userQuery.trim().length < 50) {
        log("Critical Input Failure: User query is too short/empty.", 'CRITICAL', 'LLM_PAYLOAD', { userQuery, sanitizedData: getSanitizedFormData(formData) });
        throw new Error("Cannot generate plan: Invalid input data caused an empty prompt.");
    }

    log("Technical Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...', sanitizedData: getSanitizedFormData(formData) });

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            // --- MODIFICATION (Mark 48): Updated schema to remove math fields ---
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "ingredients": {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "originalIngredient": { "type": "STRING" },
                                "category": { "type": "STRING" },
                                "tightQuery": { "type": "STRING", nullable: true },
                                "normalQuery": { "type": "STRING" },
                                "wideQuery": { "type": "STRING", nullable: true },
                                "requiredWords": { type: "ARRAY", items: { "type": "STRING" } },
                                "negativeKeywords": { type: "ARRAY", items: { "type": "STRING" } },
                                "targetSize": { type: "OBJECT", properties: { "value": { "type": "NUMBER" }, "unit": { "type": "STRING", enum: ["g", "ml"] } }, nullable: true },
                                "totalGramsRequired": { "type": "NUMBER" },
                                "quantityUnits": { "type": "STRING" },
                                "allowedCategories": { type: "ARRAY", items: { "type": "STRING" }},
                                // --- REMOVED 'aiEst...' properties ---
                            },
                            required: ["originalIngredient", "normalQuery", "requiredWords", "negativeKeywords", "allowedCategories", "totalGramsRequired", "quantityUnits"]
                        }
                    },
                    "mealPlan": {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "day": { "type": "NUMBER" },
                                "meals": {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            "type": { "type": "STRING" },
                                            "name": { "type": "STRING" },
                                            "description": { "type": "STRING" },
                                            // --- REMOVED 'subtotal_...' properties ---
                                        },
                                        required: ["type", "name", "description"]
                                    }
                                }
                            },
                             required: ["day", "meals"]
                        }
                    }
                },
                required: ["ingredients", "mealPlan"]
            }
            // --- END MODIFICATION (Mark 48) ---
         }
    };


    try {
        const response = await fetchWithRetry(
            GEMINI_API_URL,
            { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(payload) },
            log
        );
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) {
            log("Technical AI returned no JSON text.", 'CRITICAL', 'LLM', result);
            throw new Error("LLM response was empty or contained no text part.");
        }
        log("Technical Raw", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });
        try {
            const parsed = JSON.parse(jsonText);
            log("Parsed Technical", 'INFO', 'DATA', { ingreds: parsed.ingredients?.length || 0, hasMealPlan: !!parsed.mealPlan?.length });

            // --- MODIFICATION (Mark 48): Updated validation ---
            if (!parsed || typeof parsed !== 'object') {
                 log("Validation Error: Root response is not an object.", 'CRITICAL', 'LLM', parsed);
                 throw new Error("LLM response was not a valid object.");
            }
             if (parsed.ingredients && !Array.isArray(parsed.ingredients)) {
                 log("Validation Error: 'ingredients' exists but is not an array.", 'CRITICAL', 'LLM', parsed);
                 throw new Error("LLM response 'ingredients' is not an array.");
             }
             if (!parsed.mealPlan || !Array.isArray(parsed.mealPlan) || parsed.mealPlan.length === 0) {
                 log("Validation Error: 'mealPlan' is missing, not an array, or empty.", 'CRITICAL', 'LLM', parsed);
                 throw new Error("LLM response is missing a valid 'mealPlan'.");
             }
             // Validate meal structure and required fields
             for(const dayPlan of parsed.mealPlan) {
                if (!dayPlan || typeof dayPlan !== 'object' || !Number.isFinite(dayPlan.day)) throw new Error(`LLM response contains invalid dayPlan object or missing day number.`);
                if (!dayPlan.meals || !Array.isArray(dayPlan.meals) || dayPlan.meals.length === 0) throw new Error(`LLM response has invalid or empty meals array for day ${dayPlan.day}.`);
                for(const meal of dayPlan.meals) {
                     if (!meal || typeof meal !== 'object') throw new Error(`LLM response contains invalid meal object for day ${dayPlan.day}.`);
                     if (typeof meal.type !== 'string' || typeof meal.name !== 'string' || typeof meal.description !== 'string') {
                          throw new Error(`LLM response has missing required fields for meal "${meal.name || 'unnamed'}" on day ${dayPlan.day}.`);
                     }
                 }
            }
            // Validate ingredient structure and required fields
            if (parsed.ingredients) {
                 for(const ing of parsed.ingredients) {
                     if (!ing || typeof ing !== 'object') throw new Error(`LLM response contains invalid ingredient object.`);
                     if (typeof ing.originalIngredient !== 'string' || typeof ing.normalQuery !== 'string' ||
                         !Array.isArray(ing.requiredWords) || !Array.isArray(ing.negativeKeywords) ||
                         !Array.isArray(ing.allowedCategories) || ing.allowedCategories.length === 0 || // Must exist and be non-empty
                         !Number.isFinite(Number(ing.totalGramsRequired)) || typeof ing.quantityUnits !== 'string') {
                          log(`Validation Error: Ingredient "${ing?.originalIngredient || 'unknown'}" is missing required fields or has invalid types (e.g., allowedCategories missing/empty).`, 'CRITICAL', 'LLM', ing);
                          throw new Error(`LLM response ingredient "${ing?.originalIngredient || 'unknown'}" missing required fields or has invalid types.`);
                     }
                 }
            } else {
                 throw new Error("LLM response is missing the required 'ingredients' array.");
            }
            // --- END MODIFICATION (Mark 48) ---

            return parsed;
        } catch (e) {
            log(`Failed to parse or validate Technical AI JSON: ${e.message}`, 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000) });
            // Re-throw schema/parse errors specifically
             if (e.message.includes("LLM response") || e.message.includes("Failed to parse LLM JSON") || e.message.includes("missing required fields")) throw e;
            // Otherwise wrap as a generic parse failure
            throw new Error(`Failed to parse LLM JSON: ${e.message}`);
        }
    } catch (error) {
         log(`Technical AI call failed definitively: ${error.message}`, 'CRITICAL', 'LLM');
         // --- REMOVED (Mark 48): Retry logic removed ---
         // Otherwise, wrap and throw general error
         throw new Error(`Technical AI call failed: ${error.message}`);
    }
}


/// ===== API-CALLERS-END ===== ////


/// ===== NUTRITION-CALC-START ===== \\\\

function calculateCalorieTarget(formData, log = console.log) {
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


