const axios = require('axios');

const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;

/**
 * Core logic for fetching price data from a SINGLE store.
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @returns {Promise<Array>} A promise that resolves to an array of product results.
 */
async function fetchPriceData(store, query) {
    if (!RAPID_API_KEY) {
        console.error('Configuration Error: RAPIDAPI_KEY is not set.');
        throw new Error('Server configuration error: API key missing.');
    }
    if (!store || !query) {
        throw new Error('Missing required parameters: store and query.');
    }
    const host = RAPID_API_HOSTS[store];
    if (!host) {
        throw new Error(`Invalid store specified: ${store}. Must be "Coles" or "Woolworths".`);
    }

    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;

    try {
        const rapidResp = await axios.get(endpointUrl, {
            params: { query },
            headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
            timeout: 10000 // Strict 10-second timeout
        });
        // Limit to 10 candidates for performance
        const results = rapidResp.data.results || [];
        return results.slice(0, 10);
    } catch (error) {
        console.error(`RapidAPI Execution Error for "${query}" at ${store}:`, error.message);
        return []; // Return an empty array on failure to trigger fallback
    }
}

/**
 * NEW: Fetches price data with an automatic fallback to a secondary store.
 * @param {string} primaryStore - The user's selected store.
 * @param {string} query - The product search query.
 * @returns {Promise<Array>} A promise that resolves to an array of product results.
 */
async function fetchPriceDataWithFallback(primaryStore, query) {
    console.log(`[Fallback Logic] Trying primary store ${primaryStore} for "${query}"...`);
    const primaryResults = await fetchPriceData(primaryStore, query);

    if (primaryResults && primaryResults.length > 0) {
        console.log(`[Fallback Logic] Success at primary store ${primaryStore} for "${query}".`);
        return primaryResults;
    }

    const secondaryStore = primaryStore === 'Woolworths' ? 'Coles' : 'Woolworths';
    console.log(`[Fallback Logic] Primary store failed for "${query}". Falling back to ${secondaryStore}...`);
    
    const secondaryResults = await fetchPriceData(secondaryStore, query);
    if (secondaryResults && secondaryResults.length > 0) {
        console.log(`[Fallback Logic] Success at fallback store ${secondaryStore} for "${query}".`);
    } else {
        console.log(`[Fallback Logic] Fallback store ${secondaryStore} also failed for "${query}".`);
    }

    return secondaryResults;
}


/**
 * Vercel serverless function handler (for direct testing).
 */
async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).send();

    try {
        const { store, query } = req.query;
        // Use the new fallback logic for direct tests as well
        const results = await fetchPriceDataWithFallback(store, query);
        return res.status(200).json({ results });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
};

module.exports = handler;
module.exports.fetchPriceData = fetchPriceData;
module.exports.fetchPriceDataWithFallback = fetchPriceDataWithFallback;


