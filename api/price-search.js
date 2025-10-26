const axios = require('axios');
// --- MODIFICATION: Import createClient instead of the default kv instance ---
const { createClient } = require('@vercel/kv');

// --- MODIFICATION: Create a client instance using your Upstash variables ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
// --- END MODIFICATION ---

// --- CONFIGURATION ---
const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const MAX_RETRIES = 3; // Max internal retries for network issues
const DELAY_MS = 1500;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- CACHE CONFIGURATION ---
const TTL_SEARCH_MS = 1000 * 60 * 60 * 3; // 3 hours
const SWR_SEARCH_MS = 1000 * 60 * 60 * 1; // Stale While Revalidate for 1 hour
const CACHE_PREFIX_SEARCH = 'search';

// --- TOKEN BUCKET CONFIGURATION ---
const BUCKET_CAPACITY = 10;
const BUCKET_REFILL_RATE = 8; // Tokens per second
const BUCKET_RETRY_DELAY_MS = 700; // Delay after a 429 before retrying

// --- MODIFICATION (Mark 41): Removed stateful Bucket class ---
// The old class Bucket and global `buckets` map have been removed.
// They are replaced by a stateless KV-based rate limiter inside `fetchStoreSafe`.
// --- END MODIFICATION ---

// --- HELPER TO CHECK KV STATUS ---
// --- MODIFICATION: Check for your Upstash variables instead of Vercel's KV variables ---
const isKvConfigured = () => {
    return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
};
// --- END MODIFICATION ---

const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');
const inflightRefreshes = new Set();

/**
 * Internal logic for fetching price data from the API.
 */
async function _fetchPriceDataFromApi(store, query, page = 1, log = console.log) {
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
            // *** Uses axios here ***
            const rapidResp = await axios.get(endpointUrl, {
                params: apiParams,
                headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
                timeout: 30000
            });
            const attemptLatency = Date.now() - attemptStartTime;
            log(`Successfully fetched products for "${query}" (Page ${page}).`, 'SUCCESS', 'RAPID_RESPONSE', { count: rapidResp.data.results?.length || 0, status: rapidResp.status, currentPage: rapidResp.data.current_page, totalPages: rapidResp.data.total_pages, latency_ms: attemptLatency });
            return rapidResp.data;

        } catch (error) {
            const attemptLatency = Date.now() - attemptStartTime;
            const status = error.response?.status;
            const is429 = status === 429;
            const isRetryableNetworkError = error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN';

            log(`RapidAPI fetch failed (Attempt ${attempt + 1})`, 'WARN', 'RAPID_FAILURE', { store, query, page, status: status || 'Network/Timeout', message: error.message, is429, isRetryable: is429 || isRetryableNetworkError, latency_ms: attemptLatency });

            if (is429) {
                error.statusCode = 429;
                throw error;
            }

            if (isRetryableNetworkError && attempt < MAX_RETRIES - 1) {
                const delayTime = DELAY_MS * Math.pow(2, attempt);
                log(`Retrying network error in ${delayTime}ms...`, 'WARN', 'RAPID_RETRY');
                await delay(delayTime);
                continue;
            }

            const finalErrorMessage = `Request failed. Status: ${status || 'Network/Timeout'}.`;
            log(finalErrorMessage, 'CRITICAL', 'RAPID_FAILURE', { store, query, page, status: status || 504, details: error.message });
             return { error: { message: finalErrorMessage, status: status || 504, details: error.message }, results: [], total_pages: 0 };
        }
    }
    const fallbackMsg = `Price search failed definitely after ${MAX_RETRIES} internal retries.`;
    log(fallbackMsg, 'CRITICAL', 'RAPID_FAILURE', { store, query, page });
    return { error: { message: fallbackMsg, status: 500 }, results: [], total_pages: 0 };
}


// --- MODIFICATION (Mark 41): Replaced stateful bucket with stateless KV rate limiter ---
/**
 * Wrapper for API calls using a STATELESS token bucket (Vercel KV) and adding a single 429 retry.
 * This is CRITICAL for serverless environments.
 * Returns { data, waitMs }
 */
async function fetchStoreSafe(store, query, page = 1, log = console.log) {
    const storeKey = store?.toLowerCase();
    if (!RAPID_API_HOSTS[store]) { // Check against hosts map
        log(`Invalid store key "${storeKey}" for token bucket.`, 'CRITICAL', 'BUCKET_ERROR');
        return { data: { error: { message: `Internal configuration error: Invalid store key ${storeKey}`, status: 500 } }, waitMs: 0 };
    }

    // --- STATELESS BUCKET LOGIC ---
    const bucketKey = `bucket:rapidapi:${storeKey}`;
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
                // Don't loop, just break and proceed with the API call.
                break;
            }
        }

        if (!bucketState) {
            // First run or KV error: Initialize and take one token
            log(`Initializing KV bucket: ${bucketKey}`, 'DEBUG', 'BUCKET_INIT');
            if (isKvConfigured()) {
                try {
                    // Set with capacity - 1, and a TTL (using search TTL / 10 as an example) to prevent stale buckets
                    await kv.set(bucketKey, { tokens: BUCKET_CAPACITY - 1, lastRefill: now }, { ex: Math.ceil(TTL_SEARCH_MS / 1000) });
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
                    await kv.set(bucketKey, { tokens: currentTokens, lastRefill: newLastRefill }, { ex: Math.ceil(TTL_SEARCH_MS / 1000) });
                } catch (kvError) {
                    log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message });
                }
            }
            break; // Acquired token
        } else {
            // Not enough tokens, calculate wait time
            const tokensNeeded = 1 - currentTokens;
            const waitTime = Math.max(50, Math.ceil(tokensNeeded / refillRatePerMs)); // Wait at least 50ms

            log(`Rate limiter active. Waiting ${waitTime}ms for ${tokensNeeded.toFixed(2)} tokens...`, 'INFO', 'BUCKET_WAIT');
            await delay(waitTime);
            // Loop will restart, re-getting state and refilling
        }
    } // end while(true)

    waitMs = Date.now() - waitStart; // Total time spent in the loop
    log(`Acquired token for ${store} (waited ${waitMs}ms)`, 'DEBUG', 'BUCKET_TAKE', { bucket_wait_ms: waitMs });
    // --- END STATELESS BUCKET LOGIC ---

    try {
        const data = await _fetchPriceDataFromApi(store, query, page, log);
        return { data, waitMs }; // Return data and wait time
    } catch (error) {
        if (error.statusCode === 429) {
            log(`RapidAPI returned 429. Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { store, query, page });
            await delay(BUCKET_RETRY_DELAY_MS);
             try {
                 const retryData = await _fetchPriceDataFromApi(store, query, page, log);
                 return { data: retryData, waitMs };
             } catch (retryError) {
                  log(`Retry after 429 failed: ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { store, query, page });
                  const status = retryError.response?.status || retryError.statusCode || 500;
                  const errorData = { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message }, results: [], total_pages: 0 };
                  return { data: errorData, waitMs };
             }
        }
        log(`Unhandled error during fetchStoreSafe after bucket wait: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { store, query, page });
         const errorData = { error: { message: `Unexpected error during safe fetch: ${error.message}`, status: 500 }, results: [], total_pages: 0 };
         return { data: errorData, waitMs };
    }
}
// --- END MODIFICATION ---

/**
 * Initiates a background refresh for a given cache key.
 */
async function refreshInBackground(cacheKey, store, query, page, log, keyType) {
    if (inflightRefreshes.has(cacheKey)) {
        log(`Background refresh already in progress for ${cacheKey}, skipping.`, 'DEBUG', 'SWR_SKIP', { key_type: keyType });
        return;
    }
    inflightRefreshes.add(cacheKey);
    log(`Starting background refresh for ${cacheKey}...`, 'INFO', 'SWR_REFRESH_START', { key_type: keyType });

    (async () => {
        try {
            const { data: freshData } = await fetchStoreSafe(store, query, page, log);
            if (freshData && !freshData.error) {
                await kv.set(cacheKey, { data: freshData, ts: Date.now() }, { px: TTL_SEARCH_MS });
                log(`Background refresh successful for ${cacheKey}`, 'INFO', 'SWR_REFRESH_SUCCESS', { key_type: keyType });
            } else {
                 log(`Background refresh failed to fetch data for ${cacheKey}`, 'WARN', 'SWR_REFRESH_FAIL', { error: freshData?.error, key_type: keyType });
            }
        } catch (error) {
            log(`Background refresh error for ${cacheKey}: ${error.message}`, 'ERROR', 'SWR_REFRESH_ERROR', { key_type: keyType });
        } finally {
            inflightRefreshes.delete(cacheKey);
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

    if (!isKvConfigured()) {
        // --- MODIFICATION: Updated error message to reflect correct env var names ---
        log('CRITICAL: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN are missing. Bypassing cache and running uncached API fetch.', 'CRITICAL', 'CONFIG_ERROR');
        // --- END MODIFICATION ---
        // Fallback to uncached fetch, still using rate limiting
        const { data: fetchedData, waitMs: fetchWaitMs } = await fetchStoreSafe(store, query, page, log);
        return { data: fetchedData, waitMs: fetchWaitMs };
    }

    // 1. Check Cache (Only if KV is configured)
    let cachedItem = null;
    try {
        cachedItem = await kv.get(cacheKey);
    } catch (error) {
        log(`Cache GET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
    }

    if (cachedItem && typeof cachedItem === 'object' && cachedItem.data && cachedItem.ts) {
        const ageMs = Date.now() - cachedItem.ts;

        if (ageMs < SWR_SEARCH_MS) {
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit (Fresh) for ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, latency_ms: latencyMs, age_ms: ageMs });
            return { data: cachedItem.data, waitMs: 0 };
        } else if (ageMs < TTL_SEARCH_MS) {
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit (Stale) for ${cacheKey}, serving stale and refreshing.`, 'INFO', 'CACHE_HIT_STALE', { key_type: keyType, latency_ms: latencyMs, age_ms: ageMs });
            refreshInBackground(cacheKey, store, query, page, log, keyType);
            return { data: cachedItem.data, waitMs: 0 };
        }
    }

    // 2. Cache Miss or Expired: Fetch using rate-limited wrapper
    log(`Cache Miss or Expired for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    const { data: fetchedData, waitMs: fetchWaitMs } = await fetchStoreSafe(store, query, page, log);
    const fetchLatencyMs = Date.now() - startTime;

    // 3. Cache Result
    if (fetchedData && !fetchedData.error) {
        try {
            await kv.set(cacheKey, { data: fetchedData, ts: Date.now() }, { px: TTL_SEARCH_MS });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, ttl_ms: TTL_SEARCH_MS });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, latency_ms: fetchLatencyMs, success: !fetchedData?.error, bucket_wait_ms: fetchWaitMs });
    const returnData = fetchedData || { error: { message: "Fetch returned undefined", status: 500 }};
    return { data: returnData, waitMs: fetchWaitMs };
}


// --- Vercel Handler (MODIFIED Mark 41) ---
// This handler now uses the public, cached, and rate-limited `fetchPriceData` function.
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }

    try {
        const { store, query, page } = req.query;

        // --- MODIFICATION: Use the public, cached, rate-limited function ---
        // We create a simple log function for this handler's scope
        const log = (message, level = 'INFO', tag = 'HANDLER') => {
            console.log(`[${level}] [${tag}] ${message}`);
        };

        const { data: result } = await fetchPriceData(store, query, page ? parseInt(page, 10) : 1, log);
        // --- END MODIFICATION ---

        if (result.error) {
            return res.status(result.error.status || 500).json(result.error);
        }
        return res.status(200).json(result);
    } catch (error) {
        console.error("Handler error:", error);
        return res.status(500).json({ message: "Internal server error in price search handler.", details: error.message });
    }
};
// --- END MODIFICATION ---

module.exports.fetchPriceData = fetchPriceData;

