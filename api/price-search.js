const axios = require('axios');

const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;

/**
 * Core reusable logic for fetching price data, now with structured logging.
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @param {Logger} logger - The structured logger instance.
 * @returns {Promise<Array>} A promise that resolves to an array of product results.
 */
async function fetchPriceData(store, query, logger) {
    const host = RAPID_API_HOSTS[store];
    if (!host) {
        // This case should be caught by the worker's safeguard, but we log just in case.
        logger.log('CRITICAL', 'Invalid store specified in fetchPriceData.', { store });
        return [];
    }

    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;

    try {
        const rapidResp = await axios.get(endpointUrl, {
            params: { query },
            headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
            timeout: 15000
        });
        return rapidResp.data.results || [];
    } catch (error) {
        // --- FIX: Log the actual error instead of failing silently ---
        const errorDetails = {
            query,
            store,
            message: error.message,
            statusCode: error.response?.status, // e.g., 401, 403, 429
            data: error.response?.data, // The API might return a useful error message
        };
        logger.log('WARN', 'RapidAPI price search failed for an ingredient.', errorDetails);
        // --- END FIX ---
        
        // Return an empty array on failure to allow the orchestrator to continue.
        return [];
    }
}

// Export the pure function for internal use by other scripts
module.exports.fetchPriceData = fetchPriceData;

