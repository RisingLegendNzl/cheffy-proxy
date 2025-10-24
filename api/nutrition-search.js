const fetch = require('node-fetch');
const { kv } = require('@vercel/kv'); // Import Vercel KV

// --- CACHE CONFIGURATION ---
const TTL_NUTRI_BARCODE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TTL_NUTRI_NAME_MS = 1000 * 60 * 60 * 24 * 7;    // 7 days
const CACHE_PREFIX_NUTRI = 'nutri';

/**
 * Normalizes strings for consistent cache keys.
 * @param {string} str - Input string.
 * @returns {string} Normalized string (lowercase, trimmed).
 */
const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');


/**
 * Internal logic for fetching nutrition data from Open Food Facts API.
 * Accepts a log function for consistency.
 */
async function _fetchNutritionDataFromApi(barcode, query, log = console.log) {
    let openFoodFactsURL = '';
    const identifier = barcode || query;
    const identifierType = barcode ? 'barcode' : 'query';

    if (barcode) {
        openFoodFactsURL = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
    } else if (query) {
        openFoodFactsURL = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
    } else {
        log('Missing barcode or query parameter for nutrition search.', 'WARN', 'INPUT');
        // Return not_found structure directly instead of throwing for consistency
        return { status: 'not_found', error: 'Missing barcode or query parameter' };
    }

    log(`Requesting nutrition data for ${identifierType}: ${identifier}`, 'DEBUG', 'OFF_REQUEST');
    const startTime = Date.now();

    try {
        const apiResponse = await fetch(openFoodFactsURL, {
            method: 'GET',
            headers: { 'User-Agent': 'CheffyApp/1.0 (dev@cheffy.com)' } // Updated User-Agent
        });
        const latencyMs = Date.now() - startTime;

        if (!apiResponse.ok) {
            log(`Open Food Facts API returned: ${apiResponse.status} for ${identifierType}: ${identifier}`, 'WARN', 'OFF_RESPONSE', { status: apiResponse.status, latency_ms: latencyMs });
            return { status: 'not_found' }; // Don't throw, return expected structure
        }

        const data = await apiResponse.json();
        const product = barcode ? data.product : (data.products && data.products[0]);

        if (product && product.nutriments && product.nutriments['energy-kcal_100g']) {
            const nutriments = product.nutriments;
            log(`Successfully fetched nutrition for ${identifierType}: ${identifier}`, 'SUCCESS', 'OFF_RESPONSE', { latency_ms: latencyMs });
            return {
                status: 'found',
                servingUnit: product.nutrition_data_per || '100g',
                calories: parseFloat(nutriments['energy-kcal_100g'] || 0),
                protein: parseFloat(nutriments.proteins_100g || 0),
                fat: parseFloat(nutriments.fat_100g || 0),
                saturatedFat: parseFloat(nutriments['saturated-fat_100g'] || 0),
                carbs: parseFloat(nutriments.carbohydrates_100g || 0),
                sugars: parseFloat(nutriments.sugars_100g || 0),
                fiber: parseFloat(nutriments.fiber_100g || 0),
                sodium: parseFloat(nutriments.sodium_100g || 0)
            };
        } else {
            log(`Nutrition data not found in response for ${identifierType}: ${identifier}`, 'INFO', 'OFF_RESPONSE', { latency_ms: latencyMs });
            return { status: 'not_found' };
        }

    } catch (error) {
        const latencyMs = Date.now() - startTime;
        log(`Nutrition Fetch Error for ${identifierType} "${identifier}": ${error.message}`, 'ERROR', 'OFF_FAILURE', { latency_ms: latencyMs });
        return { status: 'not_found', error: error.message }; // Return expected structure on fetch error
    }
}

/**
 * Cache-wrapped function for fetching nutrition data.
 * @param {string} barcode - The product barcode.
 * @param {string} query - The product search query.
 * @param {Function} [log=console.log] - Logging function from orchestrator.
 * @returns {Promise<Object>} A promise that resolves to the nutrition data object (cached or fresh).
 */
async function fetchNutritionData(barcode, query, log = console.log) {
    const startTime = Date.now();
    let cacheKey = '';
    let ttlMs = 0;
    let keyType = '';
    const identifier = barcode || query;

    if (!identifier) {
        log('Missing barcode or query parameter for nutrition search.', 'WARN', 'INPUT');
        return { status: 'not_found', error: 'Missing barcode or query parameter' };
    }

    if (barcode) {
        const barcodeNorm = normalizeKey(barcode);
        cacheKey = `${CACHE_PREFIX_NUTRI}:barcode:${barcodeNorm}`;
        ttlMs = TTL_NUTRI_BARCODE_MS;
        keyType = 'nutri_barcode';
    } else { // Use query
        const queryNorm = normalizeKey(query);
        cacheKey = `${CACHE_PREFIX_NUTRI}:name:${queryNorm}`;
        ttlMs = TTL_NUTRI_NAME_MS;
        keyType = 'nutri_name';
    }

    try {
        const cachedData = await kv.get(cacheKey);
        if (cachedData !== null && cachedData !== undefined) {
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit for ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, latency_ms: latencyMs });
            return cachedData; // Assuming cached data has { status: 'found', ... } or { status: 'not_found' }
        }
    } catch (error) {
        log(`Cache GET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        // Proceed to fetch if cache read fails
    }

    // Cache Miss or error reading cache
    log(`Cache Miss for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    const fetchedData = await _fetchNutritionDataFromApi(barcode, query, log);
    const fetchLatencyMs = Date.now() - startTime; // Total time includes fetch

    // Cache BOTH 'found' and 'not_found' responses to avoid re-fetching known misses
    if (fetchedData && (fetchedData.status === 'found' || fetchedData.status === 'not_found')) {
        try {
            await kv.set(cacheKey, fetchedData, { px: ttlMs });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, status: fetchedData.status, ttl_ms: ttlMs });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
            // Still return fetched data even if cache write fails
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, status: fetchedData.status, latency_ms: fetchLatencyMs });
    return fetchedData;
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
        // Use internal fetch directly
        const nutritionData = await _fetchNutritionDataFromApi(barcode, query);
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

// Export the cache-wrapped function for the orchestrator
module.exports.fetchNutritionData = fetchNutritionData;
