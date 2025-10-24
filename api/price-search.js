const axios = require('axios');
const { kv } = require('@vercel/kv'); // Import Vercel KV

// --- CONFIGURATION ---
const RAPID_API_HOSTS = { /* ... */ };
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const MAX_RETRIES = 3;
const DELAY_MS = 1500;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- CACHE CONFIGURATION ---
const TTL_SEARCH_MS = 1000 * 60 * 60 * 3; // 3 hours
const SWR_SEARCH_MS = 1000 * 60 * 60 * 1; // Stale While Revalidate for 1 hour (within the 3hr TTL)
const CACHE_PREFIX_SEARCH = 'search';

// --- TOKEN BUCKET CONFIGURATION ---
const BUCKET_CAPACITY = 10;
const BUCKET_REFILL_RATE = 8;
const BUCKET_RETRY_DELAY_MS = 700;

class Bucket { /* ... (Token Bucket Class from previous step) ... */ }
const buckets = { /* ... (Bucket instances from previous step) ... */ };

// --- HELPERS ---
const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');

// Keep track of ongoing background refreshes within this invocation
const inflightRefreshes = new Set();

/**
 * Internal logic for fetching price data from the API.
 * Accepts a log function for consistency. Reduced internal retries.
 */
async function _fetchPriceDataFromApi(store, query, page = 1, log = console.log) {
    // ... (Implementation remains the same as previous step) ...
    if (!RAPID_API_KEY) { /* ... validation ... */ return { error: { message: 'Server configuration error: API key missing.', status: 500 } }; }
    if (!store || !query) { /* ... validation ... */ return { error: { message: 'Missing required parameters: store and query.', status: 400 } }; }
    const host = RAPID_API_HOSTS[store]; // Use original case for host lookup
    if (!host) { /* ... validation ... */ return { error: { message: 'Invalid store specified. Must be "Coles" or "Woolworths".', status: 400 } }; }

    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;
    const apiParams = { query, page: page.toString(), page_size: '20' };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const attemptStartTime = Date.now();
        log(`Attempt ${attempt + 1}/${MAX_RETRIES}: Requesting product data (Page ${page}).`, 'DEBUG', 'RAPID_REQUEST', { store, query, page, endpoint: endpointUrl });

        try {
            const rapidResp = await axios.get(endpointUrl, {
                params: apiParams,
                headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
                timeout: 30000 // 30 second timeout
            });
            const attemptLatency = Date.now() - attemptStartTime;
            log(`Successfully fetched products for "${query}" (Page ${page}).`, 'SUCCESS', 'RAPID_RESPONSE', { count: rapidResp.data.results?.length || 0, status: rapidResp.status, currentPage: rapidResp.data.current_page, totalPages: rapidResp.data.total_pages, latency_ms: attemptLatency });
            // IMPORTANT: Return only the data part for caching consistency
            return rapidResp.data;

        } catch (error) {
            const attemptLatency = Date.now() - attemptStartTime;
            const status = error.response?.status;
            const is429 = status === 429;
            const isRetryableNetworkError = error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN';

            log(`RapidAPI fetch failed (Attempt ${attempt + 1})`, 'WARN', 'RAPID_FAILURE', { store, query, page, status: status || 'Network/Timeout', message: error.message, is429, isRetryable: is429 || isRetryableNetworkError, latency_ms: attemptLatency });

            if (is429) {
                error.statusCode = 429;
                throw error; // Let fetchStoreSafe handle the single retry for 429
            }

            if (isRetryableNetworkError && attempt < MAX_RETRIES - 1) {
                const delayTime = DELAY_MS * Math.pow(2, attempt);
                log(`Retrying network error in ${delayTime}ms...`, 'WARN', 'RAPID_RETRY');
                await delay(delayTime);
                continue;
            }

             // Final internal failure
            const finalErrorMessage = `Request failed. Status: ${status || 'Network/Timeout'}.`;
            log(finalErrorMessage, 'CRITICAL', 'RAPID_FAILURE', { store, query, page, status: status || 504, details: error.message });
             return { error: { message: finalErrorMessage, status: status || 504, details: error.message }, results: [], total_pages: 0 };
        }
    }
    const fallbackMsg = `Price search failed definitely after ${MAX_RETRIES} internal retries.`;
    log(fallbackMsg, 'CRITICAL', 'RAPID_FAILURE', { store, query, page });
    return { error: { message: fallbackMsg, status: 500 }, results: [], total_pages: 0 };
}


/**
 * Wrapper for API calls using the token bucket and adding a single 429 retry.
 */
async function fetchStoreSafe(store, query, page = 1, log = console.log) {
    // ... (Implementation remains the same as previous step) ...
    const storeKey = store?.toLowerCase();
    if (!buckets[storeKey]) { /* ... error handling ... */ return { error: { message: `Internal configuration error: Invalid store key ${storeKey}`, status: 500 } }; }

    const waitMs = await buckets[storeKey].take(log);
    log(`Acquired token for ${store} (waited ${waitMs}ms)`, 'DEBUG', 'BUCKET_TAKE', { bucket_wait_ms: waitMs });

    try {
        return await _fetchPriceDataFromApi(store, query, page, log);
    } catch (error) {
        if (error.statusCode === 429) {
            log(`RapidAPI returned 429. Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { store, query, page });
            await delay(BUCKET_RETRY_DELAY_MS);
             try {
                 // Retry internal fetch, bypassing bucket
                 return await _fetchPriceDataFromApi(store, query, page, log);
             } catch (retryError) {
                  log(`Retry after 429 failed: ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { store, query, page });
                  const status = retryError.response?.status || retryError.statusCode || 500;
                  // Return consistent error structure
                  return { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message }, results: [], total_pages: 0 };
             }
        }
        log(`Unhandled error during fetchStoreSafe after bucket wait: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { store, query, page });
         return { error: { message: `Unexpected error during safe fetch: ${error.message}`, status: 500 }, results: [], total_pages: 0 };
    }
}

/**
 * Initiates a background refresh for a given cache key.
 */
async function refreshInBackground(cacheKey, store, query, page, log) {
    if (inflightRefreshes.has(cacheKey)) {
        log(`Background refresh already in progress for ${cacheKey}, skipping.`, 'DEBUG', 'SWR_SKIP');
        return;
    }
    inflightRefreshes.add(cacheKey);
    log(`Starting background refresh for ${cacheKey}...`, 'INFO', 'SWR_REFRESH_START');

    // Fire and forget - do not await this
    (async () => {
        try {
            // Use fetchStoreSafe to respect rate limits even during background refresh
            const freshData = await fetchStoreSafe(store, query, page, log);
            if (freshData && !freshData.error) {
                await kv.set(cacheKey, { data: freshData, ts: Date.now() }, { px: TTL_SEARCH_MS });
                log(`Background refresh successful for ${cacheKey}`, 'INFO', 'SWR_REFRESH_SUCCESS');
            } else {
                 log(`Background refresh failed to fetch data for ${cacheKey}`, 'WARN', 'SWR_REFRESH_FAIL', { error: freshData?.error });
                 // Optionally: delete the stale key or leave it
            }
        } catch (error) {
            log(`Background refresh error for ${cacheKey}: ${error.message}`, 'ERROR', 'SWR_REFRESH_ERROR');
        } finally {
            inflightRefreshes.delete(cacheKey); // Remove from inflight list
        }
    })();
}

/**
 * Cache-wrapped function for fetching price data with SWR.
 */
async function fetchPriceData(store, query, page = 1, log = console.log) {
    const startTime = Date.now();
    const storeNorm = normalizeKey(store);
    const queryNorm = normalizeKey(query);
    const cacheKey = `${CACHE_PREFIX_SEARCH}:${storeNorm}:${queryNorm}:${page}`;
    const keyType = 'price_search';

    // 1. Check Cache
    let cachedItem = null;
    try {
        cachedItem = await kv.get(cacheKey);
    } catch (error) {
        log(`Cache GET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        // Proceed to fetch if cache read fails
    }

    if (cachedItem && typeof cachedItem === 'object' && cachedItem.data && cachedItem.ts) {
        const ageMs = Date.now() - cachedItem.ts;

        if (ageMs < SWR_SEARCH_MS) {
            // Cache is fresh enough
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit (Fresh) for ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, latency_ms: latencyMs, age_ms: ageMs });
            return cachedItem.data; // Return data directly
        } else if (ageMs < TTL_SEARCH_MS) {
            // Cache is stale but within TTL - Serve stale, refresh in background
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit (Stale) for ${cacheKey}, serving stale and refreshing.`, 'INFO', 'CACHE_HIT_STALE', { key_type: keyType, latency_ms: latencyMs, age_ms: ageMs });
            // --- Trigger background refresh ---
            refreshInBackground(cacheKey, store, query, page, log);
            return cachedItem.data; // Return stale data immediately
        }
        // Cache is older than TTL, treat as miss
    }

    // 2. Cache Miss or Expired: Fetch using the rate-limited wrapper
    log(`Cache Miss or Expired for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    const fetchedData = await fetchStoreSafe(store, query, page, log);
    const fetchLatencyMs = Date.now() - startTime;

    // 3. Cache Result (Only if fetch was successful)
    if (fetchedData && !fetchedData.error) {
        try {
            // --- Store object with data and timestamp ---
            await kv.set(cacheKey, { data: fetchedData, ts: Date.now() }, { px: TTL_SEARCH_MS });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, ttl_ms: TTL_SEARCH_MS });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, latency_ms: fetchLatencyMs, success: !fetchedData?.error });
    // Return only the data part, even on first fetch
    return fetchedData || { error: { message: "Fetch returned undefined", status: 500 }};
}


// --- Vercel Handler (Remains unchanged) ---
module.exports = async (req, res) => { /* ... */ };
module.exports.fetchPriceData = fetchPriceData; // Export SWR version

