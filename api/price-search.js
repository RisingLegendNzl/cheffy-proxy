const axios = require('axios');
const { kv } = require('@vercel/kv'); // Import Vercel KV

// --- CONFIGURATION ---
const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const MAX_RETRIES = 5;
const DELAY_MS = 2000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- CACHE CONFIGURATION ---
const TTL_SEARCH_MS = 1000 * 60 * 60 * 3; // 3 hours in milliseconds
const CACHE_PREFIX_SEARCH = 'search';

/**
 * Normalizes strings for consistent cache keys.
 * @param {string} str - Input string.
 * @returns {string} Normalized string (lowercase, trimmed).
 */
const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');

/**
 * Internal logic for fetching price data from the API.
 * Accepts a log function for consistency.
 */
async function _fetchPriceDataFromApi(store, query, page = 1, log = console.log) {
    // Basic validation moved here
    if (!RAPID_API_KEY) {
        log('Configuration Error: RAPIDAPI_KEY is not set.', 'CRITICAL', 'CONFIG');
        return { error: { message: 'Server configuration error: API key missing.', status: 500 } };
    }
    if (!store || !query) {
        log('Missing required parameters: store and query.', 'WARN', 'INPUT', { store, query });
        return { error: { message: 'Missing required parameters: store and query.', status: 400 } };
    }
    const host = RAPID_API_HOSTS[store];
    if (!host) {
         log(`Invalid store specified: ${store}. Must be "Coles" or "Woolworths".`, 'WARN', 'INPUT');
        return { error: { message: 'Invalid store specified. Must be "Coles" or "Woolworths".', status: 400 } };
    }

    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;
    const apiParams = { query, page: page.toString(), page_size: '20' };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const attemptStartTime = Date.now();
        log(`Attempt ${attempt + 1}/${MAX_RETRIES}: Requesting product data (Page ${page}).`, 'DEBUG', 'RAPID_REQUEST', { store, query, page, endpoint: endpointUrl });

        try {
            const rapidResp = await axios.get(endpointUrl, {
                params: apiParams,
                headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
                timeout: 30000
            });
            const attemptLatency = Date.now() - attemptStartTime;
            log(`Successfully fetched products for "${query}" (Page ${page}).`, 'SUCCESS', 'RAPID_RESPONSE', { count: rapidResp.data.results?.length || 0, status: rapidResp.status, currentPage: rapidResp.data.current_page, totalPages: rapidResp.data.total_pages, latency_ms: attemptLatency });
            return rapidResp.data; // Success: return the full data object

        } catch (error) {
            const attemptLatency = Date.now() - attemptStartTime;
            const status = error.response?.status;
            const isRateLimitOrNetworkError = status === 429 || error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN';

            log(`RapidAPI fetch failed (Attempt ${attempt + 1})`, 'WARN', 'RAPID_FAILURE', { store, query, page, status: status || 'Network/Timeout', message: error.message, isRetryable: isRateLimitOrNetworkError, latency_ms: attemptLatency });

            if (isRateLimitOrNetworkError && attempt < MAX_RETRIES - 1) {
                const delayTime = DELAY_MS * Math.pow(2, attempt);
                log(`Retrying in ${delayTime}ms...`, 'WARN', 'RAPID_RETRY');
                await delay(delayTime);
                continue;
            }

            // Final failure: return structured error object
            const finalErrorMessage = `Request failed after ${MAX_RETRIES} attempts. Status: ${status || 'Network/Timeout'}.`;
            log(finalErrorMessage, 'CRITICAL', 'RAPID_FAILURE', { store, query, page, status: status || 504, details: error.message });
            return { error: { message: finalErrorMessage, status: status || 504, details: error.message }, results: [], total_pages: 0 };
        }
    }
    // Fallback just in case loop exits unexpectedly
    return { error: { message: `Price search failed unexpectedly after ${MAX_RETRIES} attempts.`, status: 500 }, results: [], total_pages: 0 };
}

/**
 * Cache-wrapped function for fetching price data.
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @param {number} [page=1] - The page number to fetch.
 * @param {Function} [log=console.log] - Logging function from orchestrator.
 * @returns {Promise<Object>} A promise that resolves to the API response (cached or fresh).
 */
async function fetchPriceData(store, query, page = 1, log = console.log) {
    const startTime = Date.now();
    const storeNorm = normalizeKey(store);
    const queryNorm = normalizeKey(query);
    const cacheKey = `${CACHE_PREFIX_SEARCH}:${storeNorm}:${queryNorm}:${page}`;
    const keyType = 'price_search';

    try {
        const cachedData = await kv.get(cacheKey);
        if (cachedData !== null && cachedData !== undefined) {
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit for ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, latency_ms: latencyMs });
            // Ensure structure matches API response even if cache format drifts
            return cachedData || { results: [], total_pages: 0 };
        }
    } catch (error) {
        log(`Cache GET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        // Proceed to fetch if cache read fails
    }

    // Cache Miss or error reading cache
    log(`Cache Miss for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    const fetchedData = await _fetchPriceDataFromApi(store, query, page, log);
    const fetchLatencyMs = Date.now() - startTime; // Total time includes fetch

    // Only cache successful responses (no 'error' field)
    if (fetchedData && !fetchedData.error) {
        try {
            await kv.set(cacheKey, fetchedData, { px: TTL_SEARCH_MS });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, ttl_ms: TTL_SEARCH_MS });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
            // Still return fetched data even if cache write fails
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, latency_ms: fetchLatencyMs });
    return fetchedData;
}


// --- Vercel Handler (Not used by orchestrator, doesn't use cache or advanced logging) ---
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }

    try {
        const { store, query, page } = req.query;
        // Use the internal fetch function directly for the simple handler
        const result = await _fetchPriceDataFromApi(store, query, page ? parseInt(page, 10) : 1);

        if (result.error) {
            return res.status(result.error.status || 500).json(result.error);
        }
        return res.status(200).json(result);
    } catch (error) {
        // This catch might be redundant now but kept for safety
        console.error("Handler error:", error);
        return res.status(500).json({ message: "Internal server error in price search handler.", details: error.message });
    }
};

// Export the cache-wrapped function for the orchestrator
module.exports.fetchPriceData = fetchPriceData;
