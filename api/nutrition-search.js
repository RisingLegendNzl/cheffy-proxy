const fetch = require('node-fetch');
// --- REMOVED (Mark 51): Import axios ---
const { createClient } = require('@vercel/kv');

// --- Create KV client ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// --- CACHE CONFIGURATION ---
const TTL_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days (OFF Barcode)
const SWR_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 10;
const TTL_NUTRI_NAME_MS = 1000 * 60 * 60 * 24 * 7;    // 7 days (OFF Name, USDA Name)
const SWR_NUTRI_NAME_MS = 1000 * 60 * 60 * 24 * 2;
const CACHE_PREFIX_NUTRI = 'nutri';

// --- USDA API CONFIGURATION ---
const USDA_API_KEY = process.env.USDA_API_KEY;
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_DETAILS_URL = 'https://api.nal.usda.gov/fdc/v1/food/'; // Append {fdcId}?api_key=...

// --- TOKEN BUCKET CONFIGURATION (USDA) ---
const BUCKET_CAPACITY = 10;
const BUCKET_REFILL_RATE = 1; // 1 req/sec base limit
const BUCKET_RETRY_DELAY_MS = 1100;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- CONSTANT FOR UNIT CORRECTION ---
const KJ_TO_KCAL_FACTOR = 4.184;

// Track ongoing refreshes
const inflightRefreshes = new Set();

// Normalize cache keys
const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');

// Check if KV is configured
const isKvConfigured = () => {
    return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
};


// --- NEW (Mark 53): Fixed USDA Normalizer ---
/**
 * Normalizes USDA FoodData Central API details response.
 */
function normalizeUsdaResponse(usdaDetailsResponse, query, log) {
    if (!usdaDetailsResponse || !Array.isArray(usdaDetailsResponse.foodNutrients)) {
        log(`USDA: No valid foodNutrients array for query: ${query} (FDC ID: ${usdaDetailsResponse?.fdcId})`, 'WARN', 'USDA_PARSE');
        return null;
    }

    const nutrients = usdaDetailsResponse.foodNutrients;
    const foodDescription = usdaDetailsResponse.description || 'Unknown Food';
    const fdcId = usdaDetailsResponse.fdcId || 'N/A';
    log(`USDA: Normalizing response for "${foodDescription}" (FDC ID: ${fdcId})`, 'DEBUG', 'USDA_PARSE');

    // Robust helper to find nutrient value, handles units and conversions
    const findNutrientValue = (nutrientIds, targetUnit) => {
        let foundValue = null;
        let foundUnit = '';

        for (const nutrientId of nutrientIds) {
            const nutrient = nutrients.find(n => n.nutrient?.id === nutrientId && n.amount !== undefined && n.amount !== null);
            if (nutrient) {
                const value = parseFloat(nutrient.amount);
                const unit = (nutrient.unitName || '').toUpperCase();
                log(`USDA: Found nutrient ID ${nutrientId}, Value: ${value}, Unit: ${unit}`, 'DEBUG', 'USDA_PARSE_DETAIL');

                if (!isNaN(value)) {
                    if (unit === targetUnit.toUpperCase()) {
                        foundValue = value;
                        foundUnit = unit;
                        log(`USDA: Matched ID ${nutrientId} with exact unit ${unit}.`, 'DEBUG', 'USDA_PARSE_DETAIL');
                        break; // Found best match for this ID set
                    }
                    // Handle potential conversions (store potential value, continue search for exact match)
                    else if (targetUnit.toUpperCase() === 'G' && unit === 'MG') {
                        if (foundValue === null) { // Only use conversion if no exact match found yet
                             foundValue = value / 1000;
                             foundUnit = 'MG converted to G';
                             log(`USDA: Potential conversion for ID ${nutrientId}: ${value} MG -> ${foundValue} G.`, 'DEBUG', 'USDA_PARSE_DETAIL');
                        }
                    }
                    else if (targetUnit.toUpperCase() === 'KCAL' && unit === 'KJ') {
                         if (foundValue === null) { // Only use conversion if no exact match found yet
                            foundValue = value / KJ_TO_KCAL_FACTOR;
                            foundUnit = 'KJ converted to KCAL';
                            log(`USDA: Potential conversion for ID ${nutrientId}: ${value} KJ -> ${foundValue.toFixed(0)} KCAL.`, 'DEBUG', 'USDA_PARSE_DETAIL');
                         }
                    } else {
                         log(`USDA: Found ID ${nutrientId} but unit "${unit}" doesn't match target "${targetUnit}" and no conversion defined.`, 'DEBUG', 'USDA_PARSE_DETAIL');
                    }
                } else {
                    log(`USDA: Found nutrient ID ${nutrientId}, but amount "${nutrient.amount}" is not a valid number.`, 'WARN', 'USDA_PARSE_DETAIL');
                }
            } else {
                 log(`USDA: Nutrient ID ${nutrientId} not found or amount missing.`, 'DEBUG', 'USDA_PARSE_DETAIL');
            }
        }

        if (foundValue !== null) {
            log(`USDA: Final value for target ${targetUnit} (IDs: ${nutrientIds.join(',')}) = ${foundValue} (${foundUnit})`, 'INFO', 'USDA_PARSE_RESULT');
            return foundValue;
        } else {
            log(`USDA: Could not find valid value for target ${targetUnit} (IDs: ${nutrientIds.join(',')})`, 'WARN', 'USDA_PARSE_RESULT');
            return 0; // Default to 0 if not found
        }
    };

    // Preferred USDA Nutrient IDs: (Primary, Secondary/Older)
    const kcalIds = [1008, 208];       // Energy (kcal)
    const proteinIds = [1003, 203];    // Protein
    const fatIds = [1004, 204];        // Total lipid (fat)
    const carbIds = [1005, 205];       // Carbohydrate, by difference
    const satFatIds = [1258, 606];     // Fatty acids, total saturated
    const sugarsIds = [2000, 269];     // Sugars, total including NLEA
    const fiberIds = [1079, 291];      // Fiber, total dietary
    const sodiumIds = [1093, 307];     // Sodium, Na

    // Get values using the helper
    const calories = findNutrientValue(kcalIds, 'KCAL');
    const protein = findNutrientValue(proteinIds, 'G');
    const fat = findNutrientValue(fatIds, 'G');
    const carbs = findNutrientValue(carbIds, 'G');

    // --- Strict Check: Essential macros must be valid ---
    if (calories <= 0 || protein <= 0 || fat < 0 || carbs < 0) {
        log(`USDA: Core macros missing or invalid after parsing for "${foodDescription}" (FDC ID: ${fdcId})`, 'WARN', 'USDA_PARSE_FAIL', { calories, protein, fat, carbs });
        return null; // Return null if essential data is bad
    }

    log(`USDA: Successfully parsed data for "${foodDescription}" (FDC ID: ${fdcId})`, 'SUCCESS', 'USDA_PARSE');

    // Extract other nutrients
    const saturatedFat = findNutrientValue(satFatIds, 'G');
    const sugars = findNutrientValue(sugarsIds, 'G');
    const fiber = findNutrientValue(fiberIds, 'G');
    const sodium = findNutrientValue(sodiumIds, 'G'); // Target unit G (findNutrient handles MG->G)

    // Attempt to construct ingredients list
    const ingredientsText = usdaDetailsResponse.inputFoods?.map(f => f.foodDescription).join(', ') || usdaDetailsResponse.ingredients || foodDescription || null;


    return {
        status: 'found',
        source: 'usda',
        servingUnit: '100g', // USDA is per 100g
        calories: calories,
        protein: protein,
        fat: fat,
        saturatedFat: saturatedFat,
        carbs: carbs,
        sugars: sugars,
        fiber: fiber,
        sodium: sodium,
        ingredientsText: ingredientsText
    };
}
// --- END NEW ---


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
    // Prioritize non-branded types, broader search
    const searchUrl = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=10&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS),Branded`;

    log(`Attempting USDA search for: ${query}`, 'DEBUG', 'USDA_REQUEST', { url: searchUrl.split('?')[0] + '?query=...' });

    let searchResponseData;
    try {
        const searchResponse = await fetch(searchUrl);
        const searchLatencyMs = Date.now() - searchStartTime;
        if (!searchResponse.ok) {
            if (searchResponse.status === 429) {
                 log(`USDA search returned 429 for "${query}".`, 'WARN', 'USDA_FAILURE', { status: 429, latency_ms: searchLatencyMs });
                 const rateLimitError = new Error(`USDA API rate limit hit (search)`);
                 rateLimitError.statusCode = 429;
                 throw rateLimitError;
            }
            const errorBody = await searchResponse.text();
            log(`USDA search failed for "${query}" status ${searchResponse.status}`, 'WARN', 'USDA_FAILURE', { status: searchResponse.status, latency_ms: searchLatencyMs, body: errorBody });
            return { error: { message: `USDA search failed. Status: ${searchResponse.status}`, status: searchResponse.status, details: errorBody }, source: 'usda_search' };
        }
        searchResponseData = await searchResponse.json();
        log(`USDA search OK for "${query}". Found ${searchResponseData?.totalHits} matches.`, 'DEBUG', 'USDA_RESPONSE', { latency_ms: searchLatencyMs });

    } catch (error) {
        const searchLatencyMs = Date.now() - searchStartTime;
         if (error.statusCode === 429) throw error; // Re-throw 429
        log(`USDA search network error for "${query}": ${error.message}`, 'ERROR', 'USDA_FAILURE', { latency_ms: searchLatencyMs });
        return { error: { message: `USDA search network error: ${error.message}`, status: 504 }, source: 'usda_search' };
    }

    // --- Step 2: Find Best FDC ID ---
    if (!searchResponseData || !Array.isArray(searchResponseData.foods) || searchResponseData.foods.length === 0) {
        log(`USDA search for "${query}" returned no results.`, 'INFO', 'USDA_RESPONSE');
        return { error: { message: 'No results found in USDA search', status: 404 }, source: 'usda_search' };
    }

    let bestFdcId = null;
    let foundFoodDescription = '';
    const preferredTypes = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];
    for (const type of preferredTypes) {
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
                 throw rateLimitError;
              }
             const errorBody = await detailsResponse.text();
             log(`USDA details fetch failed for FDC ID ${bestFdcId} status ${detailsResponse.status}`, 'WARN', 'USDA_FAILURE', { status: detailsResponse.status, latency_ms: detailsLatencyMs, body: errorBody });
             return { error: { message: `USDA details fetch failed. Status: ${detailsResponse.status}`, status: detailsResponse.status, details: errorBody }, source: 'usda_details' };
         }
        const detailsData = await detailsResponse.json();
        log(`USDA details fetch successful for FDC ID ${bestFdcId}`, 'SUCCESS', 'USDA_RESPONSE', { latency_ms: detailsLatencyMs });
        return detailsData; // Return raw details

    } catch (error) {
        const detailsLatencyMs = Date.now() - detailsStartTime;
         if (error.statusCode === 429) throw error; // Re-throw 429
        log(`USDA details network error for FDC ID ${bestFdcId}: ${error.message}`, 'ERROR', 'USDA_FAILURE', { latency_ms: detailsLatencyMs });
        return { error: { message: `USDA details network error: ${error.message}`, status: 504 }, source: 'usda_details' };
    }
}


/**
 * Wrapper for USDA API calls using a STATELESS token bucket (Vercel KV).
 */
async function fetchUsdaSafe(query, log = console.log) {
    const bucketKey = `bucket:usda`;
    const refillRatePerMs = BUCKET_REFILL_RATE / 1000;
    let waitMs = 0;
    const waitStart = Date.now();

    while (true) { // Loop for acquiring token
        const now = Date.now();
        let bucketState = null;

        if (isKvConfigured()) {
            try {
                bucketState = await kv.get(bucketKey);
            } catch (kvError) {
                log(`CRITICAL: KV GET failed for bucket ${bucketKey}. Bypassing rate limit.`, 'CRITICAL', 'KV_ERROR', { error: kvError.message });
                break; // Bypass loop on KV error
            }
        }

        if (!bucketState) { // Initialize bucket
            log(`Initializing KV bucket: ${bucketKey}`, 'DEBUG', 'BUCKET_INIT');
            if (isKvConfigured()) {
                try {
                    await kv.set(bucketKey, { tokens: BUCKET_CAPACITY - 1, lastRefill: now }, { ex: 86400 }); // 1 day TTL
                } catch (kvError) {
                    log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message });
                }
            }
            break; // Token acquired
        }

        // Refill logic
        const elapsedMs = now - bucketState.lastRefill;
        const tokensToAdd = elapsedMs * refillRatePerMs;
        let currentTokens = Math.min(BUCKET_CAPACITY, bucketState.tokens + tokensToAdd);
        const newLastRefill = now;

        if (currentTokens >= 1) { // Take token
            currentTokens -= 1;
            if (isKvConfigured()) {
                try {
                    await kv.set(bucketKey, { tokens: currentTokens, lastRefill: newLastRefill }, { ex: 86400 });
                } catch (kvError) {
                    log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message });
                }
            }
            break; // Token acquired
        } else { // Wait
            const tokensNeeded = 1 - currentTokens;
            const waitTime = Math.max(50, Math.ceil(tokensNeeded / refillRatePerMs));
            log(`Rate limiter active (USDA). Waiting ${waitTime}ms...`, 'INFO', 'BUCKET_WAIT');
            await delay(waitTime);
            // Continue loop to re-check after delay
        }
    } // end while(true)

    waitMs = Date.now() - waitStart;
    log(`Acquired token for USDA (waited ${waitMs}ms)`, 'DEBUG', 'BUCKET_TAKE', { bucket_wait_ms: waitMs });

    try {
        const data = await _fetchUsdaFromApi(query, log); // Call internal function
        return { data, waitMs };
    } catch (error) {
        if (error.statusCode === 429) { // Handle 429 retry
            log(`USDA returned 429. Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { query });
            await delay(BUCKET_RETRY_DELAY_MS);
             try {
                 const retryData = await _fetchUsdaFromApi(query, log);
                 return { data: retryData, waitMs };
             } catch (retryError) {
                  log(`Retry after 429 failed (USDA): ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { query });
                  const status = retryError.status || retryError.statusCode || 500;
                  const errorData = { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message }, source: retryError.source || 'usda_retry' };
                  return { data: errorData, waitMs };
             }
        }
        // Other errors
        log(`Unhandled error during fetchUsdaSafe: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { query });
         const errorData = { error: { message: `Unexpected error during safe USDA fetch: ${error.message}`, status: error.status || 500 }, source: 'usda_safe' };
         return { data: errorData, waitMs };
    }
}


/**
 * Internal logic for fetching nutrition data from Open Food Facts API (and USDA fallback).
 */
async function _fetchNutritionDataFromApi(barcode, query, log = console.log) {
    let openFoodFactsURL = '';
    const identifier = barcode || query;
    const identifierType = barcode ? 'barcode' : 'query';
    let offSucceeded = false;
    let offNutritionResult = null; // Store OFF result temporarily

    if (!identifier) {
        log('Missing barcode or query for nutrition search.', 'WARN', 'INPUT');
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
                offSucceeded = true;
                const nutriments = product.nutriments;
                const parseNutrient = (value) => {
                    if (value === undefined || value === null) return null;
                    const num = parseFloat(value);
                    return isNaN(num) ? null : num;
                };
                let calories = parseNutrient(nutriments['energy-kcal_100g']);
                if (calories === null || calories <= 0) {
                    const kj = parseNutrient(nutriments['energy-kj_100g']);
                    if (kj !== null && kj > 0) {
                        calories = kj / KJ_TO_KCAL_FACTOR;
                        log(`OFF: Used kJ fallback for ${identifier}: ${kj}kJ -> ${calories.toFixed(0)}kcal`, 'INFO', 'CALORIE_CONVERT');
                    } else { calories = null; }
                }
                const protein = parseNutrient(nutriments.proteins_100g);
                const fat = parseNutrient(nutriments.fat_100g);
                const carbs = parseNutrient(nutriments.carbohydrates_100g);

                // --- Stricter Check ---
                if (calories !== null && calories > 0 && protein !== null && protein >= 0 && // Allow 0 protein for things like oil
                    fat !== null && fat >= 0 && carbs !== null && carbs >= 0) {

                    log(`OFF: Successfully fetched complete data for ${identifier}`, 'SUCCESS', 'OFF_RESPONSE', { latency_ms: latencyMs });
                    // Store complete result and return immediately
                    offNutritionResult = {
                        status: 'found', source: 'openfoodfacts', servingUnit: product.nutrition_data_per || '100g',
                        calories: calories, protein: protein, fat: fat,
                        saturatedFat: parseNutrient(nutriments['saturated-fat_100g']) || 0,
                        carbs: carbs, sugars: parseNutrient(nutriments.sugars_100g) || 0,
                        fiber: parseNutrient(nutriments.fiber_100g) || 0,
                        sodium: parseNutrient(nutriments.sodium_100g) || 0,
                        ingredientsText: product.ingredients_text || null
                    };
                    return offNutritionResult;
                } else {
                     log(`OFF: Data incomplete/invalid for ${identifier}`, 'INFO', 'OFF_INCOMPLETE', { latency_ms: latencyMs, data: { calories, protein, fat, carbs } });
                     // Proceed to USDA fallback
                }
            } else {
                 log(`OFF: Product/nutriments structure missing for ${identifier}`, 'INFO', 'OFF_MISSING', { latency_ms: latencyMs, productFound: !!product });
                 // Proceed to USDA fallback
            }
        } else {
             log(`OFF API returned: ${apiResponse.status} for ${identifier}`, 'WARN', 'OFF_RESPONSE', { status: apiResponse.status, latency_ms: latencyMs });
             // Proceed to USDA fallback
        }
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        log(`OFF Fetch Error for "${identifier}": ${error.message}`, 'ERROR', 'OFF_FAILURE', { latency_ms: latencyMs });
        // Proceed to USDA fallback
    }

    // --- STAGE 2: Attempt USDA Fallback (only if query exists and OFF didn't return a complete result) ---
    if (query && offNutritionResult === null) {
        log(`OFF failed/incomplete for query "${query}". Attempting USDA fallback...`, 'INFO', 'USDA_ATTEMPT');

        const { data: usdaData } = await fetchUsdaSafe(query, log); // Use rate-limited wrapper

        if (usdaData && !usdaData.error) {
            const normalizedData = normalizeUsdaResponse(usdaData, query, log); // Use updated normalizer
            if (normalizedData) {
                return normalizedData; // Success with USDA!
            } else {
                log(`USDA fallback failed to parse valid data for: ${query}`, 'WARN', 'USDA_PARSE_FAIL');
            }
        } else {
             log(`USDA fallback fetch failed for: ${query}`, 'ERROR', 'USDA_FETCH_FAIL', { error: usdaData?.error });
        }
    } else if (barcode && !query && offNutritionResult === null) {
        log(`OFF failed/incomplete for barcode "${barcode}". No query for USDA fallback.`, 'WARN', 'NUTRITION_NO_QUERY');
    }

    // --- STAGE 3: Definitive Failure ---
    log(`All nutrition sources failed for ${identifierType}: ${identifier}`, 'WARN', 'NUTRITION_FAIL_ALL');
    return { status: 'not_found' };
}


/**
 * Initiates a background refresh for a nutrition cache key.
 */
async function refreshInBackground(cacheKey, barcode, query, ttlMs, log, keyType) {
    if (inflightRefreshes.has(cacheKey)) {
        log(`Nutri refresh already in progress for ${cacheKey}, skipping.`, 'DEBUG', 'SWR_SKIP', { key_type: keyType });
        return;
    }
    inflightRefreshes.add(cacheKey);
    log(`Starting nutri background refresh for ${cacheKey}...`, 'INFO', 'SWR_REFRESH_START', { key_type: keyType });

    (async () => {
        try {
            const freshData = await _fetchNutritionDataFromApi(barcode, query, log); // Calls updated internal logic
            if (freshData && (freshData.status === 'found' || freshData.status === 'not_found')) {
                 if(isKvConfigured()){
                     await kv.set(cacheKey, { data: freshData, ts: Date.now() }, { px: ttlMs });
                     log(`Nutri background refresh successful for ${cacheKey}`, 'INFO', 'SWR_REFRESH_SUCCESS', { status: freshData.status, key_type: keyType });
                 } else {
                      log(`Nutri background refresh fetched data but KV not configured, skipping set for ${cacheKey}`, 'WARN', 'SWR_REFRESH_SKIP_KV');
                 }
            } else {
                 log(`Nutri background refresh failed to fetch valid data for ${cacheKey}`, 'WARN', 'SWR_REFRESH_FAIL', { key_type: keyType });
            }
        } catch (error) {
            log(`Nutri background refresh error for ${cacheKey}: ${error.message}`, 'ERROR', 'SWR_REFRESH_ERROR', { key_type: keyType });
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

    if (!isKvConfigured()) {
        log('CRITICAL: UPSTASH_REDIS vars missing. Bypassing cache.', 'CRITICAL', 'CONFIG_ERROR');
        return await _fetchNutritionDataFromApi(barcode, query, log); // Call updated internal logic
    }

    let cacheKey = '';
    let ttlMs = 0;
    let swrMs = 0;
    let keyType = '';
    const identifier = barcode || query;

    if (!identifier) {
        log('Missing barcode or query for nutrition search.', 'WARN', 'INPUT');
        return { status: 'not_found', error: 'Missing barcode or query parameter' };
    }

    if (barcode) {
        const barcodeNorm = normalizeKey(barcode);
        cacheKey = `${CACHE_PREFIX_NUTRI}:barcode:${barcodeNorm}`;
        ttlMs = TTL_NUTRI_BARCODE_MS;
        swrMs = SWR_NUTRI_BARCODE_MS;
        keyType = 'nutri_barcode';
    } else {
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
            log(`Cache Hit (Stale) for ${cacheKey}, serving stale & refreshing.`, 'INFO', 'CACHE_HIT_STALE', { key_type: keyType, latency_ms: latencyMs, age_ms: ageMs });
            refreshInBackground(cacheKey, barcode, query, ttlMs, log, keyType);
            return cachedItem.data;
        }
    }

    // 2. Cache Miss or Expired: Fetch Fresh Data
    log(`Cache Miss or Expired for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    const fetchedData = await _fetchNutritionDataFromApi(barcode, query, log); // Call updated internal logic
    const fetchLatencyMs = Date.now() - startTime;

    // 3. Cache Result
    if (fetchedData && (fetchedData.status === 'found' || fetchedData.status === 'not_found')) {
        try {
            await kv.set(cacheKey, { data: fetchedData, ts: Date.now() }, { px: ttlMs });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, status: fetchedData.status, ttl_ms: ttlMs });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, status: fetchedData.status, latency_ms: fetchLatencyMs, source: fetchedData.source });
    return fetchedData;
}


// --- Vercel Handler ---
module.exports = async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') { return response.status(200).end(); }

    try {
        const { barcode, query } = request.query;
        const log = (message, level = 'INFO', tag = 'HANDLER') => { console.log(`[${level}] [${tag}] ${message}`); };
        const nutritionData = await fetchNutritionData(barcode, query, log); // Use public cached function

        if (nutritionData.status === 'found') {
             return response.status(200).json(nutritionData);
        } else {
             return response.status(404).json({ status: 'not_found', message: nutritionData.error || 'Nutrition data not found.' });
        }
    } catch (error) {
        console.error("Handler error:", error);
        return response.status(500).json({ status: 'error', message: 'Internal server error.', details: error.message });
    }
};

// Export main function for orchestrator
module.exports.fetchNutritionData = fetchNutritionData;


