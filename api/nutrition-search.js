const fetch = require('node-fetch');
// --- REMOVED (Mark 51): Import axios (no longer needed) ---
// --- MODIFICATION: Import createClient instead of the default kv instance ---
const { createClient } = require('@vercel/kv');

// --- MODIFICATION: Create a client instance using your Upstash variables ---
const kv = createClient({
    url: process.env.UPstash_REDIS_REST_URL, // Corrected env variable name if needed
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
// --- END MODIFICATION ---

// --- CACHE CONFIGURATION ---
const TTL_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days (OFF Barcode)
const SWR_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 10; // Stale While Revalidate after 10 days
const TTL_NUTRI_NAME_MS = 1000 * 60 * 60 * 24 * 7;    // 7 days (OFF Name, USDA Name)
const SWR_NUTRI_NAME_MS = 1000 * 60 * 60 * 24 * 2;     // Stale While Revalidate after 2 days
const CACHE_PREFIX_NUTRI = 'nutri';

// --- REMOVED (Mark 51): DIETAGRAM API CONFIGURATION ---

// --- NEW (Mark 51): USDA API CONFIGURATION ---
const USDA_API_KEY = process.env.USDA_API_KEY;
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_DETAILS_URL = 'https://api.nal.usda.gov/fdc/v1/food/'; // Append {fdcId}?api_key=...

// --- TOKEN BUCKET CONFIGURATION (Now for USDA) ---
const BUCKET_CAPACITY = 10; // Keep capacity reasonable
const BUCKET_REFILL_RATE = 1; // USDA default limit is lower (1 req/sec), adjust if needed based on plan
const BUCKET_RETRY_DELAY_MS = 1100; // Delay slightly longer than 1 sec after a 429
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// --- END NEW ---

// --- CONSTANT FOR UNIT CORRECTION ---
const KJ_TO_KCAL_FACTOR = 4.184;

// Keep track of ongoing background refreshes within this invocation
const inflightRefreshes = new Set();

/**
 * Normalizes strings for consistent cache keys.
 * @param {string} str - Input string.
 * @returns {string} Normalized string (lowercase, trimmed).
 */
const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');

// --- HELPER TO CHECK KV STATUS ---
// --- MODIFICATION: Check for your Upstash variables instead of Vercel's KV variables ---
const isKvConfigured = () => {
    // Check for both URL and TOKEN
    return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
};
// --- END MODIFICATION ---

// --- REMOVED (Mark 51): Dietagram Normalizer ---

// --- NEW (Mark 51): USDA Normalizer ---
/**
 * Normalizes a response from the USDA FoodData Central API (details endpoint)
 * into our standard nutrition object.
 * @param {object} usdaDetailsResponse - The raw response from USDA details API.
 * @param {string} query - The original query, for logging.
 * @param {function} log - The logger function.
 * @returns {object} Our standard nutrition object, or null if data is invalid.
 */
function normalizeUsdaResponse(usdaDetailsResponse, query, log) {
    if (!usdaDetailsResponse || !Array.isArray(usdaDetailsResponse.foodNutrients)) {
        log(`USDA: No valid foodNutrients array found for query: ${query} (FDC ID: ${usdaDetailsResponse?.fdcId})`, 'WARN', 'USDA_PARSE');
        return null;
    }

    const nutrients = usdaDetailsResponse.foodNutrients;
    const findNutrient = (ids, targetUnit = 'G', allowNameFallback = true) => {
        for (const id of ids) {
            const nutrient = nutrients.find(n => n.nutrient?.id === id);
            if (nutrient && nutrient.amount !== undefined && nutrient.amount !== null) {
                const unit = (nutrient.unitName || '').toUpperCase();
                let amount = parseFloat(nutrient.amount);
                if (isNaN(amount)) continue;

                if (unit === targetUnit.toUpperCase()) {
                    return amount;
                } else if (targetUnit.toUpperCase() === 'G' && unit === 'MG') {
                    return amount / 1000; // Convert mg to g
                } else if (targetUnit.toUpperCase() === 'KCAL' && unit === 'KJ') {
                     // Check if kcal is already present before converting KJ
                     const kcalNutrient = nutrients.find(n => n.nutrient?.id === 208 || n.nutrient?.id === 1008);
                     if (kcalNutrient && kcalNutrient.amount !== undefined && !isNaN(parseFloat(kcalNutrient.amount)) && parseFloat(kcalNutrient.amount) > 0) {
                         log(`USDA: Found direct kcal value for ID ${id}, skipping KJ conversion.`, 'DEBUG', 'USDA_PARSE');
                         continue; // Skip KJ if kcal exists and is valid
                     }
                     log(`USDA: Converting KJ to Kcal for ID ${id} (${amount} ${unit})`, 'DEBUG', 'USDA_PARSE');
                     return amount / KJ_TO_KCAL_FACTOR; // Convert kJ to kcal
                }
                log(`USDA: Nutrient ID ${id} found but unit mismatch (${unit} vs ${targetUnit})`, 'DEBUG', 'USDA_PARSE');
            }
        }
         // Fallback to searching by name
         if (allowNameFallback) {
             const nameMap = {
                 1008: /energy/i, // kcal (Prefer ID 1008 if name searching)
                 1003: /protein/i,
                 1004: /fat|lipid/i,
                 1005: /carbohydrate/i, // by difference usually
                 1258: /fatty acids, total saturated/i, // Prefer ID 1258
                 2000: /sugars, total/i, // Prefer ID 2000
                 1079: /fiber, total dietary/i, // Prefer ID 1079
                 1093: /sodium/i, // Prefer ID 1093
             };
              // Add older IDs as backup if preferred IDs aren't found by name
              const backupNameMap = {
                  208: /energy/i, // kcal
                  203: /protein/i,
                  204: /fat|lipid/i,
                  205: /carbohydrate/i,
                  606: /fatty acids, total saturated/i,
                  269: /sugars/i, // Less specific
                  291: /fiber/i, // Less specific
                  307: /sodium/i, // Less specific
              };

             for (const id in nameMap) { // Check preferred names first
                 const nameRegex = nameMap[id];
                 const nutrient = nutrients.find(n => n.nutrient?.name && nameRegex.test(n.nutrient.name));
                  if (nutrient && nutrient.amount !== undefined && nutrient.amount !== null) {
                       const unit = (nutrient.unitName || '').toUpperCase();
                       let amount = parseFloat(nutrient.amount);
                       if (isNaN(amount)) continue;
                       const targetUnitId = Object.keys(nameMap).find(key => nameMap[key] === nameRegex); // Get target unit based on ID
                       const targetUnit = (targetUnitId === '1008' || targetUnitId === '208') ? 'KCAL' : 'G';

                       if (unit === targetUnit) return amount;
                       else if (targetUnit === 'G' && unit === 'MG') return amount / 1000;
                        else if (targetUnit === 'KCAL' && unit === 'KJ') {
                             const kcalNutrientByName = nutrients.find(n => n.nutrient?.name && /energy/i.test(n.nutrient.name) && (n.unitName || '').toUpperCase() === 'KCAL');
                             if (kcalNutrientByName && !isNaN(parseFloat(kcalNutrientByName.amount)) && parseFloat(kcalNutrientByName.amount) > 0) {
                                 log(`USDA: Found direct kcal value by name, skipping KJ conversion.`, 'DEBUG', 'USDA_PARSE');
                                 continue;
                             }
                              log(`USDA: Converting KJ to Kcal for Name ${nameRegex} (${amount} ${unit})`, 'DEBUG', 'USDA_PARSE');
                             return amount / KJ_TO_KCAL_FACTOR;
                        }
                        log(`USDA: Nutrient Name ${nameRegex} found but unit mismatch (${unit} vs ${targetUnit})`, 'DEBUG', 'USDA_PARSE');
                  }
             }
              // Check backup names if preferred names didn't yield results
               for (const id in backupNameMap) {
                   if (nameMap[id]) continue; // Skip if already checked via preferred ID/name
                   const nameRegex = backupNameMap[id];
                   const nutrient = nutrients.find(n => n.nutrient?.name && nameRegex.test(n.nutrient.name));
                   // Add same logic as above... (This part could be refactored into a helper)
                    if (nutrient && nutrient.amount !== undefined && nutrient.amount !== null) {
                         const unit = (nutrient.unitName || '').toUpperCase();
                         let amount = parseFloat(nutrient.amount);
                         if (isNaN(amount)) continue;
                         const targetUnit = (id === '208') ? 'KCAL' : 'G';
                         if (unit === targetUnit) return amount;
                          else if (targetUnit === 'G' && unit === 'MG') return amount / 1000;
                          else if (targetUnit === 'KCAL' && unit === 'KJ') {
                              // Check again for direct kcal value before converting
                               const kcalNutrientByName = nutrients.find(n => n.nutrient?.name && /energy/i.test(n.nutrient.name) && (n.unitName || '').toUpperCase() === 'KCAL');
                               if (kcalNutrientByName && !isNaN(parseFloat(kcalNutrientByName.amount)) && parseFloat(kcalNutrientByName.amount) > 0) continue;
                               log(`USDA: Converting KJ to Kcal for Backup Name ${nameRegex} (${amount} ${unit})`, 'DEBUG', 'USDA_PARSE');
                              return amount / KJ_TO_KCAL_FACTOR;
                          }
                          log(`USDA: Backup Nutrient Name ${nameRegex} found but unit mismatch (${unit} vs ${targetUnit})`, 'DEBUG', 'USDA_PARSE');
                    }
               }
         }

        return 0; // Default to 0 if not found or invalid
    };

    // Preferred USDA Nutrient IDs:
    const kcalIds = [1008, 208]; // Energy (kcal) - Prefer 1008
    const proteinIds = [1003, 203]; // Protein - Prefer 1003
    const fatIds = [1004, 204]; // Total lipid (fat) - Prefer 1004
    const carbIds = [1005, 205]; // Carbohydrate, by difference - Prefer 1005
    const satFatIds = [1258, 606]; // Fatty acids, total saturated - Prefer 1258
    const sugarsIds = [2000, 269]; // Sugars, total including NLEA - Prefer 2000
    const fiberIds = [1079, 291]; // Fiber, total dietary - Prefer 1079
    const sodiumIds = [1093, 307]; // Sodium, Na - Prefer 1093

    const calories = findNutrient(kcalIds, 'KCAL');
    const protein = findNutrient(proteinIds, 'G');
    const fat = findNutrient(fatIds, 'G');
    const carbs = findNutrient(carbIds, 'G');

    // Only consider it found if we have core macros with values > 0
    if (calories <= 0 || protein <= 0 || fat < 0 || carbs < 0) { // Allow 0 fat/carbs, but not protein/calories
        log(`USDA: Core macros missing or zero/negative for query: ${query} (FDC ID: ${usdaDetailsResponse.fdcId})`, 'INFO', 'USDA_PARSE', { calories, protein, fat, carbs });
        return null;
    }

    log(`USDA: Successfully parsed data for query: ${query} (FDC ID: ${usdaDetailsResponse.fdcId}, Name: "${usdaDetailsResponse.description}")`, 'SUCCESS', 'USDA_PARSE');

    return {
        status: 'found',
        source: 'usda', // Add source tracking
        servingUnit: '100g', // USDA data is typically per 100g
        calories: calories,
        protein: protein,
        fat: fat,
        saturatedFat: findNutrient(satFatIds, 'G'),
        carbs: carbs,
        sugars: findNutrient(sugarsIds, 'G'),
        fiber: findNutrient(fiberIds, 'G'),
        sodium: findNutrient(sodiumIds, 'G'), // Target unit G (will convert from MG if needed)
        ingredientsText: usdaDetailsResponse.inputFoods?.map(f => f.foodDescription).join(', ') || usdaDetailsResponse.description || null // Try to get input foods for ingredients
    };
}
// --- END NEW ---

// --- REMOVED (Mark 51): Internal Dietagram API fetcher ---

// --- NEW (Mark 51): Internal USDA API fetcher ---
/**
 * Internal logic for fetching from USDA API (Search then Details).
 */
async function _fetchUsdaFromApi(query, log = console.log) {
    if (!USDA_API_KEY) {
        log('Configuration Error: USDA_API_KEY is not set.', 'CRITICAL', 'CONFIG');
        return { error: { message: 'Server configuration error: USDA API key missing.', status: 500 }, source: 'usda' };
    }

    // --- Step 1: Search ---
    const searchStartTime = Date.now();
    // Prioritize non-branded types, increase page size slightly
    const searchUrl = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=10&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS),Branded`; // Include Branded as last resort

    log(`Attempting USDA search for: ${query}`, 'DEBUG', 'USDA_REQUEST', { url: searchUrl.split('?')[0] + '?query=...' });

    let searchResponseData;
    try {
        const searchResponse = await fetch(searchUrl);
        const searchLatencyMs = Date.now() - searchStartTime;
        if (!searchResponse.ok) {
            // Handle 429 specifically if fetch throws it based on status
            if (searchResponse.status === 429) {
                 log(`USDA search returned 429 for "${query}".`, 'WARN', 'USDA_FAILURE', { status: 429, latency_ms: searchLatencyMs });
                 const rateLimitError = new Error(`USDA API rate limit hit (search)`);
                 rateLimitError.statusCode = 429;
                 throw rateLimitError; // Throw to be caught by fetchUsdaSafe
            }
            const errorBody = await searchResponse.text();
            log(`USDA search failed for "${query}" with status ${searchResponse.status}`, 'WARN', 'USDA_FAILURE', { status: searchResponse.status, latency_ms: searchLatencyMs, body: errorBody });
            return { error: { message: `USDA search failed. Status: ${searchResponse.status}`, status: searchResponse.status, details: errorBody }, source: 'usda_search' };
        }
        searchResponseData = await searchResponse.json();
        log(`USDA search successful for "${query}". Found ${searchResponseData?.totalHits} potential matches.`, 'DEBUG', 'USDA_RESPONSE', { latency_ms: searchLatencyMs });

    } catch (error) {
        const searchLatencyMs = Date.now() - searchStartTime;
         if (error.statusCode === 429) throw error; // Re-throw 429 for rate limiter
        log(`USDA search network error for "${query}": ${error.message}`, 'ERROR', 'USDA_FAILURE', { latency_ms: searchLatencyMs });
        return { error: { message: `USDA search network error: ${error.message}`, status: 504 }, source: 'usda_search' };
    }

    // --- Step 2: Find Best FDC ID ---
    if (!searchResponseData || !Array.isArray(searchResponseData.foods) || searchResponseData.foods.length === 0) {
        log(`USDA search for "${query}" returned no food results.`, 'INFO', 'USDA_RESPONSE');
        return { error: { message: 'No results found in USDA search', status: 404 }, source: 'usda_search' }; // Use 404 for no results
    }

    // Prioritize Foundation, SR Legacy, FNDDS. Find the first one.
    let bestFdcId = null;
    let foundFoodDescription = '';
    const preferredTypes = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];
    for (const type of preferredTypes) {
        // Find best match within preferred types (simple exact match first, then contains)
         const exactMatch = searchResponseData.foods.find(food => food.dataType === type && food.description.toLowerCase() === query.toLowerCase());
         const containsMatch = searchResponseData.foods.find(food => food.dataType === type && food.description.toLowerCase().includes(query.toLowerCase()));
         const foundFood = exactMatch || containsMatch;

        if (foundFood) {
            bestFdcId = foundFood.fdcId;
            foundFoodDescription = foundFood.description;
            log(`USDA selected FDC ID ${bestFdcId} ("${foundFoodDescription}", Type: ${type}) for query "${query}"`, 'INFO', 'USDA_SELECT');
            break;
        }
    }

    // Fallback to the very first result (could be Branded) if no preferred type found
    if (!bestFdcId) {
        bestFdcId = searchResponseData.foods[0].fdcId;
        foundFoodDescription = searchResponseData.foods[0].description;
        const fallbackType = searchResponseData.foods[0].dataType;
        log(`USDA falling back to first result FDC ID ${bestFdcId} ("${foundFoodDescription}", Type: ${fallbackType}) for query "${query}"`, 'INFO', 'USDA_SELECT');
    }

    // --- Step 3: Fetch Details ---
    const detailsStartTime = Date.now();
    const detailsUrl = `${USDA_DETAILS_URL}${bestFdcId}?api_key=${USDA_API_KEY}`;
    log(`Attempting USDA details fetch for FDC ID: ${bestFdcId}`, 'DEBUG', 'USDA_REQUEST', { url: detailsUrl.split('?')[0] + '?api_key=...' });

    try {
        const detailsResponse = await fetch(detailsUrl);
        const detailsLatencyMs = Date.now() - detailsStartTime;
         if (!detailsResponse.ok) {
              if (detailsResponse.status === 429) {
                 log(`USDA details returned 429 for FDC ID ${bestFdcId}.`, 'WARN', 'USDA_FAILURE', { status: 429, latency_ms: detailsLatencyMs });
                 const rateLimitError = new Error(`USDA API rate limit hit (details)`);
                 rateLimitError.statusCode = 429;
                 throw rateLimitError; // Throw to be caught by fetchUsdaSafe
              }
             const errorBody = await detailsResponse.text();
             log(`USDA details fetch failed for FDC ID ${bestFdcId} with status ${detailsResponse.status}`, 'WARN', 'USDA_FAILURE', { status: detailsResponse.status, latency_ms: detailsLatencyMs, body: errorBody });
             return { error: { message: `USDA details fetch failed. Status: ${detailsResponse.status}`, status: detailsResponse.status, details: errorBody }, source: 'usda_details' };
         }
        const detailsData = await detailsResponse.json();
        log(`USDA details fetch successful for FDC ID ${bestFdcId}`, 'SUCCESS', 'USDA_RESPONSE', { latency_ms: detailsLatencyMs });
        return detailsData; // Return the raw details data

    } catch (error) {
        const detailsLatencyMs = Date.now() - detailsStartTime;
         if (error.statusCode === 429) throw error; // Re-throw 429 for rate limiter
        log(`USDA details network error for FDC ID ${bestFdcId}: ${error.message}`, 'ERROR', 'USDA_FAILURE', { latency_ms: detailsLatencyMs });
        return { error: { message: `USDA details network error: ${error.message}`, status: 504 }, source: 'usda_details' };
    }
}
// --- END NEW ---

// --- REMOVED (Mark 51): Rate-limited wrapper for Dietagram ---

// --- NEW (Mark 51): Rate-limited wrapper for USDA ---
/**
 * Wrapper for USDA API calls using a STATELESS token bucket (Vercel KV).
 */
async function fetchUsdaSafe(query, log = console.log) {
    const bucketKey = `bucket:usda`; // Dedicated bucket for the USDA API
    const refillRatePerMs = BUCKET_REFILL_RATE / 1000;
    let waitMs = 0;
    const waitStart = Date.now();

    // Loop until we successfully acquire a token (Same logic as Dietagram/Price search)
    while (true) {
        const now = Date.now();
        let bucketState = null;

        if (isKvConfigured()) {
            try {
                bucketState = await kv.get(bucketKey);
            } catch (kvError) {
                log(`CRITICAL: KV GET failed for bucket ${bucketKey}. Bypassing rate limit.`, 'CRITICAL', 'KV_ERROR', { error: kvError.message });
                break;
            }
        }

        if (!bucketState) {
            log(`Initializing KV bucket: ${bucketKey}`, 'DEBUG', 'BUCKET_INIT');
            if (isKvConfigured()) {
                try {
                    // Use a reasonable TTL (e.g., 1 day)
                    await kv.set(bucketKey, { tokens: BUCKET_CAPACITY - 1, lastRefill: now }, { ex: 86400 });
                } catch (kvError) {
                    log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message });
                }
            }
            break;
        }

        const elapsedMs = now - bucketState.lastRefill;
        const tokensToAdd = elapsedMs * refillRatePerMs;
        let currentTokens = Math.min(BUCKET_CAPACITY, bucketState.tokens + tokensToAdd);
        const newLastRefill = now;

        if (currentTokens >= 1) {
            currentTokens -= 1;
            if (isKvConfigured()) {
                try {
                    await kv.set(bucketKey, { tokens: currentTokens, lastRefill: newLastRefill }, { ex: 86400 });
                } catch (kvError) {
                    log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message });
                }
            }
            break;
        } else {
            const tokensNeeded = 1 - currentTokens;
            const waitTime = Math.max(50, Math.ceil(tokensNeeded / refillRatePerMs));
            log(`Rate limiter active (USDA). Waiting ${waitTime}ms...`, 'INFO', 'BUCKET_WAIT');
            await delay(waitTime);
        }
    } // end while(true)

    waitMs = Date.now() - waitStart;
    log(`Acquired token for USDA (waited ${waitMs}ms)`, 'DEBUG', 'BUCKET_TAKE', { bucket_wait_ms: waitMs });

    try {
        // --- Call the internal function that performs BOTH search and details fetch ---
        const data = await _fetchUsdaFromApi(query, log);
        return { data, waitMs };
    } catch (error) {
        // Handle 429 specifically (thrown by _fetchUsdaFromApi)
        if (error.statusCode === 429) {
            log(`USDA returned 429. Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { query });
            await delay(BUCKET_RETRY_DELAY_MS);
             try {
                  // Retry the whole process (search + details)
                 const retryData = await _fetchUsdaFromApi(query, log);
                 return { data: retryData, waitMs }; // waitMs still reflects initial wait
             } catch (retryError) {
                  log(`Retry after 429 failed (USDA): ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { query });
                  const status = retryError.status || retryError.statusCode || 500;
                  const errorData = { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message }, source: retryError.source || 'usda_retry' };
                  return { data: errorData, waitMs };
             }
        }
        // General errors during the fetch process
        log(`Unhandled error during fetchUsdaSafe: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { query });
         const errorData = { error: { message: `Unexpected error during safe USDA fetch: ${error.message}`, status: error.status || 500 }, source: 'usda_safe' };
         return { data: errorData, waitMs };
    }
}
// --- END NEW ---


/**
 * Internal logic for fetching nutrition data from Open Food Facts API (and USDA fallback).
 * Accepts a log function for consistency.
 */
// --- MODIFICATION (Mark 51 & 52): Replace Dietagram with USDA fallback & refine OFF failure check ---
async function _fetchNutritionDataFromApi(barcode, query, log = console.log) {
    let openFoodFactsURL = '';
    const identifier = barcode || query;
    const identifierType = barcode ? 'barcode' : 'query';
    let offSucceeded = false; // Flag to track if OFF returned potentially usable data

    if (!identifier) {
        log('Missing barcode or query parameter for nutrition search.', 'WARN', 'INPUT');
        return { status: 'not_found', error: 'Missing barcode or query parameter' };
    }

    // --- STAGE 1: Attempt Open Food Facts ---
    if (barcode) {
        openFoodFactsURL = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
    } else if (query) {
        openFoodFactsURL = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
    }

    log(`Requesting nutrition (OFF) for ${identifierType}: ${identifier}`, 'DEBUG', 'OFF_REQUEST');
    const startTime = Date.now();
    let nutritionResult = null;

    try {
        const apiResponse = await fetch(openFoodFactsURL, {
            method: 'GET',
            headers: { 'User-Agent': 'CheffyApp/1.0 (dev@cheffy.com)' }
        });
        const latencyMs = Date.now() - startTime;

        if (apiResponse.ok) {
            const data = await apiResponse.json();
            const product = barcode ? data.product : (data.products && data.products[0]);

            if (product && product.nutriments) {
                offSucceeded = true; // Mark that we got data from OFF
                const nutriments = product.nutriments;

                // Helper to parse nutrient, returns null if invalid/missing
                const parseNutrient = (value) => {
                    if (value === undefined || value === null) return null;
                    const num = parseFloat(value);
                    return isNaN(num) ? null : num;
                };

                let calories = parseNutrient(nutriments['energy-kcal_100g']);

                // Check for kJ fallback only if kcal is null or zero
                if (calories === null || calories <= 0) {
                    const kj = parseNutrient(nutriments['energy-kj_100g']);
                    if (kj !== null && kj > 0) {
                        calories = kj / KJ_TO_KCAL_FACTOR;
                        log(`Used kJ fallback for ${identifierType}: ${identifier}. ${kj}kJ -> ${calories.toFixed(0)}kcal`, 'INFO', 'CALORIE_CONVERT');
                    } else {
                         calories = null; // Ensure calories is null if kJ also fails
                    }
                }

                const protein = parseNutrient(nutriments.proteins_100g);
                const fat = parseNutrient(nutriments.fat_100g);
                const carbs = parseNutrient(nutriments.carbohydrates_100g);

                // --- Refined Check (Mark 52): Check if ALL essential macros are valid numbers > 0 (except fat/carbs can be 0) ---
                if (calories !== null && calories > 0 &&
                    protein !== null && protein > 0 && // Protein must be > 0
                    fat !== null && fat >= 0 &&       // Fat can be 0
                    carbs !== null && carbs >= 0) {   // Carbs can be 0

                    log(`Successfully fetched nutrition (OFF) for ${identifierType}: ${identifier}`, 'SUCCESS', 'OFF_RESPONSE', { latency_ms: latencyMs });
                    nutritionResult = {
                        status: 'found',
                        source: 'openfoodfacts',
                        servingUnit: product.nutrition_data_per || '100g',
                        calories: calories,
                        protein: protein,
                        fat: fat,
                        saturatedFat: parseNutrient(nutriments['saturated-fat_100g']) || 0, // Default 0 if missing
                        carbs: carbs,
                        sugars: parseNutrient(nutriments.sugars_100g) || 0,
                        fiber: parseNutrient(nutriments.fiber_100g) || 0,
                        sodium: parseNutrient(nutriments.sodium_100g) || 0,
                        ingredientsText: product.ingredients_text || null
                    };
                    return nutritionResult; // Found complete data, return immediately
                } else {
                     log(`Nutrition data incomplete or invalid (OFF) for ${identifierType}: ${identifier}`, 'INFO', 'OFF_INCOMPLETE', { latency_ms: latencyMs, data: { calories, protein, fat, carbs } });
                     // Do not return yet, proceed to USDA fallback
                }
            } else { // Product or nutriments missing
                 log(`Nutrition data structure missing (OFF) for ${identifierType}: ${identifier}`, 'INFO', 'OFF_MISSING', { latency_ms: latencyMs, productFound: !!product });
                 // Proceed to USDA fallback
            }
        } else { // API response not OK
             log(`Open Food Facts API returned: ${apiResponse.status} for ${identifierType}: ${identifier}`, 'WARN', 'OFF_RESPONSE', { status: apiResponse.status, latency_ms: latencyMs });
             // Proceed to USDA fallback
        }
    } catch (error) { // Network or parsing error
        const latencyMs = Date.now() - startTime;
        log(`Nutrition Fetch Error (OFF) for ${identifierType} "${identifier}": ${error.message}`, 'ERROR', 'OFF_FAILURE', { latency_ms: latencyMs });
        // Proceed to USDA fallback
    }

    // --- STAGE 2: Attempt USDA Fallback (only for queries) ---
    // --- Trigger ONLY if OFF failed (offSucceeded is false) OR if OFF succeeded but data was incomplete (nutritionResult is still null) ---
    if (query && (!offSucceeded || nutritionResult === null)) {
        log(`OFF failed or incomplete for query "${query}". Attempting rate-limited USDA fallback...`, 'INFO', 'USDA_ATTEMPT');

        const { data: usdaData } = await fetchUsdaSafe(query, log); // Use rate-limited wrapper

        if (usdaData && !usdaData.error) {
            // Pass the raw details data to the normalizer
            const normalizedData = normalizeUsdaResponse(usdaData, query, log);
            if (normalizedData) {
                return normalizedData; // Success with USDA!
            } else {
                log(`USDA fallback failed to parse valid data for: ${query}`, 'WARN', 'USDA_PARSE_FAIL');
                // Proceed to definitive failure
            }
        } else {
             log(`USDA fallback fetch failed for: ${query}`, 'ERROR', 'USDA_FETCH_FAIL', { error: usdaData?.error });
             // Proceed to definitive failure
        }
    } else if (barcode && !query && (!offSucceeded || nutritionResult === null)) {
        log(`OFF failed or incomplete for barcode "${barcode}". No query provided, cannot use USDA fallback.`, 'WARN', 'NUTRITION_NO_QUERY');
    } else if (offSucceeded && nutritionResult !== null) {
        // This case should not be reached due to the early return above, but included for logic completeness.
        log(`Internal Logic Error: Reached USDA fallback stage even though OFF succeeded.`, 'ERROR', 'SYSTEM_LOGIC');
    }

    // --- STAGE 3: Definitive Failure ---
    log(`All nutrition sources failed for ${identifierType}: ${identifier}`, 'WARN', 'NUTRITION_FAIL_ALL');
    return { status: 'not_found' };
}
// --- END MODIFICATION ---

/**
 * Initiates a background refresh for a nutrition cache key.
 */
async function refreshInBackground(cacheKey, barcode, query, ttlMs, log, keyType) {
    if (inflightRefreshes.has(cacheKey)) {
        log(`Nutrition background refresh already in progress for ${cacheKey}, skipping.`, 'DEBUG', 'SWR_SKIP', { key_type: keyType });
        return;
    }
    inflightRefreshes.add(cacheKey);
    log(`Starting nutrition background refresh for ${cacheKey}...`, 'INFO', 'SWR_REFRESH_START', { key_type: keyType });

    // Fire and forget
    (async () => {
        try {
            // Calls the updated _fetchNutritionDataFromApi with the new fallback logic
            const freshData = await _fetchNutritionDataFromApi(barcode, query, log);
            // Cache both 'found' and 'not_found' results
            if (freshData && (freshData.status === 'found' || freshData.status === 'not_found')) {
                await kv.set(cacheKey, { data: freshData, ts: Date.now() }, { px: ttlMs });
                log(`Nutrition background refresh successful for ${cacheKey}`, 'INFO', 'SWR_REFRESH_SUCCESS', { status: freshData.status, key_type: keyType });
            } else {
                 log(`Nutrition background refresh failed to fetch valid data for ${cacheKey}`, 'WARN', 'SWR_REFRESH_FAIL', { key_type: keyType });
            }
        } catch (error) {
            log(`Nutrition background refresh error for ${cacheKey}: ${error.message}`, 'ERROR', 'SWR_REFRESH_ERROR', { key_type: keyType });
        } finally {
            inflightRefreshes.delete(cacheKey);
        }
    })();
}

/**
 * Cache-wrapped function for fetching nutrition data with SWR.
 */
async function fetchNutritionData(barcode, query, log = console.log) {
    const startTime = Date.now();

    // --- DEGRADATION CHECK ---
    if (!isKvConfigured()) {
        log('CRITICAL: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN are missing. Bypassing cache and running uncached API fetch.', 'CRITICAL', 'CONFIG_ERROR');
        // --- Calls the updated function with new fallback ---
        return await _fetchNutritionDataFromApi(barcode, query, log);
    }
    // --- END DEGRADATION CHECK ---

    let cacheKey = '';
    let ttlMs = 0;
    let swrMs = 0;
    let keyType = '';
    const identifier = barcode || query;

    if (!identifier) {
        log('Missing barcode or query parameter for nutrition search.', 'WARN', 'INPUT');
        return { status: 'not_found', error: 'Missing barcode or query parameter' };
    }

    // Determine key, TTL, and SWR TTL based on identifier type
    if (barcode) {
        const barcodeNorm = normalizeKey(barcode);
        cacheKey = `${CACHE_PREFIX_NUTRI}:barcode:${barcodeNorm}`;
        ttlMs = TTL_NUTRI_BARCODE_MS;
        swrMs = SWR_NUTRI_BARCODE_MS;
        keyType = 'nutri_barcode';
    } else { // Use query
        const queryNorm = normalizeKey(query);
        cacheKey = `${CACHE_PREFIX_NUTRI}:name:${queryNorm}`;
        ttlMs = TTL_NUTRI_NAME_MS;
        swrMs = SWR_NUTRI_NAME_MS;
        keyType = 'nutri_name';
    }

    // 1. Check Cache
    let cachedItem = null;
    try {
        cachedItem = await kv.get(cacheKey);
    } catch (error) {
        log(`Cache GET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
    }

    if (cachedItem && typeof cachedItem === 'object' && cachedItem.data && cachedItem.ts) {
        const ageMs = Date.now() - cachedItem.ts;

        if (ageMs < swrMs) {
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit (Fresh) for ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, latency_ms: latencyMs, age_ms: ageMs });
            return cachedItem.data;
        } else if (ageMs < ttlMs) {
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit (Stale) for ${cacheKey}, serving stale and refreshing.`, 'INFO', 'CACHE_HIT_STALE', { key_type: keyType, latency_ms: latencyMs, age_ms: ageMs });
            // --- Trigger background refresh ---
            refreshInBackground(cacheKey, barcode, query, ttlMs, log, keyType);
            return cachedItem.data; // Return stale data
        }
    }

    // 2. Cache Miss or Expired: Fetch Fresh Data
    log(`Cache Miss or Expired for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    // --- Calls the updated function with new fallback ---
    const fetchedData = await _fetchNutritionDataFromApi(barcode, query, log);
    const fetchLatencyMs = Date.now() - startTime;

    // 3. Cache Result (Cache 'found' and 'not_found')
    if (fetchedData && (fetchedData.status === 'found' || fetchedData.status === 'not_found')) {
        try {
            // --- Store object with data and timestamp ---
            await kv.set(cacheKey, { data: fetchedData, ts: Date.now() }, { px: ttlMs });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, status: fetchedData.status, ttl_ms: ttlMs });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, status: fetchedData.status, latency_ms: fetchLatencyMs, source: fetchedData.source });
    return fetchedData; // Return the fresh data object
}


// --- Vercel Handler (Now uses the updated fetchNutritionData) ---
module.exports = async (request, response) => {
    // Standard headers and OPTIONS handling
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    try {
        const { barcode, query } = request.query;

        // --- Use the public CACHED function (which now includes USDA fallback) ---
        // Add basic logging for the handler scope
        const log = (message, level = 'INFO', tag = 'HANDLER') => {
             console.log(`[${level}] [${tag}] ${message}`);
        };
        const nutritionData = await fetchNutritionData(barcode, query, log);
        // --- END MODIFICATION ---

        // Return based on status
        if (nutritionData.status === 'found') {
             return response.status(200).json(nutritionData);
        } else {
             // Return 404 for not_found, include error if present
             return response.status(404).json({ status: 'not_found', message: nutritionData.error || 'Nutrition data not found.' });
        }
    } catch (error) { // Catch errors during handler execution
        console.error("Handler error:", error);
        return response.status(500).json({ status: 'error', message: 'Internal server error in nutrition search handler.', details: error.message });
    }
};

// Export the main function for the orchestrator
module.exports.fetchNutritionData = fetchNutritionData;


