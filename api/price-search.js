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
 * Core reusable logic for fetching price data.
 * Now accepts a 'page' argument.
 * @param {string} store - The store to search ('Coles' or 'Woolworths').
 * @param {string} query - The product search query.
 * @param {number} [page=1] - The page number to fetch.
 * @returns {Promise<Object>} A promise that resolves to the full API response (including results, total_pages, etc.).
 */
async function fetchPriceData(store, query, page = 1) {
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
    
    // Define params for the API call, including pagination
    const apiParams = {
        query,
        page: page.toString(),
        page_size: '20' // Fetch 20 items per page
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // --- Log the specific request details before execution (as requested) ---
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'INFO',
            tag: 'RAPID_REQUEST',
            message: `Attempt ${attempt + 1}/${MAX_RETRIES}: Requesting product data (Page ${page}).`,
            data: {
                store: store,
                query: query,
                page: page,
                endpoint: endpointUrl,
                host: host
            }
        }));
        
        try {
            const rapidResp = await axios.get(endpointUrl, {
                params: apiParams, // Use the new params object
                headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': host },
                timeout: 30000 
            });

            // Log successful response
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'SUCCESS',
                tag: 'RAPID_RESPONSE',
                message: `Successfully fetched products for "${query}" (Page ${page}).`,
                data: {
                    count: rapidResp.data.results ? rapidResp.data.results.length : 0,
                    status: rapidResp.status,
                    currentPage: rapidResp.data.current_page,
                    totalPages: rapidResp.data.total_pages
                }
            }));
            
            // Success: return the *full* data object
            return rapidResp.data;

        } catch (error) {
            const status = error.response?.status;
            const isRateLimitOrNetworkError = status === 429 || error.code === 'ECONNABORTED' || error.code === 'EAI_AGAIN';
            
            if (isRateLimitOrNetworkError) {
                const delayTime = DELAY_MS * Math.pow(2, attempt);
                // Log warning to Vercel console
                console.warn(`RapidAPI Execution Warning for "${query}" (Page ${page}, Attempt ${attempt + 1}/${MAX_RETRIES}): Status ${status || 'Network Error'}. Retrying in ${delayTime}ms...`);
                
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
                    page: page,
                    status: status || 504, 
                    details: error.message
                }
            }));

            // Return an error object that matches the structure of a successful response
            // This simplifies error handling in the orchestrator
            return { 
                error: { 
                    message: finalErrorMessage, 
                    status: status || 504, 
                    details: error.message 
                },
                results: [],
                total_pages: 0
            };
        }
    }
    
    // Fallback for safety
    return { 
        error: { message: `Price search failed for unknown reason after ${MAX_RETRIES} attempts.`, status: 500 },
        results: [],
        total_pages: 0
    };
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
        const { store, query, page } = req.query;
        // Pass all query params to the function
        const result = await fetchPriceData(store, query, page ? parseInt(page, 10) : 1);
        
        if (result.error) {
            return res.status(result.error.status || 500).json(result.error);
        }
        // Return the full result object
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Export the pure function for internal use by other scripts
module.exports.fetchPriceData = fetchPriceData;
