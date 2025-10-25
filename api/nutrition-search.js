const fetch = require('node-fetch');
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

// --- CONSTANT FOR UNIT CORRECTION ---
const KJ_TO_KCAL_FACTOR = 4.184;
// --- MODIFICATION: Removed faulty threshold ---
// const KCAL_CONVERSION_THRESHOLD = 100.0; 
// ---

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


/**
 * Internal logic for fetching nutrition data from Open Food Facts API.
 * Accepts a log function for consistency.
 */
async function _fetchNutritionDataFromApi(barcode, query, log = console.log) {
    let openFoodFactsURL = '';
    const identifier = barcode || query;
    const identifierType = barcode ? 'barcode' : 'query';

    if (!identifier) {
        log('Missing barcode or query parameter for nutrition search.', 'WARN', 'INPUT');
        return { status: 'not_found', error: 'Missing barcode or query parameter' };
    }

    if (barcode) {
        openFoodFactsURL = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
    } else if (query) {
        openFoodFactsURL = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
    }

    log(`Requesting nutrition data for ${identifierType}: ${identifier}`, 'DEBUG', 'OFF_REQUEST');
    const startTime = Date.now();

    try {
        const apiResponse = await fetch(openFoodFactsURL, {
            method: 'GET',
            headers: { 'User-Agent': 'CheffyApp/1.0 (dev@cheffy.com)' }
        });
        const latencyMs = Date.now() - startTime;

        if (!apiResponse.ok) {
            log(`Open Food Facts API returned: ${apiResponse.status} for ${identifierType}: ${identifier}`, 'WARN', 'OFF_RESPONSE', { status: apiResponse.status, latency_ms: latencyMs });
            return { status: 'not_found' };
        }

        const data = await apiResponse.json();
        const product = barcode ? data.product : (data.products && data.products[0]);

        // --- MODIFICATION START: Robust calorie logic ---
        if (product && product.nutriments) {
            const nutriments = product.nutriments;
            let calories = parseFloat(nutriments['energy-kcal_100g'] || 0);

            // If kcal is missing or 0, try to calculate from kJ
            if (!calories || calories === 0) {
                const kj = parseFloat(nutriments['energy-kj_100g'] || 0);
                if (kj && kj > 0) {
                    calories = kj / KJ_TO_KCAL_FACTOR;
                    log(`Used kJ fallback for ${identifierType}: ${identifier}. ${kj}kJ -> ${calories.toFixed(0)}kcal`, 'INFO', 'CALORIE_CONVERT');
                }
            }
            // --- MODIFICATION END ---

            log(`Successfully fetched nutrition for ${identifierType}: ${identifier}`, 'SUCCESS', 'OFF_RESPONSE', { latency_ms: latencyMs });
            return {
                status: 'found',
                servingUnit: product.nutrition_data_per || '100g',
                calories: calories, // Use the new robust value
                protein: parseFloat(nutriments.proteins_100g || 0),
                fat: parseFloat(nutriments.fat_100g || 0),
                saturatedFat: parseFloat(nutriments['saturated-fat_100g'] || 0),
                carbs: parseFloat(nutriments.carbohydrates_100g || 0),
                sugars: parseFloat(nutriments.sugars_100g || 0),
                fiber: parseFloat(nutriments.fiber_100g || 0),
                sodium: parseFloat(nutriments.sodium_100g || 0),
                ingredientsText: product.ingredients_text || null
            };
        } else {
            log(`Nutrition data not found in response for ${identifierType}: ${identifier}`, 'INFO', 'OFF_RESPONSE', { latency_ms: latencyMs });
            return { status: 'not_found' };
        }

    } catch (error) {
        const latencyMs = Date.now() - startTime;
        log(`Nutrition Fetch Error for ${identifierType} "${identifier}": ${error.message}`, 'ERROR', 'OFF_FAILURE', { latency_ms: latencyMs });
        return { status: 'not_found', error: error.message };
    }
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

