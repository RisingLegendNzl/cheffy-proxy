// --- ORCHESTRATOR API for Cheffy V3 ---

// Mark 42: REPLACED macro calculation with industry-standard, dual-validation system.
// Mark 40: PRIVACY FIX - Added redaction for PII (name, age, weight, height) in logs
// Mark 39: CRITICAL SECURITY FIX - Moved API key from URL query to x-goog-api-key header
// ... (rest of changelog)

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
// Now importing the CACHE-WRAPPED versions with SWR and Token Buckets
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

// --- MODIFICATION START: Reinstate GEMINI_API_KEY constant ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// --- MODIFICATION END ---
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent'; // Key removed from here
const MAX_RETRIES = 3; // Retries for Gemini calls
const MAX_NUTRITION_CONCURRENCY = 5; // Concurrency for Nutrition phase
const MAX_MARKET_RUN_CONCURRENCY = 5; // K value for Parallel Market Run
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery', 'filter', 'paper', 'tip', 'shampoo', 'conditioner', 'soap', 'lotion', 'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum']; // Expanded further
const SIZE_TOLERANCE = 0.6; // +/- 60%
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60; // Must match >= 60%
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0; // Score needed on tight query to skip normal/wide
const PRICE_OUTLIER_Z_SCORE = 2.0; // Products with unit price z-score > 2 will be demoted

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- MODIFICATION (Mark 40): Added PII Redaction Helper ---
/**
 * Sanitizes form data to remove Personally Identifiable Information (PII) for logging.
 * @param {object} formData - The raw form data from the user.
 * @returns {object} A new object with PII fields redacted.
 */
function getSanitizedFormData(formData) {
    try {
        const { name, height, weight, age, bodyFat, ...rest } = formData;
        return {
            ...rest, // Keep non-sensitive fields
            user_profile: "[REDACTED]" // Replace sensitive fields with a single key
        };
    } catch (e) {
        // Fallback in case formData is not an object
        return { error: "Failed to sanitize form data." };
    }
}
// --- END MODIFICATION ---

async function concurrentlyMap(array, limit, asyncMapper) {
    const results = [];
    const executing = [];
    for (const item of array) {
        // Wrap asyncMapper call in a promise handler to catch errors and identify the item
        const promise = asyncMapper(item)
            .then(result => {
                // Remove promise from executing list on success
                const index = executing.indexOf(promise);
                if (index > -1) {
                    executing.splice(index, 1);
                }
                return result; // Forward the successful result
            })
            .catch(error => {
                console.error(`Error processing item "${item?.originalIngredient || 'unknown'}" in concurrentlyMap:`, error);
                // Remove promise from executing list on error
                const index = executing.indexOf(promise);
                if (index > -1) {
                    executing.splice(index, 1);
                }
                // Return a structured error object including item identifier
                return {
                    error: error.message || 'Unknown error during async mapping',
                    item: item?.originalIngredient || 'unknown' // Include identifier if possible
                };
            });

        executing.push(promise);
        results.push(promise); // Store the promise (which resolves to result or error object)

        // If concurrency limit is reached, wait for one promise to settle
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    // Wait for all remaining promises to settle
    return Promise.all(results);
}


async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // --- MODIFICATION (Mark 39): URL no longer contains the key ---
            log(`Attempt ${attempt}: Fetching from ${url}`, 'DEBUG', 'HTTP');
            const response = await fetch(url, options); 
            if (response.ok) {
                return response; // Success
            }
            // Check for retryable status codes
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status} from API. Retrying...`, 'WARN', 'HTTP');
                // Fall through to retry logic
            } else {
                // Non-retryable client error (4xx except 429)
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from API.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
            // Catch fetch errors (network issues) or the re-thrown client error
             if (!error.message?.startsWith('API call failed with client error')) { // Avoid double logging client errors
                log(`Attempt ${attempt}: Fetch failed for API with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
                console.error(`Fetch Error Details (Attempt ${attempt}):`, error);
            } else {
                 throw error; // Re-throw the non-retryable client error immediately
            }
        }
        // If it was a retryable error, wait before the next attempt
        if (attempt < MAX_RETRIES) {
            const delayTime = Math.pow(2, attempt - 1) * 2000; // Exponential backoff
            await delay(delayTime);
        }
    }
    // If all retries fail
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
    return price;
};

function parseSize(sizeString) {
    if (typeof sizeString !== 'string') return null;
    const sizeLower = sizeString.toLowerCase().replace(/\s/g, '');
    // Match common formats like 1kg, 500g, 2l, 750ml, but also handle potential spaces like "1 kg"
    const match = sizeLower.match(/(\d+\.?\d*)\s*(g|kg|ml|l)/);
    if (match) {
        const value = parseFloat(match[1]);
        let unit = match[2];
        let valueInBaseUnits = value;
        if (unit === 'kg') { valueInBaseUnits *= 1000; unit = 'g'; }
        else if (unit === 'l') { valueInBaseUnits *= 1000; unit = 'ml'; }
        return { value: valueInBaseUnits, unit: unit };
    }
    return null; // Return null if format doesn't match g/kg/ml/l
}

function calculateRequiredWordScore(productNameLower, requiredWords) {
    if (!requiredWords || requiredWords.length === 0) return 1.0;
    let wordsFound = 0;
    requiredWords.forEach(kw => {
        // Ensure keyword is treated as a whole word, avoid partial matches like "apple" in "pineapple"
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
    if (arr.length < 2) return 0; // Standard deviation requires at least 2 data points
    const m = mean(arr);
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / (arr.length - 1); // Use n-1 for sample stdev
    return Math.sqrt(variance);
};

/**
 * Applies a price outlier guard to a list of products.
 * @param {Array<Object>} products - List of valid product objects (containing `product.unit_price_per_100`).
 * @param {Function} log - The logger function.
 * @param {string} ingredientKey - The name of the ingredient for logging.
 * @returns {Array<Object>} The filtered list of products, excluding outliers.
 */
function applyPriceOutlierGuard(products, log, ingredientKey) {
    // Need at least 3 products to perform meaningful outlier detection
    if (products.length < 3) {
        return products;
    }

    const prices = products.map(p => p.product.unit_price_per_100).filter(p => p > 0); // Get valid unit prices
    if (prices.length < 3) {
        return products;
    }

    const m = mean(prices);
    const s = stdev(prices);

    // If standard deviation is 0 (all prices are identical), don't filter
    if (s === 0) {
        return products;
    }

    const filteredProducts = products.filter(p => {
        const price = p.product.unit_price_per_100;
        if (price <= 0) return true; // Keep items with no price (e.g., in-store only)

        const zScore = (price - m) / s;
        if (zScore > PRICE_OUTLIER_Z_SCORE) {
            log(`[${ingredientKey}] Demoting Price Outlier: "${p.product.name}" ($${price.toFixed(2)}/100) vs avg $${m.toFixed(2)}/100 (z=${zScore.toFixed(2)})`, 'INFO', 'PRICE_OUTLIER');
            return false;
        }
        return true;
    });

    return filteredProducts;
}

/**
 * Smarter Checklist function - Includes Category Guard (Step 4)
 */
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) {
        return { pass: false, score: 0 };
    }

    const { originalIngredient, requiredWords = [], negativeKeywords = [], targetSize, allowedCategories = [] } = ingredientData;
    const checkLogPrefix = `Checklist [${originalIngredient}] for "${product.product_name}"`;
    let score = 0;

    // --- 1. Banned Words ---
    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // --- 2. Negative Keywords ---
    if (negativeKeywords && negativeKeywords.length > 0) {
        const negativeWordFound = negativeKeywords.find(kw => productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }

    // --- 3. Required Words ---
    score = calculateRequiredWordScore(productNameLower, requiredWords || []);
    if (score < REQUIRED_WORD_SCORE_THRESHOLD) {
        log(`${checkLogPrefix}: FAIL (Score ${score.toFixed(2)} < ${REQUIRED_WORD_SCORE_THRESHOLD} vs [${(requiredWords || []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: score };
    }

    // --- 4. Category Allowlist ---
    const productCategory = product.product_category?.toLowerCase() || '';
    if (allowedCategories && allowedCategories.length > 0 && productCategory) {
        const hasCategoryMatch = allowedCategories.some(allowedCat => productCategory.includes(allowedCat.toLowerCase()));
        if (!hasCategoryMatch) {
            log(`${checkLogPrefix}: FAIL (Category Mismatch: Product category "${productCategory}" not in allowlist [${allowedCategories.join(', ')}])`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: score };
        }
    }

    // --- 5. Size Check ---
    if (targetSize?.value && targetSize.unit && product.product_size) {
        const productSizeParsed = parseSize(product.product_size);
        if (productSizeParsed && productSizeParsed.unit === targetSize.unit) {
            const lowerBound = targetSize.value * (1 - SIZE_TOLERANCE);
            const upperBound = targetSize.value * (1 + SIZE_TOLERANCE);
            if (productSizeParsed.value < lowerBound || productSizeParsed.value > upperBound) {
                log(`${checkLogPrefix}: FAIL (Size ${productSizeParsed.value}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
                return { pass: false, score: score };
            }
        } else if (productSizeParsed) {
             log(`${checkLogPrefix}: WARN (Size Unit Mismatch ${productSizeParsed.unit} vs ${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
        } else {
             log(`${checkLogPrefix}: WARN (Size Parse Fail "${product.product_size}")`, 'DEBUG', 'CHECKLIST');
        }
    }

    log(`${checkLogPrefix}: PASS (Score: ${score.toFixed(2)})`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: score };
}


function isCreativePrompt(cuisinePrompt) {
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false;
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'british', 'german', 'russian', 'brazilian', 'caribbean', 'african', 'middle eastern', 'spicy', 'mild', 'sweet', 'sour', 'savoury', 'quick', 'easy', 'simple', 'fast', 'budget', 'cheap', 'healthy', 'low carb', 'keto', 'low fat', 'high protein', 'high fiber', 'vegetarian', 'vegan', 'gluten free', 'dairy free', 'pescatarian', 'paleo'];
    const promptLower = cuisinePrompt.toLowerCase().trim();
    if (simpleKeywords.some(kw => promptLower === kw)) return false;
    if (promptLower.startsWith("high ") || promptLower.startsWith("low ")) return false;
    return cuisinePrompt.length > 30 || cuisinePrompt.includes(' like ') || cuisinePrompt.includes(' inspired by ') || cuisinePrompt.includes(' themed ');
}

// --- MODIFICATION (Mark 42): REMOVED old g/kg macro calculator ---
// The old `calculateMacroTargets` function (Mark 38) has been deleted.
// It is replaced by the new industry-standard, dual-validation
// function at the end of this file (after `calculateCalorieTarget`).
// --- END MODIFICATION ---


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
                    typeof value === 'object' && value !== null ? value : value
                )) : null
            };
            logs.push(logEntry);
            // Also log simple version to Vercel console
            console.log(`[${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
            if (data && (level === 'ERROR' || level === 'CRITICAL' || level === 'WARN')) { // Log data for Warn too
                 console.warn("Log Data:", data);
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

    // Handle OPTIONS pre-flight requests
    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP');
        return response.status(200).end();
    }
    
    // Only allow POST
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
        // --- MODIFICATION (Mark 38): Destructure weight ---
        const { store, cuisine, days, goal, weight } = formData; // Destructure goal + weight
        
        // Ensure critical fields are present/valid before proceeding
        if (!store || !days || !goal || isNaN(parseFloat(formData.weight)) || isNaN(parseFloat(formData.height))) { // Added goal check
             // --- MODIFICATION (Mark 40): Use sanitizer for PII ---
             log("CRITICAL: Missing core form data (store, days, goal, weight, or height). Cannot calculate plan.", 'CRITICAL', 'INPUT', getSanitizedFormData(formData));
             throw new Error("Missing critical profile data required for plan generation (store, days, goal, weight, height).");
        }
        
        const numDays = parseInt(days, 10);
        if (isNaN(numDays) || numDays < 1 || numDays > 7) { 
             log(`Invalid number of days: ${days}. Proceeding with default 1.`, 'WARN', 'INPUT');
        }
        const weightKg = parseFloat(weight); // Parse weight for macro calc

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
        // --- MODIFICATION (Mark 42): calculateCalorieTarget now uses Mifflin-St Jeor per spec ---
        const calorieTarget = calculateCalorieTarget(formData, log);
        log(`Daily target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        
        // --- MODIFICATION (Mark 42): calculateMacroTargets now uses new dual-validation system ---
        const { proteinGrams, fatGrams, carbGrams } = calculateMacroTargets(calorieTarget, goal, weightKg, log); 

        let llmResult;
        try {
            llmResult = await generateLLMPlanAndMeals(formData, calorieTarget, proteinGrams, fatGrams, carbGrams, creativeIdeas, log);
        } catch (llmError) {
            log(`Error during generateLLMPlanAndMeals call: ${llmError.message}`, 'CRITICAL', 'LLM_CALL');
            throw llmError;
        }

        const { ingredients, mealPlan = [] } = llmResult || {};
        const rawIngredientPlan = Array.isArray(ingredients) ? ingredients : [];


        // Validate rawIngredientPlan (array exists, might be empty)
        if (rawIngredientPlan.length === 0) {
            log("Blueprint fail: No ingredients returned by Technical AI (array was empty or invalid).", 'CRITICAL', 'LLM', { result: llmResult });
            throw new Error("Blueprint fail: AI did not return any ingredients.");
        }

        // Sanitize the plan
        const ingredientPlan = rawIngredientPlan.filter(ing => ing && ing.originalIngredient && ing.normalQuery && ing.requiredWords && ing.negativeKeywords && ing.totalGramsRequired >= 0);
        if (ingredientPlan.length !== rawIngredientPlan.length) {
            log(`Sanitized ingredient list: removed ${rawIngredientPlan.length - ingredientPlan.length} invalid entries.`, 'WARN', 'DATA');
        }
        if (ingredientPlan.length === 0) {
            log("Blueprint fail: All ingredients failed sanitization.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint fail: AI returned invalid ingredient data after sanitization.");
        }

        log(`Blueprint success: ${ingredientPlan.length} valid ingredients.`, 'SUCCESS', 'PHASE');
        ingredientPlan.forEach((ing, index) => {
            log(`AI Ingredient ${index + 1}: ${ing.originalIngredient}`, 'DEBUG', 'DATA', ing);
        });

        // --- Phase 3: Market Run (Parallel & Optimized) ---
        log("Phase 3: Parallel Market Run...", 'INFO', 'PHASE');

        const processSingleIngredientOptimized = async (ingredient) => {
            try {
                const ingredientKey = ingredient.originalIngredient;
                const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
                let foundProduct = null;
                let bestScoreSoFar = -1;
                const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];

                // Telemetry Variables
                let acceptedQueryIdx = -1;
                let acceptedQueryType = 'none';
                let pagesTouched = 0;
                let priceZ = null;
                let bucketWaitMs = 0;
                const mode = 'speed';

                for (const [index, { type, query }] of queriesToTry.entries()) {
                    if (!query) { result.searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0}); continue; }

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
                    log(`[${ingredientKey}] Raw results (${type}, ${rawProducts.length}):`, 'DEBUG', 'DATA', rawProducts.map(p => p.product_name));

                    const validProductsOnPage = [];
                    let pageBestScore = -1;
                    for (const rawProduct of rawProducts) {
                        const productWithCategory = { ...rawProduct, product_category: rawProduct.product_category };
                        const checklistResult = runSmarterChecklist(productWithCategory, ingredient, log);

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

                        // Capture Telemetry on Success
                        acceptedQueryIdx = index;
                        acceptedQueryType = type;
                        const keptCount = result.allProducts.length;

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
                             accepted_query_idx: acceptedQueryIdx,
                             accepted_query_type: acceptedQueryType,
                             pages_touched: pagesTouched,
                             kept_count: keptCount,
                             price_z: priceZ !== null ? parseFloat(priceZ.toFixed(2)) : null,
                             mode: mode,
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
                return { [ingredientKey]: result };

            } catch(e) {
                log(`CRITICAL Error processing single ingredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                return { [ingredient?.originalIngredient || 'unknown_error_item']: { source: 'error', error: e.message } };
            }
        }; // End processSingleIngredient

        log(`Market Run: ${ingredientPlan.length} ingredients, K=${MAX_MARKET_RUN_CONCURRENCY}...`, 'INFO', 'MARKET_RUN');
        const startMarketTime = Date.now();
        const parallelResultsArray = await concurrentlyMap(ingredientPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        const endMarketTime = Date.now();
        log(`Market Run parallel took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

        const finalResults = parallelResultsArray.reduce((acc, currentResult) => {
             if (!currentResult) { log(`Received null/undefined result from concurrentlyMap`, 'ERROR', 'SYSTEM'); return acc; }
             if (currentResult.error && currentResult.item) {
                 log(`ConcurrentlyMap Error for "${currentResult.item}": ${currentResult.error}`, 'CRITICAL', 'MARKET_RUN');
                 const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === currentResult.item);
                 acc[currentResult.item] = { ...(failedIngredientData || { originalIngredient: currentResult.item }), source: 'error', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: currentResult.error}] };
                 return acc;
             }
             const ingredientKey = Object.keys(currentResult)[0];
             if(ingredientKey && currentResult[ingredientKey]?.source === 'error') {
                 log(`Processing Error for "${ingredientKey}": ${currentResult[ingredientKey].error}`, 'CRITICAL', 'MARKET_RUN');
                  const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === ingredientKey);
                 acc[ingredientKey] = { ...(failedIngredientData || { originalIngredient: ingredientKey }), source: 'error', error: currentResult[ingredientKey].error, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url };
                 return acc;
             }
             return { ...acc, ...currentResult };
        }, {});

        log("Market Run complete.", 'SUCCESS', 'PHASE');


        // --- Phase 4: Nutrition Calculation ---
        log("Phase 4: Nutrition Calculation...", 'INFO', 'PHASE');
        let finalDailyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        const itemsToFetchNutrition = [];

        for (const key in finalResults) {
            const result = finalResults[key];
            if (result && result.source === 'discovery') {
                const selected = result.allProducts?.find(p => p.url === result.currentSelectionURL);
                if (selected) {
                    itemsToFetchNutrition.push({
                        ingredientKey: key, barcode: selected.barcode, query: selected.name,
                        grams: result.totalGramsRequired >= 0 ? result.totalGramsRequired : 0,
                        aiEstCaloriesPer100g: result.aiEstCaloriesPer100g, aiEstProteinPer100g: result.aiEstProteinPer100g,
                        aiEstFatPer100g: result.aiEstFatPer100g, aiEstCarbsPer100g: result.aiEstCarbsPer100g
                    });
                }
            } else if (result && (result.source === 'failed' || result.source === 'error')) {
                 if (result.totalGramsRequired > 0 && typeof result.aiEstCaloriesPer100g === 'number') {
                     log(`[${key}] Market Run failed, adding to nutrition queue with AI fallback.`, 'WARN', 'MARKET_RUN');
                     itemsToFetchNutrition.push({
                         ingredientKey: key, barcode: null, query: null, grams: result.totalGramsRequired,
                         aiEstCaloriesPer100g: result.aiEstCaloriesPer100g, aiEstProteinPer100g: result.aiEstProteinPer100g,
                         aiEstFatPer100g: result.aiEstFatPer100g, aiEstCarbsPer100g: result.aiEstCarbsPer100g
                     });
                 }
            }
        }


        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching/Calculating nutrition for ${itemsToFetchNutrition.length} products...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, (item) =>
                // fetchNutritionData now has SWR logic built-in
                (item.barcode || item.query) ?
                fetchNutritionData(item.barcode, item.query, log) // Pass log
                    .then(nut => ({ ...item, nut }))
                    .catch(err => {
                        log(`Unhandled Nutri fetch error ${item.ingredientKey}: ${err.message}`, 'CRITICAL', 'HTTP');
                        return { ...item, nut: { status: 'not_found', error: 'Unhandled fetch error' } };
                    })
                : Promise.resolve({ ...item, nut: { status: 'not_found' } })
            );

            log("Nutrition fetch/calc complete.", 'SUCCESS', 'HTTP');

            let weeklyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };

            nutritionResults.forEach(item => {
                if (!item.grams || item.grams <= 0) return;
                const nut = item.nut;

                // --- MODIFICATION: Attach nutrition data to the final result object ---
                const result = finalResults[item.ingredientKey];
                if (result && result.allProducts) {
                    const selectedProduct = result.allProducts.find(p => 
                        (item.barcode && p.barcode === item.barcode) || 
                        (item.query && p.name === item.query)
                    );
                    if (selectedProduct) {
                        selectedProduct.nutrition = nut; // Attach the full nutrition object
                    } else if (result.currentSelectionURL) {
                         // Fallback: attach to current selection if match failed (e.g. market fail)
                         const current = result.allProducts.find(p => p.url === result.currentSelectionURL);
                         if (current) current.nutrition = nut;
                    }
                }
                // --- END MODIFICATION ---
                
                let proteinG = 0;
                let fatG = 0;
                let carbsG = 0;

                if (nut?.status === 'found') {
                    proteinG = ((nut.protein || 0) / 100) * item.grams;
                    fatG = ((nut.fat || 0) / 100) * item.grams;
                    carbsG = ((nut.carbs || 0) / 100) * item.grams;
                } else if (
                    // Check for AI fallbacks for macros
                    typeof item.aiEstProteinPer100g === 'number' &&
                    typeof item.aiEstFatPer100g === 'number' &&
                    typeof item.aiEstCarbsPer100g === 'number'
                ) {
                    log(`Using AI nutrition fallback for ${item.ingredientKey}.`, 'WARN', 'CALC', {
                        item: item.ingredientKey, grams: item.grams,
                        source: nut?.status ? `OFF status: ${nut.status}` : 'Market Run Fail'
                    });
                    proteinG = (item.aiEstProteinPer100g / 100) * item.grams;
                    fatG = (item.aiEstFatPer100g / 100) * item.grams;
                    carbsG = (item.aiEstCarbsPer100g / 100) * item.grams;
                } else {
                    log(`Skipping nutrition for ${item.ingredientKey}: Data not found and no AI fallback.`, 'INFO', 'CALC');
                }
                
                weeklyTotals.protein += proteinG;
                weeklyTotals.fat += fatG;
                weeklyTotals.carbs += carbsG;
            });

            // Calculate calories FROM macros for consistency
            weeklyTotals.calories = (weeklyTotals.protein * 4) + (weeklyTotals.fat * 9) + (weeklyTotals.carbs * 4);
            log("Calculated WEEKLY nutrition totals (Calories derived from macros):", 'DEBUG', 'CALC', weeklyTotals);
            
            const validNumDays = (numDays >= 1 && numDays <= 7) ? numDays : 1;
            log(`Number of days for averaging: ${validNumDays}`, 'DEBUG', 'CALC');

            finalDailyTotals.calories = Math.round(weeklyTotals.calories / validNumDays);
            finalDailyTotals.protein = Math.round(weeklyTotals.protein / validNumDays);
            finalDailyTotals.fat = Math.round(weeklyTotals.fat / validNumDays);
            finalDailyTotals.carbs = Math.round(weeklyTotals.carbs / validNumDays);
            log("DAILY nutrition totals calculated.", 'SUCCESS', 'CALC', finalDailyTotals);
        } else {
            log("No valid products with required grams found for nutrition calculation.", 'WARN', 'CALC');
        }


        // --- Phase 5: Assembling Final Response ---
        log("Phase 5: Final Response...", 'INFO', 'PHASE');
        const finalResponseData = { mealPlan: mealPlan || [], uniqueIngredients: ingredientPlan, results: finalResults, nutritionalTargets: finalDailyTotals };
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


async function generateCreativeIdeas(cuisinePrompt, log) { // Pass log
    // --- MODIFICATION (Mark 39): Use base URL, key in header ---
    const GEMINI_API_URL = GEMINI_API_URL_BASE; 
    const sysPrompt=`Creative chef... comma-separated list.`;
    const userQuery=`Theme: "${cuisinePrompt}"...`;
    log("Creative Prompt",'INFO','LLM_PROMPT',{userQuery});
    const payload={contents:[{parts:[{text:userQuery}]}],systemInstruction:{parts:[{text:sysPrompt}]}};
    try{
        const res=await fetchWithRetry(
            GEMINI_API_URL,
            {
                method:'POST',
                headers:{
                    'Content-Type':'application/json',
                    'x-goog-api-key': GEMINI_API_KEY // Pass key as header
                },
                body:JSON.stringify(payload)
            },
            log
        ); // Pass log
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
        return ""; // Return empty string on failure
    }
}

async function generateLLMPlanAndMeals(formData, calorieTarget, proteinTargetGrams, fatTargetGrams, carbTargetGrams, creativeIdeas, log) { // Pass log
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    // --- MODIFICATION (Mark 39): Use base URL, key in header ---
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']}; const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2;
    const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.');

    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion' not 'scallion', 'allspice' not 'pimento')." : "";

    // --- MODIFICATION (Mark 38): Added rules 18 & 19 to system prompt ---
    // --- MODIFICATION (Mark 42): Updated macro rule 16 to emphasize targets ---
    // --- *** MODIFICATION: Merged user's stricter accuracy rules into Rule 16 *** ---
    const systemPrompt = `Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate meal plan ('mealPlan') & shopping list ('ingredients'). 2. QUERIES: For each ingredient: a. 'tightQuery': Hyper-specific, STORE-PREFIXED. b. 'normalQuery': 2-4 generic words, STORE-PREFIXED. CRITICAL: Make robust and use the MOST COMMON GENERIC NAME. DO NOT include brands, sizes, fat content (e.g., 'full cream'), specific forms (block/ball/wedge/sliced/grated), or dryness unless ESSENTIAL.${australianTermNote} c. 'wideQuery': 1-2 broad words, STORE-PREFIXED. 3. 'requiredWords': Array[1-2] ESSENTIAL, CORE NOUNS ONLY, lowercase. NO adjectives or forms. 4. 'negativeKeywords': Array[1-5] lowercase words for INCORRECT product. Be thorough, include non-food types. 5. 'targetSize': Object {value: NUM, unit: "g"|"ml"}. Null if N/A. 6. 'totalGramsRequired': BEST ESTIMATE total g/ml for plan. MUST accurately reflect sum of meal portions. 7. Adhere to constraints. 8. 'ingredients' MANDATORY. 'mealPlan' OPTIONAL but BEST EFFORT. 9. AI FALLBACK NUTRITION: Provide estimated 'aiEst...' per 100g (numbers, realistic). 10. 'OR' INGREDIENTS: Use broad 'requiredWords', add 'negativeKeywords'. 11. NICHE ITEMS: Set 'tightQuery' null, broaden queries/words. 12. FORM/TYPE: 'normalQuery' = generic form. 'requiredWords' = noun ONLY. Specify form only in 'tightQuery'. 13. NO 'nutritionalTargets' in output. 14. CATEGORY (Optional): 'allowedCategories' string array. 15. MEAL PORTIONS: For each meal in 'mealPlan.description', MUST specify clear portion sizes for key ingredients (e.g., '...150g chicken breast, 1 cup rice...'). 16. CRITICAL ADHERENCE RULE: Meal portions (from 'mealPlan.description') MUST sum precisely to 'totalGramsRequired' for each item in 'ingredients'. The total estimated Calories, Protein, Fat, and Carbs from ALL 'ingredients' (using 'totalGramsRequired' and 'aiEst...' values) MUST match the provided daily targets with high precision (within 5%). You are provided with daily grams for P/F/C and a calorie target. HIT THESE TARGETS. If your first pass misses the targets by >5%, you MUST correct the quantities and recalculate until the totals are compliant. 17. BULKING MACRO PRIORITY: For 'bulk' goals, prioritize carbohydrate sources over fats when adjusting portions to meet targets. 18. MEAL VARIETY: This is critical. The user has set 'maxRepetitions' to ${maxRepetitions}. You MUST NOT repeat the same meal for the *entire* ${days}-day plan more than this number of times. Each day's plan MUST be different and varied if 'maxRepetitions' is less than ${days}. DO NOT BE LAZY. Generate a unique and interesting plan for each day. 19. COST vs. VARIETY: The user's 'costPriority' is '${costPriority}'. However, this MUST NOT override the 'mealVariety' constraint (Rule 18). You MUST balance both. It is better to be slightly more expensive than to be repetitive.`;
    // --- *** END MODIFICATION *** ---


    // Added macro targets to User Query
    const userQuery = `Gen ${days}-day plan for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Target: ~${calorieTarget} kcal. Macro Targets: Protein ~${proteinTargetGrams}g, Fat ~${fatTargetGrams}g, Carbs ~${carbTargetGrams}g. Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}. Cuisine: ${cuisineInstruction}.`;


    // Check userQuery before passing to payload
    if (userQuery.trim().length < 50) {
        // --- MODIFICATION (Mark 40): Use sanitizer for PII ---
        log("Critical Input Failure: User query is too short/empty due to missing form data or invalid template resolution.", 'CRITICAL', 'LLM_PAYLOAD', { userQuery: userQuery, sanitizedData: getSanitizedFormData(formData) });
        throw new Error("Cannot generate plan: Invalid input data caused an empty prompt.");
    }

    // --- MODIFICATION (Mark 40): Use sanitizer for PII ---
    log("Technical Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...', sanitizedData: getSanitizedFormData(formData) });

    // Schema (Mark 25 - Remains Valid)
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
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
                                "allowedCategories": { type: "ARRAY", items: { "type": "STRING" }, nullable: true }, 
                                "aiEstCaloriesPer100g": { "type": "NUMBER", nullable: true },
                                "aiEstProteinPer100g": { "type": "NUMBER", nullable: true },
                                "aiEstFatPer100g": { "type": "NUMBER", nullable: true },
                                "aiEstCarbsPer100g": { "type": "NUMBER", nullable: true }
                            },
                            required: ["originalIngredient", "normalQuery", "requiredWords", "negativeKeywords", "totalGramsRequired", "quantityUnits"]
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
                                            "description": { "type": "STRING" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                required: ["ingredients"]
            }
        }
    };

    try {
        const response = await fetchWithRetry(
            GEMINI_API_URL, 
            { 
                method: 'POST', 
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': GEMINI_API_KEY // Pass key as header
                },
                body: JSON.stringify(payload) 
            }, 
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

            // Basic validation
            if (!parsed || typeof parsed !== 'object') {
                 log("Validation Error: Root response is not an object.", 'CRITICAL', 'LLM', parsed);
                 throw new Error("LLM response was not a valid object.");
            }
             if (parsed.ingredients && !Array.isArray(parsed.ingredients)) {
                 log("Validation Error: 'ingredients' exists but is not an array.", 'CRITICAL', 'LLM', parsed);
             }

            return parsed; // Return the parsed object
        } catch (e) {
            log("Failed to parse Technical AI JSON.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: e.message });
            throw new Error(`Failed to parse LLM JSON: ${e.message}`);
        }
    } catch (error) {
         log(`Technical AI call failed definitively: ${error.message}`, 'CRITICAL', 'LLM');
         throw error; // Re-throw to be caught by the main handler
    }
}


/// ===== API-CALLERS-END ===== ////


/// ===== NUTRITION-CALC-START ===== \\\\
// This block contains the new, industry-standard calculation stack
// as specified in your request.

/**
 * SECTION 1 & 2 & 3: Calorie Target Calculation
 * Implements Mifflin-St Jeor for BMR, applies TDEE factor, and Goal % modifier.
 * This function was already compliant with the specification.
 */
function calculateCalorieTarget(formData, log = console.log) {
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);

    if (isNaN(weightKg) || isNaN(heightCm) || isNaN(ageYears) || !gender || !activityLevel || !goal) {
        // --- MODIFICATION (Mark 40): Use sanitizer for PII ---
        log("Missing or invalid profile data for calorie calculation, using default 2000.", 'WARN', 'CALC', getSanitizedFormData({ weight, height, age, gender, activityLevel, goal}));
        return 2000;
    }

    // 1. BMR (Mifflin-St Jeor): (10W + 6.25H - 5A + S)
    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    
    // 2. TDEE (Activity Factor)
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    let multiplier = activityMultipliers[activityLevel];
     if (!multiplier) {
         log(`Invalid activityLevel "${activityLevel}", using default 1.55.`, 'WARN', 'CALC');
         multiplier = 1.55;
     }
    const tdee = bmr * multiplier;
    
    // 3. Goal Adjustment (Energy Modifier)
    // Note: 'cut_moderate' maps to '-0.15' (Moderate Cut), etc.
    const goalAdjustments = {
        maintain: 0,
        cut_moderate: - (tdee * 0.15), // -15% deficit
        cut_aggressive: - (tdee * 0.25), // -25% deficit
        bulk_lean: + (tdee * 0.15),    // +15% surplus
        bulk_aggressive: + (tdee * 0.25)     // +25% surplus
    };
    
    let adjustment = goalAdjustments[goal];
    if (adjustment === undefined) {
         log(`Invalid goal "${goal}", using default 'maintain' (0 adjustment).`, 'WARN', 'CALC');
         adjustment = 0; // Default to maintain if goal key is invalid
    }
    
    log(`Calorie Calc: BMR=${bmr.toFixed(0)}, TDEE=${tdee.toFixed(0)}, Goal=${goal}, Adjustment=${adjustment.toFixed(0)}`, 'INFO', 'CALC');
    
    // Final Target Calories
    return Math.max(1200, Math.round(tdee + adjustment));
}


/**
 * SECTION 4 & 5: Macronutrient Distribution (Dual Validation)
 * This is the new, upgraded function that replaces the old g/kg model.
 * It uses a percentage-based split (4a) and validates with
 * g/kg body-weight checks and sanity layers (4b, 5).
 */
function calculateMacroTargets(calorieTarget, goal, weightKg, log) {
    
    // 4a. Define Macronutrient Percentages by Goal
    // These are sensible defaults selected from within your specified ranges.
    const macroSplits = {
        // Cut Goals: P: 35%, F: 25%, C: 40%
        'cut_aggressive': { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'cut_moderate':   { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        // Maintain Goal: P: 30%, F: 30%, C: 40%
        'maintain':       { pPct: 0.30, fPct: 0.30, cPct: 0.40 },
        // Lean Bulk Goal: P: 25%, F: 25%, C: 50%
        'bulk_lean':      { pPct: 0.25, fPct: 0.25, cPct: 0.50 },
        // Aggressive Bulk Goal: P: 20%, F: 25%, C: 55%
        'bulk_aggressive':{ pPct: 0.20, fPct: 0.25, cPct: 0.55 }
    };

    // Get the split for the user's goal, or default to 'maintain'
    const split = macroSplits[goal] || macroSplits['maintain'];
    if (!macroSplits[goal]) {
        log(`Invalid goal "${goal}" for macro split, using 'maintain' defaults.`, 'WARN', 'CALC');
    }

    // 8. Implementation Directive: Calculate initial grams from percentages
    let proteinGrams = (calorieTarget * split.pPct) / 4;
    let fatGrams = (calorieTarget * split.fPct) / 9;
    let carbGrams = (calorieTarget * split.cPct) / 4;

    // 4b & 5. Validation Layers
    const validWeightKg = (typeof weightKg === 'number' && weightKg > 0) ? weightKg : 75; // Default to 75kg if invalid
    let proteinPerKg = proteinGrams / validWeightKg;
    let fatPerKg = fatGrams / validWeightKg;
    let fatPercent = (fatGrams * 9) / calorieTarget;
    let carbsNeedRecalc = false;

    // --- Sanity Check 1: Protein (Layer 5) ---
    // Rule: Protein ≤ 3.0 g/kg
    const PROTEIN_MAX_G_PER_KG = 3.0;
    if (proteinPerKg > PROTEIN_MAX_G_PER_KG) {
        log(`ADJUSTMENT: Initial protein ${proteinPerKg.toFixed(1)}g/kg > ${PROTEIN_MAX_G_PER_KG}g/kg. Capping protein and recalculating carbs.`, 'WARN', 'CALC');
        proteinGrams = PROTEIN_MAX_G_PER_KG * validWeightKg;
        carbsNeedRecalc = true;
    }

    // --- Sanity Check 2: Fat (Layer 5) ---
    // Rule: Fat ≤ 35% of calories
    const FAT_MAX_PERCENT = 0.35;
    if (fatPercent > FAT_MAX_PERCENT) {
        log(`ADJUSTMENT: Initial fat ${fatPercent.toFixed(1)}% > ${FAT_MAX_PERCENT}%. Capping fat and recalculating carbs.`, 'WARN', 'CALC');
        fatGrams = (calorieTarget * FAT_MAX_PERCENT) / 9;
        carbsNeedRecalc = true;
    }

    // --- Recalculate Carbs (if any cap was hit) ---
    if (carbsNeedRecalc) {
        const proteinCalories = proteinGrams * 4;
        const fatCalories = fatGrams * 9;
        const carbCalories = calorieTarget - proteinCalories - fatCalories;
        carbGrams = carbCalories / 4;
        log(`RECALC: New Carb Target: ${carbGrams.toFixed(0)}g`, 'INFO', 'CALC');
    }

    // --- Guideline Logging (Layer 4b) ---
    // Log warnings if targets fall outside *optimal* (but not *unsafe*) ranges
    
    // Protein g/kg guidelines
    const PROTEIN_MIN_G_PER_KG = 1.6;
    const PROTEIN_CUT_MAX_G_PER_KG = 2.4;
    proteinPerKg = proteinGrams / validWeightKg; // Re-check after cap
    if (proteinPerKg < PROTEIN_MIN_G_PER_KG) {
        log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is below the optimal ${PROTEIN_MIN_G_PER_KG}g/kg range.`, 'INFO', 'CALC');
    }
    if ((goal === 'cut_aggressive' || goal === 'cut_moderate') && proteinPerKg > PROTEIN_CUT_MAX_G_PER_KG) {
         log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is above the ${PROTEIN_CUT_MAX_G_PER_KG}g/kg recommendation for cutting.`, 'INFO', 'CALC');
    }

    // Fat g/kg guidelines
    const FAT_MIN_G_PER_KG = 0.8;
    fatPerKg = fatGrams / validWeightKg; // Re-check after cap
    if (fatPerKg < FAT_MIN_G_PER_KG) {
         log(`GUIDELINE: Fat target ${fatPerKg.toFixed(1)}g/kg is below the optimal ${FAT_MIN_G_PER_KG}g/kg minimum.`, 'INFO', 'CALC');
    }

    // Final rounding
    const finalProteinGrams = Math.round(proteinGrams);
    const finalFatGrams = Math.round(fatGrams);
    const finalCarbGrams = Math.round(carbGrams);
    
    log(`Calculated Macro Targets (Dual-Validation) (Goal: ${goal}, Cals: ${calorieTarget}, Weight: ${validWeightKg}kg): P ${finalProteinGrams}g, F ${finalFatGrams}g, C ${finalCarbGrams}g`, 'INFO', 'CALC');

    return { 
        proteinGrams: finalProteinGrams, 
        fatGrams: finalFatGrams, 
        carbGrams: finalCarbGrams 
    };
}

/// ===== NUTRITION-CALC-END ===== \\\\
