const axios = require('axios');

const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;

// --- CONFIGURATION FOR RETRY ---
const MAX_RETRIES = 5;
const DELAY_MS = 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Core reusable logic for fetching price data. This function is "pure"
 * and does not depend on Vercel's request/response objects.
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @returns {Promise<Array>} A promise that resolves to an array of product results.
 */
async function fetchPriceData(store, query) {
    if (!RAPID_API_KEY) {
        console.error('Configuration Error: RAPIDAPI_KEY is not set.');
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
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const rapidResp = await axios.get(endpointUrl, {
                params: { query },
                headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
                // Increased timeout from 15 to 30 seconds for better reliability
                timeout: 30000 
            });
            // Success: return results
            return rapidResp.data.results || [];

        } catch (error) {
            // Axios wraps the native error, check for response status
            const status = error.response?.status;
            
            if (status === 429 || error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN') {
                const delayTime = DELAY_MS * Math.pow(2, attempt); // Exponential backoff
                console.warn(`RapidAPI Execution Warning for "${query}" (Attempt ${attempt + 1}/${MAX_RETRIES}): Status ${status || 'Network Error'}. Retrying in ${delayTime}ms...`);
                
                if (attempt < MAX_RETRIES - 1) {
                    await delay(delayTime);
                    continue; // Continue to the next attempt
                }
            }
            
            // Log the final failure and exit the loop/function
            console.error(`RapidAPI Execution Error for "${query}" after ${MAX_RETRIES} attempts:`, error.message);
            // Return an empty array on final failure to allow the orchestrator to continue.
            return [];
        }
    }
    
    // Should be unreachable if the final catch/return is correct, but added for safety
    return [];
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