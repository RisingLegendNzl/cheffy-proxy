const fetch = require('node-fetch');
// --- MODIFICATION: Import axios for Dietagram fallback ---
const axios = require('axios');
// --- MODIFICATION: Import createClient instead of the default kv instance ---
const { createClient } = require('@vercel/kv');

// --- MODIFICATION: Create a client instance using your Upstash variables ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
// --- END MODIFICATION ---

// --- CACHE CONFIGURATION ---
const TTL_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SWR_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 10; // Stale While Revalidate after 10 days
const TTL_NUTRI_NAME_MS = 1000 * 60 * 60 * 24 * 7;    // 7 days
const SWR_NUTRI_NAME_MS = 1000 * 60 * 60 * 24 * 2;     // Stale While Revalidate after 2 days
const CACHE_PREFIX_NUTRI = 'nutri';

// --- DIETAGRAM API CONFIGURATION (NEW) ---
// --- BUG FIX: Use the correct environment variable 'RAPIDAPI_KEY' as specified by user ---
const DIETAGRAM_API_KEY = process.env.RAPIDAPI_KEY;
// const DIETAGRAM_API_KEY = process.env.DIETAGRAM_RAPIDAPI_KEY; // Old
// --- END BUG FIX ---
const DIETAGRAM_API_HOST = process.env.DIETAGRAM_RAPIDAPI_HOST || 'dietagram.p.rapidapi.com';

// --- TOKEN BUCKET CONFIGURATION (NEW - copied from price-search.js) ---
const BUCKET_CAPACITY = 10;
const BUCKET_REFILL_RATE = 8; // Tokens per second (same as other RapidAPI)
const BUCKET_RETRY_DELAY_MS = 700; // Delay after a 429 before retrying
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


// --- NEW: Dietagram Normalizer ---
/**
 * Normalizes a response from the Dietagram API into our standard nutrition object.
 * @param {object} dietagramResponse - The raw response from Dietagram API.
 * @param {string} query - The original query, for logging.
 * @param {function} log - The logger function.
 * @returns {object} Our standard nutrition object, or null if data is invalid.
 */
function normalizeDietagramResponse(dietagramResponse, query, log) {
    if (!dietagramResponse || !Array.isArray(dietagramResponse) || dietagramResponse.length === 0) {
        log(`Dietagram: No results array found for query: ${query}`, 'INFO', 'DIETAGRAM_PARSE');
        return null;
    }
    
    // Attempt to find the best match (e.g., first one that isn't a category)
    // This is a heuristic and might need refinement.
    const product = dietagramResponse.find(item => item.name && item.kcal); 

    if (!product) {
        log(`Dietagram: No valid product with kcal found in results for: ${query}`, 'INFO', 'DIETAGRAM_PARSE');
        return null;
    }

    log(`Dietagram: Found match "${product.name}" for query: ${query}`, 'SUCCESS', 'DIETAGRAM_PARSE');
    
    // Dietagram provides values per 100g
    return {
        status: 'found',
        source: 'dietagram', // Add source tracking
        servingUnit: '100g',
        calories: parseFloat(product.kcal || 0),
        protein: parseFloat(product.protein || 0),
        fat: parseFloat(product.fat || 0),
        saturatedFat: parseFloat(product.saturatedFat || 0),
        carbs: parseFloat(product.carbohydrates || 0),
        sugars: parseFloat(product.sugar || 0),
        fiber: parseFloat(product.fiber || 0),
        sodium: parseFloat(product.sodium || 0) / 1000, // Convert mg to g if needed (assuming sodium is mg)
        ingredientsText: product.ingredients || null
    };
}
// --- END NEW ---

// --- NEW (Mark 44.2): Internal Dietagram API fetcher ---
/**
 * Internal logic for fetching from Dietagram API.
 */
async function _fetchDietagramFromApi(query, log = console.log) {
    // --- BUG FIX: Updated check to reflect new variable and provide clearer logging ---
    if (!DIETAGRAM_API_KEY) { 
        log('Configuration Error: Nutrition API key (RAPIDAPI_KEY) is not set.', 'CRITICAL', 'CONFIG');
        return { error: { message: 'Server configuration error: Nutrition API key missing.', status: 500 } };
    }
    log('Using Nutrition API Key.', 'DEBUG', 'CONFIG'); // Added success log
    // --- END BUG FIX ---

    // --- BUG FIX: Manually construct URL with query params for RapidAPI compatibility ---
    const encodedQuery = encodeURIComponent(query);
    const lang = 'en'; // Assuming 'en' for now
    const url = `https://${DIETAGRAM_API_HOST}/apiFood.php?name=${encodedQuery}&lang=${lang}`;
    // --- END BUG FIX ---

    const options = {
        method: 'GET',
        url: url, // Use the manually constructed URL
        // params: { name: query, lang: 'en' }, // REMOVED params object
        headers: {
            'x-rapidapi-key': DIETAGRAM_API_KEY,
            'x-rapidapi-host': DIETAGRAM_API_HOST
        },
        timeout: 10000 // 10 second timeout
    };
    
    const attemptStartTime = Date.now();
    log(`Attempting Dietagram fetch for: ${query}`, 'DEBUG', 'DIETAGRAM_REQUEST', { url }); // Log the full URL

    try {
        const rapidResp = await axios.request(options);
        const attemptLatency = Date.now() - attemptStartTime;
        log(`Successfully fetched Dietagram for "${query}".`, 'SUCCESS', 'DIETAGRAM_RESPONSE', { status: rapidResp.status, latency_ms: attemptLatency });
        return rapidResp.data; // Return the raw data
    } catch (error) {
        const attemptLatency = Date.now() - attemptStartTime;
        const status = error.response?.status;
        const is429 = status === 429;

        log(`Dietagram fetch failed for "${query}"`, 'WARN', 'DIETAGRAM_FAILURE', { status: status || 'Network/Timeout', message: error.message, is429, latency_ms: attemptLatency });

        if (is429) {
            error.statusCode = 429;
            throw error; // Re-throw 429 to be handled by fetchDietagramSafe
        }
        
        const finalErrorMessage = `Request failed. Status: ${status || 'Network/Timeout'}.`;
        return { error: { message: finalErrorMessage, status: status || 504, details: error.message } };
    }
}
// --- END NEW ---

// --- NEW (Mark 44.2): Rate-limited wrapper for Dietagram ---
/**
 * Wrapper for Dietagram API calls using a STATELESS token bucket (Vercel KV).
 * This is CRITICAL for serverless environments.
 * Returns { data, waitMs }
 */
async function fetchDietagramSafe(query, log = console.log) {
    const bucketKey = `bucket:dietagram`; // Single bucket for the API
    const refillRatePerMs = BUCKET_REFILL_RATE / 1000;
    let waitMs = 0;
    const waitStart = Date.now();

    // Loop until we successfully acquire a token
    while (true) {
        const now = Date.now();
        let bucketState = null;

        if (isKvConfigured()) {
            try {
                bucketState = await kv.get(bucketKey);
            } catch (kvError) {
                log(`CRITICAL: KV GET failed for bucket ${bucketKey}. Bypassing rate limit.`, 'CRITICAL', 'KV_ERROR', { error: kvError.message });
                break; // Bypassing loop
            }
        }

        if (!bucketState) {
            log(`Initializing KV bucket: ${bucketKey}`, 'DEBUG', 'BUCKET_INIT');
            if (isKvConfigured()) {
                try {
                    await kv.set(bucketKey, { tokens: BUCKET_CAPACITY - 1, lastRefill: now }, { ex: Math.ceil(TTL_NUTRI_NAME_MS / 1000) });
                } catch (kvError) {
                    log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message });
                }
            }
            break; // Acquired token
        }

        // State exists, calculate refill
        const elapsedMs = now - bucketState.lastRefill;
        const tokensToAdd = elapsedMs * refillRatePerMs;
        let currentTokens = Math.min(BUCKET_CAPACITY, bucketState.tokens + tokensToAdd);
        const newLastRefill = now;

        if (currentTokens >= 1) {
            // Take token and update KV
            currentTokens -= 1;
            if (isKvConfigured()) {
                try {
                    await kv.set(bucketKey, { tokens: currentTokens, lastRefill: newLastRefill }, { ex: Math.ceil(TTL_NUTRI_NAME_MS / 1000) });
                } catch (kvError) {
                    log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message });
                }
            }
            break; // Acquired token
        } else {
            // Not enough tokens, calculate wait time
            const tokensNeeded = 1 - currentTokens;
            const waitTime = Math.max(50, Math.ceil(tokensNeeded / refillRatePerMs)); // Wait at least 50ms
            log(`Rate limiter active (Dietagram). Waiting ${waitTime}ms...`, 'INFO', 'BUCKET_WAIT');
            await delay(waitTime);
        }
    } // end while(true)
    
    waitMs = Date.now() - waitStart;
    log(`Acquired token for Dietagram (waited ${waitMs}ms)`, 'DEBUG', 'BUCKET_TAKE', { bucket_wait_ms: waitMs });

    try {
        const data = await _fetchDietagramFromApi(query, log);
        return { data, waitMs }; // Return data and wait time
    } catch (error) {
        if (error.statusCode === 429) {
            log(`Dietagram returned 429. Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { query });
            await delay(BUCKET_RETRY_DELAY_MS);
             try {
                 const retryData = await _fetchDietagramFromApi(query, log);
                 return { data: retryData, waitMs };
             } catch (retryError) {
                  log(`Retry after 429 failed (Dietagram): ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { query });
                  const status = retryError.response?.status || retryError.statusCode || 500;
                  const errorData = { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message } };
                  return { data: errorData, waitMs };
             }
        }
        log(`Unhandled error during fetchDietagramSafe: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { query });
         const errorData = { error: { message: `Unexpected error during safe fetch: ${error.message}`, status: 500 } };
         return { data: errorData, waitMs };
    }
}
// --- END NEW ---


/**
 * Internal logic for fetching nutrition data from Open Food Facts API (and Dietagram fallback).
 * Accepts a log function for consistency.
 */
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
            // Don't return yet, fall through to Dietagram
        } else {
            const data = await apiResponse.json();
            const product = barcode ? data.product : (data.products && data.products[0]);

            if (product && product.nutriments) {
                const nutriments = product.nutriments;
                let calories = parseFloat(nutriments['energy-kcal_100g'] || 0);

                if (!calories || calories === 0) {
                    const kj = parseFloat(nutriments['energy-kj_100g'] || 0);
                    if (kj && kj > 0) {
                        calories = kj / KJ_TO_KCAL_FACTOR;
                        log(`Used kJ fallback for ${identifierType}: ${identifier}. ${kj}kJ -> ${calories.toFixed(0)}kcal`, 'INFO', 'CALORIE_CONVERT');
                    }
                }
                
                // Only consider it "found" if we have core macros
                if (calories > 0 && nutriments.proteins_100g && nutriments.fat_100g && nutriments.carbohydrates_100g) {
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
        // Fall through to Dietagram
    }

    // --- STAGE 2: Attempt Dietagram Fallback (only for queries) ---
    // --- MODIFICATION (Mark 44.2): Use fetchDietagramSafe ---
    if (query) {
        log(`OFF failed for query "${query}". Attempting rate-limited Dietagram fallback...`, 'INFO', 'DIETAGRAM_REQUEST');
        
        const { data: dietagramData } = await fetchDietagramSafe(query, log);

        if (dietagramData && !dietagramData.error) {
            const normalizedData = normalizeDietagramResponse(dietagramData, query, log);
            if (normalizedData) {
                return normalizedData; // Success!
            } else {
                log(`Dietagram fallback failed to parse valid data for: ${query}`, 'WARN', 'DIETAGRAM_RESPONSE');
            }
        } else {
             log(`Dietagram fallback fetch failed for: ${query}`, 'ERROR', 'DIETAGRAM_FAILURE', { error: dietagramData?.error });
        }
    } else if (barcode && !query) {
        log(`OFF failed for barcode "${barcode}". No query provided, cannot use Dietagram fallback.`, 'WARN', 'NUTRITION_FAIL');
    }
    // --- END MODIFICATION ---

    // --- STAGE 3: Definitive Failure ---
    log(`All nutrition sources failed for ${identifierType}: ${identifier}`, 'WARN', 'NUTRITION_FAIL');
    return { status: 'not_found' };
}

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


// --- Vercel Handler (Not used by orchestrator, doesn't use cache or advanced logging) ---
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
        
        // --- MODIFICATION: Use the CACHED function, not the internal one ---
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

module.exports.fetchNutritionData = fetchNutritionData;


