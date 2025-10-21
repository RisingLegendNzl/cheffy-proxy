// --- RAPIDAPI PRICE PROXY ---
const axios = require('axios');

// --- CONFIGURATION ---
const RAPID_API_HOSTS = {
    Coles: 'coles-product-price-api.p.rapidapi.com',
    Woolworths: 'woolworths-products-api.p.rapidapi.com'
};
const RAPID_API_KEY = process.env.RAPIDAPI_KEY; // Your RapidAPI key

// --- MAIN HANDLER ---
module.exports = async (req, res) => {
    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle pre-flight CORS requests
    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }

    // Validate environment configuration
    if (!RAPID_API_KEY) {
        console.error('Configuration Error: RAPIDAPI_KEY environment variable is not set.');
        return res.status(500).json({ error: 'Server configuration error: API key missing.' });
    }

    const { store, query } = req.query;

    // Validate incoming request parameters
    if (!store || !query) {
        return res.status(400).json({ error: 'Missing required parameters: store and query.' });
    }

    const host = RAPID_API_HOSTS[store];
    if (!host) {
        return res.status(400).json({ error: 'Invalid store specified. Must be "Coles" or "Woolworths".' });
    }

    // Construct the external API URL
    const endpointUrl = `https://${host}/${store.toLowerCase()}/product-search/`;

    try {
        const rapidResp = await axios.get(endpointUrl, {
            params: { query },
            headers: {
                'x-rapidapi-key': RAPID_API_KEY,
                'x-rapidapi-host': host
            },
            timeout: 15000 // 15-second timeout
        });

        // Proxy the successful response back to the client
        return res.status(200).json(rapidResp.data);

    } catch (error) {
        console.error('RapidAPI Proxy Execution Error:', error.message);
        const statusCode = error.response ? error.response.status : 503;
        const errorMessage = error.response ? error.response.data : 'External API is unavailable or timed out.';
        return res.status(statusCode).json({ error: 'Proxy failed to execute external API call.', details: errorMessage });
    }
};

