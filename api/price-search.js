const axios = require('axios');
const { kv } = require('@vercel/kv'); // Import Vercel KV

// --- CONFIGURATION ---
const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const MAX_RETRIES = 3; // Reduced internal retries slightly as bucket manages rate limits more proactively
const DELAY_MS = 1500; // Adjusted base delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- CACHE CONFIGURATION ---
const TTL_SEARCH_MS = 1000 * 60 * 60 * 3; // 3 hours in milliseconds
const CACHE_PREFIX_SEARCH = 'search';

// --- TOKEN BUCKET CONFIGURATION ---
const BUCKET_CAPACITY = 10; // Max tokens
const BUCKET_REFILL_RATE = 8; // Tokens per second
const BUCKET_RETRY_DELAY_MS = 700; // Delay after a 429 before retry

/**
 * Simple Token Bucket implementation.
 */
class Bucket {
    constructor(capacity, refillRatePerSecond, log = console.log) {
        this.capacity = capacity;
        this.tokens = capacity; // Start full
        this.refillRate = refillRatePerSecond / 10; // Refill amount per 100ms
        this.log = log;
        this.lastRefill = Date.now();

        // Use a more robust interval, checking elapsed time
        setInterval(() => {
            const now = Date.now();
            const elapsedMs = now - this.lastRefill;
            if (elapsedMs > 100) { // Refill roughly every 100ms
                 const refillAmount = (elapsedMs / 1000) * refillRatePerSecond;
                 this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
                 this.lastRefill = now;
                 // this.log(`Bucket refill: +${refillAmount.toFixed(2)}, current: ${this.tokens.toFixed(2)}`, 'DEBUG', 'BUCKET');
            }
        }, 100); // Check every 100ms
    }

    async take(log = this.log) {
         // Refill based on elapsed time before taking
        const now = Date.now();
        const elapsedMs = now - this.lastRefill;
        if (elapsedMs > 0) {
            const refillAmount = (elapsedMs / 1000) * (this.refillRate * 10); // Use original rate/s here
            this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
            this.lastRefill = now;
        }

        if (this.tokens >= 1) {
            this.tokens -= 1;
            // log(`Token taken. Remaining: ${this.tokens.toFixed(2)}`, 'DEBUG', 'BUCKET_TAKE');
            return 0; // Return 0 wait time
        } else {
            // Calculate wait time needed for 1 token
            const tokensNeeded = 1 - this.tokens;
            const waitTimeMs = Math.ceil((tokensNeeded / (this.refillRate * 10)) * 1000); // Wait time based on refill rate per second
            log(`Bucket empty. Waiting ${waitTimeMs}ms...`, 'INFO', 'BUCKET_WAIT');
            await delay(waitTimeMs);
            this.tokens = Math.max(0, this.tokens -1); // Ensure tokens don't go negative after waiting
            // log(`Token taken after wait. Remaining: ${this.tokens.toFixed(2)}`, 'DEBUG', 'BUCKET_TAKE');
            return waitTimeMs; // Return wait time
        }
    }
}

// Instantiate buckets (use lowercase keys for easier matching)
const buckets = {
    coles: new Bucket(BUCKET_CAPACITY, BUCKET_REFILL_RATE, console.log), // Use default console log for bucket internal logging initially
    woolworths: new Bucket(BUCKET_CAPACITY, BUCKET_REFILL_RATE, console.log)
};

/**
 * Normalizes strings for consistent cache keys and bucket lookup.
 * @param {string} str - Input string.
 * @returns {string} Normalized string (lowercase, trimmed, underscores).
 */
const normalizeKey = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, '_');

/**
 * Internal logic for fetching price data from the API.
 * Accepts a log function for consistency. Reduced internal retries.
 */
async function _fetchPriceDataFromApi(store, query, page = 1, log = console.log) {
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
            return rapidResp.data;

        } catch (error) {
            const attemptLatency = Date.now() - attemptStartTime;
            const status = error.response?.status;
            // Check specifically for 429 needed by fetchStoreSafe retry logic
            const is429 = status === 429;
            const isRetryableNetworkError = error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN'; // Other retryable errors

            log(`RapidAPI fetch failed (Attempt ${attempt + 1})`, 'WARN', 'RAPID_FAILURE', { store, query, page, status: status || 'Network/Timeout', message: error.message, is429, isRetryable: is429 || isRetryableNetworkError, latency_ms: attemptLatency });

            // If it's a 429, throw it so fetchStoreSafe can catch and retry once quickly
            if (is429) {
                // Attach status code to error for easier checking
                error.statusCode = 429;
                throw error;
            }

            // For other retryable errors, use exponential backoff
            if (isRetryableNetworkError && attempt < MAX_RETRIES - 1) {
                const delayTime = DELAY_MS * Math.pow(2, attempt);
                log(`Retrying network error in ${delayTime}ms...`, 'WARN', 'RAPID_RETRY');
                await delay(delayTime);
                continue; // Continue internal retry loop
            }

             // If it's a non-429 client error (4xx) or final retry failure for network errors
            const finalErrorMessage = `Request failed. Status: ${status || 'Network/Timeout'}.`;
            log(finalErrorMessage, 'CRITICAL', 'RAPID_FAILURE', { store, query, page, status: status || 504, details: error.message });
            // Don't throw here, return error object
             return { error: { message: finalErrorMessage, status: status || 504, details: error.message }, results: [], total_pages: 0 };
        }
    }
     // Fallback after internal retries fail
    const fallbackMsg = `Price search failed definitely after ${MAX_RETRIES} internal retries.`;
    log(fallbackMsg, 'CRITICAL', 'RAPID_FAILURE', { store, query, page });
    return { error: { message: fallbackMsg, status: 500 }, results: [], total_pages: 0 };
}


/**
 * Wrapper for API calls using the token bucket and adding a single 429 retry.
 */
async function fetchStoreSafe(store, query, page = 1, log = console.log) {
    const storeKey = store?.toLowerCase(); // Use lowercase for bucket lookup
    if (!buckets[storeKey]) {
         log(`Invalid store key "${storeKey}" for token bucket.`, 'ERROR', 'BUCKET');
         return { error: { message: `Internal configuration error: Invalid store key ${storeKey}`, status: 500 } };
    }

    const waitMs = await buckets[storeKey].take(log); // Pass log, get wait time
    log(`Acquired token for ${store} (waited ${waitMs}ms)`, 'DEBUG', 'BUCKET_TAKE', { bucket_wait_ms: waitMs });

    try {
        // Pass original store case to API fetcher
        return await _fetchPriceDataFromApi(store, query, page, log);
    } catch (error) {
        // Catch the 429 thrown by _fetchPriceDataFromApi
        if (error.statusCode === 429) {
            log(`RapidAPI returned 429. Retrying once after ${BUCKET_RETRY_DELAY_MS}ms...`, 'WARN', 'BUCKET_RETRY', { store, query, page });
            await delay(BUCKET_RETRY_DELAY_MS);
            // Retry the internal fetch directly, bypassing bucket for the retry
            // If this fails again, the error will propagate up
             try {
                 return await _fetchPriceDataFromApi(store, query, page, log);
             } catch (retryError) {
                  log(`Retry after 429 failed: ${retryError.message}`, 'ERROR', 'BUCKET_RETRY_FAIL', { store, query, page });
                  // Return a structured error similar to how _fetchPriceDataFromApi does on final failure
                  const status = retryError.response?.status || retryError.statusCode || 500;
                  return { error: { message: `Retry after 429 failed. Status: ${status}`, status: status, details: retryError.message }, results: [], total_pages: 0 };
             }

        }
        // Re-throw other errors (shouldn't happen often if _fetch handles its own errors)
        log(`Unhandled error during fetchStoreSafe after bucket wait: ${error.message}`, 'CRITICAL', 'BUCKET_ERROR', { store, query, page });
         return { error: { message: `Unexpected error during safe fetch: ${error.message}`, status: 500 }, results: [], total_pages: 0 };
    }
}


/**
 * Cache-wrapped function for fetching price data, now using fetchStoreSafe.
 */
async function fetchPriceData(store, query, page = 1, log = console.log) {
    const startTime = Date.now();
    const storeNorm = normalizeKey(store);
    const queryNorm = normalizeKey(query);
    const cacheKey = `${CACHE_PREFIX_SEARCH}:${storeNorm}:${queryNorm}:${page}`;
    const keyType = 'price_search';

    // 1. Check Cache
    try {
        const cachedData = await kv.get(cacheKey);
        if (cachedData !== null && cachedData !== undefined) {
            const latencyMs = Date.now() - startTime;
            log(`Cache Hit for ${cacheKey}`, 'INFO', 'CACHE_HIT', { key_type: keyType, latency_ms: latencyMs });
            return cachedData || { results: [], total_pages: 0 };
        }
    } catch (error) {
        log(`Cache GET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        // Proceed to fetch if cache read fails
    }

    // 2. Cache Miss: Fetch using the rate-limited wrapper
    log(`Cache Miss for ${cacheKey}`, 'INFO', 'CACHE_MISS', { key_type: keyType });
    // --- CALL fetchStoreSafe instead of _fetchPriceDataFromApi ---
    const fetchedData = await fetchStoreSafe(store, query, page, log);
    const fetchLatencyMs = Date.now() - startTime; // Total time includes potential bucket wait + fetch

    // 3. Cache Result (Only if fetch was successful)
    if (fetchedData && !fetchedData.error) {
        try {
            await kv.set(cacheKey, fetchedData, { px: TTL_SEARCH_MS });
            log(`Cache SET success for ${cacheKey}`, 'DEBUG', 'CACHE_WRITE', { key_type: keyType, ttl_ms: TTL_SEARCH_MS });
        } catch (error) {
            log(`Cache SET error for ${cacheKey}: ${error.message}`, 'ERROR', 'CACHE_ERROR', { key_type: keyType });
        }
    }

    log(`Fetch completed for ${cacheKey}`, 'INFO', 'FETCH_COMPLETE', { key_type: keyType, latency_ms: fetchLatencyMs, success: !fetchedData.error });
    return fetchedData;
}


// --- Vercel Handler (Remains unchanged, uses _fetch directly) ---
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }

    try {
        const { store, query, page } = req.query;
        // This simple handler bypasses cache and rate limiting - intended only for direct testing.
        const result = await _fetchPriceDataFromApi(store, query, page ? parseInt(page, 10) : 1);

        if (result.error) {
            return res.status(result.error.status || 500).json(result.error);
        }
        return res.status(200).json(result);
    } catch (error) {
        console.error("Handler error:", error);
        return res.status(500).json({ message: "Internal server error in price search handler.", details: error.message });
    }
};

// Export the cache-wrapped and rate-limited function for the orchestrator
module.exports.fetchPriceData = fetchPriceData;

