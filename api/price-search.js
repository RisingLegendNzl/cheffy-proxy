const axios = require('axios');
// --- MODIFICATION: Import createClient instead of the default kv instance ---
const { createClient } = require('@vercel/kv');

// --- MODIFICATION: Create a client instance using your Upstash variables ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
// --- END MODIFICATION ---

// --- *** MODIFICATION: Removed unused require for product-validator *** ---
// const { validateProduct, selectBest } = require('./product-validator');
// --- *** END MODIFICATION *** ---

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
// --- [PERF] Updated BUCKET_REFILL_RATE from 8 to 10 ---
const BUCKET_CAPACITY = 10;
const BUCKET_REFILL_RATE = 10; // Tokens per second
const BUCKET_RETRY_DELAY_MS = 700; // Delay after a 429 before retrying
// --- [PERF] Added Token Bucket Max Wait ---
const TOKEN_BUCKET_MAX_WAIT_MS = 250;

const isKvConfigured = () => {
    return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
};

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
    // --- [PERF] Instruction: Keep page=1 only. This function already only fetches one page. ---
    const apiParams = { query, page: page.toString(), page_size: '20' };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const attemptStartTime = Date.now();
        log(`Attempt ${attempt + 1}/${MAX_RETRIES}: Requesting product data (Page ${page}).`, 'DEBUG', 'RAPID_REQUEST', { store, query, page, endpoint: endpointUrl });

        try {
            const rapidResp = await axios.get(endpointUrl, {
                params: apiParams,
                headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
                // --- [PERF] Reduced timeout from 30000ms to 8000ms ---
                timeout: 8000
            });
            const attemptLatency = Date.now() - attemptStartTime;
            log(`Successfully fetched products for "${query}" (Page ${page}).`, 'SUCCESS', 'RAPID_RESPONSE', { count: rapidResp.data.results?.length || 0, status: rapidResp.status, currentPage: rapidResp.data.current_page, totalPages: rapidResp.data.total_pages, latency_ms: attemptLatency });
            return rapidResp.data;

        } catch (error) {
            const attemptLatency = Date.now() - attemptStartTime;
            const status = error.response?.status;
            const is429 = status === 429;
            // --- [PERF] Added timeout code check ---
            const isRetryableNetworkError = error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN' || error.message.includes('timeout');

            log(`RapidAPI fetch failed (Attempt ${attempt + 1})`, 'WARN', 'RAPID_FAILURE', { store, query, page, status: status || 'Network/Timeout', message: error.message, is429, isRetryable: is429 || isRetryableNetworkError, latency_ms: attemptLatency });

            if (is429) {
                // Throw specifically for the fetchStoreSafe wrapper to catch and handle retry
                const rateLimitError = new Error(`Rate limit exceeded (429)`);
                rateLimitError.statusCode = 429;
                throw rateLimitError;
            }

            if (isRetryableNetworkError && attempt < MAX_RETRIES - 1) {
                const delayTime = DELAY_MS * Math.pow(2, attempt);
                log(`Retrying network error in ${delayTime}ms...`, 'WARN', 'RAPID_RETRY');
                await delay(delayTime);
                continue;
            }

            // Non-retryable error or final attempt failed
            const finalErrorMessage = `Request failed after ${attempt + 1} attempts. Status: ${status || 'Network/Timeout'}.`;
            log(finalErrorMessage, 'CRITICAL', 'RAPID_FAILURE', { store, query, page, status: status || 504, details: error.message });
             // Return an error object consistent with success structure but indicating failure
             return { error: { message: finalErrorMessage, status: status || 504, details: error.message }, results: [], total_pages: 0, current_page: 1 };
        }
    }
     // Fallback if loop finishes without returning (should only happen after max retries fail)
     const fallbackMsg = `Price search failed definitely after ${MAX_RETRIES} internal retries.`;
     log(fallbackMsg, 'CRITICAL', 'RAPID_FAILURE', { store, query, page });
     return { error: { message: fallbackMsg, status: 500 }, results: [], total_pages: 0, current_page: 1 };
}

/**
 * Wrapper for API calls using a STATELESS token bucket (Vercel KV) and adding a single 429 retry.
 */
async function fetchStoreSafe(store, query, page = 1, log = console.log) {
    const storeKey = store?.toLowerCase();
    if (!RAPID_API_HOSTS[store]) {
        log(`Invalid store key "${storeKey}" for token bucket.`, 'CRITICAL', 'BUCKET_ERROR');
        return { data: { error: { message: `Internal configuration error: Invalid store key ${storeKey}`, status: 500 } }, waitMs: 0 };
    }

    const bucketKey = `bucket:rapidapi:${storeKey}`;
    const refillRatePerMs = BUCKET_REFILL_RATE / 1000;
    let waitMs = 0;
    const waitStart = Date.now();
    // --- [PERF] Track total wait time ---
    let totalWaitTime = 0;

    while (true) {
        // --- [PERF] Check total wait time against max wait ---
        totalWaitTime = Date.now() - waitStart;
        if (totalWaitTime > TOKEN_BUCKET_MAX_WAIT_MS) {
            log(`Token wait exceeded ${TOKEN_BUCKET_MAX_WAIT_MS}ms. Skipping request.`, 'WARN', 'BUCKET_SKIP', { store, query, page, totalWaitTime });
            const errorData = { error: { message: `Rate limit wait timed out after ${totalWaitTime}ms`, status: 429, details: "Token bucket max wait exceeded" }, results: [], total_pages: 0, current_page: 1 };
            return { data: errorData, waitMs: totalWaitTime };
        }
        // --- [END PERF] ---

        const now = Date.now();
        let bucketState = null;

        if (isKvConfigured()) {
            try { bucketState = await kv.get(bucketKey); } catch (kvError) {
                log(`CRITICAL: KV GET failed for bucket ${bucketKey}. Bypassing rate limit.`, 'CRITICAL', 'KV_ERROR', { error: kvError.message }); break;
            }
        }

        if (!bucketState) {
            log(`Initializing KV bucket: ${bucketKey}`, 'DEBUG', 'BUCKET_INIT');
            if (isKvConfigured()) {
                try { await kv.set(bucketKey, { tokens: BUCKET_CAPACITY - 1, lastRefill: now }, { ex: Math.ceil(TTL_SEARCH_MS / 1000) }); } catch (kvError) { log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message }); }
            } break;
        }

        const elapsedMs = now - bucketState.lastRefill;
        const tokensToAdd = elapsedMs * refillRatePerMs;
        let currentTokens = Math.min(BUCKET_CAPACITY, bucketState.tokens + tokensToAdd);
        const newLastRefill = now;

        if (currentTokens >= 1) {
            currentTokens -= 1;
            if (isKvConfigured()) {
                try { await kv.set(bucketKey, { tokens: currentTokens, lastRefill: newLastRefill }, { ex: Math.ceil(TTL_SEARCH_MS / 1000) }); } catch (kvError) { log(`Warning: KV SET failed for bucket ${bucketKey}.`, 'WARN', 'KV_ERROR', { error: kvError.message }); }
            } break;
        } else {
            const tokensNeeded = 1 - currentTokens;
            let waitTime = Math.max(50, Math.ceil(tokensNeeded / refillRatePerMs));

            // --- [PERF] Cap wait time to not exceed maxWait ---
            const remainingWaitBudget = (TOKEN_BUCKET_MAX_WAIT_MS - totalWaitTime);
            if (waitTime > remainingWaitBudget && remainingWaitBudget > 0) {
                // Wait just enough to trigger the timeout on the next loop, plus a small buffer
                waitTime = remainingWaitBudget + 50;
            }
            // --- [END PERF] ---

            log(`Rate limiter active. Waiting ${waitTime}ms for ${tokensNeeded.toFixed(2)} tokens...`, 'INFO', 'BUCKET_WAIT');
            await delay(waitTime);
        }
    }

    // --- [PERF] totalWaitTime is now calculated in the loop ---
    waitMs = totalWaitTime;
    log(`Acquired token for ${store} (waited ${waitMs}ms)`, 'DEBUG', 'BUCKET_TAKE', { bucket_wait_ms: waitMs });

    try {
        const data = await _fetchPriceDataFromApi(store, query, page, log);
        return { data, waitMs };
    } catch (error) {
        if (error.statusCode === 429) {
            log(`RapidAPI returned 429. Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { store, query, page });
            await delay(BUCKET_RETRY_DELAY_MS);
             try {
                 // Directly call the internal fetch again for the retry
                 const retryData = await _fetchPriceDataFromApi(store, query, page, log);
                 return { data: retryData, waitMs }; // Return potentially successful retry data
             } catch (retryError) {
                  // Catch errors from the RETRY attempt
                  log(`Retry after 429 failed: ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { store, query, page });
                  const status = retryError.response?.status || retryError.statusCode || 500;
                  // Ensure error structure matches success structure
                  const errorData = { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message }, results: [], total_pages: 0, current_page: 1 };
                  return { data: errorData, waitMs }; // Return error structure
             }
        }
        // Handle unexpected errors not caught by _fetchPriceDataFromApi (should be rare)
        log(`Unhandled error during fetchStoreSafe after bucket wait: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { store, query, page });
         const errorData = { error: { message: `Unexpected error during safe fetch: ${error.message}`, status: 500 }, results: [], total_pages: 0, current_page: 1 };
         return { data: errorData, waitMs };
    }
}

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

    // Use IIFE to handle async logic without awaiting in the main flow
    (async () => {
        try {
            // Fetch fresh data using the rate-limited wrapper
            const { data: freshData } = await fetchStoreSafe(store, query, page, log);
            // Check if fetch was successful before caching
            if (freshData && !freshData.error) {
                // Cache the successful fresh data
                await kv.set(cacheKey, { data: freshData, ts: Date.now() }, { px: TTL_SEARCH_MS });
                log(`Background refresh successful for ${cacheKey}`, 'INFO', 'SWR_REFRESH_SUCCESS', { key_type: keyType });
            } else {
                 // Log failure if fetch returned an error structure
                 log(`Background refresh failed to fetch data for ${cacheKey}`, 'WARN', 'SWR_REFRESH_FAIL', { error: freshData?.error, key_type: keyType });
            }
        } catch (error) { // Catch errors from fetchStoreSafe itself
            log(`Background refresh error for ${cacheKey}: ${error.message}`, 'ERROR', 'SWR_REFRESH_ERROR', { key_type: keyType });
        } finally {
            inflightRefreshes.delete(cacheKey); // Always remove from inflight set
        }
    })(); // Immediately invoke the async function
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
        log('CRITICAL: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN are missing. Bypassing cache.', 'CRITICAL', 'CONFIG_ERROR');
        const { data: fetchedData, waitMs: fetchWaitMs } = await fetchStoreSafe(store, query, page, log);
        // Ensure fetchedData exists and return consistent structure
        return { data: fetchedData || { error: { message: "Uncached fetch failed unexpectedly", status: 500 }}, waitMs: fetchWaitMs };
    }

    let cachedItem = null;
    try {
        cachedItem = await kv.get(cacheKey);
    } catch (error) {
        log(`Cache GET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
    }

    if (cachedItem && typeof cachedItem === 'object' && cachedItem.data && cachedItem.ts) {
        const ageMs = Date.now() - cachedItem.ts;
        if (ageMs < SWR_SEARCH_MS) {
            log(`Cache Hit (Fresh) for ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, latency_ms: Date.now() - startTime, age_ms: ageMs });
            return { data: cachedItem.data, waitMs: 0 }; // Fresh data, no wait
        } else if (ageMs < TTL_SEARCH_MS) {
            log(`Cache Hit (Stale) for ${cacheKey}, serving stale and refreshing.`, 'INFO', 'CACHE_HIT_STALE', { key_type: keyType, latency_ms: Date.now() - startTime, age_ms: ageMs });
            refreshInBackground(cacheKey, store, query, page, log, keyType); // Trigger background refresh
            return { data: cachedItem.data, waitMs: 0 }; // Serve stale, no wait
        }
    }

    log(`Cache Miss or Expired for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    const { data: fetchedData, waitMs: fetchWaitMs } = await fetchStoreSafe(store, query, page, log);
    const fetchLatencyMs = Date.now() - startTime;

    // Cache only if fetch was successful
    if (fetchedData && !fetchedData.error) {
        try {
            await kv.set(cacheKey, { data: fetchedData, ts: Date.now() }, { px: TTL_SEARCH_MS });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, ttl_ms: TTL_SEARCH_MS });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, latency_ms: fetchLatencyMs, success: !fetchedData?.error, bucket_wait_ms: fetchWaitMs });
    // Ensure fetchedData exists and return consistent structure
    const returnData = fetchedData || { error: { message: "Fetch returned undefined after cache miss", status: 500 }};
    return { data: returnData, waitMs: fetchWaitMs };
}


// --- Vercel Handler ---
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }

    try {
        const { store, query, page } = req.query;
        const log = (message, level = 'INFO', tag = 'HANDLER') => { console.log(`[${level}] [${tag}] ${message}`); };

        const { data: result, waitMs } = await fetchPriceData(store, query, page ? parseInt(page, 10) : 1, log);

        // Check the structure of the result from fetchPriceData
        if (result && result.error) {
             log(`Price search handler returning error: ${result.error.message}`, 'WARN', 'HANDLER');
            return res.status(result.error.status || 500).json(result.error);
        } else if (result) {
            // Successful result, return it
            return res.status(200).json(result);
        } else {
             // Handle unexpected case where result is null/undefined
            log('Price search handler received unexpected null/undefined result.', 'ERROR', 'HANDLER');
            return res.status(500).json({ message: "Internal server error: Price search failed unexpectedly." });
        }
    } catch (error) {
        console.error("Handler error:", error);
        return res.status(500).json({ message: "Internal server error in price search handler.", details: error.message });
    }
};

// Expose fetchPriceData for generate-full-plan.js
module.exports.fetchPriceData = fetchPriceData;

// --- *** MODIFICATION: Removed unused exports *** ---
// module.exports.selectBestForIngredient = selectBestForIngredient;
// module.exports.buildSpec = buildSpec;
// --- *** END MODIFICATION *** ---

