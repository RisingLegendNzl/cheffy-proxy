const axios = require('axios');

const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;

// --- CONFIGURATION FOR RETRY ---
const MAX_RETRIES = 5;
const DELAY_MS = 2000; // Increased base delay to 2 seconds for more aggressive backoff
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Core reusable logic for fetching price data. This function is "pure"
 * and does not depend on Vercel's request/response objects.
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @returns {Promise<Object>} A promise that resolves to an object containing either 'results' (Array) or 'error' (Object).
 */
async function fetchPriceData(store, query) {
    if (!RAPID_API_KEY) {
        console.error('Configuration Error: RAPIDAPI_KEY is not set.');
        return { error: { message: 'Server configuration error: API key missing.', status: 500 } };
    }
    if (!store || !query) {
        return { error: { message: 'Missing required parameters: store and query.', status: 400 } };
    }
    const host = RAPID_API_HOSTS[store];
    if (!host) {
        return { error: { message: 'Invalid store specified. Must be "Coles" or "Woolworths".', status: 400 } };
    }

    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // --- Log the specific request details before execution (as requested) ---
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'INFO',
            tag: 'RAPID_REQUEST',
            message: `Attempt ${attempt + 1}/${MAX_RETRIES}: Requesting product data.`,
            data: {
                store: store,
                query: query,
                endpoint: endpointUrl,
                host: host
            }
        }));
        
        try {
            const rapidResp = await axios.get(endpointUrl, {
                params: { query },
                headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
                timeout: 30000 
            });

            // Log successful response
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'SUCCESS',
                tag: 'RAPID_RESPONSE',
                message: `Successfully fetched products for "${query}".`,
                data: {
                    count: rapidResp.data.results ? rapidResp.data.results.length : 0,
                    status: rapidResp.status
                }
            }));
            
            // Success: return results
            return { results: rapidResp.data.results || [] };

        } catch (error) {
            const status = error.response?.status;
            const isRateLimitOrNetworkError = status === 429 || error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN';
            
            if (isRateLimitOrNetworkError) {
                const delayTime = DELAY_MS * Math.pow(2, attempt);
                // Log warning to Vercel console
                console.warn(`RapidAPI Execution Warning for "${query}" (Attempt ${attempt + 1}/${MAX_RETRIES}): Status ${status || 'Network Error'}. Retrying in ${delayTime}ms...`);
                
                if (attempt < MAX_RETRIES - 1) {
                    await delay(delayTime);
                    continue; 
                }
            }
            
            // Final failure: return structured error object
            const finalErrorMessage = `Request failed after ${MAX_RETRIES} attempts. Status: ${status || 'Network/Timeout'}.`;
            
            // Log final failure to Vercel console
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'CRITICAL',
                tag: 'RAPID_FAILURE',
                message: finalErrorMessage,
                data: {
                    store: store,
                    query: query,
                    status: status || 504, 
                    details: error.message
                }
            }));

            return { 
                error: { 
                    message: finalErrorMessage, 
                    status: status || 504, 
                    details: error.message 
                } 
            };
        }
    }
    
    // Fallback for safety
    return { error: { message: `Price search failed for unknown reason after ${MAX_RETRIES} attempts.`, status: 500 } };
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
        const result = await fetchPriceData(store, query);
        if (result.error) {
            return res.status(result.error.status || 500).json(result.error);
        }
        return res.status(200).json({ results: result.results });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Export the pure function for internal use by other scripts
module.exports.fetchPriceData = fetchPriceData;
