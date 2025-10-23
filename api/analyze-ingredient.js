// --- AI INGREDIENT ANALYSIS API ---
// This is a dedicated, lightweight endpoint for the "Substitutes" button.
// It receives one ingredient and a list of product names, and returns
// a 100% reliable, AI-vetted analysis.

const fetch = require('node-fetch');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3;

// --- HELPERS (Copied from orchestrator for resilience) ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status}. Retrying...`, 'WARN', 'HTTP');
            } else {
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status}.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
            log(`Attempt ${attempt}: Fetch failed with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
        }
        if (attempt < MAX_RETRIES) {
            const delayTime = Math.pow(2, attempt - 1) * 2000;
            await delay(delayTime);
        }
    }
    throw new Error(`API call to ${url} failed after ${MAX_RETRIES} attempts.`);
}

/**
 * Analyzes a list of product candidates for a SINGLE ingredient.
 * @param {string} ingredientName - The name of the ingredient (e.g., "Chicken Breast").
 * @param {string[]} productCandidates - An array of product names (e.g., ["Woolworths Chicken...", "Steggles Chicken..."]).
 * @param {Function} log - The logger function.
 * @returns {Promise<Object>} A promise that resolves to { ingredientName, analysis: [...] }.
 */
async function analyzeSingleIngredientProducts(ingredientName, productCandidates, log) {
    if (!productCandidates || productCandidates.length === 0) {
        log(`Skipping analysis for "${ingredientName}": no candidates.`, "INFO", 'LLM');
        return { ingredientName: ingredientName, analysis: [] };
    }
    
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    const systemPrompt = `You are a specialized AI Grocery Analyst. Your task is to determine if a given product name is a "perfect match" for a required grocery ingredient.
Classifications:
- "perfect": The product is exactly what was asked for (e.g., ingredient "Chicken Breast" and product "Woolworths RSPCA Approved Chicken Breast Fillets"). Brand names, sizes, or minor descriptors like "fresh" or "frozen" are acceptable.
- "substitute": The product is a reasonable alternative but not an exact match (e.g., ingredient "Chicken Breast" and product "Chicken Thighs").
- "irrelevant": The product is completely wrong (e.g., ingredient "Chicken Breast" and product "Beef Mince").

Analyze the following grocery item's product candidates. Provide a JSON response *as an array* of your analysis.`;
    
    const userQuery = `Analyze and classify the products for: "${ingredientName}"\nCandidates:\n${JSON.stringify(productCandidates, null, 2)}`;
    
    log(`Product Analysis LLM Prompt for "${ingredientName}"`, 'INFO', 'LLM_PROMPT');
    
    const payload = { 
        contents: [{ parts: [{ text: userQuery }] }], 
        systemInstruction: { parts: [{ text: systemPrompt }] }, 
        generationConfig: { 
            responseMimeType: "application/json", 
            responseSchema: { 
                type: "ARRAY", 
                items: { 
                    type: "OBJECT", 
                    properties: { 
                        "productName": { "type": "STRING" }, 
                        "classification": { "type": "STRING" }, 
                        "reason": { "type": "STRING" } 
                    },
                    "required": ["productName", "classification", "reason"]
                } 
            } 
        } 
    };

    const response = await fetchWithRetry(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, log);
    
    if (!response.ok) {
        const errorBody = await response.text();
        log(`Product Analysis LLM Error for "${ingredientName}": HTTP ${response.status}`, 'WARN', 'LLM', { error: errorBody });
        throw new Error(`Product Analysis LLM Error: HTTP ${response.status} after all retries. Body: ${errorBody}`);
    }
    
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!jsonText) {
        log(`LLM returned no candidate text for "${ingredientName}".`, 'CRITICAL', 'LLM', result);
        throw new Error("LLM response was empty or malformed.");
    }
    
    log(`Product Analysis LLM Raw Response for "${ingredientName}"`, 'INFO', 'LLM');
    
    try {
        const analysisArray = JSON.parse(jsonText); 
        return { ingredientName: ingredientName, analysis: analysisArray || [] };
    } catch (parseError) {
        log(`Failed to parse LLM JSON response for "${ingredientName}".`, 'CRITICAL', 'LLM', { error: parseError.message });
        throw new Error(`Failed to parse LLM JSON response: ${parseError.message}`);
    }
}

// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    // Simple logger for this lightweight endpoint
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, tag, message, data }));
    };

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP');
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { ingredientName, productCandidates } = request.body;
        if (!ingredientName || !productCandidates) {
            return response.status(400).json({ message: "Missing 'ingredientName' or 'productCandidates'" });
        }

        const analysisResult = await analyzeSingleIngredientProducts(ingredientName, productCandidates, log);
        return response.status(200).json(analysisResult);

    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack });
        return response.status(500).json({ message: "An error occurred during analysis.", error: error.message });
    }
}

