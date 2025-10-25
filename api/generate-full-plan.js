// --- ORCHESTRATOR API for Cheffy V4 ---
// Mark 46: Implemented Stable IDs & LP Solver (javascript-lp-solver) with Heuristic Fallback
// - Updated AI Phase 1 prompt/schema for ingredient_id and structured mealPlan.
// - Keyed nutritionDataMap by ingredient_id.
// - Replaced heuristic solver with LP solver using javascript-lp-solver.
// - Implemented iterative heuristic as fallback.
// - Refactored Phase 5+ to use ingredient_id for data joins.
// Mark 45: Implemented generic nutritionQuery strategy.
// Mark 44.3 (FIX): Corrected typo in GEMINI_API_URL_BASE causing DNS failure.
// Mark 44.2 (FIX): Build fail (removed js-lpsolver, added basic heuristic).
// Mark 44: Re-architected pipeline ("AI-Code-AI Sandwich").
// Mark 42: Replaced macro calculation with dual-validation system.
// Mark 40: Added PII redaction.
// Mark 39: Moved API key to header.
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

// Defines macro targets for each meal type as a percentage of the day's total.
// NOTE: These are less critical now as targets are generated per meal by AI Phase 1
const MEAL_MACRO_BUDGETS = {
    '3': { 'B': 0.30, 'L': 0.40, 'D': 0.30 },
    '4': { 'B': 0.25, 'L': 0.35, 'D': 0.30, 'S1': 0.10 },
    '5': { 'B': 0.20, 'L': 0.30, 'D': 0.30, 'S1': 0.10, 'S2': 0.10 }
};
// --- REMOVED (Mark 46): Old heuristic config ---
// const HEURISTIC_PRIORITY_MAP = { ... };
// const SOLVER_MIN_GRAMS = 20;

// Banned keywords for market run checklist
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'battery', 'filter', 'paper', 'tip', 'shampoo', 'conditioner', 'soap', 'lotion', 'cleaner', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum']; // Removed 'wrap', 'spray'
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60; // Must match >= 60%
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0; // Score needed on tight query to skip normal/wide
const PRICE_OUTLIER_Z_SCORE = 2.0; // Products with unit price z-score > 2 will be demoted

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

async function concurrentlyMap(array, limit, asyncMapper) {
    const results = [];
    const executing = [];
    for (const item of array) {
        // Wrap asyncMapper call in a promise handler to catch errors and identify the item
        // --- MODIFICATION (Mark 46): Use ingredient_id for error reporting if available ---
        const identifier = item?.ingredient_id || item?.originalIngredient || 'unknown';
        const promise = asyncMapper(item)
            .then(result => {
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                return result;
            })
            .catch(error => {
                console.error(`Error processing item "${identifier}" in concurrentlyMap:`, error);
                const index = executing.indexOf(promise);
                if (index > -1) executing.splice(index, 1);
                return {
                    error: error.message || 'Unknown error during async mapping',
                    itemIdentifier: identifier // Use consistent identifier key
                };
            });

        executing.push(promise);
        results.push(promise); // Store the promise (which resolves to result or error object)

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

function calculateRequiredWordScore(productNameLower, requiredWords) {
    if (!requiredWords || requiredWords.length === 0) return 1.0;
    let wordsFound = 0;
    requiredWords.forEach(kw => {
        const regex = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (regex.test(productNameLower)) {
            wordsFound++;
        }
    });
    return wordsFound / requiredWords.length;
}

// --- Statistical Helper Functions ---
const mean = (arr) => arr.reduce((acc, val) => acc + val, 0) / arr.length;
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

/** Smarter Checklist function */
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) return { pass: false, score: 0 };
    // --- MODIFICATION (Mark 46): Use ingredient_id if available for logging ---
    const logId = ingredientData.ingredient_id || ingredientData.originalIngredient;
    const { requiredWords = [], negativeKeywords = [], allowedCategories = [] } = ingredientData;
    const checkLogPrefix = `Checklist [${logId}] for "${product.product_name}"`;

    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }
    if (negativeKeywords && negativeKeywords.length > 0) {
        const negativeWordFound = negativeKeywords.find(kw => productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }
    const score = calculateRequiredWordScore(productNameLower, requiredWords || []);
    if (score < REQUIRED_WORD_SCORE_THRESHOLD) {
        log(`${checkLogPrefix}: FAIL (Score ${score.toFixed(2)} < ${REQUIRED_WORD_SCORE_THRESHOLD} vs [${(requiredWords || []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: score };
    }
    const productCategory = product.product_category?.toLowerCase() || '';
    if (allowedCategories && allowedCategories.length > 0 && productCategory) {
        const hasCategoryMatch = allowedCategories.some(allowedCat => productCategory.includes(allowedCat.toLowerCase()));
        if (!hasCategoryMatch) {
            log(`${checkLogPrefix}: FAIL (Category Mismatch: Product category "${productCategory}" not in allowlist [${allowedCategories.join(', ')}])`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: score };
        }
    }
    log(`${checkLogPrefix}: PASS (Score: ${score.toFixed(2)})`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: score };
}


function isCreativePrompt(cuisinePrompt) {
    // (Existing logic - unchanged)
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false;
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'british', 'german', 'russian', 'brazilian', 'caribbean', 'african', 'middle eastern', 'spicy', 'mild', 'sweet', 'sour', 'savoury', 'quick', 'easy', 'simple', 'fast', 'budget', 'cheap', 'healthy', 'low carb', 'keto', 'low fat', 'high protein', 'high fiber', 'vegetarian', 'vegan', 'gluten free', 'dairy free', 'pescatarian', 'paleo'];
    const promptLower = cuisinePrompt.toLowerCase().trim();
    if (simpleKeywords.some(kw => promptLower === kw)) return false;
    if (promptLower.startsWith("high ") || promptLower.startsWith("low ")) return false;
    return cuisinePrompt.length > 30 || cuisinePrompt.includes(' like ') || cuisinePrompt.includes(' inspired by ') || cuisinePrompt.includes(' themed ');
}

/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        try {
            const logEntry = { /* ... existing log structure ... */
                timestamp: new Date().toISOString(),
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    typeof value === 'object' && value !== null ? value : value
                )) : null
            };
            logs.push(logEntry);
            console.log(`[${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
             if (data && (level === 'ERROR' || level === 'CRITICAL' || level === 'WARN')) {
                 console.warn("Log Data:", data);
             }
            return logEntry;
        } catch (error) {
            const fallbackEntry = { /* ... fallback log structure ... */
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
        const { store, cuisine, days, goal, weight, eatingOccasions } = formData;

        if (!store || !days || !goal || isNaN(parseFloat(formData.weight)) || isNaN(parseFloat(formData.height))) {
             log("CRITICAL: Missing core form data (store, days, goal, weight, or height). Cannot calculate plan.", 'CRITICAL', 'INPUT', getSanitizedFormData(formData));
             throw new Error("Missing critical profile data required for plan generation (store, days, goal, weight, height).");
        }

        const numDays = parseInt(days, 10);
        if (isNaN(numDays) || numDays < 1 || numDays > 7) {
             log(`Invalid number of days: ${days}. Proceeding with default 1.`, 'WARN', 'INPUT');
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
        const { proteinGrams, fatGrams, carbGrams } = calculateMacroTargets(calorieTarget, goal, weightKg, log);
        const dailyNutritionalTargets = { calories: calorieTarget, protein: proteinGrams, fat: fatGrams, carbs: carbGrams };

        // --- AI Phase 1 (Idea Chef) ---
        log(`AI Phase 1: Generating Ideas & Structured Plan...`, 'INFO', 'PHASE');
        const llmResult = await generateLLMPlanAndMeals_Phase1(formData, dailyNutritionalTargets, creativeIdeas, log); // Pass targets object

        // --- MODIFICATION (Mark 46): Use structured meal plan ---
        const { ingredients: rawIngredientPlan, mealPlan: structuredMealPlan } = llmResult || {};

        if (!Array.isArray(rawIngredientPlan) || rawIngredientPlan.length === 0) {
            log("Blueprint fail: No ingredients returned by AI.", 'CRITICAL', 'LLM', { result: llmResult });
            throw new Error("Blueprint fail: AI did not return any ingredients.");
        }
         // --- NEW (Mark 46): Validate structured meal plan ---
         if (!Array.isArray(structuredMealPlan) || structuredMealPlan.length === 0 || !structuredMealPlan[0].meals || structuredMealPlan[0].meals.length === 0) {
             log("Blueprint fail: No valid structured meal plan returned by AI.", 'CRITICAL', 'LLM', { result: llmResult });
             throw new Error("Blueprint fail: AI did not return a valid structured meal plan.");
         }

        // Sanitize ingredients
        // --- MODIFICATION (Mark 46): Add ingredient_id to validation ---
        const ingredientPlan = rawIngredientPlan.filter(ing => ing && ing.ingredient_id && ing.originalIngredient && ing.normalQuery && ing.nutritionQuery && ing.requiredWords && ing.negativeKeywords);
        if (ingredientPlan.length !== rawIngredientPlan.length) {
            log(`Sanitized ingredient list: removed ${rawIngredientPlan.length - ingredientPlan.length} invalid entries (missing required fields including ingredient_id).`, 'WARN', 'DATA');
        }
        if (ingredientPlan.length === 0) {
            log("Blueprint fail: All ingredients failed sanitization.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint fail: AI returned invalid ingredient data after sanitization.");
        }

        // --- NEW (Mark 46): Create ingredient map for easy lookup by ID ---
        const ingredientMapById = ingredientPlan.reduce((map, ing) => {
            map[ing.ingredient_id] = ing;
            return map;
        }, {});
        
        log(`AI Phase 1 success: ${ingredientPlan.length} valid ingredients, ${structuredMealPlan.length} day(s) in meal plan.`, 'SUCCESS', 'PHASE');
        ingredientPlan.forEach((ing, index) => {
            log(`AI Ingredient ${index + 1}: ${ing.ingredient_id} (${ing.originalIngredient})`, 'DEBUG', 'DATA', ing);
        });

        // --- Execute Phases 3 & 4 (Market Run & Nutrition Fetch) ---
        // --- MODIFICATION (Mark 46): Pass ingredientPlan to key nutrition map ---
        const { finalResults, finalDailyTotals, nutritionDataMap } = await executeMarketAndNutrition(ingredientPlan, numDays, store, log);

        // --- Phase 5 (Solver) & Phase 6 (AI Food Writer) ---
        log("Phase 5 & 6: Running Solver and AI Food Writer...", 'INFO', 'PHASE');
        // --- MODIFICATION (Mark 46): Pass structured meal plan and ingredient map ---
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
                log(`Solver calculated grams for "${ingredientId}", but its original name wasn't found in finalResults. Adding dummy entry.`, 'WARN', 'SOLVER');
                 finalResults[originalIngredientName] = { // Add using name for frontend key
                      ingredient_id: ingredientId, // Keep ID for reference
                      originalIngredient: originalIngredientName,
                      source: 'solver_only',
                      totalGramsRequired: finalIngredientTotals[ingredientId].totalGrams,
                      quantityUnits: finalIngredientTotals[ingredientId].quantityUnits,
                      allProducts: [],
                      currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url
                 };
            }
        }

        // --- Phase 7: Assembling Final Response ---
        log("Phase 7: Final Response...", 'INFO', 'PHASE');
        const finalResponseData = {
            // --- MODIFICATION (Mark 46): Return the plan with solution details ---
            mealPlan: finalMealPlanWithSolution,
            uniqueIngredients: ingredientPlan.map(({ ingredient_id, originalIngredient, category, quantityUnits }) => ({ ingredient_id, originalIngredient, category, quantityUnits })), // Frontend needs original name
            results: finalResults, // The market data + solved gram totals (keyed by original name)
            nutritionalTargets: actualSolvedDailyTotals // The *actual* solved totals
        };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL Orchestrator ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error("ORCHESTRATOR UNHANDLED ERROR:", error);
        return response.status(500).json({ message: "An unrecoverable server error occurred during plan generation.", error: error.message, logs });
    }
}
// --- END MAIN HANDLER ---


/**
 * Helper to run Market & Nutrition phases (Phases 3 & 4).
 * @param {Array} ingredientPlan - The FULL ingredient list from the LLM, including ingredient_id.
 * @returns {Object} - { finalResults, finalDailyTotals, nutritionDataMap }
 */
async function executeMarketAndNutrition(ingredientPlan, numDays, store, log) {

    // --- Phase 3: Market Run (Parallel & Optimized) ---
    log("Phase 3: Parallel Market Run...", 'INFO', 'PHASE');

    const processSingleIngredientOptimized = async (ingredient) => {
        try {
            // --- MODIFICATION (Mark 46): Use originalIngredient for market lookups/logs, but keep ID ---
            const ingredientKey = ingredient.originalIngredient;
            const ingredientId = ingredient.ingredient_id;
            const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
            let foundProduct = null;
            let bestScoreSoFar = -1;
            const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];
            let bucketWaitMs = 0;

            for (const [index, { type, query }] of queriesToTry.entries()) {
                // (Existing query loop logic - unchanged, uses ingredientKey for logs)
                if (!query) { result.searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0}); continue; }
                log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
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
                let pageBestScore = -1;
                for (const rawProduct of rawProducts) {
                    const checklistResult = runSmarterChecklist(rawProduct, ingredient, log); // Pass full ingredient object
                    if (checklistResult.pass) {
                        validProductsOnPage.push({ product: { name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size) }, score: checklistResult.score });
                        pageBestScore = Math.max(pageBestScore, checklistResult.score);
                    }
                }
                const filteredProducts = applyPriceOutlierGuard(validProductsOnPage, log, ingredientKey);
                currentAttemptLog.foundCount = filteredProducts.length;
                currentAttemptLog.bestScore = pageBestScore;
                if (filteredProducts.length > 0) {
                    log(`[${ingredientKey}] Found ${filteredProducts.length} valid (${type}, Score: ${pageBestScore.toFixed(2)}).`, 'INFO', 'DATA');
                    const currentUrls = new Set(result.allProducts.map(p => p.url));
                    filteredProducts.forEach(vp => { if (!currentUrls.has(vp.product.url)) { result.allProducts.push(vp.product); currentUrls.add(vp.product.url); } });
                    foundProduct = result.allProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, result.allProducts[0]);
                    result.currentSelectionURL = foundProduct.url;
                    result.source = 'discovery';
                    currentAttemptLog.status = 'success';
                    bestScoreSoFar = Math.max(bestScoreSoFar, pageBestScore);
                    // (Telemetry capture logic - unchanged)
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
                         accepted_query_idx: index,
                         accepted_query_type: type,
                         pages_touched: 1, // Simplified assumption
                         kept_count: result.allProducts.length,
                         price_z: priceZ !== null ? parseFloat(priceZ.toFixed(2)) : null,
                         mode: 'speed',
                         bucket_wait_ms: bucketWaitMs
                     });

                    if (type === 'tight' && bestScoreSoFar >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                        log(`[${ingredientKey}] Skip heuristic hit (Score ${bestScoreSoFar.toFixed(2)}).`, 'INFO', 'MARKET_RUN');
                        break;
                    }
                    break; // "speed" mode
                } else {
                    log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA');
                    currentAttemptLog.status = 'no_match';
                }
            } // End query loop

            if (result.source === 'failed') { log(`[${ingredientKey}] Definitive fail.`, 'WARN', 'MARKET_RUN'); }
            // --- MODIFICATION (Mark 46): Return keyed by originalIngredient name for consistency, but keep ID ---
            return { [ingredientKey]: { ...result, ingredient_id: ingredientId } };

        } catch(e) {
            log(`CRITICAL Error processing single ingredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
             // --- MODIFICATION (Mark 46): Return keyed by originalIngredient name ---
            return { [ingredient?.originalIngredient || 'unknown_error_item']: { ...(ingredient || {}), source: 'error', error: e.message } };
        }
    }; // End processSingleIngredient

    log(`Market Run: ${ingredientPlan.length} ingredients, K=${MAX_MARKET_RUN_CONCURRENCY}...`, 'INFO', 'MARKET_RUN');
    const startMarketTime = Date.now();
    const parallelResultsArray = await concurrentlyMap(ingredientPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
    const endMarketTime = Date.now();
    log(`Market Run parallel took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

    // --- MODIFICATION (Mark 46): Reduce back into map keyed by originalIngredient name ---
    const finalResults = parallelResultsArray.reduce((acc, currentResult) => {
        if (!currentResult) { log(`Received null/undefined result from concurrentlyMap`, 'ERROR', 'SYSTEM'); return acc; }
        // Handle concurrentlyMap errors (now includes itemIdentifier)
        if (currentResult.error && currentResult.itemIdentifier) {
            const id = currentResult.itemIdentifier;
            const originalName = ingredientPlan.find(i => i.ingredient_id === id)?.originalIngredient || id;
            log(`ConcurrentlyMap Error for "${id}": ${currentResult.error}`, 'CRITICAL', 'MARKET_RUN');
            const failedIngredientData = ingredientPlan.find(i => i.ingredient_id === id);
            acc[originalName] = { ...(failedIngredientData || { originalIngredient: originalName, ingredient_id: id }), source: 'error', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: currentResult.error}] };
            return acc;
        }
        // Handle processing errors within processSingleIngredientOptimized
        const ingredientKey = Object.keys(currentResult)[0]; // This is originalIngredient name
        if(ingredientKey && currentResult[ingredientKey]?.source === 'error') {
            log(`Processing Error for "${ingredientKey}": ${currentResult[ingredientKey].error}`, 'CRITICAL', 'MARKET_RUN');
            const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === ingredientKey);
            acc[ingredientKey] = { ...(failedIngredientData || { originalIngredient: ingredientKey }), source: 'error', error: currentResult[ingredientKey].error, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url };
            return acc;
        }
        // Add successful result
        return { ...acc, ...currentResult };
    }, {});


    log("Market Run complete.", 'SUCCESS', 'PHASE');


    // --- Phase 4: Nutrition Calculation ---
    log("Phase 4: Nutrition Calculation...", 'INFO', 'PHASE');
    // --- MODIFICATION (Mark 46): Initialize nutritionDataMap keyed by ingredient_id ---
    const nutritionDataMap = {}; // Key: ingredient_id, Value: { per_g: {...} }
    let finalDailyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    const itemsToFetchNutrition = [];

    // --- MODIFICATION (Mark 46): Iterate ingredientPlan to ensure we have ID ---
    for (const ingredient of ingredientPlan) {
        const key = ingredient.originalIngredient; // Key for finalResults lookup
        const id = ingredient.ingredient_id;
        const result = finalResults[key]; // Get market result using name

        if (result && result.source === 'discovery') {
            const selected = result.allProducts?.find(p => p.url === result.currentSelectionURL);
            const barcodeToUse = selected?.barcode;
            const queryToUse = ingredient.nutritionQuery; // Use the generic query

            if (barcodeToUse || queryToUse) {
                 itemsToFetchNutrition.push({
                     ingredient_id: id, // Pass ID
                     ingredientKey: key, // Pass original name for logging
                     barcode: barcodeToUse,
                     query: queryToUse
                 });
            } else {
                 log(`[${key}/${id}] Cannot fetch nutrition: Missing both barcode and nutritionQuery.`, 'WARN', 'NUTRITION');
            }
        } else if (result && (result.source === 'failed' || result.source === 'error')) {
            log(`[${key}/${id}] Market Run failed, cannot fetch nutrition.`, 'WARN', 'MARKET_RUN');
        } else if (!result) {
            log(`[${key}/${id}] Ingredient missing from Market Run results.`, 'WARN', 'DATA');
        }
    }

    if (itemsToFetchNutrition.length > 0) {
        log(`Fetching/Calculating nutrition for ${itemsToFetchNutrition.length} ingredients using barcode or generic query...`, 'INFO', 'HTTP');
        const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, (item) =>
            fetchNutritionData(item.barcode, item.query, log)
                .then(nut => ({ ...item, nut }))
                .catch(err => {
                    log(`Unhandled Nutri fetch error for "${item.ingredient_id}" (Query: ${item.query}): ${err.message}`, 'CRITICAL', 'HTTP');
                    return { ...item, nut: { status: 'not_found', error: 'Unhandled fetch error' } };
                })
        );

        log("Nutrition fetch/calc complete.", 'SUCCESS', 'HTTP');

        // --- MODIFICATION (Mark 46): Populate nutritionDataMap keyed by ingredient_id ---
        nutritionResults.forEach(item => {
            const id = item.ingredient_id;
            if (item.nut?.status === 'found') {
                // Store nutrition data per gram, keyed by ID
                nutritionDataMap[id] = {
                    per_g: {
                        kcal: (item.nut.calories || 0) / 100,
                        p: (item.nut.protein || 0) / 100,
                        f: (item.nut.fat || 0) / 100,
                        c: (item.nut.carbs || 0) / 100,
                    },
                    // Add other useful info if available, like density (g/ml) for liquids?
                    // density_g_per_ml: item.nut.density || null
                    source: item.nut.source || 'unknown',
                    category: ingredientPlan.find(i => i.ingredient_id === id)?.category || 'default'
                };
                 log(`Nutrition found for "${id}" (Using: ${item.barcode ? 'barcode' : `query '${item.query}'`}, Source: ${item.nut.source})`, 'INFO', 'NUTRITION');
            } else {
                 log(`No nutrition data found for "${id}" (Tried: ${item.barcode ? `barcode ${item.barcode} & ` : ''}query '${item.query}'). It will be excluded from the solver.`, 'WARN', 'NUTRITION');
            }

            // Attach full nutrition result to the corresponding product in finalResults (still keyed by name)
            const result = finalResults[item.ingredientKey];
             if (result && result.allProducts && result.currentSelectionURL) {
                 const selectedProduct = result.allProducts.find(p => p.url === result.currentSelectionURL);
                 if (selectedProduct) {
                     selectedProduct.nutrition = item.nut;
                 }
             }
        });

        log("Nutrition data mapped by ingredient_id. Solver will calculate totals.", 'INFO', 'CALC');

    } else {
        log("No valid ingredients required nutrition calculation.", 'WARN', 'CALC');
    }

    return { finalResults, finalDailyTotals, nutritionDataMap };
};
// --- END OF executeMarketAndNutrition HELPER ---


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


async function generateCreativeIdeas(cuisinePrompt, log) {
    // (Existing logic - unchanged)
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const sysPrompt=`Creative chef... comma-separated list.`;
    const userQuery=`Theme: "${cuisinePrompt}"...`;
    log("Creative Prompt",'INFO','LLM_PROMPT',{userQuery});
    const payload={contents:[{parts:[{text:userQuery}]}],systemInstruction:{parts:[{text:sysPrompt}]}};
    try{
        const res=await fetchWithRetry(GEMINI_API_URL,{ method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key': GEMINI_API_KEY }, body:JSON.stringify(payload) }, log);
        const result = await res.json(); const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string' || text.length === 0) { log("Creative AI returned non-string or empty text.", 'WARN', 'LLM', { result }); throw new Error("Creative AI empty or invalid text."); }
        log("Creative Raw",'INFO','LLM',{raw:text.substring(0,500)}); return text;
    } catch(e){ log(`Creative AI failed: ${e.message}`,'CRITICAL','LLM'); return ""; }
}

// --- MODIFICATION (Mark 46): Updated AI Phase 1 for Stable IDs ---
async function generateLLMPlanAndMeals_Phase1(formData, dailyNutritionalTargets, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2;
    const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.');
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms." : "";

    // --- UPDATED SYSTEM PROMPT (Mark 46) ---
    const systemPrompt = `Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate shopping list ('ingredients') & meal plan ('mealPlan'). 2. INGREDIENTS: For each: a. 'originalIngredient': Full descriptive name. b. 'ingredient_id': UNIQUE slug (e.g., 'ing_chicken_breast', 'ing_rolled_oats'). Use ONLY this ID for links. c. 'tightQuery', 'normalQuery', 'wideQuery', 'nutritionQuery': As defined below. d. 'requiredWords': Array[1] CORE NOUN, lowercase (e.g., ["chicken"], ["oats"], ["spinach"], ["eggs"], ["tomatoes"]). e. 'negativeKeywords': Array[1-5] lowercase exclusions. f. 'category' (optional). g. 'allowedCategories' (optional). 3. QUERIES: a. 'tightQuery': Hyper-specific, STORE-PREFIXED. b. 'normalQuery': 2-3 CORE GENERIC WORDS ONLY, STORE-PREFIXED. EXCLUDE ALL modifiers: brands, sizes, forms (diced/shredded/spray), fat content, prep (microwave/canned). JUST CORE NAME (e.g., "Coles brown rice", "Coles tuna").${australianTermNote} c. 'wideQuery': 1-2 broad words, STORE-PREFIXED. d. 'nutritionQuery': 1-2 CORE GENERIC WORDS ONLY, *NO STORE PREFIX*. For generic nutrition lookup (e.g., "chicken breast", "rolled oats"). 4. MEAL PLAN: Array of days. Each day: a. 'day_id': YYYY-MM-DD or simple day number. b. 'meals': Array of meals. Each meal: i. 'meal_id': UNIQUE slug (e.g., 'd1_m1_oats'). ii. 'title': Appealing name. iii. 'type': 'B', 'L', 'D', 'S1', 'S2'. iv. 'targets': {'kcal': INT, 'p': INT, 'c': INT, 'f': INT}. Calculate these by distributing daily targets based on meal type (e.g., B=20%, L=30%, D=30%, S=10% each). v. 'tol' (Tolerances): {'kcal': INT, 'p': INT, 'c': INT, 'f': INT}. Set reasonable ± tolerances (e.g., kcal±50, p±10, c±15, f±10). vi. 'items': Array of ingredients for this meal: {'ingredient_id': ID_FROM_LIST, 'display_name': originalIngredient, 'min_g': INT (usually 0), 'max_g': INT (e.g., 500)}. Include ALL ingredients needed for the meal. 'display_name' is UI ONLY. ALL JOINS USE ingredient_id. 5. VARIETY: Max repetitions per meal title = ${maxRepetitions}. Ensure variety across days if needed. 6. CONSISTENCY: Ensure every ingredient_id used in mealPlan.items exists in the main 'ingredients' list.`;

    const userQuery = `Gen ${days}-day plan for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Daily Target: ~${dailyNutritionalTargets.calories} kcal (P ~${dailyNutritionalTargets.protein}g, F ~${dailyNutritionalTargets.fat}g, C ~${dailyNutritionalTargets.carbs}g). Dietary: ${dietary}. Meals per day: ${eatingOccasions}. Spend: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}. Cuisine: ${cuisineInstruction}. Return JSON matching schema.`;

    if (userQuery.trim().length < 50) {
        log("Critical Input Failure: User query too short.", 'CRITICAL', 'LLM_PAYLOAD', { userQuery: userQuery, sanitizedData: getSanitizedFormData(formData) });
        throw new Error("Cannot generate plan: Invalid input data caused an empty prompt.");
    }

    log("Technical Prompt (Phase 1 - IDs & Structure)", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...', sanitizedData: getSanitizedFormData(formData) });

    // --- UPDATED SCHEMA (Mark 46) ---
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "ingredients": { // Top-level list of all unique ingredients
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "ingredient_id": { "type": "STRING" },
                                "originalIngredient": { "type": "STRING" },
                                "category": { "type": "STRING", nullable: true },
                                "tightQuery": { "type": "STRING", nullable: true },
                                "normalQuery": { "type": "STRING" },
                                "wideQuery": { "type": "STRING", nullable: true },
                                "nutritionQuery": { "type": "STRING" },
                                "requiredWords": { type: "ARRAY", items: { "type": "STRING" } },
                                "negativeKeywords": { type: "ARRAY", items: { "type": "STRING" } },
                                "allowedCategories": { type: "ARRAY", items: { "type": "STRING" }, nullable: true }
                            },
                            required: ["ingredient_id", "originalIngredient", "normalQuery", "nutritionQuery", "requiredWords", "negativeKeywords"]
                        }
                    },
                    "mealPlan": { // Array of days
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "day_id": { "type": "STRING" }, // Or NUMBER
                                "meals": { // Array of meals for the day
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            "meal_id": { "type": "STRING" },
                                            "title": { "type": "STRING" },
                                            "type": { "type": "STRING", "enum": ["B", "L", "D", "S1", "S2"] }, // Use codes directly
                                            "targets": {
                                                type: "OBJECT",
                                                properties: { "kcal": { "type": "NUMBER" }, "p": { "type": "NUMBER" }, "c": { "type": "NUMBER" }, "f": { "type": "NUMBER" } },
                                                required: ["kcal", "p", "c", "f"]
                                            },
                                            "tol": { // Tolerances
                                                type: "OBJECT",
                                                properties: { "kcal": { "type": "NUMBER" }, "p": { "type": "NUMBER" }, "c": { "type": "NUMBER" }, "f": { "type": "NUMBER" } },
                                                required: ["kcal", "p", "c", "f"]
                                            },
                                            "items": { // List of ingredients for this meal
                                                type: "ARRAY",
                                                items: {
                                                    type: "OBJECT",
                                                    properties: {
                                                        "ingredient_id": { "type": "STRING" },
                                                        "display_name": { "type": "STRING" },
                                                        "min_g": { "type": "NUMBER" },
                                                        "max_g": { "type": "NUMBER" }
                                                    },
                                                    required: ["ingredient_id", "display_name", "min_g", "max_g"]
                                                }
                                            }
                                        },
                                        required: ["meal_id", "title", "type", "targets", "tol", "items"]
                                    }
                                }
                            },
                            required: ["day_id", "meals"]
                        }
                    }
                },
                required: ["ingredients", "mealPlan"]
            }
        }
    };
    // --- END UPDATE ---

    try {
        const response = await fetchWithRetry( GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(payload) }, log );
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) { log("Technical AI (Phase 1) returned no JSON text.", 'CRITICAL', 'LLM', result); throw new Error("LLM response was empty."); }
        log("Technical Raw (Phase 1)", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });
        try {
            const parsed = JSON.parse(jsonText);
            log("Parsed Technical (Phase 1)", 'INFO', 'DATA', { ingreds: parsed.ingredients?.length || 0, days: parsed.mealPlan?.length || 0 });
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.mealPlan)) { throw new Error("LLM response missing required fields or invalid structure."); }
            return parsed;
        } catch (e) { log("Failed to parse Technical AI (Phase 1) JSON.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: e.message }); throw new Error(`Failed to parse LLM JSON: ${e.message}`); }
    } catch (error) { log(`Technical AI (Phase 1) call failed definitively: ${error.message}`, 'CRITICAL', 'LLM'); throw error; }
}


// --- AI Phase 2 (Food Writer) - Modified Input (Mark 46) ---
/**
 * Calls the LLM to write a human-readable meal description.
 * Accepts a list of { display_name, grams }.
 */
async function generateLLMMealDescription_Phase2(mealTitle, mealType, solvedItems, log) { // Input is now Array<{ display_name, grams }>
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const systemPrompt = `You are a food writer... RULES: 1. Incorporate all ingredients and their exact gram amounts (e.g., "210g", "75g"). 2. Be concise and appealing. 3. DO NOT add ingredients not listed. 4. Ignore 0g ingredients. 5. Assume grams are raw/dry unless noted.`;

    const ingredientList = solvedItems
        .filter(item => item.grams > 0)
        .map(item => `${item.grams}g ${item.display_name}`)
        .join(', ');

    if (!ingredientList) {
        log(`AI Phase 2: No non-zero ingredients for ${mealTitle}, returning simple title.`, 'WARN', 'LLM');
        return mealTitle;
    }

    const userQuery = `Write a description for a ${mealType} called "${mealTitle}" containing: ${ingredientList}`;
    log("AI Phase 2 Prompt", 'INFO', 'LLM_PROMPT', { userQuery });
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] } };

    try {
        const res = await fetchWithRetry( GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(payload) }, log );
        const result = await res.json(); const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string' || text.length === 0) { log("AI Phase 2 returned non-string or empty text.", 'WARN', 'LLM', { result }); return `A meal of ${ingredientList}`; }
        log("AI Phase 2 Raw", 'INFO', 'LLM', { raw: text }); return text.trim();
    } catch(e){ log(`AI Phase 2 (Food Writer) failed: ${e.message}`, 'CRITICAL', 'LLM'); return `A meal of ${ingredientList}`; }
}
// --- END UPDATE ---


/// ===== API-CALLERS-END ===== ////


// --- NEW (Mark 46): LP Solver Implementation ---

/** Helper to extract solver inputs using ingredient_id */
function buildMealInputs(meal, nutritionDataMap, log) {
  const rows = [];
  for (const it of meal.items) {
    const nut = nutritionDataMap[it.ingredient_id];
    if (!nut || !nut.per_g) { // Check for per_g specifically
      log(`[Meal: ${meal.title}] Skipping "${it.display_name}" (${it.ingredient_id}) in solver: Missing nutrition data.`, 'WARN', 'SOLVER_INPUT');
      continue;
    }
    rows.push({
      id: it.ingredient_id, // Use ID as the variable name
      display_name: it.display_name, // Keep for logging/output
      min_g: it.min_g ?? 0,
      max_g: it.max_g ?? 1000, // Default max if not provided
      kcal: nut.per_g.kcal || 0, // Default to 0 if missing
      p: nut.per_g.p || 0,
      c: nut.per_g.c || 0,
      f: nut.per_g.f || 0
    });
  }
  // Use targets defined by AI for this meal
  return { rows, targets: meal.targets, tolerances: meal.tol };
}


/** Builds the LP model for javascript-lp-solver */
function buildLP(rows, targets, tolerances, log) {
    const model = {
        optimize: "obj", // Target the objective function
        opType: "min",   // Minimize deviations (implicitly)
        constraints: {},
        variables: {},
        // --- NEW: Add integers object for gram rounding ---
        ints: {}
    };

    // Ingredient variables q_i (grams)
    for (const r of rows) {
        model.variables[r.id] = {
            // Objective: tiny penalty on grams to encourage less complex solutions if multiple optimal exist
            obj: 1e-4,
        };
         // --- NEW: Grams should be integers ---
         model.ints[r.id] = 1;

        // Add bounds directly to variables
        model.variables[r.id].min = r.min_g;
        model.variables[r.id].max = r.max_g;
    }

    // Constraints for each macro (within tolerance)
    const macros = ['kcal', 'p', 'c', 'f'];
    macros.forEach(macro => {
        const target = targets[macro];
        const tolerance = tolerances[macro];
        const lowerBound = target - tolerance;
        const upperBound = target + tolerance;

        // Define the constraint names
        const constraintLo = `${macro}_lo`;
        const constraintHi = `${macro}_hi`;

        // Add constraints to the model
        model.constraints[constraintLo] = { min: lowerBound };
        model.constraints[constraintHi] = { max: upperBound };

        // Add coefficients for each ingredient variable to these constraints
        for (const r of rows) {
            model.variables[r.id][constraintLo] = r[macro];
            model.variables[r.id][constraintHi] = r[macro];
        }
    });
    log("LP Model built", "DEBUG", "LP_SOLVER", { variables: Object.keys(model.variables), constraints: Object.keys(model.constraints) });
    return model;
}

/** Solves the meal LP model */
function solveMealLP(meal, nutritionDataMap, log) {
    const { rows, targets, tolerances } = buildMealInputs(meal, nutritionDataMap, log);
    if (rows.length === 0) {
        log(`[Meal: ${meal.title}] LP Solver skipped: No ingredients with nutrition data.`, 'WARN', 'LP_SOLVER');
        return { solution: [], note: "no_ingredients", feasible: false };
    }

    const model = buildLP(rows, targets, tolerances, log);
    let lpResult = null;
    try {
        lpResult = solver.Solve(model);
        log(`[Meal: ${meal.title}] LP Solver Result:`, "INFO", "LP_SOLVER", lpResult);
    } catch (e) {
         log(`[Meal: ${meal.title}] LP Solver CRASHED: ${e.message}`, 'CRITICAL', 'LP_SOLVER', { model });
         return { solution: [], note: "lp_crash", feasible: false };
    }


    if (!lpResult || !lpResult.feasible) {
         log(`[Meal: ${meal.title}] LP Solver failed or returned infeasible solution.`, 'WARN', 'LP_SOLVER', { result: lpResult });
        return { solution: [], note: "lp_infeasible", feasible: false };
    }

    // Map result back to { ingredient_id, display_name, grams } format
    const solution = rows.map(r => {
        const grams = lpResult[r.id] ?? 0;
        return {
            ingredient_id: r.id,
            display_name: r.display_name,
            grams: Math.max(0, Math.round(grams)) // Ensure non-negative and round
        };
    });

    return { solution, note: "lp_success", feasible: true };
}
// --- END LP Solver ---


// --- NEW (Mark 46): Iterative Heuristic Fallback ---
function solveHeuristic(meal, nutritionDataMap, log) {
    const { rows, targets, tolerances } = buildMealInputs(meal, nutritionDataMap, log);
     if (rows.length === 0) {
        log(`[Meal: ${meal.title}] Heuristic Solver skipped: No ingredients with nutrition data.`, 'WARN', 'HEURISTIC_SOLVER');
        return { solution: [], note: "no_ingredients" };
    }

    const q = Object.fromEntries(rows.map(r => [r.id, r.min_g])); // Start quantities at minimum

    const calculateTotalsAndError = (currentQuantities) => {
        let kcal = 0, p = 0, c = 0, f = 0;
        for (const r of rows) {
            const g = currentQuantities[r.id];
            kcal += r.kcal * g;
            p += r.p * g;
            c += r.c * g;
            f += r.f * g;
        }
        // Weighted error (prioritize calories/protein more)
        const err = (
            Math.abs(kcal - targets.kcal) * 1.0 +
            Math.abs(p - targets.p) * 2.0 +
            Math.abs(c - targets.c) * 0.7 +
            Math.abs(f - targets.f) * 0.7
        );
        return { kcal, p, c, f, err };
    };

    let step = 40; // Initial large step size
    let lastState = calculateTotalsAndError(q);
    let iterations = 0;
    const MAX_ITERATIONS = 500; // Prevent infinite loops

    log(`[Meal: ${meal.title}] Heuristic Start`, 'DEBUG', 'HEURISTIC_SOLVER', { targets, initial_q: q, initial_err: lastState.err });

    while (step >= 5 && iterations < MAX_ITERATIONS) {
        let improvedThisCycle = false;
        // Shuffle rows to avoid bias towards ingredients listed first
        const shuffledRows = [...rows].sort(() => Math.random() - 0.5);

        for (const r of shuffledRows) {
            // Try increasing
            if (q[r.id] + step <= r.max_g) {
                q[r.id] += step;
                const newState = calculateTotalsAndError(q);
                if (newState.err < lastState.err) {
                    lastState = newState;
                    improvedThisCycle = true;
                    // Don't revert q[r.id] - keep the improvement
                     log(`Heuristic Iter ${iterations}: +${step}g ${r.id} -> Err ${newState.err.toFixed(1)}`, 'DEBUG', 'HEURISTIC_SOLVER');
                } else {
                    q[r.id] -= step; // Revert if no improvement
                }
            }
             // Try decreasing (only if above minimum) - less common but can help balance
             if (!improvedThisCycle && q[r.id] - step >= r.min_g) {
                 q[r.id] -= step;
                 const newState = calculateTotalsAndError(q);
                 if (newState.err < lastState.err) {
                     lastState = newState;
                     improvedThisCycle = true;
                      log(`Heuristic Iter ${iterations}: -${step}g ${r.id} -> Err ${newState.err.toFixed(1)}`, 'DEBUG', 'HEURISTIC_SOLVER');
                 } else {
                     q[r.id] += step; // Revert
                 }
             }
        }

        if (!improvedThisCycle) {
            step = Math.floor(step / 2); // Reduce step size if no improvement found in a full cycle
            log(`Heuristic Iter ${iterations}: No improvement found. Reducing step to ${step}g. Current Err ${lastState.err.toFixed(1)}`, 'DEBUG', 'HEURISTIC_SOLVER');
        }
        iterations++;
    }

     if (iterations >= MAX_ITERATIONS) {
         log(`[Meal: ${meal.title}] Heuristic Solver stopped: Max iterations reached.`, 'WARN', 'HEURISTIC_SOLVER');
     } else {
          log(`[Meal: ${meal.title}] Heuristic Solver finished in ${iterations} iterations. Final Err: ${lastState.err.toFixed(1)}`, 'INFO', 'HEURISTIC_SOLVER');
     }

    // Map result back
    const solution = rows.map(r => ({
        ingredient_id: r.id,
        display_name: r.display_name,
        grams: Math.max(0, Math.round(q[r.id]))
    }));

    return { solution, note: "heuristic_fallback" };
}
// --- END Heuristic Fallback ---


// --- Phase 5 (Solver) & Phase 6 (AI Food Writer) - UPDATED (Mark 46) ---
async function solveAndDescribePlan(structuredMealPlan, finalResults, nutritionDataMap, ingredientMapById, log) {
    const finalMealPlanWithSolution = JSON.parse(JSON.stringify(structuredMealPlan)); // Deep copy
    const finalIngredientTotals = {}; // Key: ingredient_id
    let solvedDailyTotalsAcc = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    let daysProcessed = 0;
    const mealDescriptionPromises = [];

    log("Starting Phase 5: Solving Meals...", 'INFO', 'PHASE');

    for (const day of finalMealPlanWithSolution) {
        if (!day.meals || !Array.isArray(day.meals)) continue;
        daysProcessed++;

        for (const meal of day.meals) {
            log(`Processing Meal: ${meal.title} (${meal.meal_id})`, 'DEBUG', 'SOLVER');

            let solverResult;
            try {
                solverResult = solveMealLP(meal, nutritionDataMap, log); // Primary: LP Solver
                if (!solverResult || !solverResult.feasible) {
                     log(`[Meal: ${meal.title}] LP Solver failed or infeasible, attempting heuristic fallback.`, 'WARN', 'SOLVER_FALLBACK');
                    solverResult = solveHeuristic(meal, nutritionDataMap, log); // Fallback: Heuristic
                }
            } catch (e) {
                log(`[Meal: ${meal.title}] CRITICAL SOLVER ERROR (caught): ${e.message}. Attempting heuristic fallback.`, 'CRITICAL', 'SOLVER_FALLBACK', { stack: e.stack?.substring(0,300) });
                try {
                     solverResult = solveHeuristic(meal, nutritionDataMap, log);
                } catch (heuristicError) {
                     log(`[Meal: ${meal.title}] Heuristic fallback ALSO FAILED: ${heuristicError.message}. Skipping meal solution.`, 'CRITICAL', 'SOLVER_FALLBACK');
                     solverResult = { solution: [], note: "heuristic_crash", feasible: false }; // Mark as failed
                }
            }

            meal.solution = solverResult.solution; // Attach solution: Array<{ ingredient_id, display_name, grams }>
            meal.solver_note = solverResult.note; // Attach note about which solver was used or failure reason

            // Calculate actual macros achieved and update totals
            let mealCals = 0, mealProt = 0, mealFat = 0, mealCarbs = 0;
            if (meal.solution && meal.solution.length > 0) {
                meal.solution.forEach(item => {
                    const id = item.ingredient_id;
                    const grams = item.grams;
                    if (grams > 0) {
                        const nutrition = nutritionDataMap[id]?.per_g;
                        if (nutrition) {
                            mealCals += nutrition.kcal * grams;
                            mealProt += nutrition.p * grams;
                            mealFat += nutrition.f * grams;
                            mealCarbs += nutrition.c * grams;
                        }

                        // Add to grand total (keyed by ID)
                        if (!finalIngredientTotals[id]) {
                            finalIngredientTotals[id] = { totalGrams: 0, quantityUnits: "" };
                        }
                        finalIngredientTotals[id].totalGrams += grams;
                    }
                });
            } else {
                 log(`[Meal: ${meal.title}] No solution found or generated by solver.`, 'WARN', 'SOLVER');
            }

            solvedDailyTotalsAcc.calories += mealCals;
            solvedDailyTotalsAcc.protein += mealProt;
            solvedDailyTotalsAcc.fat += mealFat;
            solvedDailyTotalsAcc.carbs += mealCarbs;

            log(`[Meal: ${meal.title}] Solution (${meal.solver_note}):`, 'DEBUG', 'SOLVER', meal.solution);
            log(`[Meal: ${meal.title}] Solved Macros (Target vs Actual):`, 'DEBUG', 'SOLVER', {
                target: meal.targets,
                actual: { calories: mealCals, protein: mealProt, fat: mealFat, carbs: mealCarbs }
            });
        } // End meal loop
    } // End day loop

    log("Finished Phase 5: Solving Meals.", 'SUCCESS', 'PHASE');

    // Update grand totals with quantityUnits (using ID map to get name for finalResults)
    for (const id in finalIngredientTotals) {
         const ingredientInfo = ingredientMapById[id];
         const originalName = ingredientInfo?.originalIngredient || id;
         const result = finalResults[originalName]; // Look up market data by name
         const product = result?.allProducts?.find(p => p.url === result.currentSelectionURL);
         const parsedSize = product ? parseSize(product.size) : null;
         let units = "units";
         if (parsedSize && parsedSize.value > 0) {
             const totalGrams = finalIngredientTotals[id].totalGrams;
             const numUnits = Math.ceil(totalGrams / parsedSize.value);
             units = `${numUnits} x ${product.size} ${parsedSize.unit === 'g' ? 'pack(s)' : 'bottle(s)'}`;
         } else if (product) {
             units = `(Check size: ${product.size})`;
         }
         finalIngredientTotals[id].quantityUnits = units; // Keep keyed by ID
    }

    // Run AI Phase 2 (Food Writer)
    log("Running AI Phase 2 (Food Writer) for all meals...", 'INFO', 'PHASE');
    for (const day of finalMealPlanWithSolution) {
        for (const meal of day.meals) {
            // Pass the solution array directly
             meal.descriptionPromise = (meal.solution && meal.solution.length > 0)
                ? generateLLMMealDescription_Phase2(meal.title, meal.type, meal.solution, log)
                : Promise.resolve(meal.title); // Fallback if no solution
        }
    }

    // Await all descriptions
    for (const day of finalMealPlanWithSolution) {
        for (const meal of day.meals) {
            meal.description = await meal.descriptionPromise; // Overwrite original description
            delete meal.descriptionPromise; // Clean up
            // Optionally delete targets/tolerances if not needed by frontend
            // delete meal.targets;
            // delete meal.tol;
            // delete meal.items; // Keep solution array instead
        }
    }
    log("AI Phase 2 (Food Writer) complete.", 'SUCCESS', 'PHASE');

    // Calculate final average daily totals
    const avgSolvedTotals = {
        calories: Math.round(solvedDailyTotalsAcc.calories / (daysProcessed || 1)),
        protein: Math.round(solvedDailyTotalsAcc.protein / (daysProcessed || 1)),
        fat: Math.round(solvedDailyTotalsAcc.fat / (daysProcessed || 1)),
        carbs: Math.round(solvedDailyTotalsAcc.carbs / (daysProcessed || 1)),
    };
    log("Final Solved Daily Averages:", 'SUCCESS', 'SOLVER', avgSolvedTotals);

    return {
        finalMealPlanWithSolution,
        finalIngredientTotals, // Keyed by ingredient_id
        solvedDailyTotals: avgSolvedTotals
    };
}
// --- END UPDATE ---


/// ===== NUTRITION-CALC-START ===== \\\\

/** Calorie Target Calculation */
function calculateCalorieTarget(formData, log = console.log) {
    // (Existing logic - unchanged)
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight); const heightCm = parseFloat(height); const ageYears = parseInt(age, 10);
    if (isNaN(weightKg) || isNaN(heightCm) || isNaN(ageYears) || !gender || !activityLevel || !goal) { log("Missing or invalid profile data for calorie calculation, using default 2000.", 'WARN', 'CALC', getSanitizedFormData({ weight, height, age, gender, activityLevel, goal})); return 2000; }
    let bmr = (gender === 'male') ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5) : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 }; let multiplier = activityMultipliers[activityLevel]; if (!multiplier) { log(`Invalid activityLevel "${activityLevel}", using default 1.55.`, 'WARN', 'CALC'); multiplier = 1.55; } const tdee = bmr * multiplier;
    const goalAdjustments = { maintain: 0, cut_moderate: - (tdee * 0.15), cut_aggressive: - (tdee * 0.25), bulk_lean: + (tdee * 0.15), bulk_aggressive: + (tdee * 0.25) }; let adjustment = goalAdjustments[goal]; if (adjustment === undefined) { log(`Invalid goal "${goal}", using default 'maintain' (0 adjustment).`, 'WARN', 'CALC'); adjustment = 0; }
    log(`Calorie Calc: BMR=${bmr.toFixed(0)}, TDEE=${tdee.toFixed(0)}, Goal=${goal}, Adjustment=${adjustment.toFixed(0)}`, 'INFO', 'CALC');
    return Math.max(1200, Math.round(tdee + adjustment));
}


/** Macronutrient Distribution (Dual Validation) */
function calculateMacroTargets(calorieTarget, goal, weightKg, log) {
    // (Existing logic - unchanged)
    const macroSplits = { 'cut_aggressive': { pPct: 0.35, fPct: 0.25, cPct: 0.40 }, 'cut_moderate': { pPct: 0.35, fPct: 0.25, cPct: 0.40 }, 'maintain': { pPct: 0.30, fPct: 0.30, cPct: 0.40 }, 'bulk_lean': { pPct: 0.25, fPct: 0.25, cPct: 0.50 }, 'bulk_aggressive':{ pPct: 0.20, fPct: 0.25, cPct: 0.55 } };
    const split = macroSplits[goal] || macroSplits['maintain']; if (!macroSplits[goal]) { log(`Invalid goal "${goal}" for macro split, using 'maintain' defaults.`, 'WARN', 'CALC'); }
    let proteinGrams = (calorieTarget * split.pPct) / 4; let fatGrams = (calorieTarget * split.fPct) / 9; let carbGrams = (calorieTarget * split.cPct) / 4;
    const validWeightKg = (typeof weightKg === 'number' && weightKg > 0) ? weightKg : 75; let proteinPerKg = proteinGrams / validWeightKg; let fatPerKg = fatGrams / validWeightKg; let fatPercent = (fatGrams * 9) / calorieTarget; let carbsNeedRecalc = false;
    const PROTEIN_MAX_G_PER_KG = 3.0; if (proteinPerKg > PROTEIN_MAX_G_PER_KG) { log(`ADJUSTMENT: Initial protein ${proteinPerKg.toFixed(1)}g/kg > ${PROTEIN_MAX_G_PER_KG}g/kg. Capping protein and recalculating carbs.`, 'WARN', 'CALC'); proteinGrams = PROTEIN_MAX_G_PER_KG * validWeightKg; carbsNeedRecalc = true; }
    const FAT_MAX_PERCENT = 0.35; if (fatPercent > FAT_MAX_PERCENT) { log(`ADJUSTMENT: Initial fat ${fatPercent.toFixed(1)}% > ${FAT_MAX_PERCENT}%. Capping fat and recalculating carbs.`, 'WARN', 'CALC'); fatGrams = (calorieTarget * FAT_MAX_PERCENT) / 9; carbsNeedRecalc = true; }
    if (carbsNeedRecalc) { const proteinCalories = proteinGrams * 4; const fatCalories = fatGrams * 9; const carbCalories = calorieTarget - proteinCalories - fatCalories; carbGrams = carbCalories / 4; log(`RECALC: New Carb Target: ${carbGrams.toFixed(0)}g`, 'INFO', 'CALC'); }
    const PROTEIN_MIN_G_PER_KG = 1.6; const PROTEIN_CUT_MAX_G_PER_KG = 2.4; proteinPerKg = proteinGrams / validWeightKg; if (proteinPerKg < PROTEIN_MIN_G_PER_KG) { log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is below the optimal ${PROTEIN_MIN_G_PER_KG}g/kg range.`, 'INFO', 'CALC'); } if ((goal === 'cut_aggressive' || goal === 'cut_moderate') && proteinPerKg > PROTEIN_CUT_MAX_G_PER_KG) { log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is above the ${PROTEIN_CUT_MAX_G_PER_KG}g/kg recommendation for cutting.`, 'INFO', 'CALC'); }
    const FAT_MIN_G_PER_KG = 0.8; fatPerKg = fatGrams / validWeightKg; if (fatPerKg < FAT_MIN_G_PER_KG) { log(`GUIDELINE: Fat target ${fatPerKg.toFixed(1)}g/kg is below the optimal ${FAT_MIN_G_PER_KG}g/kg minimum.`, 'INFO', 'CALC'); }
    const finalProteinGrams = Math.round(proteinGrams); const finalFatGrams = Math.round(fatGrams); const finalCarbGrams = Math.round(carbGrams);
    log(`Calculated Macro Targets (Dual-Validation) (Goal: ${goal}, Cals: ${calorieTarget}, Weight: ${validWeightKg}kg): P ${finalProteinGrams}g, F ${finalFatGrams}g, C ${finalCarbGrams}g`, 'INFO', 'CALC');
    return { proteinGrams: finalProteinGrams, fatGrams: finalFatGrams, carbGrams: finalCarbGrams };
}

/// ===== NUTRITION-CALC-END ===== \\\\


