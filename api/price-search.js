const axios = require('axios');

const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;

/**
 * Core reusable logic for fetching price data.
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @returns {Promise<Array>} A promise that resolves to a maximum of 10 product results.
 */
async function fetchPriceData(store, query) {
    // Note: The maximum product candidates to return is capped at 10 for speed optimization.
    const MAX_CANDIDATES = 10;
    
    if (!RAPID_API_KEY) {
        // In a pure function, we throw the error instead of sending a response
        throw new Error('Server configuration error: API key missing.');
    }
    if (!store || !query) {
        throw new Error('Missing required parameters: store and query.');
    }
    const host = RAPID_API_HOSTS[store];
    if (!host) {
        throw new Error('Invalid store specified. Must be "Coles" or "Woolworths".');
    }

    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;

    try {
        const rapidResp = await axios.get(endpointUrl, {
            params: { query },
            headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
            // Reducing timeout to 10 seconds to fail fast and prevent Vercel timeouts.
            timeout: 10000 
        });
        
        // Filter and cap the results immediately to reduce payload size and AI workload.
        const allResults = rapidResp.data.results || [];
        return allResults.slice(0, MAX_CANDIDATES);

    } catch (error) {
        // Axios wraps the timeout error, so we log the message.
        console.error(`RapidAPI Execution Error for "${query}":`, error.message);
        // Return an empty array on failure to allow the orchestrator to continue.
        return [];
    }
}

/**
 * Vercel serverless function handler. This part is only used if the file is called
 * directly as an API endpoint, which it no longer is by the orchestrator.
 */
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }

    try {
        const { store, query } = req.query;
        const results = await fetchPriceData(store, query);
        return res.status(200).json({ results });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
};

// Export the pure function for internal use by other scripts
module.exports.fetchPriceData = fetchPriceData;

