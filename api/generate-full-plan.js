// --- ORCHESTRATOR API for Cheffy V3 ---

// Mark 23 Pipeline + Refined AI Query/Keyword Rules based on ChatGPT Data
// 1. Creative AI (Optional)
// 2. Technical AI (Plan, 3 Queries, Keywords, Size, Total Grams, AI Nutrition Est.) - Log full output
// 3. Parallel Market Run (T->N->W, Skip Heuristic, Smarter Checklist) - Log queries, raw results, checklist reasons
// 4. Nutrition Calculation (with AI Fallback) - Log weekly totals & days

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // Retries for Gemini calls
const MAX_NUTRITION_CONCURRENCY = 5; // Concurrency for Nutrition phase
const MAX_MARKET_RUN_CONCURRENCY = 5; // K value for Parallel Market Run
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery', 'filter', 'paper', 'tip']; // Expanded further
const SIZE_TOLERANCE = 0.6; // +/- 60%
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60; // Must match >= 60% - KEEPING at 0.6 for now, adjust if needed later
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0; // Score needed on tight query to skip normal/wide

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\


const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };


/// ===== MOCK-END ===== ////


/// ===== HELPERS-START ===== \\\\


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
            const response = await fetch(url, options);
            if (response.ok) {
                return response; // Success
            }
            // Check for retryable status codes
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status} from ${url}. Retrying...`, 'WARN', 'HTTP');
                // Fall through to retry logic
            } else {
                // Non-retryable client error (4xx except 429)
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from ${url}.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
            // Catch fetch errors (network issues) or the re-thrown client error
             if (!error.message?.startsWith('API call failed with client error')) { // Avoid double logging client errors
                log(`Attempt ${attempt}: Fetch failed for ${url} with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
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
    log(`API call to ${url} failed definitively after ${MAX_RETRIES} attempts.`, 'CRITICAL', 'HTTP');
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

/**
 * Smarter Checklist function - WITH DETAILED LOGGING ENABLED.
 */
function runSmarterChecklist(product, ingredientData, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    // Basic check: If product name is missing or empty, fail immediately.
    if (!productNameLower) {
        // log(`Checklist [${ingredientData.originalIngredient}] for UNNAMED PRODUCT: FAIL (Missing Name)`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }


    const { originalIngredient, requiredWords = [], negativeKeywords = [], targetSize } = ingredientData;
    const checkLogPrefix = `Checklist [${originalIngredient}] for "${product.product_name}"`;
    let score = 0;

    // --- 1. Excludes Banned Words (Global Filter) ---
    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // --- 2. Excludes Negative Keywords (AI Filter) ---
    // Ensure negativeKeywords is treated as an array even if missing/null from AI
    if (negativeKeywords && negativeKeywords.length > 0) {
        const negativeWordFound = negativeKeywords.find(kw => productNameLower.includes(kw.toLowerCase()));
        if (negativeWordFound) {
            log(`${checkLogPrefix}: FAIL (Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }

    // --- 3. Required Words Score ---
    // Ensure requiredWords is treated as an array
    score = calculateRequiredWordScore(productNameLower, requiredWords || []);
    if (score < REQUIRED_WORD_SCORE_THRESHOLD) {
        log(`${checkLogPrefix}: FAIL (Score ${score.toFixed(2)} < ${REQUIRED_WORD_SCORE_THRESHOLD} vs [${(requiredWords || []).join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: score };
    }

    // --- 4. Size sanity check ---
    // Check targetSize, value, unit, and product_size exist before proceeding
    if (targetSize?.value && targetSize.unit && product.product_size) {
        const productSizeParsed = parseSize(product.product_size);
        // Only compare if parsing succeeded and units match
        if (productSizeParsed && productSizeParsed.unit === targetSize.unit) {
            const lowerBound = targetSize.value * (1 - SIZE_TOLERANCE);
            const upperBound = targetSize.value * (1 + SIZE_TOLERANCE);
            // Check if product size is outside the tolerance range
            if (productSizeParsed.value < lowerBound || productSizeParsed.value > upperBound) {
                log(`${checkLogPrefix}: FAIL (Size ${productSizeParsed.value}${productSizeParsed.unit} outside ${lowerBound.toFixed(0)}-${upperBound.toFixed(0)}${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
                return { pass: false, score: score };
            }
        } else if (productSizeParsed) {
            // Log unit mismatch only if needed for debugging
             log(`${checkLogPrefix}: WARN (Size Unit Mismatch ${productSizeParsed.unit} vs ${targetSize.unit})`, 'DEBUG', 'CHECKLIST');
        } else {
             // Log parse failure only if needed for debugging
             log(`${checkLogPrefix}: WARN (Size Parse Fail "${product.product_size}")`, 'DEBUG', 'CHECKLIST');
        }
    } // No penalty if units mismatch, parse fails, or target size is missing

    log(`${checkLogPrefix}: PASS (Score: ${score.toFixed(2)})`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: score };
}


function isCreativePrompt(cuisinePrompt) {
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false;
    // Expanded list of simple keywords
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'british', 'german', 'russian', 'brazilian', 'caribbean', 'african', 'middle eastern', 'spicy', 'mild', 'sweet', 'sour', 'savoury', 'quick', 'easy', 'simple', 'fast', 'budget', 'cheap', 'healthy', 'low carb', 'keto', 'low fat', 'high protein', 'high fiber', 'vegetarian', 'vegan', 'gluten free', 'dairy free', 'pescatarian', 'paleo'];
    const promptLower = cuisinePrompt.toLowerCase().trim();
    // Check if the prompt *exactly* matches a simple keyword
    if (simpleKeywords.some(kw => promptLower === kw)) return false;
    // Check common patterns for simple requests
    if (promptLower.startsWith("high ") || promptLower.startsWith("low ")) return false;
    // Consider prompts with structure words or longer length as potentially creative
    return cuisinePrompt.length > 30 || cuisinePrompt.includes(' like ') || cuisinePrompt.includes(' inspired by ') || cuisinePrompt.includes(' themed ');
}

/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];
    // Enhanced log function to handle potential circular structures in data
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                // Simple serialization check to avoid crashing on circular refs
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    typeof value === 'object' && value !== null ? value : value
                )) : null
            };
            logs.push(logEntry);
            console.log(JSON.stringify(logEntry)); // Log stringified version to console
            return logEntry;
        } catch (error) {
            // Fallback log entry if serialization fails
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
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Added Authorization if needed later
    if (request.method === 'OPTIONS') {
        log("OPTIONS request handled.", 'INFO', 'HTTP');
        return response.status(204).end(); // Use 204 No Content for OPTIONS
    }
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        return response.status(405).json({ message: 'Method Not Allowed', logs });
    }

    try {
        // Basic Input Validation
        if (!request.body) {
             return response.status(400).json({ message: "Request body is missing.", logs });
        }
        const formData = request.body;
        const { store, cuisine, days } = formData;
        if (!store || !days) {
             log("Missing required form data (store or days).", 'WARN', 'INPUT', formData);
             return response.status(400).json({ message: "Missing required fields: store, days.", logs });
        }

        const numDays = parseInt(days, 10);
        if (isNaN(numDays) || numDays < 1 || numDays > 7) {
             log(`Invalid number of days: ${days}. Defaulting to 1.`, 'WARN', 'INPUT');
             // Consider failing instead: return response.status(400).json({ message: "Invalid number of days (must be 1-7).", logs });
             // For now, let's proceed but maybe flag it? The AI below uses formData.days
        }


        // --- Phase 1: Creative Router ---
        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) {
            log(`Creative prompt: "${cuisine}". Calling AI...`, 'INFO', 'LLM');
            creativeIdeas = await generateCreativeIdeas(cuisine, log);
            log(`Creative AI: "${creativeIdeas.substring(0, 50)}..."`, 'SUCCESS', 'LLM');
        } else {
            log("Simple prompt. Skipping Creative AI.", 'INFO', 'SYSTEM');
        }

        // --- Phase 2: Technical Blueprint ---
        log("Phase 2: Technical Blueprint...", 'INFO', 'PHASE');
        const calorieTarget = calculateCalorieTarget(formData); // Uses corrected function below
        log(`Daily target: ${calorieTarget} kcal.`, 'INFO', 'CALC');
        // Ensure ingredientPlan and mealPlan are always arrays, even if AI returns null/undefined
        const { ingredients: rawIngredientPlan = [], mealPlan = [] } = await generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log);

        // More robust check for blueprint success
        if (!rawIngredientPlan || rawIngredientPlan.length === 0) {
            log("Blueprint fail: No ingredients returned by Technical AI.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint fail: AI did not return a valid ingredient list.");
        }
         // Data Sanitization/Validation for AI output (Example)
        const ingredientPlan = rawIngredientPlan.filter(ing => ing && ing.originalIngredient && ing.normalQuery && ing.requiredWords && ing.negativeKeywords && ing.totalGramsRequired >= 0);
        if (ingredientPlan.length !== rawIngredientPlan.length) {
            log(`Sanitized ingredient list: removed ${rawIngredientPlan.length - ingredientPlan.length} invalid entries.`, 'WARN', 'DATA');
        }
         if (ingredientPlan.length === 0) {
             log("Blueprint fail: All ingredients failed sanitization.", 'CRITICAL', 'LLM');
            throw new Error("Blueprint fail: AI returned invalid ingredient data.");
         }

        log(`Blueprint success: ${ingredientPlan.length} valid ingredients.`, 'SUCCESS', 'PHASE');
        ingredientPlan.forEach((ing, index) => {
            log(`AI Ingredient ${index + 1}: ${ing.originalIngredient}`, 'DEBUG', 'DATA', ing);
        });

        // --- Phase 3: Market Run (Parallel & Optimized) ---
        log("Phase 3: Parallel Market Run...", 'INFO', 'PHASE');

        const processSingleIngredientOptimized = async (ingredient) => {
            // Add try-catch within the mapped function for better error isolation
            try {
                const ingredientKey = ingredient.originalIngredient;
                // --- PASS AI NUTRITION DATA THROUGH ---
                const result = { ...ingredient, allProducts: [], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, source: 'failed', searchAttempts: [] };
                let foundProduct = null;
                let bestScoreSoFar = -1;

                const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];

                for (const { type, query } of queriesToTry) {
                    if (!query) { result.searchAttempts.push({ queryType: type, query: null, status: 'skipped', foundCount: 0}); continue; }

                    log(`[${ingredientKey}] Attempting "${type}" query: "${query}"`, 'DEBUG', 'HTTP');
                    // Add timeout to price fetch?
                    const priceData = await fetchPriceData(store, query, 1);
                    result.searchAttempts.push({ queryType: type, query: query, status: 'pending', foundCount: 0, rawCount: 0, bestScore: 0});
                    const currentAttemptLog = result.searchAttempts.at(-1);

                    if (priceData.error) {
                        log(`[${ingredientKey}] Fetch failed (${type}): ${priceData.error.message}`, 'WARN', 'HTTP', { status: priceData.error.status });
                        currentAttemptLog.status = 'fetch_error';
                        // Decide: Should a fetch error on 'tight' stop us trying 'normal'?
                        // Current logic continues, which seems reasonable.
                        continue;
                    }

                    const rawProducts = priceData.results || [];
                    currentAttemptLog.rawCount = rawProducts.length;
                    log(`[${ingredientKey}] Raw results (${type}, ${rawProducts.length}):`, 'DEBUG', 'DATA', rawProducts.map(p => p.product_name));

                    const validProductsOnPage = [];
                    let pageBestScore = -1;
                    for (const rawProduct of rawProducts) {
                        const checklistResult = runSmarterChecklist(rawProduct, ingredient, log);
                        if (checklistResult.pass) {
                             validProductsOnPage.push({ product: { name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size), }, score: checklistResult.score });
                             pageBestScore = Math.max(pageBestScore, checklistResult.score);
                        }
                    }
                    currentAttemptLog.foundCount = validProductsOnPage.length;
                    currentAttemptLog.bestScore = pageBestScore;

                    if (validProductsOnPage.length > 0) {
                        log(`[${ingredientKey}] Found ${validProductsOnPage.length} valid (${type}, Score: ${pageBestScore.toFixed(2)}).`, 'INFO', 'DATA');
                        // Filter out duplicates before adding (important with parallel processing if structure changes)
                        const currentUrls = new Set(result.allProducts.map(p => p.url));
                        validProductsOnPage.forEach(vp => {
                            if (!currentUrls.has(vp.product.url)) {
                                result.allProducts.push(vp.product);
                                currentUrls.add(vp.product.url);
                            }
                        });

                        // Always recalculate the cheapest from the *combined* list found so far
                        foundProduct = result.allProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, result.allProducts[0]);
                        result.currentSelectionURL = foundProduct.url;
                        result.source = 'discovery';
                        currentAttemptLog.status = 'success';
                        bestScoreSoFar = Math.max(bestScoreSoFar, pageBestScore);

                        // Skip Heuristic Check
                        if (type === 'tight' && bestScoreSoFar >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                            log(`[${ingredientKey}] Skip heuristic hit (Score ${bestScoreSoFar.toFixed(2)}).`, 'INFO', 'MARKET_RUN');
                            break; // Stop trying normal/wide for this ingredient
                        }
                        // Stop after first success, regardless of query type (as per user note)
                         break; // <<<--- Ensures we stop after the first successful query type finds *any* valid product

                    } else {
                        log(`[${ingredientKey}] No valid products (${type}).`, 'WARN', 'DATA');
                        currentAttemptLog.status = 'no_match';
                        // Continue to the next query type
                    }
                } // End query loop

                if (result.source === 'failed') { log(`[${ingredientKey}] Definitive fail.`, 'WARN', 'MARKET_RUN'); }
                return { [ingredientKey]: result };

            } catch(e) {
                // Catch unexpected errors within processing a single ingredient
                log(`CRITICAL Error processing single ingredient "${ingredient?.originalIngredient}": ${e.message}`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                // Return an error structure for this ingredient
                return { [ingredient?.originalIngredient || 'unknown_error_item']: { source: 'error', error: e.message } };
            }
        }; // End processSingleIngredient

        log(`Market Run: ${ingredientPlan.length} ingredients, K=${MAX_MARKET_RUN_CONCURRENCY}...`, 'INFO', 'MARKET_RUN');
        const startMarketTime = Date.now();
        const parallelResultsArray = await concurrentlyMap(ingredientPlan, MAX_MARKET_RUN_CONCURRENCY, processSingleIngredientOptimized);
        const endMarketTime = Date.now();
        log(`Market Run parallel took ${(endMarketTime - startMarketTime)/1000}s`, 'INFO', 'SYSTEM');

        // Consolidate results, handling errors from concurrentlyMap AND processSingleIngredient
        const finalResults = parallelResultsArray.reduce((acc, currentResult) => {
             if (!currentResult) { // Handle cases where map function might return undefined/null unexpectedly
                 log(`Received null/undefined result from concurrentlyMap`, 'ERROR', 'SYSTEM');
                 return acc;
             }
             // Handle errors returned from concurrentlyMap itself (e.g., during promise settlement)
             if (currentResult.error && currentResult.item) {
                 log(`ConcurrentlyMap Error for "${currentResult.item}": ${currentResult.error}`, 'CRITICAL', 'MARKET_RUN');
                 const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === currentResult.item);
                 acc[currentResult.item] = { ...(failedIngredientData || { originalIngredient: currentResult.item }), source: 'error', allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url, searchAttempts: [{ status: 'processing_error', error: currentResult.error}] };
                 return acc;
             }
             // Handle errors returned *within* processSingleIngredient
             const ingredientKey = Object.keys(currentResult)[0];
             if(ingredientKey && currentResult[ingredientKey]?.source === 'error') {
                 log(`Processing Error for "${ingredientKey}": ${currentResult[ingredientKey].error}`, 'CRITICAL', 'MARKET_RUN');
                 // Keep the error information, ensure basic structure
                  const failedIngredientData = ingredientPlan.find(i => i.originalIngredient === ingredientKey);
                 acc[ingredientKey] = { ...(failedIngredientData || { originalIngredient: ingredientKey }), source: 'error', error: currentResult[ingredientKey].error, allProducts:[], currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url };
                 return acc;
             }
             // Merge successful results
             return { ...acc, ...currentResult };
        }, {});

        log("Market Run complete.", 'SUCCESS', 'PHASE');


        // --- Phase 4: Nutrition Calculation ---
        log("Phase 4: Nutrition Calculation...", 'INFO', 'PHASE');
        let calculatedTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        const itemsToFetchNutrition = [];
        
        for (const key in finalResults) {
            const result = finalResults[key];
            // Ensure result exists and is not an error object before accessing properties
            if (result && result.source === 'discovery') {
                const selected = result.allProducts?.find(p => p.url === result.currentSelectionURL);
                if (selected) {
                    itemsToFetchNutrition.push({
                        ingredientKey: key,
                        barcode: selected.barcode,
                        query: selected.name, // Use selected product name for OFF query
                        grams: result.totalGramsRequired >= 0 ? result.totalGramsRequired : 0, // Ensure grams is non-negative
                        // --- ADD AI FALLBACK DATA TO THE PAYLOAD ---
                        aiEstCaloriesPer100g: result.aiEstCaloriesPer100g,
                        aiEstProteinPer100g: result.aiEstProteinPer100g,
                        aiEstFatPer100g: result.aiEstFatPer100g,
                        aiEstCarbsPer100g: result.aiEstCarbsPer100g
                    });
                }
            }
            // --- NEW: Add failed items to nutrition calc if they have AI fallback data ---
            else if (result && (result.source === 'failed' || result.source === 'error')) {
                 if (result.totalGramsRequired > 0 && typeof result.aiEstCaloriesPer100g === 'number') {
                     log(`[${key}] Market Run failed, adding to nutrition queue with AI fallback.`, 'WARN', 'MARKET_RUN');
                     itemsToFetchNutrition.push({
                         ingredientKey: key,
                         barcode: null, // No barcode, will force fallback
                         query: null, // No query, will force fallback
                         grams: result.totalGramsRequired,
                         aiEstCaloriesPer100g: result.aiEstCaloriesPer100g,
                         aiEstProteinPer100g: result.aiEstProteinPer100g,
                         aiEstFatPer100g: result.aiEstFatPer100g,
                         aiEstCarbsPer100g: result.aiEstCarbsPer100g
                     });
                 }
            }
        }


        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching/Calculating nutrition for ${itemsToFetchNutrition.length} products...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, (item) =>
                // --- Only fetch if we have a barcode or query ---
                (item.barcode || item.query) ? 
                fetchNutritionData(item.barcode, item.query) // Query OFF using barcode first, then name
                    .then(nut => ({ ...item, nut }))
                    .catch(err => {
                        log(`Nutri fetch fail ${item.ingredientKey}: ${err.message}`, 'WARN', 'HTTP');
                        return { ...item, nut: { status: 'not_found' } }; // Ensure nut object exists on error
                    })
                : Promise.resolve({ ...item, nut: { status: 'not_found' } }) // --- Instantly resolve if no barcode/query (i.e., failed market run item)
            );
            log("Nutrition fetch/calc complete.", 'SUCCESS', 'HTTP');

            let weeklyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
            
            nutritionResults.forEach(item => {
                // Skip if no grams
                if (!item.grams || item.grams <= 0) return; 

                const nut = item.nut;

                if (nut?.status === 'found') {
                    // --- 1. Use Live Data (Priority 1) ---
                    weeklyTotals.calories += ((nut.calories || 0) / 100) * item.grams;
                    weeklyTotals.protein += ((nut.protein || 0) / 100) * item.grams;
                    weeklyTotals.fat += ((nut.fat || 0) / 100) * item.grams;
                    weeklyTotals.carbs += ((nut.carbs || 0) / 100) * item.grams;
                } else if (
                    // --- 2. Use AI Fallback Data (Priority 2) ---
                    typeof item.aiEstCaloriesPer100g === 'number' &&
                    typeof item.aiEstProteinPer100g === 'number' &&
                    typeof item.aiEstFatPer100g === 'number' &&
                    typeof item.aiEstCarbsPer100g === 'number'
                ) {
                    log(`Using AI nutrition fallback for ${item.ingredientKey}.`, 'WARN', 'CALC', { 
                        item: item.ingredientKey, 
                        grams: item.grams,
                        source: nut?.status ? `OFF status: ${nut.status}` : 'Market Run Fail' 
                    });
                    weeklyTotals.calories += (item.aiEstCaloriesPer100g / 100) * item.grams;
                    weeklyTotals.protein += (item.aiEstProteinPer100g / 100) * item.grams;
                    weeklyTotals.fat += (item.aiEstFatPer100g / 100) * item.grams;
                    weeklyTotals.carbs += (item.aiEstCarbsPer100g / 100) * item.grams;
                } else {
                    // --- 3. Skip (No Live, No Fallback) ---
                    log(`Skipping nutrition for ${item.ingredientKey}: Data not found and no AI fallback.`, 'INFO', 'CALC');
                }
            });


            log("Calculated WEEKLY nutrition totals:", 'DEBUG', 'CALC', weeklyTotals);
            // Ensure numDays is valid before dividing
            const validNumDays = (numDays >= 1 && numDays <= 7) ? numDays : 1;
            log(`Number of days for averaging: ${validNumDays}`, 'DEBUG', 'CALC');

            calculatedTotals.calories = Math.round(weeklyTotals.calories / validNumDays);
            calculatedTotals.protein = Math.round(weeklyTotals.protein / validNumDays);
            calculatedTotals.fat = Math.round(weeklyTotals.fat / validNumDays);
            calculatedTotals.carbs = Math.round(weeklyTotals.carbs / validNumDays);
            log("DAILY nutrition totals calculated.", 'SUCCESS', 'CALC', calculatedTotals);
        } else {
            log("No valid products with required grams found for nutrition calculation.", 'WARN', 'CALC');
        }


        // --- Phase 5: Assembling Final Response ---
        log("Phase 5: Final Response...", 'INFO', 'PHASE');
        // Ensure mealPlan is always an array
        const finalResponseData = { mealPlan: mealPlan || [], uniqueIngredients: ingredientPlan, results: finalResults, nutritionalTargets: calculatedTotals };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        // Catch top-level errors (e.g., from AI blueprint failure, unhandled exceptions)
        log(`CRITICAL Orchestrator ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error("ORCHESTRATOR UNHANDLED ERROR:", error);
        // Return a generic error message, including logs for debugging
        return response.status(500).json({ message: "An unrecoverable server error occurred during plan generation.", error: error.message, logs });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\


async function generateCreativeIdeas(cuisinePrompt, log) { /* no change */ const GEMINI_API_URL=`${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;const sysPrompt=`Creative chef... comma-separated list.`;const userQuery=`Theme: "${cuisinePrompt}"...`;log("Creative Prompt",'INFO','LLM_PROMPT',{userQuery});const payload={contents:[{parts:[{text:userQuery}]}],systemInstruction:{parts:[{text:sysPrompt}]}};try{const res=await fetchWithRetry(GEMINI_API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},log);if(!res.ok)throw new Error(`Creative AI HTTP ${res.status}.`);const result=await res.json();const text=result.candidates?.[0]?.content?.parts?.[0]?.text;if(!text)throw new Error("Creative AI empty.");log("Creative Raw",'INFO','LLM',{raw:text.substring(0,500)});return text;}catch(e){log("Creative AI failed.",'CRITICAL','LLM',{error:e.message});return"";}}

async function generateLLMPlanAndMeals(formData, calorieTarget, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']}; const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2;
    const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.');

    // --- PROMPT (Mark 23 - Refined Rules based on ChatGPT Data) ---
    const systemPrompt = `Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate meal plan & shopping list ('ingredients'). 2. QUERIES: For each ingredient: a. 'tightQuery': Hyper-specific, STORE-PREFIXED (e.g., "${store} RSPCA chicken breast 500g"). Prefer common brands found via ChatGPT analysis (e.g., "Bulla", "Primo"). Null if impossible or niche item. b. 'normalQuery': 2-4 generic words, STORE-PREFIXED (e.g., "${store} chicken breast fillets"). NO brands/sizes unless essential. CRITICAL: Make this query robust and likely to match common product names (e.g., use "${store} greek yogurt" NOT "${store} full fat greek yogurt"). c. 'wideQuery': 1-2 broad words, STORE-PREFIXED (e.g., "${store} chicken"). Null if normal is broad. 3. 'requiredWords': Array[1-2] ESSENTIAL, CORE NOUNS, lowercase for SCORE-BASED matching (e.g., ["lemon"], ["chorizo"], ["greek", "yogurt"]). CRITICAL: DO NOT include simple adjectives ('fresh', 'loose', 'natural', 'raw', 'dry', 'full', 'whole', 'plain') or hyper-specific terms ('roma') here. Put descriptors in 'tightQuery'. 4. 'negativeKeywords': Array[1-5] lowercase words indicating INCORRECT product (e.g., ["oil", "brine", "cat"]). CRITICAL: Be thorough - add keywords for incorrect forms (e.g., add ["juice", "soda", "cordial"] for fresh Lemons; add ["snack"] for raw Pork Rind). CRITICAL: DO NOT add negative keywords that conflict with the original ingredient (e.g., no 'mix' for 'Mixed Nuts'). 5. 'targetSize': Object {value: NUM, unit: "g"|"ml"} (e.g., {value: 500, unit: "g"}). Null if N/A. 6. 'totalGramsRequired': BEST ESTIMATE total g/ml for plan. SUM your meal portions. Be precise. 7. Adhere to constraints. 8. 'ingredients' MANDATORY. 'mealPlan' OPTIONAL but BEST EFFORT. 9. AI FALLBACK NUTRITION: For each ingredient, provide estimated nutrition per 100g as four fields: 'aiEstCaloriesPer100g', 'aiEstProteinPer100g', 'aiEstFatPer100g', 'aiEstCarbsPer100g'. These MUST be numbers. CRITICAL: These estimates MUST be accurate and realistic; exaggeration will fail the plan. 10. 'OR' INGREDIENTS: For ingredients with 'or' (e.g., "Raisins/Sultanas"), use broad 'requiredWords' (e.g., ["dried", "fruit"]) and add 'negativeKeywords' for undesired types (e.g., ["prunes", "apricots"]). 11. NICHE ITEMS (e.g., Yuzu, Shishito, Black Garlic): If an item seems rare, set 'tightQuery' to null, broaden 'normalQuery' (e.g., "Coles korean chili"), ensure 'wideQuery' is general (e.g., "Coles chili"), and use broader 'requiredWords' (e.g., ["korean", "chili"]). 12. FORM/TYPE: 'normalQuery' should usually be generic about form (e.g., "Coles pork rind"). Specify form (e.g., paste, whole, crushed) only if essential. 'requiredWords' should focus on the ingredient noun, not the form. 13. NO 'nutritionalTargets'.`;

    const userQuery = `Gen ${days}-day plan for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Target: ~${calorieTarget} kcal (ref). Dietary: ${dietary}. Meals: ${eatingOccasions} (${requiredMeals.join(', ')}). Spend: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}. Cuisine: ${cuisineInstruction}.`;


    log("Technical Prompt", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...' });

    // Schema (Mark 21 - Added AI Nutrition fields) - Schema remains the same
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
                                // --- NEW FALLBACK FIELDS ---
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
        const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) }, log);
        // Removed !response.ok check here as fetchWithRetry handles non-ok and throws on final failure
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

             // Validate essential structure
             if (!Array.isArray(parsed.ingredients)) {
                 log("Validation Error: 'ingredients' is not an array.", 'CRITICAL', 'LLM', parsed);
                 parsed.ingredients = []; // Attempt recovery
             }
             if (parsed.ingredients.length > 0) {
                const firstIng = parsed.ingredients[0];
                 if (!firstIng?.normalQuery) { log("Validation WARN: First ingredient missing 'normalQuery'.", 'WARN', 'LLM', firstIng); }
                 // --- Reduced required word validation based on new rule ---
                 if (!Array.isArray(firstIng?.requiredWords) || firstIng.requiredWords.length === 0 || firstIng.requiredWords.length > 2) { 
                     log("Validation WARN: First ingredient 'requiredWords' check (should be 1-2 core nouns).", 'WARN', 'LLM', firstIng); 
                 }
                 if (!Array.isArray(firstIng?.negativeKeywords)) { log("Validation WARN: First ingredient missing 'negativeKeywords'.", 'WARN', 'LLM', firstIng); }
                 if (typeof firstIng?.totalGramsRequired !== 'number') {log("Validation WARN: First ingredient missing/invalid 'totalGramsRequired'.", 'WARN', 'LLM', firstIng); }
                 if (typeof firstIng?.aiEstCaloriesPer100g !== 'number') {log("Validation WARN: First ingredient missing 'aiEstCaloriesPer100g'. Fallback may fail.", 'WARN', 'LLM', firstIng); }
             }
             // Ensure mealPlan is an array if it exists but is null/malformed
             if (parsed.mealPlan && !Array.isArray(parsed.mealPlan)) {
                 log("Validation WARN: 'mealPlan' exists but is not an array. Resetting.", 'WARN', 'LLM');
                 parsed.mealPlan = [];
             }


            return parsed;
        } catch (e) {
            log("Failed to parse Technical AI JSON.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: e.message });
            throw new Error(`Failed to parse LLM JSON: ${e.message}`);
        }
    } catch (error) {
         // Catch errors from fetchWithRetry (including final retry failure or non-retryable errors)
         log(`Technical AI call failed definitively: ${error.message}`, 'CRITICAL', 'LLM');
         // Re-throw to be caught by the main handler's try-catch
         throw error;
    }
}


// CORRECTED calculateCalorieTarget function
function calculateCalorieTarget(formData) {
    const { weight, height, age, gender, activityLevel, goal } = formData; // Use activityLevel here
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);
    // Add validation for inputs
    if (isNaN(weightKg) || isNaN(heightCm) || isNaN(ageYears) || !gender || !activityLevel || !goal) {
        // --- log function is not defined in this scope, use console.warn ---
        console.warn("Missing or invalid profile data for calorie calculation, using default 2000.", { weight, height, age, gender, activityLevel, goal});
        return 2000;
    }
    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    // Use activityLevel from formData correctly here
    let multiplier = activityMultipliers[activityLevel]; // Changed to let
     if (!multiplier) {
         console.warn(`Invalid activityLevel "${activityLevel}", using default 1.55.`);
         multiplier = 1.55;
     }
    const tdee = bmr * multiplier;
    const goalAdjustments = { cut: -500, maintain: 0, bulk: 500 };
    let adjustment = goalAdjustments[goal]; // Changed to let
    if (adjustment === undefined) {
         console.warn(`Invalid goal "${goal}", using default 0 adjustment.`);
         adjustment = 0;
    }
    // Ensure calculation results in a sensible number, prevent negative calories
    return Math.max(1200, Math.round(tdee + adjustment)); // Set a minimum floor of 1200 kcal
}
/// ===== API-CALLERS-END ===== ////

