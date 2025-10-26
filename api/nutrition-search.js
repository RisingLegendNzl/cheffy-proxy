const fetch = require('node-fetch');
// --- REMOVED (Mark 51): Import axios (no longer needed) ---
// const axios = require('axios');
// --- MODIFICATION: Import createClient instead of the default kv instance ---
const { createClient } = require('@vercel/kv');

// --- MODIFICATION: Create a client instance using your Upstash variables ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
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
        log(`USDA: No valid foodNutrients array found for query: ${query}`, 'WARN', 'USDA_PARSE');
        return null;
    }

    const nutrients = usdaDetailsResponse.foodNutrients;
    const findNutrient = (ids, targetUnit = 'G', allowNameFallback = true) => {
        for (const id of ids) {
            const nutrient = nutrients.find(n => n.nutrient?.id === id);
            if (nutrient && nutrient.amount !== undefined && nutrient.amount !== null) {
                // Basic unit check/conversion
                const unit = (nutrient.unitName || '').toUpperCase();
                let amount = parseFloat(nutrient.amount);
                if (isNaN(amount)) continue;

                if (unit === targetUnit.toUpperCase()) {
                    return amount;
                } else if (targetUnit.toUpperCase() === 'G' && unit === 'MG') {
                    return amount / 1000; // Convert mg to g
                } else if (targetUnit.toUpperCase() === 'KCAL' && unit === 'KJ') {
                    return amount / KJ_TO_KCAL_FACTOR; // Convert kJ to kcal
                }
                // Add other conversions if needed
                log(`USDA: Nutrient ID ${id} found but unit mismatch (${unit} vs ${targetUnit})`, 'DEBUG', 'USDA_PARSE');
                // Don't return if unit is wrong unless it's a convertible unit
            }
        }
         // Fallback to searching by name if IDs fail and allowed
         if (allowNameFallback) {
             const nameMap = {
                 208: /energy/i, // kcal
                 203: /protein/i,
                 204: /fat|lipid/i,
                 205: /carbohydrate/i,
                 606: /fatty acids, total saturated/i,
                 269: /sugars/i,
                 291: /fiber/i,
                 307: /sodium/i,
             };
             for (const id of ids) {
                 const nameRegex = nameMap[id];
                 if (!nameRegex) continue;
                 const nutrient = nutrients.find(n => n.nutrient?.name && nameRegex.test(n.nutrient.name));
                  if (nutrient && nutrient.amount !== undefined && nutrient.amount !== null) {
                       const unit = (nutrient.unitName || '').toUpperCase();
                       let amount = parseFloat(nutrient.amount);
                       if (isNaN(amount)) continue;
                       if (unit === targetUnit.toUpperCase()) return amount;
                       // Add conversions as above
                        else if (targetUnit.toUpperCase() === 'G' && unit === 'MG') return amount / 1000;
                        else if (targetUnit.toUpperCase() === 'KCAL' && unit === 'KJ') return amount / KJ_TO_KCAL_FACTOR;
                        log(`USDA: Nutrient Name ${nameRegex} found but unit mismatch (${unit} vs ${targetUnit})`, 'DEBUG', 'USDA_PARSE');
                  }
             }
         }

        return 0; // Default to 0 if not found or invalid
    };

    // Common USDA Nutrient IDs:
    const kcalIds = [208, 1008]; // Energy (kcal)
    const proteinIds = [203, 1003]; // Protein
    const fatIds = [204, 1004]; // Total lipid (fat)
    const carbIds = [205, 1005]; // Carbohydrate, by difference
    const satFatIds = [606, 1258]; // Fatty acids, total saturated
    const sugarsIds = [269, 2000]; // Sugars, total including NLEA
    const fiberIds = [291, 1079]; // Fiber, total dietary
    const sodiumIds = [307]; // Sodium, Na

    const calories = findNutrient(kcalIds, 'KCAL');
    const protein = findNutrient(proteinIds, 'G');
    const fat = findNutrient(fatIds, 'G');
    const carbs = findNutrient(carbIds, 'G');

    // Only consider it found if we have core macros
    if (calories <= 0 || protein <= 0 || fat <= 0 || carbs <= 0) {
        log(`USDA: Core macros missing or zero for query: ${query} (FDC ID: ${usdaDetailsResponse.fdcId})`, 'INFO', 'USDA_PARSE', { calories, protein, fat, carbs });
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
        ingredientsText: usdaDetailsResponse.ingredients || null
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
        return { error: { message: 'Server configuration error: USDA API key missing.', status: 500 } };
    }

    // --- Step 1: Search ---
    const searchStartTime = Date.now();
    const searchUrl = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=5&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)`; // Prioritize non-branded types

    log(`Attempting USDA search for: ${query}`, 'DEBUG', 'USDA_REQUEST', { url: searchUrl.split('?')[0] + '?query=...' });

    let searchResponseData;
    try {
        const searchResponse = await fetch(searchUrl);
        const searchLatencyMs = Date.now() - searchStartTime;
        if (!searchResponse.ok) {
            const errorBody = await searchResponse.text();
            log(`USDA search failed for "${query}" with status ${searchResponse.status}`, 'WARN', 'USDA_FAILURE', { status: searchResponse.status, latency_ms: searchLatencyMs, body: errorBody });
            return { error: { message: `USDA search failed. Status: ${searchResponse.status}`, status: searchResponse.status, details: errorBody } };
        }
        searchResponseData = await searchResponse.json();
        log(`USDA search successful for "${query}". Found ${searchResponseData?.totalHits} potential matches.`, 'DEBUG', 'USDA_RESPONSE', { latency_ms: searchLatencyMs });

    } catch (error) {
        const searchLatencyMs = Date.now() - searchStartTime;
        log(`USDA search network error for "${query}": ${error.message}`, 'ERROR', 'USDA_FAILURE', { latency_ms: searchLatencyMs });
        return { error: { message: `USDA search network error: ${error.message}`, status: 504 } };
    }

    // --- Step 2: Find Best FDC ID ---
    if (!searchResponseData || !Array.isArray(searchResponseData.foods) || searchResponseData.foods.length === 0) {
        log(`USDA search for "${query}" returned no food results.`, 'INFO', 'USDA_RESPONSE');
        return { error: { message: 'No results found in USDA search', status: 404 } }; // Use 404 for no results
    }

    // Prioritize Foundation, SR Legacy, FNDDS. Find the first one.
    let bestFdcId = null;
    let foundFoodDescription = '';
    const preferredTypes = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];
    for (const type of preferredTypes) {
        const foundFood = searchResponseData.foods.find(food => food.dataType === type);
        if (foundFood) {
            bestFdcId = foundFood.fdcId;
            foundFoodDescription = foundFood.description;
            log(`USDA selected FDC ID ${bestFdcId} ("${foundFoodDescription}", Type: ${type}) for query "${query}"`, 'INFO', 'USDA_SELECT');
            break;
        }
    }

    // Fallback to the very first result if no preferred type found
    if (!bestFdcId) {
        bestFdcId = searchResponseData.foods[0].fdcId;
        foundFoodDescription = searchResponseData.foods[0].description;
        log(`USDA falling back to first result FDC ID ${bestFdcId} ("${foundFoodDescription}", Type: ${searchResponseData.foods[0].dataType}) for query "${query}"`, 'INFO', 'USDA_SELECT');
    }

    // --- Step 3: Fetch Details ---
    const detailsStartTime = Date.now();
    const detailsUrl = `${USDA_DETAILS_URL}${bestFdcId}?api_key=${USDA_API_KEY}`;
    log(`Attempting USDA details fetch for FDC ID: ${bestFdcId}`, 'DEBUG', 'USDA_REQUEST', { url: detailsUrl.split('?')[0] + '?api_key=...' });

    try {
        const detailsResponse = await fetch(detailsUrl);
        const detailsLatencyMs = Date.now() - detailsStartTime;
        if (!detailsResponse.ok) {
            const errorBody = await detailsResponse.text();
            log(`USDA details fetch failed for FDC ID ${bestFdcId} with status ${detailsResponse.status}`, 'WARN', 'USDA_FAILURE', { status: detailsResponse.status, latency_ms: detailsLatencyMs, body: errorBody });
            return { error: { message: `USDA details fetch failed. Status: ${detailsResponse.status}`, status: detailsResponse.status, details: errorBody } };
        }
        const detailsData = await detailsResponse.json();
        log(`USDA details fetch successful for FDC ID ${bestFdcId}`, 'SUCCESS', 'USDA_RESPONSE', { latency_ms: detailsLatencyMs });
        return detailsData; // Return the raw details data

    } catch (error) {
        const detailsLatencyMs = Date.now() - detailsStartTime;
        log(`USDA details network error for FDC ID ${bestFdcId}: ${error.message}`, 'ERROR', 'USDA_FAILURE', { latency_ms: detailsLatencyMs });
        return { error: { message: `USDA details network error: ${error.message}`, status: 504 } };
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

    // Note: USDA involves potentially two API calls (search + details) per token.
    // If rate limits become an issue, we might need separate buckets or adjust logic.
    // For now, assume one token covers the entire process for one query.

    try {
        // --- Call the internal function that performs BOTH search and details fetch ---
        const data = await _fetchUsdaFromApi(query, log);
        return { data, waitMs };
    } catch (error) {
        // Handle 429 specifically if _fetchUsdaFromApi throws it (though unlikely with fetch)
        if (error.statusCode === 429) { // Check if error object has statusCode property
            log(`USDA returned 429 (unexpected with fetch). Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { query });
            await delay(BUCKET_RETRY_DELAY_MS);
             try {
                 const retryData = await _fetchUsdaFromApi(query, log);
                 return { data: retryData, waitMs };
             } catch (retryError) {
                  log(`Retry after 429 failed (USDA): ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { query });
                  const status = retryError.status || retryError.statusCode || 500;
                  const errorData = { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message } };
                  return { data: errorData, waitMs };
             }
        }
        // General errors during the fetch process
        log(`Unhandled error during fetchUsdaSafe: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { query });
         const errorData = { error: { message: `Unexpected error during safe USDA fetch: ${error.message}`, status: error.status || 500 } };
         return { data: errorData, waitMs };
    }
}
// --- END NEW ---


/**
 * Internal logic for fetching nutrition data from Open Food Facts API (and USDA fallback).
 * Accepts a log function for consistency.
 */
// --- MODIFICATION (Mark 51): Replace Dietagram with USDA fallback ---
async function _fetchNutritionDataFromApi(barcode, query, log = console.log) {
    let openFoodFactsURL = '';
    const identifier = barcode || query;
    const identifierType = barcode ? 'barcode' : 'query';
    let nutritionResult = null;

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

    try {
        const apiResponse = await fetch(openFoodFactsURL, {
            method: 'GET',
            headers: { 'User-Agent': 'CheffyApp/1.0 (dev@cheffy.com)' }
        });
        const latencyMs = Date.now() - startTime;

        if (!apiResponse.ok) {
            log(`Open Food Facts API returned: ${apiResponse.status} for ${identifierType}: ${identifier}`, 'WARN', 'OFF_RESPONSE', { status: apiResponse.status, latency_ms: latencyMs });
            // Don't return yet, fall through to USDA
        } else {
            const data = await apiResponse.json();
            const product = barcode ? data.product : (data.products && data.products[0]);

            if (product && product.nutriments) {
                const nutriments = product.nutriments;
                let calories = parseFloat(nutriments['energy-kcal_100g'] || 0);

                // Check for kJ fallback
                if (!calories || calories <= 0) { // Changed condition to <= 0
                    const kj = parseFloat(nutriments['energy-kj_100g'] || 0);
                    if (kj && kj > 0) {
                        calories = kj / KJ_TO_KCAL_FACTOR;
                        log(`Used kJ fallback for ${identifierType}: ${identifier}. ${kj}kJ -> ${calories.toFixed(0)}kcal`, 'INFO', 'CALORIE_CONVERT');
                    }
                }

                // Only consider it "found" if we have core macros
                if (calories > 0 && nutriments.proteins_100g !== undefined && nutriments.fat_100g !== undefined && nutriments.carbohydrates_100g !== undefined) {
                    log(`Successfully fetched nutrition (OFF) for ${identifierType}: ${identifier}`, 'SUCCESS', 'OFF_RESPONSE', { latency_ms: latencyMs });
                    nutritionResult = {
                        status: 'found',
                        source: 'openfoodfacts', // Add source tracking
                        servingUnit: product.nutrition_data_per || '100g',
                        calories: calories,
                        protein: parseFloat(nutriments.proteins_100g || 0),
                        fat: parseFloat(nutriments.fat_100g || 0),
                        saturatedFat: parseFloat(nutriments['saturated-fat_100g'] || 0),
                        carbs: parseFloat(nutriments.carbohydrates_100g || 0),
                        sugars: parseFloat(nutriments.sugars_100g || 0),
                        fiber: parseFloat(nutriments.fiber_100g || 0),
                        sodium: parseFloat(nutriments.sodium_100g || 0),
                        ingredientsText: product.ingredients_text || null
                    };
                    return nutritionResult; // Found it, return immediately
                } else {
                     log(`Nutrition data incomplete (OFF) for ${identifierType}: ${identifier}`, 'INFO', 'OFF_RESPONSE', { latency_ms: latencyMs });
                }
            } else {
                log(`Nutrition data not found in response (OFF) for ${identifierType}: ${identifier}`, 'INFO', 'OFF_RESPONSE', { latency_ms: latencyMs });
            }
        }
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        log(`Nutrition Fetch Error (OFF) for ${identifierType} "${identifier}": ${error.message}`, 'ERROR', 'OFF_FAILURE', { latency_ms: latencyMs });
        // Fall through to USDA
    }

    // --- STAGE 2: Attempt USDA Fallback (only for queries) ---
    if (query) {
        log(`OFF failed for query "${query}". Attempting rate-limited USDA fallback...`, 'INFO', 'USDA_REQUEST');

        // --- Use fetchUsdaSafe ---
        const { data: usdaData } = await fetchUsdaSafe(query, log);

        if (usdaData && !usdaData.error) {
            // Pass the raw details data to the normalizer
            const normalizedData = normalizeUsdaResponse(usdaData, query, log);
            if (normalizedData) {
                return normalizedData; // Success!
            } else {
                log(`USDA fallback failed to parse valid data for: ${query}`, 'WARN', 'USDA_RESPONSE');
            }
        } else {
             log(`USDA fallback fetch failed for: ${query}`, 'ERROR', 'USDA_FAILURE', { error: usdaData?.error });
        }
    } else if (barcode && !query) {
        log(`OFF failed for barcode "${barcode}". No query provided, cannot use USDA fallback.`, 'WARN', 'NUTRITION_FAIL');
    }
    // --- END MODIFICATION ---

    // --- STAGE 3: Definitive Failure ---
    log(`All nutrition sources failed for ${identifierType}: ${identifier}`, 'WARN', 'NUTRITION_FAIL');
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
        // --- MODIFICATION: Updated error message to reflect correct env var names ---
        log('CRITICAL: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN are missing. Bypassing cache and running uncached API fetch.', 'CRITICAL', 'CONFIG_ERROR');
        // --- END MODIFICATION ---
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

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, status: fetchedData.status, latency_ms: fetchLatencyMs });
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
        const nutritionData = await fetchNutritionData(barcode, query);
        // --- END MODIFICATION ---

        // Return based on status
        if (nutritionData.status === 'found') {
             return response.status(200).json(nutritionData);
        } else {
             // Return 404 for not_found, include error if present
             return response.status(404).json({ status: 'not_found', message: nutritionData.error || 'Nutrition data not found.' });
        }
    } catch (error) { // Should ideally not be reached if _fetch handles errors
        console.error("Handler error:", error);
        return response.status(500).json({ status: 'error', message: 'Internal server error in nutrition search handler.' });
    }
};

// Export the main function for the orchestrator
module.exports.fetchNutritionData = fetchNutritionData;


