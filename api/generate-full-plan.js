// --- ORCHESTrator API for Cheffy V4 ---
// Mark 53: Fixed AI Phase 1 schema for day_id (removed array type). Added retry for AI Phase 1 validation failure.
// Mark 52: Implement fixes based on ChatGPT analysis & logs
// - Set MAX_DESCRIPTION_CONCURRENCY = 1 (Serialize Food Writer calls).
// - Added calculateMacrosFromSolution helper.
// - Refactored solveAndDescribePlan to use calculateMacrosFromSolution after final solution (LP/Heuristic/min_g) is determined.
// - Ensured solvedDailyTotalsAcc accumulates only the correct final macros.
// Mark 51: Further fixes based on log analysis
// - Corrected Final Average Macro Calculation attempt (was still flawed).
// - Reduced MAX_DESCRIPTION_CONCURRENCY to 2.
// Mark 50: Implemented fixes based on log analysis
// - Added MAX_DESCRIPTION_CONCURRENCY and used concurrentlyMap for AI Phase 2 (Food Writer) to prevent 429s.
// - Updated AI Phase 1 prompt to suggest wider tolerances for simple meals/snacks.
// - Updated AI Phase 1 prompt to improve nutritionQuery generation (e.g., for sprays).
// - Added Heuristic Output Validation: Check if heuristic result is within tolerances; if not, use min_g values and log warning.
// Mark 49: Fixed Market Run failures for Olive Oil Spray and Brown Onion.
// ... (rest of changelog)

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
// Now importing the CACHE-WRAPPED versions with SWR and Token Buckets
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

// --- NEW (Mark 46): Import LP Solver ---
const solver = require('javascript-lp-solver');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // Retries for Gemini calls
const MAX_NUTRITION_CONCURRENCY = 5; // Concurrency for Nutrition phase
const MAX_MARKET_RUN_CONCURRENCY = 5; // K value for Parallel Market Run
// --- MODIFICATION (Mark 52): Set description concurrency to 1 ---
const MAX_DESCRIPTION_CONCURRENCY = 1; // K value for AI Phase 2 (Food Writer) - Serialized
// --- END MODIFICATION ---


// Defines macro targets for each meal type as a percentage of the day's total.
const MEAL_MACRO_BUDGETS = {
    '3': { 'B': 0.30, 'L': 0.40, 'D': 0.30 },
    '4': { 'B': 0.25, 'L': 0.35, 'D': 0.30, 'S1': 0.10 },
    '5': { 'B': 0.20, 'L': 0.30, 'D': 0.30, 'S1': 0.10, 'S2': 0.10 }
};

// Banned keywords for market run checklist
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'battery', 'filter', 'paper', 'tip', 'shampoo', 'conditioner', 'soap', 'lotion', 'cleaner', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum']; // Removed 'wrap', 'spray'

// Hard-coded overrides for known-bad AI checklist data
const REQ_ANY = {
  ing_wholemeal_pasta: ["pasta", "spaghetti", "penne", "fusilli", "rigatoni", "spirals"],
  ing_onion: ["onion", "onions", "brownonion"],
  ing_spinach: ["spinach"],
  ing_eggs: ["eggs"],
  ing_diced_tomatoes: ["tomatoes"]
};
const NEG_EXTRA = {
  ing_onion: ["shallots", "spring", "powder", "minced", "prepack", "packet", "mix"],
  ing_olive_oil_spray: ["canola", "vegetable", "eucalyptus", "sunflower"],
  ing_canola_oil_spray: ["olive", "vegetable", "eucalyptus", "sunflower"], // Added for canola spray
  ing_diced_tomatoes: ["paste", "sundried", "cherry", "soup", "puree"],
  ing_wholemeal_pasta: ["bread", "loaf", "flour", "rolls"]
};

const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0;
const PRICE_OUTLIER_Z_SCORE = 2.0;

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sanitizes form data to remove Personally Identifiable Information (PII) for logging.
 */
function getSanitizedFormData(formData) {
    try {
        const { name, height, weight, age, bodyFat, ...rest } = formData;
        return {
            ...rest, // Keep non-sensitive fields
            user_profile: "[REDACTED]" // Replace sensitive fields with a single key
        };
    } catch (e) {
        return { error: "Failed to sanitize form data." };
    }
}

/**
 * Maps an array concurrently with a specified limit.
 * Includes error handling for each item.
 */
async function concurrentlyMap(array, limit, asyncMapper) {
    const results = [];
    const executing = [];
    for (const item of array) {
        // Wrap asyncMapper call in a promise handler to catch errors and identify the item
        const identifier = item?.ingredient_id || item?.originalIngredient || item?.meal_id || 'unknown'; // Use meal_id as fallback identifier
        const promise = asyncMapper(item)
            .then(result => {
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                return result; // Return successful result
            })
            .catch(error => {
                console.error(`Error processing item "${identifier}" in concurrentlyMap:`, error);
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                // Return an object indicating failure for this specific item
                return {
                    error: error.message || 'Unknown error during async mapping',
                    itemIdentifier: identifier,
                    failedItem: item // Include the original item for context if needed
                };
            });

        executing.push(promise);
        results.push(promise); // Store the promise (which resolves to result or error object)

        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    // Use Promise.allSettled to ensure all promises resolve, even if some fail
    const settledResults = await Promise.allSettled(results);

    // Process settled results to return a consistent array (either success result or error object)
    return settledResults.map(result => {
        if (result.status === 'fulfilled') {
            return result.value; // This could be the successful mapper result OR the error object we created in .catch()
        } else {
            // This happens if the promise itself was rejected before our .catch() could handle it (less likely)
             console.error(`Unhandled rejection processing item in concurrentlyMap:`, result.reason);
             // Try to find the original item based on the reason (might be fragile)
             const failedItem = array.find(i => (i?.ingredient_id || i?.originalIngredient || i?.meal_id) === result.reason?.itemIdentifier);
            return {
                error: result.reason?.message || 'Unhandled rejection during async mapping',
                itemIdentifier: result.reason?.itemIdentifier || failedItem?.ingredient_id || failedItem?.originalIngredient || failedItem?.meal_id || 'unknown_rejection',
                failedItem: failedItem || null
            };
        }
    });
}


/**
 * Fetches data from a URL with retry logic for network errors and specific HTTP statuses (429, 5xx).
 * Accepts a log function for consistent logging.
 */
async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log(`Attempt ${attempt}: Fetching from ${url}`, 'DEBUG', 'HTTP');
            const response = await fetch(url, options);

            if (response.ok) return response; // Success

            // Check for retryable statuses
            if (response.status === 429 || response.status >= 500) {
                 log(`Attempt ${attempt}: Received retryable error ${response.status} from API. Retrying...`, 'WARN', 'HTTP');
                 // Throw an error specifically for 429 to allow distinct handling if needed upstream
                 if (response.status === 429) {
                     const rateLimitError = new Error(`API rate limit exceeded (429) on attempt ${attempt}.`);
                     rateLimitError.statusCode = 429;
                     rateLimitError.attempt = attempt;
                     throw rateLimitError;
                 }
            } else {
                // Non-retryable client error (4xx other than 429)
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from API.`, 'CRITICAL', 'HTTP', { body: errorBody });
                 // --- MODIFICATION (Mark 53): Include response body in error for 400 ---
                 const clientError = new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`);
                 clientError.statusCode = response.status;
                 clientError.errorBody = errorBody; // Attach body for inspection
                 throw clientError;
                 // --- END MODIFICATION ---
            }
        } catch (error) {
             // Handle specific 429 error re-thrown above
             if (error.statusCode === 429) {
                 log(`Attempt ${error.attempt}: API Rate Limit Hit (429). Retrying...`, 'WARN', 'HTTP_RETRY');
                 // Proceed to delay and retry logic below
             }
             // Handle generic network errors or errors from response.text()
             else if (error.statusCode !== 400 && !error.message?.startsWith('API call failed with client error')) { // Don't retry non-429 client errors
                log(`Attempt ${attempt}: Fetch failed for API with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
                console.error(`Fetch Error Details (Attempt ${attempt}):`, error);
            }
            // Non-retryable client error (like 400), re-throw immediately
            else {
                 throw error;
            }
        }
        // If we reached here, it was a retryable error (5xx, 429, or network issue)
        if (attempt < MAX_RETRIES) {
            // Exponential backoff
            const delayTime = Math.pow(2, attempt - 1) * 2000; // 2s, 4s
            log(`Waiting ${delayTime / 1000}s before next retry...`, 'INFO', 'HTTP_RETRY')
            await delay(delayTime);
        }
    }
    // If loop completes without success
    log(`API call failed definitively after ${MAX_RETRIES} attempts to ${url}.`, 'CRITICAL', 'HTTP');
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
    return price;
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

// --- Statistical Helper Functions ---
const mean = (arr) => arr.length > 0 ? arr.reduce((acc, val) => acc + val, 0) / arr.length : 0; // Guard against empty array
const stdev = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
};

/** Applies a price outlier guard */
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

// --- NEW (Mark 47): Helper functions for new checklist logic ---
function normTokens(s){
  if (typeof s !== 'string') return [];
  return s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
}
function hasAny(tokens, words){
  const set = new Set(tokens);
  return words.some(w => set.has(w));
}
function lemmaVariants(w){ // tiny stemmer for common food forms
  const base = w.toLowerCase();
  const forms = new Set([base]);
  if (base.endsWith('s')) forms.add(base.slice(0,-1));
  if (base.endsWith('ies')) forms.add(base.slice(0,-3)+'y');
  return [...forms];
}
function expandWords(words){
  const out = new Set();
  for (const w of words) for (const v of lemmaVariants(w)) out.add(v);
  return [...out];
}

// Category gating function
function categoryOK(product, ingredient_id, log) {
  const prodCat = (product.product_category || '').toLowerCase();
  if (!prodCat) {
      log(`Category Check [${ingredient_id || 'unknown_ing'}] for "${product.product_name}": PASS (Category missing)`, 'DEBUG', 'CHECKLIST_CAT');
      return true;
  }
  const logId = ingredient_id || 'unknown_ing';
  const checkLogPrefix = `Category Check [${logId}] for "${product.product_name}" (Cat: ${prodCat})`;

  switch(ingredient_id){
    case 'ing_olive_oil_spray':
    case 'ing_canola_oil_spray':
      if (!(prodCat.includes('oil') || prodCat.includes('spray') || prodCat.includes('pantry'))) {
        log(`${checkLogPrefix}: FAIL (Cat must include 'oil', 'spray', or 'pantry')`, 'DEBUG', 'CHECKLIST_CAT');
        return false;
      }
      return true;
    case 'ing_soy_sauce':
      if (!(prodCat.includes('sauce') || prodCat.includes('pantry') || prodCat.includes('asian'))) {
         log(`${checkLogPrefix}: FAIL (Cat must include 'sauce', 'pantry', or 'asian')`, 'DEBUG', 'CHECKLIST_CAT');
         return false;
      }
      return true;
    case 'ing_english_muffins':
      if (!(prodCat.includes('bakery') || prodCat.includes('bread'))) {
         log(`${checkLogPrefix}: FAIL (Cat must include 'bakery' or 'bread')`, 'DEBUG', 'CHECKLIST_CAT');
         return false;
      }
      return true;
    case 'ing_wholemeal_pasta':
    case 'ing_pasta_spaghetti': // Add generic pasta check
       if (!(prodCat.includes('pasta') || prodCat.includes('pantry'))) {
          log(`${checkLogPrefix}: FAIL (Cat must include 'pasta' or 'pantry')`, 'DEBUG', 'CHECKLIST_CAT');
          return false;
       }
       return true;
    default:
      // General check: Reject obvious non-food categories
      const genericBannedCats = ['health & beauty', 'household', 'baby', 'pet', 'tobacco'];
       if (genericBannedCats.some(banned => prodCat.includes(banned))) {
            log(`${checkLogPrefix}: FAIL (Generic Banned Category: "${prodCat}")`, 'DEBUG', 'CHECKLIST_CAT');
            return false;
       }
      return true;
  }
}

// Smarter Checklist function
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) return { pass: false, score: 0, reason: 'no_name' };

    const ingredient_id = ingredientData.ingredient_id;
    const logId = ingredient_id || ingredientData.originalIngredient;
    const { allowedCategories = [] } = ingredientData;
    const checkLogPrefix = `Checklist [${logId}] for "${product.product_name}"`;

    // 1. Category Gating (Hard-coded)
    if (!categoryOK(product, ingredient_id, log)) {
        return { pass: false, score: 0, reason: 'category_hard' };
    }

    // 2. Global Banned Keywords
    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0, reason: 'banned_global' };
    }

    // 3. Expanded Negative Keywords (AI + Hard-coded)
    const allNegativeKeywords = (ingredientData.negativeKeywords || []).concat(NEG_EXTRA[ingredient_id] || []);
    if (allNegativeKeywords.length > 0) {
        const negativeWordFound = allNegativeKeywords.find(kw => productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0, reason: 'negative_expanded' };
        }
    }

    // 4. Expanded Required Words (Hard-coded Override OR AI Default)
    const wordsToUse = REQ_ANY[ingredient_id] || ingredientData.requiredWords || [];
    const expandedRequired = expandWords(wordsToUse);
    const titleTokens = normTokens(productNameLower);

    if (expandedRequired.length > 0 && !hasAny(titleTokens, expandedRequired)) {
         log(`${checkLogPrefix}: FAIL (RequiredWord-ANY: Tokens [${titleTokens.join(', ')}] did not match any of [${expandedRequired.join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0, reason: 'required_any' };
    }

    // 5. AI-defined Allowed Categories (Soft-check)
    const productCategory = product.product_category?.toLowerCase() || '';
    if (productCategory && allowedCategories && allowedCategories.length > 0) {
        const hasCategoryMatch = allowedCategories.some(allowedCat => productCategory.includes(allowedCat.toLowerCase()));
        if (!hasCategoryMatch) {
            log(`${checkLogPrefix}: FAIL (Category Mismatch: Product category "${productCategory}" not in AI allowlist [${allowedCategories.join(', ')}])`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0, reason: 'category_ai' };
        }
    }

    // 6. Pass
    log(`${checkLogPrefix}: PASS (Checks passed)`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: 1.0 };
}


function isCreativePrompt(cuisinePrompt) {
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false;
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'british', 'german', 'russian', 'brazilian', 'caribbean', 'african', 'middle eastern', 'spicy', 'mild', 'sweet', 'sour', 'savoury', 'quick', 'easy', 'simple', 'fast', 'budget', 'cheap', 'healthy', 'low carb', 'keto', 'low fat', 'high protein', 'high fiber', 'vegetarian', 'vegan', 'gluten free', 'dairy free', 'pescatarian', 'paleo'];
    const promptLower = cuisinePrompt.toLowerCase().trim();
    if (simpleKeywords.some(kw => promptLower === kw)) return false;
    if (promptLower.startsWith("high ") || promptLower.startsWith("low ")) return false;
    return cuisinePrompt.length > 30 || cuisinePrompt.includes(' like ') || cuisinePrompt.includes(' inspired by ') || cuisinePrompt.includes(' themed ');
}

// --- NEW (Mark 52): Helper to calculate macros from a solution array ---
/**
 * Calculates total macros for a given meal solution.
 * @param {Array} solution - Array of { ingredient_id, grams }.
 * @param {Object} nutritionDataMap - Map of nutrition data keyed by ingredient_id.
 * @returns {Object} - { calories, protein, fat, carbs }
 */
function calculateMacrosFromSolution(solution, nutritionDataMap) {
    let calories = 0, protein = 0, fat = 0, carbs = 0;
    if (!solution || !Array.isArray(solution)) {
        return { calories, protein, fat, carbs };
    }
    solution.forEach(item => {
        const id = item.ingredient_id;
        const grams = item.grams;
        if (grams > 0) {
            const nutrition = nutritionDataMap[id]?.per_g;
            if (nutrition) {
                calories += (nutrition.kcal || 0) * grams;
                protein += (nutrition.p || 0) * grams;
                fat += (nutrition.f || 0) * grams;
                carbs += (nutrition.c || 0) * grams;
            }
        }
    });
    // Return rounded values
    return {
        calories: Math.round(calories),
        protein: Math.round(protein),
        fat: Math.round(fat),
        carbs: Math.round(carbs)
    };
}
// --- END NEW HELPER ---


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
                // Ensure data is serializable, convert non-serializable types to string
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    typeof value === 'object' && value !== null ? value : String(value) // Convert primitives/functions to string
                )) : null
            };
            logs.push(logEntry);
            // Optionally log to console as well
            console.log(`[${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
             if (data && (level === 'ERROR' || level === 'CRITICAL' || level === 'WARN')) {
                 // Log complex data only for errors/warnings to reduce noise
                 console.warn("Log Data:", JSON.stringify(data, null, 2));
             }
            return logEntry;
        } catch (error) {
            // Fallback logging if serialization fails
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
    // Set CORS headers
    response.setHeader('Access-Control-Allow-Origin', '*'); // Allow any origin
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Add any other headers your frontend sends

    // Handle OPTIONS pre-flight request for CORS
    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP');
        return response.status(200).end();
    }

    // Ensure it's a POST request
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        response.setHeader('Allow', 'POST, OPTIONS');
        return response.status(405).json({ message: `Method ${request.method} Not Allowed.` });
    }

    // --- Main Logic ---
    try {
        // Validate request body
        if (!request.body) {
            log("Orchestrator fail: Received empty request body.", 'CRITICAL', 'SYSTEM');
            throw new Error("Request body is missing or invalid.");
        }
        const formData = request.body;
        const { store, cuisine, days, goal, weight, eatingOccasions } = formData; // Destructure required fields

        // Core data validation
        if (!store || !days || !goal || isNaN(parseFloat(formData.weight)) || isNaN(parseFloat(formData.height))) {
             log("CRITICAL: Missing core form data (store, days, goal, weight, or height). Cannot calculate plan.", 'CRITICAL', 'INPUT', getSanitizedFormData(formData));
             throw new Error("Missing critical profile data required for plan generation (store, days, goal, weight, height).");
        }

        const numDays = parseInt(days, 10);
        if (isNaN(numDays) || numDays < 1 || numDays > 7) {
             log(`Invalid number of days: ${days}. Proceeding with default 1.`, 'WARN', 'INPUT');
             // Consider setting numDays = 1 here if needed, or rely on AI to handle
        }
        const weightKg = parseFloat(weight);

        // --- Phase 1: Creative Router ---
        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) {
            log(`Creative prompt detected: "${cuisine}". Calling Creative AI...`, 'INFO', 'LLM');
            creativeIdeas = await generateCreativeIdeas(cuisine, log); // Call helper
        } else {
            log("Simple prompt. Skipping Creative AI.", 'INFO', 'SYSTEM');
        }

        // --- Phase 2: Technical Blueprint ---
        log("Phase 2: Technical Blueprint...", 'INFO', 'PHASE');
        // Calculate Nutritional Targets
        const calorieTarget = calculateCalorieTarget(formData, log); // Pass full form data
        log(`Calculated daily calorie target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        const { proteinGrams, fatGrams, carbGrams } = calculateMacroTargets(calorieTarget, goal, weightKg, log); // Use goal and weight
        const dailyNutritionalTargets = { calories: calorieTarget, protein: proteinGrams, fat: fatGrams, carbs: carbGrams };

        // --- AI Phase 1 (Idea Chef) ---
        log(`AI Phase 1: Generating Ideas & Structured Plan...`, 'INFO', 'PHASE');
        let llmResult = null;
        let blueprintRetries = 0;
        const MAX_BLUEPRINT_RETRIES = 2; // Allow 1 retry

        // --- MODIFICATION (Mark 53): Added Retry Loop for AI Phase 1 Validation ---
        while (blueprintRetries <= MAX_BLUEPRINT_RETRIES) {
            try {
                llmResult = await generateLLMPlanAndMeals_Phase1(formData, dailyNutritionalTargets, creativeIdeas, log); // Call API

                // --- Validation Check (Moved inside try block) ---
                // Check if result exists, has arrays, arrays are not empty, and don't contain placeholders
                if (llmResult &&
                    Array.isArray(llmResult.ingredients) && llmResult.ingredients.length > 0 && !(String(llmResult.ingredients[0]).startsWith('@@')) &&
                    Array.isArray(llmResult.mealPlan) && llmResult.mealPlan.length > 0 && !(String(llmResult.mealPlan[0]).startsWith('@@')) &&
                    llmResult.mealPlan[0].meals && Array.isArray(llmResult.mealPlan[0].meals) && llmResult.mealPlan[0].meals.length > 0)
                {
                    log(`AI Phase 1 validation passed (Attempt ${blueprintRetries + 1}).`, 'INFO', 'LLM_VALIDATION');
                    break; // Exit loop on successful validation
                } else {
                    // Log specific validation failure reason
                    let validationError = "AI Phase 1 returned invalid structure.";
                    if (!llmResult || !Array.isArray(llmResult.ingredients) || !Array.isArray(llmResult.mealPlan)) validationError = "Missing ingredients or mealPlan array.";
                    else if (llmResult.ingredients.length === 0 || llmResult.mealPlan.length === 0) validationError = "Ingredients or mealPlan array is empty.";
                    else if (String(llmResult.ingredients[0]).startsWith('@@') || String(llmResult.mealPlan[0]).startsWith('@@')) validationError = "Response contained placeholder data ('@@...@@').";
                    else if (!llmResult.mealPlan[0].meals || !Array.isArray(llmResult.mealPlan[0].meals) || llmResult.mealPlan[0].meals.length === 0) validationError = "MealPlan day 1 is missing valid 'meals' array.";
                    log(validationError, 'WARN', 'LLM_VALIDATION', { llmResultSnippet: JSON.stringify(llmResult)?.substring(0, 500) });
                    throw new Error(validationError); // Throw validation error to trigger retry
                }
            } catch (error) {
                log(`AI Phase 1 FAILED (Attempt ${blueprintRetries + 1}/${MAX_BLUEPRINT_RETRIES + 1}): ${error.message}`, 'WARN', 'LLM', { errorData: error, llmResult });
                blueprintRetries++; // Increment retry counter
                if (blueprintRetries > MAX_BLUEPRINT_RETRIES) {
                    // If retries exceeded, throw final error
                    log("AI Phase 1 failed definitively after retries.", 'CRITICAL', 'LLM');
                    // --- MODIFICATION (Mark 53): Include Gemini 400 body in final error if available ---
                    let finalErrorMessage = `Blueprint fail: AI Phase 1 failed after ${MAX_BLUEPRINT_RETRIES + 1} attempts. Last error: ${error.message}`;
                    if (error.statusCode === 400 && error.errorBody) {
                        finalErrorMessage += ` | API Error Body: ${error.errorBody.substring(0, 500)}`; // Add snippet of 400 error body
                    }
                    throw new Error(finalErrorMessage);
                    // --- END MODIFICATION ---
                }
                log(`Retrying AI Phase 1 after a short delay...`, 'INFO', 'LLM_RETRY');
                await delay(2000); // Wait 2 seconds before retrying
            }
        }
        // --- End Retry Loop ---


        // Destructure validated result
        const { ingredients: rawIngredientPlan, mealPlan: structuredMealPlan } = llmResult; // llmResult is now guaranteed to be valid if we didn't throw

        // Sanitize ingredients (Filter out entries missing essential fields)
        const ingredientPlan = rawIngredientPlan.filter(ing => ing && ing.ingredient_id && ing.originalIngredient && ing.normalQuery && ing.nutritionQuery && ing.requiredWords && ing.negativeKeywords);
        if (ingredientPlan.length !== rawIngredientPlan.length) {
            log(`Sanitized ingredient list: removed ${rawIngredientPlan.length - ingredientPlan.length} invalid entries (missing required fields).`, 'WARN', 'DATA');
        }
        // Ensure we still have ingredients after sanitization
        if (ingredientPlan.length === 0) {
            log("Blueprint fail: All ingredients failed sanitization.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint fail: AI returned invalid ingredient data after sanitization.");
        }

        // Create ingredient map for easy lookup by ID
        const ingredientMapById = ingredientPlan.reduce((map, ing) => {
            map[ing.ingredient_id] = ing;
            return map;
        }, {});

        log(`AI Phase 1 success: ${ingredientPlan.length} valid ingredients, ${structuredMealPlan.length} day(s) in meal plan.`, 'SUCCESS', 'PHASE');
        ingredientPlan.forEach((ing, index) => {
            log(`AI Ingredient ${index + 1}: ${ing.ingredient_id} (${ing.originalIngredient})`, 'DEBUG', 'DATA', ing);
        });

        // --- Execute Phases 3 & 4 (Market Run & Nutrition Fetch) ---
        const { finalResults, nutritionDataMap } = await executeMarketAndNutrition(ingredientPlan, numDays, store, log);

        // --- Phase 5 (Solver) & Phase 6 (AI Food Writer) ---
        log("Phase 5 & 6: Running Solver and AI Food Writer...", 'INFO', 'PHASE');
        const { finalMealPlanWithSolution, finalIngredientTotals, solvedDailyTotals: actualSolvedDailyTotals } = await solveAndDescribePlan(
            structuredMealPlan, // The structured plan from AI Phase 1
            finalResults,       // The market data
            nutritionDataMap,   // The map of verified nutrition data (keyed by ingredient_id)
            ingredientMapById,  // Map to get display names
            log
        );

        // Update finalResults with solved grams (using ingredient_id join)
        for (const ingredientId in finalIngredientTotals) {
             const originalIngredientName = ingredientMapById[ingredientId]?.originalIngredient || ingredientId;
            if (finalResults[originalIngredientName]) { // finalResults is still keyed by original name from Market Run
                finalResults[originalIngredientName].totalGramsRequired = finalIngredientTotals[ingredientId].totalGrams;
                finalResults[originalIngredientName].quantityUnits = finalIngredientTotals[ingredientId].quantityUnits;
            } else {
                log(`Solver calculated grams for "${ingredientId}" (${originalIngredientName}), but its original name wasn't found in Market Results. Adding dummy entry.`, 'WARN', 'SOLVER');
                 // Add a basic entry for frontend display if market run failed completely for an item but solver used it (e.g., via hardcoded nutrition)
                 finalResults[originalIngredientName] = { // Add using name for frontend key
                      ingredient_id: ingredientId, // Keep ID for reference
                      originalIngredient: originalIngredientName,
                      source: 'solver_only', // Indicate it only has solver data
                      totalGramsRequired: finalIngredientTotals[ingredientId].totalGrams,
                      quantityUnits: finalIngredientTotals[ingredientId].quantityUnits,
                      allProducts: [], // No market data
                      currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url,
                      searchAttempts: [] // No search attempts if market run missed it
                 };
            }
        }

        // --- Phase 7: Assembling Final Response ---
        log("Phase 7: Final Response...", 'INFO', 'PHASE');
        const finalResponseData = {
            mealPlan: finalMealPlanWithSolution,
            // Provide ingredients with category for frontend grouping
            uniqueIngredients: ingredientPlan.map(({ ingredient_id, originalIngredient, category }) => ({
                 ingredient_id,
                 originalIngredient,
                 category: category || 'Uncategorized', // Ensure category exists
             })),
            results: finalResults, // The market data + solved gram totals (keyed by original name)
            nutritionalTargets: actualSolvedDailyTotals // The *correctly* calculated solved averages
        };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        // Send the complete response including logs
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        // Catch any unhandled errors during the process
        log(`CRITICAL Orchestrator ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) }); // Log stack trace snippet
        console.error("ORCHESTRATOR UNHANDLED ERROR:", error);
        // Return a generic error response, including logs collected so far
        return response.status(500).json({ message: "An unrecoverable server error occurred during plan generation.", error: error.message, logs });
    }
}
// --- END MAIN HANDLER ---


/**
 * Helper to run Market & Nutrition phases (Phases 3 & 4).
 * @param {Array} ingredientPlan - The FULL ingredient list from the LLM.
 * @returns {Object} - { finalResults, nutritionDataMap }
 */
async function executeMarketAndNutrition(ingredientPlan, numDays, store, log) {

    // --- Phase 3: Market Run (Parallel & Optimized) ---
    log("Phase 3: Parallel Market Run...", 'INFO', 'PHASE');

    const processSingleIngredientOptimized = async (ingredient) => {
        try {
            const ingredientKey = ingredient.originalIngredient;
            const ingredientId = ingredient.ingredient_id;
            // Initialize result structure
            const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
            let foundProduct = null;
            let bestScoreSoFar = -1;
            const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];
            let bucketWaitMs = 0;

            for (const [index, { type, query }] of queriesToTry.entries()) {
                // Skip if query is missing
                if (!query) { result.searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0}); continue; }

                log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
                // Fetch price data using cache-wrapped function
                const { data: priceData, waitMs: currentWaitMs } = await fetchPriceData(store, query, 1, log);
                bucketWaitMs = Math.max(bucketWaitMs, currentWaitMs); // Track max wait time
                // Log search attempt details
                result.searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0, rawCount: 0, bestScore: 0});
                const currentAttemptLog = result.searchAttempts.at(-1);

                // Handle fetch errors
                if (priceData.error) {
                    log(`[${ingredientKey}] Fetch failed (${type}): ${priceData.error.message}`, 'WARN', 'HTTP', { status: priceData.error.status });
                    currentAttemptLog.status = 'fetch_error';
                    continue; // Try next query if fetch fails
                }

                // Process results
                const rawProducts = priceData.results || [];
                currentAttemptLog.rawCount = rawProducts.length;
                const validProductsOnPage = [];
                let pageBestScore = -1;

                // Validate each product
                for (const rawProduct of rawProducts) {
                    // --- Run checklist ---
                    const checklistResult = runSmarterChecklist(rawProduct, ingredient, log);
                    if (checklistResult.pass) {
                        // Calculate unit price and validate
                        const unitPrice = calculateUnitPrice(rawProduct.current_price, rawProduct.product_size);
                        if (unitPrice > 0 && unitPrice < 1000) { // Basic sanity check on price/100 units
                             validProductsOnPage.push({
                                 product: { // Structure the product object
                                     name: rawProduct.product_name, brand: rawProduct.product_brand,
                                     price: rawProduct.current_price, size: rawProduct.product_size,
                                     url: rawProduct.url, barcode: rawProduct.barcode,
                                     unit_price_per_100: unitPrice
                                 },
                                 score: checklistResult.score // Keep score if needed later
                             });
                             pageBestScore = Math.max(pageBestScore, checklistResult.score);
                        } else {
                            log(`[${ingredientKey}] Rejecting product "${rawProduct.product_name}" due to invalid calculated unit price: ${unitPrice}`, 'WARN', 'DATA_VALIDATION');
                        }
                    }
                }

                // Apply price outlier guard
                const filteredProducts = applyPriceOutlierGuard(validProductsOnPage, log, ingredientKey);
                currentAttemptLog.foundCount = filteredProducts.length;
                currentAttemptLog.bestScore = pageBestScore;

                // If valid products found
                if (filteredProducts.length > 0) {
                    log(`[${ingredientKey}] Found ${filteredProducts.length} valid products (${type}, Best Score: ${pageBestScore.toFixed(2)}).`, 'INFO', 'DATA');
                    // Add new unique products to the list
                    const currentUrls = new Set(result.allProducts.map(p => p.url));
                    filteredProducts.forEach(vp => { if (!currentUrls.has(vp.product.url)) { result.allProducts.push(vp.product); currentUrls.add(vp.product.url); } });

                    // Re-select the cheapest from the combined list after each successful query type
                    if (result.allProducts.length > 0) {
                        foundProduct = result.allProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, result.allProducts[0]);
                        result.currentSelectionURL = foundProduct.url;
                        result.source = 'discovery'; // Mark as successfully found
                        currentAttemptLog.status = 'success';
                        bestScoreSoFar = Math.max(bestScoreSoFar, pageBestScore);

                        // Log Telemetry (Can be adjusted based on needs)
                        let priceZ = null;
                         if (result.allProducts.length >= 3 && foundProduct.unit_price_per_100 > 0) {
                            const prices = result.allProducts.map(p => p.unit_price_per_100).filter(p => p > 0);
                            if (prices.length >= 2) {
                                const m = mean(prices);
                                const s = stdev(prices);
                                priceZ = (s > 0) ? ((foundProduct.unit_price_per_100 - m) / s) : 0;
                            }
                        }
                         log(`[${ingredientKey}] Success Telemetry`, 'INFO', 'LADDER_TELEMETRY', {
                             ingredientKey: ingredientKey,
                             accepted_query_idx: index, // Which query type succeeded
                             accepted_query_type: type,
                             pages_touched: 1, // Assume 1 page for now
                             kept_count: result.allProducts.length,
                             price_z: priceZ !== null ? parseFloat(priceZ.toFixed(2)) : null,
                             mode: 'exhaustive', // Indicate all queries were tried
                             bucket_wait_ms: bucketWaitMs
                         });

                        // Check skip heuristic only after tight query
                        if (type === 'tight' && bestScoreSoFar >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                            log(`[${ingredientKey}] Skip heuristic hit (Tight query score ${bestScoreSoFar.toFixed(2)} >= ${SKIP_HEURISTIC_SCORE_THRESHOLD}). Skipping normal/wide.`, 'INFO', 'MARKET_RUN');
                            break; // Stop trying queries for this ingredient
                        }
                    } else {
                        // Should not happen if filteredProducts.length > 0, but safety check
                        currentAttemptLog.status = 'filter_error';
                         log(`[${ingredientKey}] Internal Error: Filtered products found, but allProducts list is empty.`, 'ERROR', 'MARKET_RUN');
                    }
                } else {
                    log(`[${ingredientKey}] No valid products found for "${type}" query after filtering.`, 'WARN', 'DATA');
                    currentAttemptLog.status = 'no_match';
                }
            } // End query loop

            // Log definitive failure if source is still 'failed'
            if (result.source === 'failed') { log(`[${ingredientKey}] Definitive market run fail after trying all queries.`, 'WARN', 'MARKET_RUN'); }
            // Return result keyed by originalIngredient name
            return { [ingredientKey]: { ...result, ingredient_id: ingredientId } };

        } catch(e) {
            // Catch unexpected errors during processing
            log(`CRITICAL Error processing single ingredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
             // Return an error object keyed by originalIngredient name
            return { [ingredient?.originalIngredient || 'unknown_error_item']: { ...(ingredient || {}), source: 'error', error: e.message, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: e.message}] } };
        }
    }; // End processSingleIngredientOptimized

    // --- Execute Market Run Concurrently ---
    log(`Market Run: ${ingredientPlan.length} ingredients, Concurrency K=${MAX_MARKET_RUN_CONCURRENCY}...`, 'INFO', 'MARKET_RUN');
    const startMarketTime = Date.now();
    // Use concurrentlyMap to manage parallel execution
    const parallelResultsArray = await concurrentlyMap(ingredientPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
    const endMarketTime = Date.now();
    log(`Market Run parallel execution took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

    // --- Aggregate Results ---
    // Reduce the array of results back into a single object keyed by originalIngredient name
    const finalResults = parallelResultsArray.reduce((acc, currentResult) => {
        // Handle potential errors returned by concurrentlyMap itself
        if (!currentResult) { log(`Received null/undefined result from concurrentlyMap`, 'ERROR', 'SYSTEM'); return acc; }
        if (currentResult.error && currentResult.itemIdentifier) {
            const id = currentResult.itemIdentifier;
            // Try to find the original name using the identifier (which could be ingredient_id)
            const originalName = ingredientPlan.find(i => i.ingredient_id === id)?.originalIngredient || id;
            log(`ConcurrentlyMap Error processing item "${id}": ${currentResult.error}`, 'CRITICAL', 'MARKET_RUN');
            const failedIngredientData = ingredientPlan.find(i => i.ingredient_id === id);
            // Add error entry to accumulator
            acc[originalName] = { ...(failedIngredientData || { originalIngredient: originalName, ingredient_id: id }), source: 'error', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: currentResult.error}] };
            return acc;
        }
        // Handle processing errors within processSingleIngredientOptimized (already formatted)
        const ingredientKey = Object.keys(currentResult)[0]; // Should be originalIngredient name
        if(ingredientKey && currentResult[ingredientKey]?.source === 'error') {
            log(`Processing Error occurred for "${ingredientKey}": ${currentResult[ingredientKey].error}`, 'CRITICAL', 'MARKET_RUN');
            // Ensure error structure is consistent
            const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === ingredientKey);
            acc[ingredientKey] = { ...(failedIngredientData || { originalIngredient: ingredientKey }), source: 'error', error: currentResult[ingredientKey].error, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: currentResult[ingredientKey].error}] };
            return acc;
        }
        // Add successful result to accumulator
        return { ...acc, ...currentResult };
    }, {});


    log("Market Run complete.", 'SUCCESS', 'PHASE');


    // --- Phase 4: Nutrition Calculation ---
    log("Phase 4: Nutrition Calculation...", 'INFO', 'PHASE');
    const nutritionDataMap = {}; // Key: ingredient_id, Value: { per_g: {...}, source: '...', category: '...' }
    const itemsToFetchNutrition = [];

    // Identify ingredients needing nutrition lookup
    for (const ingredient of ingredientPlan) {
        const key = ingredient.originalIngredient; // Key for finalResults lookup
        const id = ingredient.ingredient_id; // ID for nutritionDataMap
        const result = finalResults[key]; // Get market result using name

        // Check if market run found the item
        if (result && result.source === 'discovery') {
            const selected = result.allProducts?.find(p => p.url === result.currentSelectionURL);
            const barcodeToUse = selected?.barcode;
            const queryToUse = ingredient.nutritionQuery; // Use the AI-generated generic query

            // Need either a barcode or a query to proceed
            if (barcodeToUse || queryToUse) {
                 itemsToFetchNutrition.push({
                     ingredient_id: id, // Pass ID
                     ingredientKey: key, // Pass original name (for logging/result mapping)
                     barcode: barcodeToUse,
                     query: queryToUse
                 });
            } else {
                 log(`[${key}/${id}] Cannot fetch nutrition: Missing both barcode and nutritionQuery.`, 'WARN', 'NUTRITION');
            }
        } else if (result && (result.source === 'failed' || result.source === 'error')) {
            // Log if market run failed for this item
            log(`[${key}/${id}] Market Run failed or errored, cannot fetch nutrition.`, 'WARN', 'MARKET_RUN');
        } else if (!result) {
            // Log if ingredient is somehow missing from market results
            log(`[${key}/${id}] Ingredient missing from Market Run results. Cannot fetch nutrition.`, 'WARN', 'DATA');
        }
    }

    // --- Fetch Nutrition Concurrently ---
    if (itemsToFetchNutrition.length > 0) {
        log(`Fetching/Calculating nutrition for ${itemsToFetchNutrition.length} ingredients (Concurrency K=${MAX_NUTRITION_CONCURRENCY})...`, 'INFO', 'HTTP');
        // Use concurrentlyMap for parallel nutrition fetching
        const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, (item) =>
            fetchNutritionData(item.barcode, item.query, log) // Calls cache-wrapped function (OFF -> USDA)
                .then(nut => ({ ...item, nut })) // Attach result to item info
                .catch(err => { // Catch unexpected errors during fetchNutritionData call itself
                    log(`Unhandled Nutri fetch error for "${item.ingredient_id}" (Query: ${item.query}): ${err.message}`, 'CRITICAL', 'HTTP');
                    return { ...item, nut: { status: 'not_found', error: 'Unhandled fetch error' } }; // Return error structure
                })
        );

        log("Nutrition fetch/calc complete.", 'SUCCESS', 'HTTP');

        // --- Process Nutrition Results ---
        nutritionResults.forEach(item => {
             // Handle potential errors from concurrentlyMap
             if (item.error && item.itemIdentifier) {
                log(`Skipping nutrition mapping for "${item.itemIdentifier}" due to concurrentlyMap error: ${item.error}`, 'ERROR', 'NUTRITION');
                return; // Skip this item
             }

            const id = item.ingredient_id;
            // Check if nutrition data was found successfully
            if (item.nut?.status === 'found') {
                // Store nutrition data per gram, keyed by ID
                nutritionDataMap[id] = {
                    per_g: { // Calculate per-gram values
                        kcal: (item.nut.calories || 0) / 100,
                        p: (item.nut.protein || 0) / 100,
                        f: (item.nut.fat || 0) / 100,
                        c: (item.nut.carbs || 0) / 100,
                    },
                    source: item.nut.source || 'unknown', // Track source (openfoodfacts, usda)
                    category: ingredientPlan.find(i => i.ingredient_id === id)?.category || 'default' // Store category if available
                };
                 log(`Nutrition found for "${id}" (Source: ${item.nut.source}, Method: ${item.barcode ? 'barcode' : `query '${item.query}'`})`, 'INFO', 'NUTRITION');
            } else {
                 // Log failure if nutrition wasn't found
                 log(`No nutrition data found for "${id}" (Tried: ${item.barcode ? `barcode ${item.barcode}` : ''}${item.barcode && item.query ? ' & ' : ''}${item.query ? `query '${item.query}'` : ''}). Excluded from solver.`, 'WARN', 'NUTRITION');
            }

            // --- Attach full nutrition result back to the selected product in finalResults ---
            // This allows frontend to display detailed nutrition if needed
            const result = finalResults[item.ingredientKey]; // Find result by original name
             if (result && result.allProducts && result.currentSelectionURL) {
                 const selectedProduct = result.allProducts.find(p => p.url === result.currentSelectionURL);
                 if (selectedProduct) {
                     selectedProduct.nutrition = item.nut; // Attach the raw nutrition object (found or not_found)
                 }
             }
        });

        log("Nutrition data mapped by ingredient_id.", 'INFO', 'CALC');

    } else {
        log("No valid ingredients required nutrition calculation.", 'WARN', 'CALC');
    }

    // Return the aggregated market results and the nutrition map
    return { finalResults, nutritionDataMap };
};
// --- END OF executeMarketAndNutrition HELPER ---


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


async function generateCreativeIdeas(cuisinePrompt, log) {
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    // Simple prompt for creative ideas
    const sysPrompt = `You are a creative chef. Given a cuisine theme, provide a comma-separated list of 5-10 evocative keywords, dishes, or specific ingredients related to that theme. Be concise.`;
    const userQuery = `Theme: "${cuisinePrompt}". Generate related keywords/dishes/ingredients.`;
    log("Creative Prompt", 'INFO', 'LLM_PROMPT', { userQuery });
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: sysPrompt }] } };
    try {
        const res = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(payload) }, log);
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string' || text.length === 0) {
            log("Creative AI returned non-string or empty text.", 'WARN', 'LLM', { result });
            throw new Error("Creative AI returned empty or invalid text.");
        }
        log("Creative Raw Response", 'INFO', 'LLM', { raw: text.substring(0, 500) }); // Log snippet
        return text.trim(); // Return the trimmed text
    } catch (e) {
        log(`Creative AI call failed: ${e.message}`, 'CRITICAL', 'LLM');
        return ""; // Return empty string on failure
    }
}

// --- Updated AI Phase 1 prompt (Mark 50) & Schema (Mark 53) ---
async function generateLLMPlanAndMeals_Phase1(formData, dailyNutritionalTargets, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    // Map priorities to instructions
    const costInstruction = {'Extreme Budget':"Focus STRICTLY on the absolute lowest cost items available.",'Quality Focus':"Prioritize higher quality or organic options where reasonable, budget permitting.",'Best Value':"Balance cost and quality, avoiding premium brands unless necessary."}[costPriority]||"Balance cost and quality.";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2; // Max times a meal title can repeat
    // Construct cuisine instruction
    const cuisineInstruction = creativeIdeas ? `Incorporate elements from these creative ideas: ${creativeIdeas}` : (cuisine && cuisine.trim() ? `Focus on ${cuisine} cuisine style.` : 'Use a neutral/varied cuisine profile.');
    // Note for Australian terms if applicable
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian grocery terms." : "";

    // --- System Prompt ---
    // Refined instructions for clarity, tolerances, min_g, and nutritionQuery
    const systemPrompt = `You are an expert dietitian, chef, and grocery query optimizer specializing in ${store}.
RULES:
1.  **Output Structure:** Generate a JSON object with two top-level keys: "ingredients" (array) and "mealPlan" (array).
2.  **Ingredients Array:** For EACH unique ingredient needed:
    * "originalIngredient": Full descriptive name (e.g., "Boneless Skinless Chicken Breast", "Frozen Mixed Vegetables (Peas, Corn, Carrots)").
    * "ingredient_id": A UNIQUE, consistent slug-style ID (e.g., "ing_chicken_breast", "ing_frozen_veg_mix"). Use ONLY this ID for linking within the mealPlan.
    * "tightQuery": Hyper-specific search query, prefixed with store name (e.g., "${store} RSPCA Approved Chicken Breast Fillets Value Pack").
    * "normalQuery": 2-3 CORE GENERIC WORDS ONLY, prefixed with store name. NO modifiers (brands, sizes, forms like diced/shredded/spray, fat %, prep like canned). Example: "${store} chicken breast", "${store} rolled oats".${australianTermNote}
    * "wideQuery": 1-2 broad words, prefixed with store name (e.g., "${store} chicken", "${store} oats").
    * "nutritionQuery": 1-2 CORE GENERIC WORDS ONLY, *NO store prefix*. For generic nutrition lookup. Be specific if form matters (e.g., "chicken breast fillet", "rolled oats", "canola oil spray" - include 'spray'!).
    * "requiredWords": Array[1-3] lowercase core nouns/synonyms critical for identification (e.g., ["chicken", "breast"], ["oats"], ["spinach"], ["egg", "eggs"], ["tomato", "tomatoes"]).
    * "negativeKeywords": Array[1-5] lowercase words to EXCLUDE (e.g., ["thigh", "wings"], ["instant", "quick"], ["oil", "flavored"]).
    * "category" (Optional): Broad grocery category (e.g., "Poultry", "Pantry", "Produce", "Frozen").
    * "allowedCategories" (Optional): Array of lowercase store categories if known (e.g., ["meat & seafood", "poultry"]).
3.  **Meal Plan Array:** Array of day objects. Each day object:
    * "day_id": Simple day identifier as a STRING (e.g., "1", "2", "3").
    * "meals": Array of meal objects for the day. Each meal object:
        * "meal_id": UNIQUE slug (e.g., "d1_m1_oats", "d1_m2_chicken_rice").
        * "title": Appealing, descriptive meal name.
        * "type": Meal type code: 'B' (Breakfast), 'L' (Lunch), 'D' (Dinner), 'S1' (Snack 1), 'S2' (Snack 2).
        * "targets": {'kcal': INT, 'p': INT, 'c': INT, 'f': INT}. Distribute the daily macro targets based APPROXIMATELY on meal type (e.g., B=20%, L=30%, D=30%, S=10% each). Sum should be close to daily target.
        * "tol" (Tolerances): {'kcal': INT, 'p': INT, 'c': INT, 'f': INT}. Set reasonable ± tolerances around targets. **IMPORTANT: For simple snack meals (S1, S2) OR meals with 2 or fewer ingredients, use WIDER tolerances** (e.g., kcal±100, p±15, c±25, f±15) to increase solver feasibility. Standard meals: kcal±50, p±10, c±15, f±10.
        * "items": Array of ingredient objects for THIS meal:
            * "ingredient_id": The ID from the main "ingredients" list.
            * "display_name": The "originalIngredient" name (for UI display only).
            * "min_g": Sensible CULINARY MINIMUM grams (e.g., 50g tomatoes for sauce, 5g garlic, 1g oil spray, 100g main protein). **DO NOT default min_g to 0** for core recipe components.
            * "max_g": Reasonable maximum grams (e.g., 500g). Must be >= min_g.
4.  **Variety:** Ensure meal titles do not repeat more than ${maxRepetitions} times across the plan. Provide variety, especially if mealVariety is 'Balanced' or 'Low'.
5.  **Consistency:** EVERY "ingredient_id" used in "mealPlan.items" MUST exist in the main "ingredients" list.
6.  **Adherence:** Follow the JSON structure and constraints strictly. Do NOT use placeholders like "@@VALUE@@".`;

    // --- User Query ---
    const userQuery = `Generate a ${days}-day meal plan for ${name||'Guest'}.
Profile: ${age} years old ${gender}, ${height}cm, ${weight}kg.
Activity Level: ${formData.activityLevel}.
Goal: ${goal}.
Store: ${store}.
Daily Nutritional Target: Approx ${dailyNutritionalTargets.calories} kcal (Protein ~${dailyNutritionalTargets.protein}g, Fat ~${dailyNutritionalTargets.fat}g, Carbs ~${dailyNutritionalTargets.carbs}g).
Dietary Preferences: ${dietary}.
Meals Per Day: ${eatingOccasions}.
Spending Priority: ${costPriority} (${costInstruction}).
Meal Variety (Max Repetitions): ${mealVariety} (${maxRepetitions}).
Cuisine Profile: ${cuisineInstruction}.

Return ONLY the valid JSON object matching the schema provided in the system instructions. Ensure all constraints (min_g, tolerances, linking IDs, variety) are met.`;

    // Basic check for empty query
    if (userQuery.trim().length < 50) { // Arbitrary length check
        log("Critical Input Failure: User query appears too short or invalid after construction.", 'CRITICAL', 'LLM_PAYLOAD', { userQuery: userQuery, sanitizedData: getSanitizedFormData(formData) });
        throw new Error("Cannot generate plan: Invalid input data resulted in an unexpectedly short prompt.");
    }

    log("Technical Prompt (Phase 1)", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...', sanitizedData: getSanitizedFormData(formData) });

    // --- API Payload ---
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "ingredients": {
                        type: "ARRAY", items: {
                            type: "OBJECT", properties: {
                                "ingredient_id": { type: "STRING" }, "originalIngredient": { type: "STRING" },
                                "category": { type: "STRING", nullable: true }, "tightQuery": { type: "STRING", nullable: true },
                                "normalQuery": { type: "STRING" }, "wideQuery": { type: "STRING", nullable: true },
                                "nutritionQuery": { type: "STRING" }, "requiredWords": { type: "ARRAY", items: { type: "STRING" } },
                                "negativeKeywords": { type: "ARRAY", items: { type: "STRING" } },
                                "allowedCategories": { type: "ARRAY", items: { type: "STRING" }, nullable: true }
                            }, required: ["ingredient_id", "originalIngredient", "normalQuery", "nutritionQuery", "requiredWords", "negativeKeywords"]
                        }
                    },
                    "mealPlan": {
                        type: "ARRAY", items: {
                            type: "OBJECT", properties: {
                                // --- MODIFICATION (Mark 53): Changed type to STRING ---
                                "day_id": { type: "STRING" },
                                // --- END MODIFICATION ---
                                "meals": {
                                    type: "ARRAY", items: {
                                        type: "OBJECT", properties: {
                                            "meal_id": { type: "STRING" }, "title": { type: "STRING" },
                                            "type": { type: "STRING", enum: ["B", "L", "D", "S1", "S2"] },
                                            "targets": { type: "OBJECT", properties: { "kcal": { type: "NUMBER" }, "p": { type: "NUMBER" }, "c": { type: "NUMBER" }, "f": { type: "NUMBER" } }, required: ["kcal", "p", "c", "f"] },
                                            "tol": { type: "OBJECT", properties: { "kcal": { type: "NUMBER" }, "p": { type: "NUMBER" }, "c": { type: "NUMBER" }, "f": { type: "NUMBER" } }, required: ["kcal", "p", "c", "f"] },
                                            "items": {
                                                type: "ARRAY", items: {
                                                    type: "OBJECT", properties: {
                                                        "ingredient_id": { type: "STRING" }, "display_name": { type: "STRING" },
                                                        "min_g": { type: "NUMBER" }, "max_g": { type: "NUMBER" }
                                                    }, required: ["ingredient_id", "display_name", "min_g", "max_g"]
                                                }
                                            }
                                        }, required: ["meal_id", "title", "type", "targets", "tol", "items"]
                                    }
                                }
                            }, required: ["day_id", "meals"]
                        }
                    }
                }, required: ["ingredients", "mealPlan"]
            } // End schema
        } // End generationConfig
    }; // End payload

    // --- API Call ---
    try {
        const response = await fetchWithRetry( GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(payload) }, log );
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

        // Validate response structure
        if (!jsonText) {
            log("Technical AI (Phase 1) returned no JSON text in candidate.", 'CRITICAL', 'LLM', result);
            throw new Error("LLM response candidate was empty or missing text part.");
        }
        log("Technical Raw (Phase 1)", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' }); // Log snippet

        // Attempt to parse JSON
        try {
            const parsed = JSON.parse(jsonText);
            log("Parsed Technical (Phase 1) - Basic Structure Check", 'INFO', 'DATA', { hasIngreds: Array.isArray(parsed.ingredients), hasMealPlan: Array.isArray(parsed.mealPlan) });
            // Perform basic structural validation before returning
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.mealPlan)) {
                throw new Error("LLM response missing required top-level arrays ('ingredients', 'mealPlan').");
            }
             // Add a check for placeholders specifically
             if ( (parsed.ingredients.length > 0 && String(parsed.ingredients[0]).startsWith('@@')) || // Check first element if exists
                  (parsed.mealPlan.length > 0 && String(parsed.mealPlan[0]).startsWith('@@')) ) { // Check first element if exists
                  throw new Error("LLM response contained placeholder data ('@@...@@').");
             }
            return parsed; // Return successfully parsed and validated data
        } catch (e) {
            log("Failed to parse Technical AI (Phase 1) JSON or basic validation failed.", 'CRITICAL', 'LLM', { jsonTextSnippet: jsonText.substring(0, 1000), error: e.message });
            throw new Error(`Failed to parse or validate LLM JSON response: ${e.message}`); // Re-throw parsing/validation error
        }
    } catch (error) {
        // Catch errors from fetchWithRetry or JSON parsing/validation
        log(`Technical AI (Phase 1) call failed definitively: ${error.message}`, 'CRITICAL', 'LLM');
        throw error; // Re-throw the error to be caught by the main handler's retry logic
    }
}


// --- AI Phase 2 (Food Writer) ---
async function generateLLMMealDescription_Phase2(meal, log) {
    // Destructure needed info from the meal object (which now includes final solution)
    const { title: mealTitle, type: mealType, solution: solvedItems } = meal;
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    // Prompt for description generation
    const systemPrompt = `You are a concise food writer. Given a meal title, type, and list of ingredients with gram amounts, write a short (1-2 sentences), appealing description for a meal plan.
RULES:
1. Incorporate all listed ingredients with their exact gram amounts (e.g., "150g chicken breast", "75g white rice").
2. Be brief and appetizing.
3. DO NOT add ingredients not listed.
4. Ignore any ingredients with 0 grams.
5. Assume grams are for raw/uncooked ingredients unless context implies otherwise.`;

    // Create the ingredient list string, filtering out 0g items
    const ingredientList = solvedItems
        ?.filter(item => item.grams > 0)
        ?.map(item => `${item.grams}g ${item.display_name}`) // Use display_name from solution
        ?.join(', ') || ''; // Join with commas, handle empty list

    // Fallback description if no ingredients or generation fails
    const fallbackDescription = `A meal of ${ingredientList || mealTitle}`;

    // Skip API call if there are no non-zero ingredients
    if (!ingredientList) {
        log(`AI Phase 2: No non-zero ingredients for ${mealTitle}, using fallback description.`, 'WARN', 'LLM');
        return fallbackDescription;
    }

    // Construct the user query for Gemini
    const userQuery = `Write a description for a ${mealType} meal called "${mealTitle}" containing: ${ingredientList}`;
    log("AI Phase 2 Prompt", 'INFO', 'LLM_PROMPT', { userQuery }); // Log the prompt
    // Prepare API payload
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] } };

    // Call API with retry logic
    try {
        const res = await fetchWithRetry( GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(payload) }, log );
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        // Validate response
        if (typeof text !== 'string' || text.length === 0) {
            log(`AI Phase 2 returned empty or invalid text for ${mealTitle}. Using fallback.`, 'WARN', 'LLM', { result });
            return fallbackDescription; // Use fallback on empty/invalid response
        }
        log(`AI Phase 2 Raw Success for ${mealTitle}`, 'INFO', 'LLM', { raw: text.substring(0, 100) + '...' }); // Log success snippet
        return text.trim(); // Return the generated description
    } catch(e){
        // Log critical failure after retries
        log(`AI Phase 2 (Food Writer) failed definitively for ${mealTitle}: ${e.message}. Using fallback.`, 'CRITICAL', 'LLM');
        return fallbackDescription; // Use fallback on definitive failure
    }
}


/// ===== API-CALLERS-END ===== ////


// --- LP Solver Implementation ---

/** Helper to extract solver inputs using ingredient_id */
function buildMealInputs(meal, nutritionDataMap, log) {
  const rows = [];
  // Validate meal items structure
  if (!Array.isArray(meal.items)) {
       log(`[Meal: ${meal.title}] Invalid 'items' structure, expected array. Skipping solver input build.`, 'ERROR', 'SOLVER_INPUT');
       return { rows, targets: {}, tolerances: {} }; // Return empty structure
  }
  for (const it of meal.items) {
    // Ensure item has required properties
    if (!it || !it.ingredient_id) {
        log(`[Meal: ${meal.title}] Skipping invalid meal item: ${JSON.stringify(it)}`, 'WARN', 'SOLVER_INPUT');
        continue;
    }
    const nut = nutritionDataMap[it.ingredient_id];
    // Check if nutrition data exists for this ingredient ID
    if (!nut || !nut.per_g) {
      log(`[Meal: ${meal.title}] Skipping "${it.display_name || it.ingredient_id}" in solver: Missing nutrition data.`, 'WARN', 'SOLVER_INPUT');
      continue; // Skip ingredients without nutrition
    }
    // Validate and sanitize min/max grams from AI
     const min_g = typeof it.min_g === 'number' && it.min_g >= 0 ? it.min_g : 0; // Default min to 0 if invalid
     const max_g = typeof it.max_g === 'number' && it.max_g >= min_g ? it.max_g : 1000; // Default max to 1000 if invalid or less than min
     // Log if corrections were made
     if (min_g !== it.min_g || max_g !== it.max_g) {
          log(`[Meal: ${meal.title}] Corrected min/max grams for "${it.display_name || it.ingredient_id}": min ${it.min_g} -> ${min_g}, max ${it.max_g} -> ${max_g}`, 'WARN', 'SOLVER_INPUT');
     }

    // Add valid ingredient row for solver
    rows.push({
      id: it.ingredient_id,
      display_name: it.display_name || it.ingredient_id, // Use ID as fallback display name
      min_g: min_g,
      max_g: max_g,
      // Ensure nutrition values are numbers, default to 0 if missing/invalid
      kcal: typeof nut.per_g.kcal === 'number' ? nut.per_g.kcal : 0,
      p: typeof nut.per_g.p === 'number' ? nut.per_g.p : 0,
      c: typeof nut.per_g.c === 'number' ? nut.per_g.c : 0,
      f: typeof nut.per_g.f === 'number' ? nut.per_g.f : 0
    });
  }
   // Validate targets and tolerances, providing defaults
   const validatedTargets = {
       kcal: Math.max(0, meal.targets?.kcal || 0),
       p: Math.max(0, meal.targets?.p || 0),
       c: Math.max(0, meal.targets?.c || 0),
       f: Math.max(0, meal.targets?.f || 0),
   };
   const validatedTolerances = {
       kcal: Math.max(10, meal.tol?.kcal || 50), // Min tolerance 10 kcal
       p: Math.max(5, meal.tol?.p || 10),      // Min tolerance 5g protein
       c: Math.max(10, meal.tol?.c || 15),     // Min tolerance 10g carbs
       f: Math.max(5, meal.tol?.f || 10),      // Min tolerance 5g fat
   };

   // Log validated inputs
   log(`[Meal: ${meal.title}] Solver Inputs: ${rows.length} ingredients. Targets: Kcal ${validatedTargets.kcal}±${validatedTolerances.kcal}, P ${validatedTargets.p}±${validatedTolerances.p}, F ${validatedTargets.f}±${validatedTolerances.f}, C ${validatedTargets.c}±${validatedTolerances.c}`, 'DEBUG', 'SOLVER_INPUT');

  return { rows, targets: validatedTargets, tolerances: validatedTolerances };
}


/** Builds the LP model for javascript-lp-solver */
function buildLP(rows, targets, tolerances, log) {
    // Initialize model structure
    const model = {
        optimize: "obj", // Define objective function name
        opType: "min",   // Minimize the objective function
        constraints: {}, // Object to hold constraints
        variables: {},   // Object to hold variables
        ints: {}         // Object to specify integer variables
    };

    // Define variables (ingredient grams)
    for (const r of rows) {
        model.variables[r.id] = {
            obj: 1e-4, // Small objective coefficient to encourage simpler solutions
            min: r.min_g, // Lower bound from input
            max: r.max_g  // Upper bound from input
        };
         model.ints[r.id] = 1; // Specify that grams should be integers
    }

    // Define constraints for each macro (kcal, p, c, f)
    const macros = ['kcal', 'p', 'c', 'f'];
    macros.forEach(macro => {
        const target = targets[macro];
        const tolerance = tolerances[macro];
        // Calculate lower and upper bounds for the constraint, ensuring lower bound >= 0
        const lowerBound = Math.max(0, target - tolerance);
        const upperBound = target + tolerance;

        // Define constraint names (e.g., "kcal_lo", "kcal_hi")
        const constraintLo = `${macro}_lo`;
        const constraintHi = `${macro}_hi`;

        // Add constraints to the model with their bounds
        model.constraints[constraintLo] = { min: lowerBound };
        model.constraints[constraintHi] = { max: upperBound };

        // Add coefficients for each variable (ingredient) to these constraints
        for (const r of rows) {
            // The contribution of 1 gram of this ingredient to the macro
            model.variables[r.id][constraintLo] = r[macro];
            model.variables[r.id][constraintHi] = r[macro];
        }
    });
    log("LP Model built", "DEBUG", "LP_SOLVER", { variables: Object.keys(model.variables).length, constraints: Object.keys(model.constraints).length });
    return model;
}

/** Solves the meal LP model */
function solveMealLP(meal, nutritionDataMap, log) {
    // Build solver inputs (rows, targets, tolerances)
    const { rows, targets, tolerances } = buildMealInputs(meal, nutritionDataMap, log);
    // Skip if no valid ingredients with nutrition data
    if (rows.length === 0) {
        log(`[Meal: ${meal.title}] LP Solver skipped: No valid ingredients with nutrition data.`, 'WARN', 'LP_SOLVER');
        return { solution: [], note: "no_ingredients", feasible: false };
    }

    // Build the LP model
    const model = buildLP(rows, targets, tolerances, log);
    let lpResult = null;
    // Solve the model, catching potential errors
    try {
        lpResult = solver.Solve(model);
        log(`[Meal: ${meal.title}] LP Solver Result:`, "DEBUG", "LP_SOLVER", lpResult); // Log raw result
    } catch (e) {
         log(`[Meal: ${meal.title}] LP Solver CRASHED: ${e.message}`, 'CRITICAL', 'LP_SOLVER', { model }); // Log crash and model
         return { solution: [], note: "lp_crash", feasible: false }; // Return crash status
    }

    // Check if solver found a feasible solution
    if (!lpResult || !lpResult.feasible) {
         log(`[Meal: ${meal.title}] LP Solver failed or returned infeasible solution.`, 'WARN', 'LP_SOLVER', { result: lpResult });
        return { solution: [], note: "lp_infeasible", feasible: false }; // Return infeasible status
    }

    // Map result back to { ingredient_id, display_name, grams } format
    const solution = rows.map(r => {
        const grams = lpResult[r.id] ?? 0; // Get grams from result, default to 0
        return {
            ingredient_id: r.id,
            display_name: r.display_name,
            grams: Math.max(0, Math.round(grams)) // Ensure non-negative and round to nearest gram
        };
    });

    // Return successful solution
    return { solution, note: "lp_success", feasible: true };
}
// --- END LP Solver ---


// --- Iterative Heuristic Fallback ---
function solveHeuristic(meal, nutritionDataMap, log) {
    // Build solver inputs (rows, targets, tolerances)
    const { rows, targets, tolerances } = buildMealInputs(meal, nutritionDataMap, log);
     // Skip if no valid ingredients
     if (rows.length === 0) {
        log(`[Meal: ${meal.title}] Heuristic Solver skipped: No valid ingredients with nutrition data.`, 'WARN', 'HEURISTIC_SOLVER');
        // Return structure indicating failure
        return { solution: [], note: "no_ingredients", validationPassed: false, finalTotals: { kcal: 0, p: 0, c: 0, f: 0 } };
    }

    // Initialize quantities at minimum grams
    const q = Object.fromEntries(rows.map(r => [r.id, r.min_g]));

    // Helper to calculate macros and error for current quantities
    const calculateTotalsAndError = (currentQuantities) => {
        let kcal = 0, p = 0, c = 0, f = 0;
        // Sum macros based on current grams
        for (const r of rows) {
            const g = currentQuantities[r.id];
            kcal += r.kcal * g;
            p += r.p * g;
            c += r.c * g;
            f += r.f * g;
        }
        // Calculate weighted error (prioritizing protein)
        const err = (
            Math.abs(kcal - targets.kcal) * 1.0 +
            Math.abs(p - targets.p) * 2.0 +
            Math.abs(c - targets.c) * 0.7 +
            Math.abs(f - targets.f) * 0.7
        );
         // Return rounded totals for validation, but keep raw error for optimization
        return { kcal: Math.round(kcal), p: Math.round(p), c: Math.round(c), f: Math.round(f), err };
    };

    // --- Iterative Optimization ---
    let step = 40; // Initial step size for adjusting grams
    let lastState = calculateTotalsAndError(q); // Calculate initial state
    let iterations = 0;
    const MAX_ITERATIONS = 500; // Safety break

    log(`[Meal: ${meal.title}] Heuristic Start`, 'DEBUG', 'HEURISTIC_SOLVER', { targets, initial_q: q, initial_err: lastState.err });

    // Loop until step size is too small or max iterations reached
    while (step >= 5 && iterations < MAX_ITERATIONS) {
        let improvedThisCycle = false;
        // Shuffle ingredient order to avoid bias
        const shuffledRows = [...rows].sort(() => Math.random() - 0.5);

        // Try adjusting each ingredient
        for (const r of shuffledRows) {
            // Try increasing grams
            if (q[r.id] + step <= r.max_g) {
                q[r.id] += step; // Tentatively increase
                const newState = calculateTotalsAndError(q);
                if (newState.err < lastState.err) { // Check if error improved
                    lastState = newState; // Keep change
                    improvedThisCycle = true;
                } else {
                    q[r.id] -= step; // Revert change
                }
            }
            // Try decreasing grams (independent check)
            if (q[r.id] - step >= r.min_g) {
                 q[r.id] -= step; // Tentatively decrease
                 const newState = calculateTotalsAndError(q);
                 if (newState.err < lastState.err) { // Check if error improved
                     lastState = newState; // Keep change
                     improvedThisCycle = true;
                 } else {
                     q[r.id] += step; // Revert change
                 }
             }
        }

        // If no improvement in a full cycle, reduce step size
        if (!improvedThisCycle) {
            step = Math.floor(step / 2);
        }
        iterations++;
    } // End optimization loop

     // Log outcome
     if (iterations >= MAX_ITERATIONS) {
         log(`[Meal: ${meal.title}] Heuristic Solver stopped: Max iterations reached.`, 'WARN', 'HEURISTIC_SOLVER');
     } else {
          log(`[Meal: ${meal.title}] Heuristic Solver finished in ${iterations} iterations. Final Err: ${lastState.err.toFixed(1)}`, 'INFO', 'HEURISTIC_SOLVER');
     }

    // --- Format Solution ---
    const solution = rows.map(r => ({
        ingredient_id: r.id,
        display_name: r.display_name,
        grams: Math.max(0, Math.round(q[r.id])) // Final rounded grams
    }));

     // --- Validate Heuristic Result Against Tolerances ---
     const finalTotals = { kcal: lastState.kcal, p: lastState.p, c: lastState.c, f: lastState.f }; // Use rounded totals from last state
     const validationPassed = (
         Math.abs(finalTotals.kcal - targets.kcal) <= tolerances.kcal &&
         Math.abs(finalTotals.p - targets.p) <= tolerances.p &&
         Math.abs(finalTotals.c - targets.c) <= tolerances.c &&
         Math.abs(finalTotals.f - targets.f) <= tolerances.f
     );

    // Return solution, note, validation status, and final calculated totals
    return { solution, note: "heuristic_fallback", validationPassed, finalTotals };
}
// --- END Heuristic Fallback ---


// --- Phase 5 (Solver) & Phase 6 (AI Food Writer) - UPDATED (Mark 52) ---
async function solveAndDescribePlan(structuredMealPlan, finalResults, nutritionDataMap, ingredientMapById, log) {
    const finalMealPlanWithSolution = JSON.parse(JSON.stringify(structuredMealPlan)); // Deep copy
    const finalIngredientTotals = {}; // Key: ingredient_id, Value: { totalGrams, quantityUnits }
    let solvedDailyTotalsAcc = { calories: 0, protein: 0, fat: 0, carbs: 0 }; // Accumulator for CORRECTED macros
    let daysProcessed = 0;
    const mealsForDescription = []; // Collect meals needing description

    log("Starting Phase 5: Solving Meals...", 'INFO', 'PHASE');

    // Iterate through each day in the plan
    for (const day of finalMealPlanWithSolution) {
        // Basic validation for day structure
        if (!day.meals || !Array.isArray(day.meals)) {
            log(`Skipping invalid day structure: ${JSON.stringify(day)}`, 'WARN', 'SOLVER');
            continue;
        }
        daysProcessed++;

        // Iterate through each meal in the day
        for (const meal of day.meals) {
            log(`Processing Meal: ${meal.title} (${meal.meal_id})`, 'DEBUG', 'SOLVER');
            let finalSolutionItems = []; // Stores the final gram amounts { ingredient_id, display_name, grams }
            let finalSolverNote = "solver_error"; // Default status note
            let heuristicTotalsBeforeValidation = null; // To log the raw heuristic output if it fails validation

            // --- Solver Logic ---
            try {
                // Attempt Linear Programming Solver first
                const lpResult = solveMealLP(meal, nutritionDataMap, log);
                if (lpResult?.feasible) {
                    // LP Success
                    finalSolutionItems = lpResult.solution;
                    finalSolverNote = lpResult.note;
                } else {
                    // LP Failed or Infeasible -> Attempt Heuristic Fallback
                     log(`[Meal: ${meal.title}] LP failed/infeasible (${lpResult?.note || 'unknown'}), trying heuristic fallback.`, 'WARN', 'SOLVER_FALLBACK');
                    const heuristicResult = solveHeuristic(meal, nutritionDataMap, log);
                    heuristicTotalsBeforeValidation = heuristicResult.finalTotals; // Store raw heuristic result

                    // Validate Heuristic Result
                    if (heuristicResult?.validationPassed) {
                         // Heuristic Succeeded and Validated
                         finalSolutionItems = heuristicResult.solution;
                         finalSolverNote = heuristicResult.note + "_validated";
                         log(`[Meal: ${meal.title}] Heuristic fallback SUCCEEDED validation.`, 'INFO', 'HEURISTIC_VALIDATION', { heuristicTotals: heuristicTotalsBeforeValidation });
                    } else {
                         // Heuristic Failed Validation -> Revert to Minimum Grams
                         finalSolverNote = (heuristicResult?.note || "heuristic_fallback") + "_tolerance_fail";
                         log(`[Meal: ${meal.title}] Heuristic fallback FAILED validation. Reverting to min_g values.`, 'WARN', 'HEURISTIC_VALIDATION', { heuristicTotals: heuristicTotalsBeforeValidation, targets: meal.targets, tolerances: meal.tol });
                         // Rebuild using min_g values
                         const { rows } = buildMealInputs(meal, nutritionDataMap, log);
                         finalSolutionItems = rows.map(r => ({
                             ingredient_id: r.id,
                             display_name: r.display_name,
                             grams: r.min_g // Use the validated min_g
                         }));
                    }
                }
            } catch (e) {
                // Catch unexpected crashes during solver attempts
                log(`[Meal: ${meal.title}] CRITICAL SOLVER/HEURISTIC ERROR (caught): ${e.message}. Reverting to min_g.`, 'CRITICAL', 'SOLVER_FALLBACK', { stack: e.stack?.substring(0,300) });
                 finalSolverNote = "solver_crash_min_g_fallback";
                 // Revert to Minimum Grams on crash
                 const { rows } = buildMealInputs(meal, nutritionDataMap, log);
                 finalSolutionItems = rows.map(r => ({
                     ingredient_id: r.id,
                     display_name: r.display_name,
                     grams: r.min_g // Use validated min_g
                 }));
            }

            // --- Store final solution and calculate CORRECT macros ---
            meal.solution = finalSolutionItems; // Attach the final solution array
            meal.solver_note = finalSolverNote; // Attach the status note

            // Calculate macros based ONLY on the final solution items
            meal.finalMacros = calculateMacrosFromSolution(meal.solution, nutritionDataMap);

            // --- Accumulate totals and aggregate ingredient grams ---
            if (meal.solution && meal.solution.length > 0) {
                // Add this meal's CORRECT macros to the daily accumulator
                solvedDailyTotalsAcc.calories += meal.finalMacros.calories;
                solvedDailyTotalsAcc.protein += meal.finalMacros.protein;
                solvedDailyTotalsAcc.fat += meal.finalMacros.fat;
                solvedDailyTotalsAcc.carbs += meal.finalMacros.carbs;

                // Add grams to the grand total for each ingredient
                meal.solution.forEach(item => {
                    if (item.grams > 0) {
                        // Initialize if first time seeing this ingredient
                        if (!finalIngredientTotals[item.ingredient_id]) {
                            finalIngredientTotals[item.ingredient_id] = { totalGrams: 0, quantityUnits: "" };
                        }
                        finalIngredientTotals[item.ingredient_id].totalGrams += item.grams;
                    }
                });
                // Add meal to list for description generation if it has a solution
                mealsForDescription.push(meal);
            } else {
                 // Log if no solution items (e.g., no valid ingredients)
                 log(`[Meal: ${meal.title}] No valid solution items found after solver attempts. Macros will be zero.`, 'WARN', 'SOLVER');
                 // Ensure finalMacros is zeroed out if solution is empty/null
                 meal.finalMacros = { calories: 0, protein: 0, fat: 0, carbs: 0 };
            }

            // --- Logging ---
            log(`[Meal: ${meal.title}] Final Solution Determined (${meal.solver_note}):`, 'DEBUG', 'SOLVER', meal.solution);
            // Log the comparison between target and the CORRECT final macros
            log(`[Meal: ${meal.title}] Final Macros (Target vs Actual Calculated):`, 'DEBUG', 'SOLVER_FINAL_MACROS', {
                target: meal.targets,
                actual: meal.finalMacros // Log the correctly calculated final macros
            });
             // Log the heuristic attempt totals ONLY if heuristic ran AND failed validation, for comparison/debugging
             if (finalSolverNote.includes('tolerance_fail') && heuristicTotalsBeforeValidation) {
                 log(`[Meal: ${meal.title}] Heuristic Attempt Macros (FAILED VALIDATION, NOT USED):`, 'DEBUG', 'HEURISTIC_FAILED_MACROS', heuristicTotalsBeforeValidation);
             }

        } // End meal loop
    } // End day loop

    log("Finished Phase 5: Solving Meals.", 'SUCCESS', 'PHASE');

    // --- Calculate Quantity Units based on total grams and product size ---
    for (const id in finalIngredientTotals) {
         const ingredientInfo = ingredientMapById[id]; // Get original AI data
         const originalName = ingredientInfo?.originalIngredient || id; // Get display name
         const result = finalResults[originalName]; // Look up market data by name
         // Find the selected product from market results
         const product = result?.allProducts?.find(p => p.url === result.currentSelectionURL);
         const parsedSize = product ? parseSize(product.size) : null; // Parse size string (e.g., "500g")
         let units = "(Units N/A)"; // Default unit string

         if (parsedSize && parsedSize.value > 0) { // If size was parsed successfully
             const totalGrams = finalIngredientTotals[id].totalGrams;
             if (totalGrams > 0) {
                 // Calculate number of units needed (rounding up)
                 const numUnits = Math.ceil(totalGrams / parsedSize.value);
                 units = `${numUnits} x ${product.size || 'unit'}`; // Format as "N x Size unit"
             } else {
                  units = `0 x ${product.size || 'unit'}`; // Handle 0 grams case
             }
         } else if (product && product.size) {
             units = `(Check size: ${product.size})`; // Fallback if size couldn't be parsed
         } else if (!product){
              units = "(Product not found)"; // Fallback if market run failed
         }
         finalIngredientTotals[id].quantityUnits = units; // Store the calculated unit string
    }

    // --- Run AI Phase 2 (Food Writer) - Now Serialized (K=1) ---
    log(`Running AI Phase 2 (Food Writer) for ${mealsForDescription.length} meals (Serialized K=${MAX_DESCRIPTION_CONCURRENCY})...`, 'INFO', 'PHASE');
    // Use concurrentlyMap even with K=1 for consistent error handling structure
    const descriptionResults = await concurrentlyMap(mealsForDescription, MAX_DESCRIPTION_CONCURRENCY, (meal) =>
        // Call generator, then map result to include meal_id for later matching
        generateLLMMealDescription_Phase2(meal, log).then(description => ({ meal_id: meal.meal_id, description }))
    );

     // --- Map generated descriptions back to the meal plan ---
     const descriptionMap = descriptionResults.reduce((map, result) => {
         // Handle successful results
         if (result && !result.error && result.meal_id) {
             map[result.meal_id] = result.description;
         }
         // Handle errors during description generation (use fallback)
         else if (result && result.error) {
              log(`Skipping description mapping for meal "${result.itemIdentifier}" due to error: ${result.error}`, 'ERROR', 'LLM');
              // Find the meal that failed to generate a fallback description
              const failedMeal = mealsForDescription.find(m => m.meal_id === result.itemIdentifier);
              if(failedMeal) {
                  // Generate fallback using the *final* solution ingredients
                  const fallbackList = failedMeal.solution?.filter(i => i.grams > 0).map(i => `${i.grams}g ${i.display_name}`).join(', ');
                  map[result.itemIdentifier] = `A meal of ${fallbackList || failedMeal.title}`; // Fallback text
              }
         }
         return map;
     }, {});

     // Assign descriptions to the final meal plan object
     for (const day of finalMealPlanWithSolution) {
         for (const meal of day.meals) {
             meal.description = descriptionMap[meal.meal_id] || meal.title; // Assign generated or fallback description
             // Clean up temporary/internal fields before sending to frontend
             // delete meal.items; // Raw AI items are no longer needed
             // delete meal.targets; // Solver targets
             // delete meal.tol; // Solver tolerances
             // delete meal.solver_note; // Internal solver status note
             // Keep meal.solution (final grams) and meal.finalMacros (calculated macros)
         }
     }

    log("AI Phase 2 (Food Writer) complete.", 'SUCCESS', 'PHASE');

    // --- Calculate Final Average Daily Macros (Corrected) ---
    // Average the accumulated CORRECT totals over the number of days processed
    const avgSolvedTotals = {
        calories: Math.round(solvedDailyTotalsAcc.calories / (daysProcessed || 1)),
        protein: Math.round(solvedDailyTotalsAcc.protein / (daysProcessed || 1)),
        fat: Math.round(solvedDailyTotalsAcc.fat / (daysProcessed || 1)),
        carbs: Math.round(solvedDailyTotalsAcc.carbs / (daysProcessed || 1)),
    };
    log("Final Solved Daily Averages (Corrected):", 'SUCCESS', 'SOLVER', avgSolvedTotals);

    // Return the final plan, totals, and calculated averages
    return {
        finalMealPlanWithSolution, // The meal plan with solutions and descriptions
        finalIngredientTotals, // Aggregated grams and units per ingredient (keyed by ID)
        solvedDailyTotals: avgSolvedTotals // The correctly calculated average daily macros
    };
}
// --- END UPDATE ---


/// ===== NUTRITION-CALC-START ===== \\\\

/** Calorie Target Calculation */
function calculateCalorieTarget(formData, log = console.log) {
    const { weight, height, age, gender, activityLevel, goal } = formData;
    // Parse inputs safely
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);

    // Validate inputs
    if (isNaN(weightKg) || isNaN(heightCm) || isNaN(ageYears) || !gender || !activityLevel || !goal) {
        log("Missing or invalid profile data for calorie calculation, using default 2000.", 'WARN', 'CALC', getSanitizedFormData(formData)); // Log sanitized data
        return 2000; // Return default
    }

    // Calculate BMR (Mifflin-St Jeor Equation)
    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);

    // Determine TDEE multiplier
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    let multiplier = activityMultipliers[activityLevel];
    if (!multiplier) {
        log(`Invalid activityLevel "${activityLevel}", using default 'moderate' (1.55).`, 'WARN', 'CALC');
        multiplier = 1.55; // Default multiplier
    }
    const tdee = bmr * multiplier; // Total Daily Energy Expenditure

    // Determine goal-based adjustment (as percentage of TDEE)
    const goalAdjustments = {
        maintain: 0,
        cut_moderate: - (tdee * 0.15), // ~15% deficit
        cut_aggressive: - (tdee * 0.25), // ~25% deficit
        bulk_lean: + (tdee * 0.15),      // ~15% surplus
        bulk_aggressive: + (tdee * 0.25) // ~25% surplus
    };
    let adjustment = goalAdjustments[goal];
    if (adjustment === undefined) { // Handle invalid goal input
        log(`Invalid goal "${goal}", using default 'maintain' (0 adjustment).`, 'WARN', 'CALC');
        adjustment = 0;
    }

    log(`Calorie Calc: BMR=${bmr.toFixed(0)}, TDEE=${tdee.toFixed(0)}, Goal=${goal}, Adjustment=${adjustment.toFixed(0)}`, 'INFO', 'CALC');
    // Calculate final target, ensuring minimum threshold (e.g., 1200 kcal)
    return Math.max(1200, Math.round(tdee + adjustment));
}


/** Macronutrient Distribution (Dual Validation) */
function calculateMacroTargets(calorieTarget, goal, weightKg, log) {
    // Define macro percentage splits based on goal
    const macroSplits = {
        'cut_aggressive': { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'cut_moderate':   { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'maintain':       { pPct: 0.30, fPct: 0.30, cPct: 0.40 },
        'bulk_lean':      { pPct: 0.25, fPct: 0.25, cPct: 0.50 },
        'bulk_aggressive':{ pPct: 0.20, fPct: 0.25, cPct: 0.55 }
    };
    // Select split, defaulting to 'maintain' if goal is invalid
    const split = macroSplits[goal] || macroSplits['maintain'];
    if (!macroSplits[goal]) {
        log(`Invalid goal "${goal}" for macro split, using 'maintain' defaults.`, 'WARN', 'CALC');
    }

    // Initial calculation based on percentages
    let proteinGrams = (calorieTarget * split.pPct) / 4; // 4 kcal/g protein
    let fatGrams = (calorieTarget * split.fPct) / 9;     // 9 kcal/g fat
    let carbGrams = (calorieTarget * split.cPct) / 4;    // 4 kcal/g carb

    // --- Validation and Adjustment ---
    const validWeightKg = (typeof weightKg === 'number' && weightKg > 0) ? weightKg : 75; // Use default weight if invalid
    let proteinPerKg = proteinGrams / validWeightKg;
    let fatPerKg = fatGrams / validWeightKg;
    let fatPercent = (fatGrams * 9) / calorieTarget;
    let carbsNeedRecalc = false; // Flag if adjustments require carb recalculation

    // Protein Cap (g/kg bodyweight)
    const PROTEIN_MAX_G_PER_KG = 3.0; // Absolute upper limit
    if (proteinPerKg > PROTEIN_MAX_G_PER_KG) {
        log(`ADJUSTMENT: Initial protein ${proteinPerKg.toFixed(1)}g/kg > ${PROTEIN_MAX_G_PER_KG}g/kg. Capping protein.`, 'WARN', 'CALC');
        proteinGrams = PROTEIN_MAX_G_PER_KG * validWeightKg;
        carbsNeedRecalc = true;
    }

    // Fat Cap (% of total calories)
    const FAT_MAX_PERCENT = 0.35; // Upper limit for fat percentage
    if (fatPercent > FAT_MAX_PERCENT) {
        log(`ADJUSTMENT: Initial fat ${fatPercent.toFixed(1)}% > ${FAT_MAX_PERCENT}%. Capping fat.`, 'WARN', 'CALC');
        fatGrams = (calorieTarget * FAT_MAX_PERCENT) / 9;
        carbsNeedRecalc = true;
    }

    // Recalculate Carbs if Protein or Fat were capped
    if (carbsNeedRecalc) {
        const proteinCalories = proteinGrams * 4;
        const fatCalories = fatGrams * 9;
        // Remaining calories assigned to carbs
        const carbCalories = Math.max(0, calorieTarget - proteinCalories - fatCalories); // Ensure non-negative
        carbGrams = carbCalories / 4;
        log(`RECALC: New Carb Target after adjustments: ${carbGrams.toFixed(0)}g`, 'INFO', 'CALC');
    }

    // --- Guideline Checks (Informational Logging) ---
    // Minimum protein guideline
    const PROTEIN_MIN_G_PER_KG = 1.6;
    proteinPerKg = proteinGrams / validWeightKg; // Recalculate ratio after potential capping
    if (proteinPerKg < PROTEIN_MIN_G_PER_KG) {
        log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is below the generally recommended ${PROTEIN_MIN_G_PER_KG}g/kg minimum.`, 'INFO', 'CALC');
    }
    // Specific protein guideline for cutting
    const PROTEIN_CUT_MAX_G_PER_KG = 2.4;
    if ((goal === 'cut_aggressive' || goal === 'cut_moderate') && proteinPerKg > PROTEIN_CUT_MAX_G_PER_KG) {
        log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is above the commonly recommended ${PROTEIN_CUT_MAX_G_PER_KG}g/kg range for cutting phases.`, 'INFO', 'CALC');
    }
    // Minimum fat guideline
    const FAT_MIN_G_PER_KG = 0.8;
    fatPerKg = fatGrams / validWeightKg; // Recalculate ratio after potential capping
    if (fatPerKg < FAT_MIN_G_PER_KG) {
        log(`GUIDELINE: Fat target ${fatPerKg.toFixed(1)}g/kg is below the recommended ${FAT_MIN_G_PER_KG}g/kg minimum for hormonal health.`, 'INFO', 'CALC');
    }

    // Final rounded values
    const finalProteinGrams = Math.round(proteinGrams);
    const finalFatGrams = Math.round(fatGrams);
    const finalCarbGrams = Math.round(carbGrams);

    log(`Calculated Macro Targets (Validated): P ${finalProteinGrams}g, F ${finalFatGrams}g, C ${finalCarbGrams}g`, 'INFO', 'CALC');
    // Return final gram targets
    return { proteinGrams: finalProteinGrams, fatGrams: finalFatGrams, carbGrams: finalCarbGrams };
}

/// ===== NUTRITION-CALC-END ===== \\\\


