const axios = require('axios');

// --- CONFIGURATION ---
const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const API_TIMEOUT = 10000; // 10-second timeout

/**
 * Performs a single, direct search against one of the grocery store APIs.
 * It now uses a dynamic limit for the number of results.
 * @param {string} store - The store to search.
 * @param {string} query - The product search query.
 * @param {number} limit - The maximum number of results to return.
 * @param {function} log - The logging function.
 * @returns {Promise<Array>} A promise that resolves to an array of product results.
 */
async function singleStoreSearch(store, query, limit, log) {
    if (!RAPID_API_KEY) {
        throw new Error('Server configuration error: RAPIDAPI_KEY missing.');
    }
    const host = RAPID_API_HOSTS[store];
    if (!host) {
        throw new Error(`Invalid store specified: ${store}.`);
    }

    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;
    
    try {
        const rapidResp = await axios.get(endpointUrl, {
            params: { query },
            headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
            timeout: API_TIMEOUT
        });
        
        const results = rapidResp.data.results || [];
        // Use the dynamic searchLimit provided by the AI, defaulting to 10
        const searchLimit = typeof limit === 'number' && limit > 0 ? limit : 10;
        return results.slice(0, searchLimit);

    } catch (error) {
        const errorMessage = `RapidAPI Execution Error for "${query}" at ${store}: ${error.message}`;
        log({ message: errorMessage, level: 'WARN', tag: 'HTTP_EXTERNAL' });
        throw new Error(errorMessage);
    }
}

/**
 * The main reliable fetch function with fallback, now passing the search limit.
 * @param {string} primaryStore - The user's selected store.
 * @param {string} query - The product search query.
 * @param {number} searchLimit - The intelligent limit from the AI.
 * @param {function} log - The orchestrator's logging function.
 * @returns {Promise<{products: Array, sourceStore: string}>} Results and the store they came from.
 */
async function fetchPriceDataWithFallback(primaryStore, query, searchLimit, log) {
    const secondaryStore = primaryStore === 'Woolworths' ? 'Coles' : 'Woolworths';

    try {
        // Attempt 1: Try the primary store with the dynamic limit
        const primaryResults = await singleStoreSearch(primaryStore, query, searchLimit, log);
        if (primaryResults.length > 0) {
            return { products: primaryResults, sourceStore: primaryStore };
        }
        log({ message: `Primary search for "${query}" at ${primaryStore} returned 0 results. Proceeding to fallback.`, tag: 'FALLBACK' });
    } catch (error) {
        log({ message: `Primary search for "${query}" failed. Triggering fallback to ${secondaryStore}.`, level: 'INFO', tag: 'FALLBACK' });
    }

    // Attempt 2: Fallback to the secondary store
    try {
        const fallbackResults = await singleStoreSearch(secondaryStore, query, searchLimit, log);
        if (fallbackResults.length > 0) {
             log({ message: `Fallback for "${query}" SUCCEEDED at ${secondaryStore}.`, level: 'SUCCESS', tag: 'FALLBACK' });
             return { products: fallbackResults, sourceStore: secondaryStore };
        }
        log({ message: `Fallback for "${query}" at ${secondaryStore} also returned 0 results.`, level: 'WARN', tag: 'FALLBACK' });
    } catch (error) {
         log({ message: `Fallback search for "${query}" at ${secondaryStore} also FAILED. No products found.`, level: 'CRITICAL', tag: 'FALLBACK' });
    }

    return { products: [], sourceStore: 'none' };
}

// Export the reliable fetching logic for the orchestrator
module.exports.fetchPriceDataWithFallback = fetchPriceDataWithFallback;


