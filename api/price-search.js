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
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @param {function} log - The logging function from the orchestrator.
 * @returns {Promise<Array>} A promise that resolves to an array of product results.
 */
async function singleStoreSearch(store, query, log) {
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
        // Limit to top 10 results for speed and efficiency
        const results = rapidResp.data.results || [];
        return results.slice(0, 10);
    } catch (error) {
        // Log the specific error but re-throw it so the fallback can be triggered.
        const errorMessage = `RapidAPI Execution Error for "${query}" at ${store}: ${error.message}`;
        log({ message: errorMessage, level: 'WARN', tag: 'HTTP_EXTERNAL' });
        throw new Error(errorMessage); // Re-throw to signal failure
    }
}

/**
 * The main reliable fetch function with a built-in fallback mechanism.
 * @param {string} primaryStore - The user's selected store.
 * @param {string} query - The product search query.
 * @param {function} log - The orchestrator's logging function.
 * @returns {Promise<{products: Array, sourceStore: string}>} Results and the store they came from.
 */
async function fetchPriceDataWithFallback(primaryStore, query, log) {
    const secondaryStore = primaryStore === 'Woolworths' ? 'Coles' : 'Woolworths';

    try {
        // --- Attempt 1: Try the primary store ---
        const primaryResults = await singleStoreSearch(primaryStore, query, log);
        if (primaryResults.length > 0) {
            return { products: primaryResults, sourceStore: primaryStore };
        }
        // If no results, log it and proceed to fallback.
        log({ message: `Primary search for "${query}" at ${primaryStore} returned 0 results. Proceeding to fallback.`, tag: 'FALLBACK' });
    } catch (error) {
        // This block catches timeouts or other critical errors from the primary search.
        log({ message: `Primary search for "${query}" failed. Triggering fallback to ${secondaryStore}.`, level: 'INFO', tag: 'FALLBACK' });
    }

    // --- Attempt 2: Fallback to the secondary store ---
    try {
        const fallbackResults = await singleStoreSearch(secondaryStore, query, log);
        if (fallbackResults.length > 0) {
             log({ message: `Fallback for "${query}" SUCCEEDED at ${secondaryStore}.`, level: 'SUCCESS', tag: 'FALLBACK' });
             return { products: fallbackResults, sourceStore: secondaryStore };
        }
        log({ message: `Fallback for "${query}" at ${secondaryStore} also returned 0 results.`, level: 'WARN', tag: 'FALLBACK' });
    } catch (error) {
         log({ message: `Fallback search for "${query}" at ${secondaryStore} also FAILED. No products found.`, level: 'CRITICAL', tag: 'FALLBACK' });
    }

    // If both attempts fail, return an empty array.
    return { products: [], sourceStore: 'none' };
}

// Export the reliable fetching logic for the orchestrator
module.exports.fetchPriceDataWithFallback = fetchPriceDataWithFallback;

