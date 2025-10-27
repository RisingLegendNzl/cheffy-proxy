// --- ORCHESTRATOR API for Cheffy V3 ---

// Mark 46: Rewrote Prompt Rule 16 for explicit final sum verification. Added defensive check for accepted_query_idx ReferenceError.
// Mark 45: Fixed ReferenceError for fatGrams/proteinGrams/carbGrams in prompt generation.
// Mark 44: Implemented ChatGPT suggestions - Macro Sum Assertion + Retry, Mandatory Categories, Improved Negative Keywords, Category-Aware Size Validation.
// Mark 43: Merged stricter AI prompt rules, added meal subtotals schema, fixed validator plural matching.
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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // Retries for Gemini calls
const MAX_LLM_PLAN_RETRIES = 1; // Max retries specifically for macro sum mismatch
const MAX_NUTRITION_CONCURRENCY = 5;
const MAX_MARKET_RUN_CONCURRENCY = 5;
const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery', 'filter', 'paper', 'tip', 'shampoo', 'conditioner', 'soap', 'lotion', 'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum'];
const REQUIRED_WORD_SCORE_THRESHOLD = 0.60;
const SKIP_HEURISTIC_SCORE_THRESHOLD = 1.0;
const PRICE_OUTLIER_Z_SCORE = 2.0;
const PANTRY_CATEGORIES = ["pantry", "grains", "canned", "spreads", "condiments", "drinks"];

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

function passRequiredWords(title = '', required = []) {
  if (!required || required.length === 0) return true;
  const t = title.toLowerCase();
  return required.every(w => {
    if (!w) return true;
    const base = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b${base}(?:e?s)?\\b`, 'i');
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
    let score = 1.0;

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

    const productSizeParsed = parseSize(product.product_size);
    // Pass allowedCategories which should now be guaranteed by prompt/validation
    if (!sizeOk(productSizeParsed, targetSize, allowedCategories, log, originalIngredient, checkLogPrefix)) {
        return { pass: false, score: 0 };
    }

    log(`${checkLogPrefix}: PASS`, 'DEBUG', 'CHECKLIST');
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
            console.log(`[${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
            if (data && (level === 'ERROR' || level === 'CRITICAL' || level === 'WARN')) {
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

        let llmResult;
        let planAttempt = 0;
        let macroCheckPassed = false;
        
        while (planAttempt <= MAX_LLM_PLAN_RETRIES && !macroCheckPassed) {
             planAttempt++;
             log(`Attempt ${planAttempt} to generate technically valid plan from LLM.`, 'INFO', 'LLM_CALL');
             try {
                 llmResult = await generateLLMPlanAndMeals(
                     formData,
                     calorieTarget,
                     macroTargets.proteinGrams,
                     macroTargets.fatGrams,
                     macroTargets.carbGrams,
                     creativeIdeas,
                     log,
                     planAttempt > 1
                 );

                 assertDailyMacroSums(llmResult?.mealPlan || [], { kcal: calorieTarget, protein_g: macroTargets.proteinGrams, fat_g: macroTargets.fatGrams, carbs_g: macroTargets.carbGrams }, log);
                 macroCheckPassed = true;
                 log("Macro sum validation passed.", 'SUCCESS', 'LLM_VALIDATION');

             } catch (llmError) {
                 log(`Error during generateLLMPlanAndMeals call or validation (Attempt ${planAttempt}): ${llmError.message}`, 'WARN', 'LLM_CALL', { name: llmError.name });

                 if (llmError.message === "PLANNER_SUM_MISMATCH") {
                      if (planAttempt <= MAX_LLM_PLAN_RETRIES) {
                         log(`Retrying LLM call due to macro mismatch (Attempt ${planAttempt}).`, 'WARN', 'LLM_RETRY');
                         await delay(1000);
                         continue;
                     } else {
                         log(`Macro mismatch persisted after ${MAX_LLM_PLAN_RETRIES + 1} attempts. Proceeding with inaccurate plan.`, 'CRITICAL', 'LLM_VALIDATION');
                          if (!llmResult) {
                               throw new Error("LLM failed to produce any plan after retries.");
                          }
                          macroCheckPassed = true; // Force exit loop and use potentially bad plan
                     }
                 } else {
                     // If it's a different error (e.g., schema validation, API error), re-throw immediately
                     throw llmError;
                 }
             }
        } // End while loop

        const { ingredients, mealPlan = [] } = llmResult || {};
        const rawIngredientPlan = Array.isArray(ingredients) ? ingredients : [];


        if (rawIngredientPlan.length === 0) {
            log("Blueprint fail: No ingredients returned by Technical AI (array was empty or invalid).", 'CRITICAL', 'LLM', { result: llmResult });
            throw new Error("Blueprint fail: AI did not return any ingredients.");
        }

        // Ensure allowedCategories exists (as required by prompt now)
        const ingredientPlan = rawIngredientPlan.filter(ing => ing && ing.originalIngredient && ing.normalQuery && Array.isArray(ing.requiredWords) && Array.isArray(ing.negativeKeywords) && Array.isArray(ing.allowedCategories) && ing.allowedCategories.length > 0 && ing.totalGramsRequired >= 0);
        if (ingredientPlan.length !== rawIngredientPlan.length) {
            log(`Sanitized ingredient list: removed ${rawIngredientPlan.length - ingredientPlan.length} invalid entries (check required fields like allowedCategories).`, 'WARN', 'DATA');
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
                let bestScoreSoFar = -1; // Keep score for skip heuristic
                const queriesToTry = [ { type: 'tight', query: ingredient.tightQuery }, { type: 'normal', query: ingredient.normalQuery }, { type: 'wide', query: ingredient.wideQuery } ];

                // --- MODIFICATION (Mark 46): Initialize telemetry variables outside loop ---
                let acceptedQueryIdx = -1; // Initialize to invalid state
                let acceptedQueryType = 'none';
                let pagesTouched = 0;
                let priceZ = null;
                let bucketWaitMs = 0;
                const mode = 'speed';
                // --- END MODIFICATION ---

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
                    for (const rawProduct of rawProducts) {
                         if (!rawProduct || !rawProduct.product_name) {
                             log(`[${ingredientKey}] Skipping invalid raw product data`, 'WARN', 'DATA', { rawProduct });
                             continue;
                         }
                        const productWithCategory = { ...rawProduct, product_category: rawProduct.product_category };
                        const checklistResult = runSmarterChecklist(productWithCategory, ingredient, log);

                        if (checklistResult.pass) {
                             validProductsOnPage.push({ product: { name: rawProduct.product_name, brand: rawProduct.product_brand, price: rawProduct.current_price, size: rawProduct.product_size, url: rawProduct.url, barcode: rawProduct.barcode, unit_price_per_100: calculateUnitPrice(rawProduct.current_price, rawProduct.product_size) }, score: checklistResult.score }); // Keep score for skip heuristic
                        }
                    }

                    const filteredProducts = applyPriceOutlierGuard(validProductsOnPage, log, ingredientKey);

                    currentAttemptLog.foundCount = filteredProducts.length;
                    currentAttemptLog.bestScore = filteredProducts.length > 0 ? filteredProducts.reduce((max, p) => Math.max(max, p.score), 0) : 0; // Use actual score for skip heuristic

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
                             continue; // Try next query type
                        }

                        result.source = 'discovery';
                        currentAttemptLog.status = 'success';
                        bestScoreSoFar = Math.max(bestScoreSoFar, currentAttemptLog.bestScore); // Update best score found so far

                        // --- MODIFICATION (Mark 46): Set telemetry vars *on success* ---
                        acceptedQueryIdx = index;
                        acceptedQueryType = type;
                        // --- END MODIFICATION ---
                        const keptCount = result.allProducts.length;

                        // Calculate priceZ only if needed (moved before telemetry log)
                        if (result.allProducts.length >= 3 && foundProduct.unit_price_per_100 != null && foundProduct.unit_price_per_100 > 0) {
                            const prices = result.allProducts.map(p => p.unit_price_per_100).filter(p => p != null && p > 0);
                             if (prices.length >= 2) {
                                const m = mean(prices);
                                const s = stdev(prices);
                                priceZ = (s > 0) ? ((foundProduct.unit_price_per_100 - m) / s) : 0;
                            }
                        }

                        // --- MODIFICATION (Mark 46): Add defensive check before logging telemetry ---
                        if (typeof acceptedQueryIdx === 'number' && acceptedQueryIdx >= 0) {
                            log(`[${ingredientKey}] Success Telemetry`, 'INFO', 'LADDER_TELEMETRY', {
                                 ingredientKey, accepted_query_idx, accepted_query_type, pages_touched, kept_count,
                                 price_z: priceZ !== null ? parseFloat(priceZ.toFixed(2)) : null,
                                 mode, bucket_wait_ms
                             });
                        } else {
                             log(`[${ingredientKey}] CRITICAL Error: Telemetry skipped due to invalid accepted_query_idx: ${acceptedQueryIdx}`, 'CRITICAL', 'MARKET_RUN_ERROR', {
                                ingredientKey, index, type, success: true // Log context
                             });
                        }
                        // --- END MODIFICATION ---


                        if (type === 'tight' && bestScoreSoFar >= SKIP_HEURISTIC_SCORE_THRESHOLD) {
                            log(`[${ingredientKey}] Skip heuristic hit (Tight query successful with score >= ${SKIP_HEURISTIC_SCORE_THRESHOLD}).`, 'INFO', 'MARKET_RUN');
                            break; // Skip normal/wide if tight query worked well enough
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
                 log(`Processing Error for "${ingredientKey}": ${currentResult[ingredientKey].error}`, 'CRITICAL', 'MARKET_RUN'); // Logged already in processSingleIngredientOptimized, but good to have context here
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


        // --- Phase 4: Nutrition Calculation ---
        log("Phase 4: Nutrition Calculation...", 'INFO', 'PHASE');
        let finalDailyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
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
                        aiEstCaloriesPer100g: result.aiEstCaloriesPer100g, aiEstProteinPer100g: result.aiEstProteinPer100g,
                        aiEstFatPer100g: result.aiEstFatPer100g, aiEstCarbsPer100g: result.aiEstCarbsPer100g
                    });
                } else {
                     log(`[${key}] Result source is 'discovery' but no selected product found for URL ${result.currentSelectionURL}. Using AI fallback.`, 'WARN', 'CALC');
                     // Use AI fallback if grams and estimate exist
                     if (typeof result.totalGramsRequired === 'number' && result.totalGramsRequired > 0 && typeof result.aiEstCaloriesPer100g === 'number') {
                         itemsToFetchNutrition.push({
                             ingredientKey: key, barcode: null, query: null, grams: result.totalGramsRequired,
                             aiEstCaloriesPer100g: result.aiEstCaloriesPer100g, aiEstProteinPer100g: result.aiEstProteinPer100g,
                             aiEstFatPer100g: result.aiEstFatPer100g, aiEstCarbsPer100g: result.aiEstCarbsPer100g
                         });
                     }
                }
            } else if (result.source === 'failed' || result.source === 'error') {
                 // Use AI fallback if grams and estimate exist
                 if (typeof result.totalGramsRequired === 'number' && result.totalGramsRequired > 0 && typeof result.aiEstCaloriesPer100g === 'number') {
                     log(`[${key}] Market Run failed or error, adding to nutrition queue with AI fallback.`, 'WARN', 'MARKET_RUN');
                     itemsToFetchNutrition.push({
                         ingredientKey: key, barcode: null, query: null, grams: result.totalGramsRequired,
                         aiEstCaloriesPer100g: result.aiEstCaloriesPer100g, aiEstProteinPer100g: result.aiEstProteinPer100g,
                         aiEstFatPer100g: result.aiEstFatPer100g, aiEstCarbsPer100g: result.aiEstCarbsPer100g
                     });
                 } else {
                     log(`[${key}] Market Run failed/error, but no valid grams/AI estimate for nutrition fallback. Skipping.`, 'WARN', 'CALC', { grams: result.totalGramsRequired, est: result.aiEstCaloriesPer100g });
                 }
            }
        } // End for loop building nutrition items


        if (itemsToFetchNutrition.length > 0) {
            log(`Fetching/Calculating nutrition for ${itemsToFetchNutrition.length} products...`, 'INFO', 'HTTP');
            const nutritionResults = await concurrentlyMap(itemsToFetchNutrition, MAX_NUTRITION_CONCURRENCY, (item) =>
                (item.barcode || item.query) ?
                fetchNutritionData(item.barcode, item.query, log)
                    .then(nut => ({ ...item, nut })) // Ensure item data is carried through
                    .catch(err => {
                        log(`Unhandled Nutri fetch error ${item.ingredientKey}: ${err.message}`, 'CRITICAL', 'HTTP');
                        // Return item data even on error, with not_found status
                        return { ...item, nut: { status: 'not_found', error: 'Unhandled fetch error' } };
                    })
                // If no barcode/query (only AI fallback), resolve immediately
                : Promise.resolve({ ...item, nut: { status: 'not_found', source: 'ai_fallback_only' } })
            );

            log("Nutrition fetch/calc complete.", 'SUCCESS', 'HTTP');

            let weeklyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };

            nutritionResults.forEach(item => {
                 // Basic validation of item structure
                 if (!item || typeof item !== 'object' || !item.ingredientKey || !item.nut) {
                    log('Skipping invalid item in nutritionResults loop.', 'ERROR', 'CALC', { item });
                    return;
                }
                // Ensure grams is a valid number
                 const grams = typeof item.grams === 'number' ? item.grams : parseFloat(item.grams);
                 if (isNaN(grams) || grams <= 0) {
                      log(`[${item.ingredientKey}] Skipping nutrition calculation due to invalid or zero grams: ${item.grams}`, 'WARN', 'CALC');
                      return;
                 }


                const nut = item.nut;
                const result = finalResults[item.ingredientKey]; // Get the corresponding market result

                 // Attach nutrition data back to the finalResults object
                 if (result) {
                     // If discovery, try to find the selected product to attach to
                     if (result.source === 'discovery' && Array.isArray(result.allProducts)) {
                         let productToAttach = result.allProducts.find(p => p && p.url === result.currentSelectionURL);
                         if (productToAttach) {
                             productToAttach.nutrition = nut;
                         } else {
                             log(`[${item.ingredientKey}] Could not find selected product by URL to attach nutrition. Attaching to first product if available.`, 'WARN', 'CALC');
                             if (result.allProducts.length > 0 && result.allProducts[0]) {
                                result.allProducts[0].nutrition = nut;
                             }
                         }
                     } else {
                          // If failed/error or other source, attach directly to the result object
                         result.nutrition = nut;
                     }
                 } else {
                      log(`[${item.ingredientKey}] Could not find market result object to attach nutrition data.`, 'WARN', 'CALC');
                 }


                let proteinG = 0;
                let fatG = 0;
                let carbsG = 0;

                // Prioritize found nutrition data
                if (nut?.status === 'found' && nut.protein != null && nut.fat != null && nut.carbs != null) {
                    proteinG = (nut.protein / 100) * grams;
                    fatG = (nut.fat / 100) * grams;
                    carbsG = (nut.carbs / 100) * grams;
                }
                // Fallback to AI estimates if nutrition wasn't found or invalid
                else if (
                    typeof item.aiEstProteinPer100g === 'number' &&
                    typeof item.aiEstFatPer100g === 'number' &&
                    typeof item.aiEstCarbsPer100g === 'number'
                ) {
                    log(`Using AI nutrition fallback for ${item.ingredientKey}.`, 'WARN', 'CALC', {
                        item: item.ingredientKey, grams,
                        reason: nut?.status ? `Nutri API status: ${nut.status}` : 'Market Run Fail/Error/No Selection/No Query'
                    });
                    proteinG = (item.aiEstProteinPer100g / 100) * grams;
                    fatG = (item.aiEstFatPer100g / 100) * grams;
                    carbsG = (item.aiEstCarbsPer100g / 100) * grams;
                } else {
                    log(`Skipping nutrition calculation for ${item.ingredientKey}: Data not found and no valid AI fallback.`, 'INFO', 'CALC');
                }

                weeklyTotals.protein += proteinG;
                weeklyTotals.fat += fatG;
                weeklyTotals.carbs += carbsG;
            });

            // Calculate final calories from summed macros
            weeklyTotals.calories = (weeklyTotals.protein * 4) + (weeklyTotals.fat * 9) + (weeklyTotals.carbs * 4);
            log("Calculated WEEKLY nutrition totals (Calories derived from macros):", 'DEBUG', 'CALC', weeklyTotals);

            const validNumDays = (numDays >= 1 && numDays <= 7) ? numDays : 1;
            log(`Number of days for averaging: ${validNumDays}`, 'DEBUG', 'CALC');

            // Calculate daily averages
            finalDailyTotals.calories = Math.round(weeklyTotals.calories / validNumDays);
            finalDailyTotals.protein = Math.round(weeklyTotals.protein / validNumDays);
            finalDailyTotals.fat = Math.round(weeklyTotals.fat / validNumDays);
            finalDailyTotals.carbs = Math.round(weeklyTotals.carbs / validNumDays);
            log("DAILY nutrition totals calculated.", 'SUCCESS', 'CALC', finalDailyTotals);
        } else {
            log("No valid items found for nutrition calculation (Market Run likely failed for all items with grams).", 'WARN', 'CALC');
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

const within5 = (v, t) => {
    if (t == null || v == null) return false; // Fail if either is null/undefined
    const target = Number(t);
    const value = Number(v);
    if (!Number.isFinite(target) || !Number.isFinite(value)) return false; // Fail if not numbers
    if (target === 0 && value === 0) return true;
    if (target === 0) return false;
    // Use Math.abs(target) in denominator to handle potential negative targets correctly (though unlikely here)
    return Math.abs(value - target) / Math.max(1, Math.abs(target)) <= 0.05;
};


function assertDailyMacroSums(mealPlanDays = [], targets = {}, log) {
    if (!mealPlanDays || mealPlanDays.length === 0) {
        log("Macro Sum Check: No meal plan days provided.", 'WARN', 'LLM_VALIDATION');
        return; // Nothing to check
    }
    const { kcal, protein_g, fat_g, carbs_g } = targets;
    // Check if targets are valid numbers
    if (kcal == null || protein_g == null || fat_g == null || carbs_g == null ||
        !Number.isFinite(Number(kcal)) || !Number.isFinite(Number(protein_g)) ||
        !Number.isFinite(Number(fat_g)) || !Number.isFinite(Number(carbs_g))) {
        log("Macro Sum Check: Missing or invalid target values.", 'ERROR', 'LLM_VALIDATION', { targets });
        throw new Error("PLANNER_SUM_MISMATCH"); // Treat missing/invalid targets as mismatch
    }

    for (const dayData of mealPlanDays) {
        if (!dayData || !Array.isArray(dayData.meals) || dayData.meals.length === 0) { // Check for empty meals array too
             log(`Macro Sum Check: Invalid day data or missing/empty meals for day ${dayData?.day || 'unknown'}.`, 'WARN', 'LLM_VALIDATION');
             // Decide if this should be a failure or just a skip. Let's make it a failure.
             throw new Error("PLANNER_SUM_MISMATCH");
        }
        const sums = dayData.meals.reduce((acc, meal) => {
            // Check meal structure and ensure subtotals are valid numbers before adding
            if (meal && typeof meal === 'object') {
                 const kcalVal = Number(meal.subtotal_kcal);
                 const pVal = Number(meal.subtotal_protein);
                 const fVal = Number(meal.subtotal_fat);
                 const cVal = Number(meal.subtotal_carbs);
                 acc.kcal += Number.isFinite(kcalVal) ? kcalVal : 0;
                 acc.p += Number.isFinite(pVal) ? pVal : 0;
                 acc.f += Number.isFinite(fVal) ? fVal : 0;
                 acc.c += Number.isFinite(cVal) ? cVal : 0;
            } else {
                 log(`Macro Sum Check: Invalid meal structure encountered for day ${dayData.day}`, 'WARN', 'LLM_VALIDATION', { meal });
            }
            return acc;
        }, { kcal: 0, p: 0, f: 0, c: 0 });

        // Perform the 5% check using the helper
        const kcalOk = within5(sums.kcal, kcal);
        const pOk = within5(sums.p, protein_g);
        const fOk = within5(sums.f, fat_g);
        const cOk = within5(sums.c, carbs_g);
        const ok = kcalOk && pOk && fOk && cOk;


        if (!ok) {
            log(`Macro Sum Check FAILED for Day ${dayData.day}: Targets(K:${kcal},P:${protein_g},F:${fat_g},C:${carbs_g}) vs Sums(K:${sums.kcal.toFixed(0)},P:${sums.p.toFixed(0)},F:${sums.f.toFixed(0)},C:${sums.c.toFixed(0)})`, 'ERROR', 'LLM_VALIDATION', {
                 kcalOk, pOk, fOk, cOk // Add individual checks to log
            });
            throw new Error("PLANNER_SUM_MISMATCH"); // Trigger re-prompt
        } else {
             log(`Macro Sum Check PASSED for Day ${dayData.day}: Targets(K:${kcal},P:${protein_g},F:${fat_g},C:${carbs_g}) vs Sums(K:${sums.kcal.toFixed(0)},P:${sums.p.toFixed(0)},F:${sums.f.toFixed(0)},C:${sums.c.toFixed(0)})`, 'INFO', 'LLM_VALIDATION');
        }
    }
}


async function generateLLMPlanAndMeals(formData, calorieTarget, proteinTargetGrams, fatTargetGrams, carbTargetGrams, creativeIdeas, log, isRetry = false) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']}; const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2;
    const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.');
    const isAustralianStore = (store === 'Coles' || store === 'Woolworths');
    const australianTermNote = isAustralianStore ? " Use common Australian terms (e.g., 'spring onion' not 'scallion', 'capsicum' not 'bell pepper')." : "";

    // --- *** MODIFICATION (Mark 46): Rewrote Rule 16 *** ---
    const systemPrompt = `Expert dietitian/chef/query optimizer for store: ${store}. RULES: 1. Generate meal plan ('mealPlan') & shopping list ('ingredients'). 2. QUERIES: For each ingredient: a. 'tightQuery': Hyper-specific, STORE-PREFIXED. b. 'normalQuery': 2-4 generic words, STORE-PREFIXED. CRITICAL: Use MOST COMMON GENERIC NAME. DO NOT include brands, sizes, fat content, specific forms (sliced/grated), or dryness unless ESSENTIAL.${australianTermNote} c. 'wideQuery': 1-2 broad words, STORE-PREFIXED. 3. 'requiredWords': Array[1] SINGLE ESSENTIAL CORE NOUN ONLY, lowercase singular. NO adjectives, forms, plurals, or multiple words (e.g., for 'baby spinach leaves', use ['spinach']; for 'roma tomatoes', use ['tomato']). This word MUST exist in product names. 4. 'negativeKeywords': Array[1-5] lowercase words for INCORRECT product. Be thorough. Include common mismatches by type. Examples: fresh produce → ["bread","cake","sauce","canned","powder","chips","dried","frozen"], herb/spice → ["spray","cleaner","mouthwash","deodorant"], meat cuts → ["cat","dog","pet","toy"]. 5. 'targetSize': Object {value: NUM, unit: "g"|"ml"}. Null if N/A. Prefer common package sizes. 6. 'totalGramsRequired': BEST ESTIMATE total g/ml for plan. MUST accurately reflect sum of meal portions. 7. Adhere to constraints. 8. 'ingredients' MANDATORY. 'mealPlan' MANDATORY. 9. AI FALLBACK NUTRITION: Provide estimated 'aiEst...' per 100g (numbers, realistic). 10. 'OR' INGREDIENTS: Use broad 'requiredWords', add relevant 'negativeKeywords'. 11. NICHE ITEMS: Set 'tightQuery' null, broaden queries/words. 12. FORM/TYPE: 'normalQuery' = generic form. 'requiredWords' = singular noun ONLY. Specify form only in 'tightQuery'. 13. NO 'nutritionalTargets' in output. 14. 'allowedCategories' (MANDATORY): Provide precise, lowercase categories for each ingredient using this exact set: ["produce","fruit","veg","dairy","bakery","meat","seafood","pantry","frozen","drinks","canned","grains","spreads","condiments","snacks"]. 15. MEAL PORTIONS & SUBTOTALS: For each meal in 'mealPlan.meals': a) Specify clear portion sizes for key ingredients in 'description' (e.g., '...150g chicken breast, 80g dry rice...'). b) MANDATORY: Calculate and include 'subtotal_kcal', 'subtotal_protein', 'subtotal_fat', 'subtotal_carbs' (numbers, integers). YOU MUST DO THIS MATH ACCURATELY. 16. CRITICAL FINAL VALIDATION RULE: Before returning the JSON, YOU MUST perform this final check for EACH day in the 'mealPlan': Calculate the SUM of 'subtotal_kcal' across all meals for that day. Verify if this SUM is within ±5% of the overall daily_kcal_target (${calorieTarget}). Do the same verification for the SUM of 'subtotal_protein' against the target (${proteinTargetGrams}g), SUM of 'subtotal_fat' against (${fatTargetGrams}g), and SUM of 'subtotal_carbs' against (${carbTargetGrams}g). If ANY of these sums for ANY day fall outside the ±5% tolerance, you MUST revise the meal portion sizes (grams in the 'description' field) and recalculate the corresponding 'subtotal_...' values for the affected meals until ALL daily sums meet the ±5% requirement for ALL macros. ONLY return the final, validated JSON object that passes this check for all days. 17. BULKING MACRO PRIORITY: For 'bulk' goals, prioritize carbohydrate sources over fats when adjusting portions. 18. MEAL VARIETY: Critical. User maxRepetitions=${maxRepetitions}. DO NOT repeat exact meals more than this across the entire ${days}-day plan. Ensure variety, especially if maxRepetitions < ${days}. 19. COST vs. VARIETY: User costPriority='${costPriority}'. Balance with Rule 18. Prioritize variety if needed. Output ONLY the valid JSON object described by the schema, nothing else.`;
    // --- *** END MODIFICATION *** ---

    let userQuery = `Gen ${days}-day plan for ${name||'Guest'}. Profile: ${age}yo ${gender}, ${height}cm, ${weight}kg. Act: ${formData.activityLevel}. Goal: ${goal}. Store: ${store}. Target: ~${calorieTarget} kcal. Macro Targets: Protein ~${proteinTargetGrams}g, Fat ~${fatTargetGrams}g, Carbs ~${carbTargetGrams}g. Dietary: ${dietary}. Meals: ${eatingOccasions} (${Array.isArray(requiredMeals) ? requiredMeals.join(', ') : '3 meals'}). Spend: ${costPriority} (${costInstruction}). Rep Max: ${maxRepetitions}. Cuisine: ${cuisineInstruction}.`;

    if (isRetry) {
        userQuery = `PREVIOUS ATTEMPT FAILED MACRO CHECK (Rule 16). Adjust meal portion sizes (grams) significantly and recalculate meal subtotals precisely. CRITICAL: You MUST verify that the SUM of subtotals for each day matches the daily targets (within +/- 5%) BEFORE returning the JSON, as per Rule 16.\nORIGINAL REQUEST:\n${userQuery}`;
        log("Adding retry instruction to LLM prompt, emphasizing FINAL SUM CHECK.", 'WARN', 'LLM_RETRY');
    }

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
            responseSchema: { /* Schema remains unchanged */
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
                                "aiEstCaloriesPer100g": { "type": "NUMBER", nullable: true },
                                "aiEstProteinPer100g": { "type": "NUMBER", nullable: true },
                                "aiEstFatPer100g": { "type": "NUMBER", nullable: true },
                                "aiEstCarbsPer100g": { "type": "NUMBER", nullable: true }
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
                                            "subtotal_kcal": { "type": "NUMBER" },
                                            "subtotal_protein": { "type": "NUMBER" },
                                            "subtotal_fat": { "type": "NUMBER" },
                                            "subtotal_carbs": { "type": "NUMBER" }
                                        },
                                        required: ["type", "name", "description", "subtotal_kcal", "subtotal_protein", "subtotal_fat", "subtotal_carbs"]
                                    }
                                }
                            },
                             required: ["day", "meals"]
                        }
                    }
                },
                required: ["ingredients", "mealPlan"]
            }
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

            // Basic validation
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
             // Validate meal structure and required fields (including subtotals)
             for(const dayPlan of parsed.mealPlan) {
                if (!dayPlan || typeof dayPlan !== 'object' || !Number.isFinite(dayPlan.day)) throw new Error(`LLM response contains invalid dayPlan object or missing day number.`);
                if (!dayPlan.meals || !Array.isArray(dayPlan.meals) || dayPlan.meals.length === 0) throw new Error(`LLM response has invalid or empty meals array for day ${dayPlan.day}.`);
                for(const meal of dayPlan.meals) {
                     if (!meal || typeof meal !== 'object') throw new Error(`LLM response contains invalid meal object for day ${dayPlan.day}.`);
                     if (typeof meal.type !== 'string' || typeof meal.name !== 'string' || typeof meal.description !== 'string' ||
                         !Number.isFinite(Number(meal.subtotal_kcal)) || !Number.isFinite(Number(meal.subtotal_protein)) ||
                         !Number.isFinite(Number(meal.subtotal_fat)) || !Number.isFinite(Number(meal.subtotal_carbs))) {
                          throw new Error(`LLM response has missing required fields or non-numeric subtotals for meal "${meal.name || 'unnamed'}" on day ${dayPlan.day}.`);
                     }
                 }
            }
            // Validate ingredient structure and required fields (including allowedCategories)
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
         // Check if the error is due to the macro mismatch validation, re-throw specifically if so
         if (error.message === "PLANNER_SUM_MISMATCH") {
             throw error; // Let the main handler catch this for retry logic
         }
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


