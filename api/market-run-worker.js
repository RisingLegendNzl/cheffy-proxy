// --- API ENDPOINT: MARKET RUN WORKER (BACKGROUND JOB) - FIXED ---
const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

// --- CONFIGURATION and UTILITIES (Logger, AI Providers etc.) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_PROVIDERS = [
    { name: 'Gemini Flash', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}` },
    { name: 'Gemini Pro', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}` }
];
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder", brand: "N/A", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };

class Logger { /* Identical to blueprint logger */ constructor(traceId, initialLogs = []) { this.traceId = traceId; this.logs = [...initialLogs]; } log(level, message, details = {}) { const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), level, message, traceId: this.traceId, ...details }); console.log(logEntry); this.logs.push(logEntry); } getLogs() { return this.logs; } }

// Main handler for the background worker
module.exports = async function handler(request, response) {
    const { kv } = await import('@vercel/kv');

    if (request.method !== 'POST') return response.status(405).end();
    
    const { jobId, store, ingredientPlan, logs: initialLogs } = request.body;
    const logger = new Logger(jobId, initialLogs);
    
    logger.log('INFO', 'Market Run Worker started.', { phase: 2 });
    
    try {
        const allPriceResults = await Promise.all(
            ingredientPlan.map(item => fetchPriceData(store, item.searchQuery).then(rawProducts => ({ item, rawProducts })))
        );
        logger.log('INFO', 'All price searches complete.', { phase: 2 });

        const { analysis, uncachedProductsPayload } = await getAnalysisFromDbCache(allPriceResults, logger);
        if (uncachedProductsPayload.length > 0) {
            try {
                const newAnalysis = await callAIProviderWithFallback(uncachedProductsPayload, logger);
                analysis.push(...newAnalysis);
                // persistAnalysisToDb(newAnalysis, logger); // In a real app, this would be implemented
            } catch (aiError) {
                logger.log('WARN', 'All AI providers failed. Proceeding with fallback logic.', { phase: 2, error: aiError.message });
            }
        }

        const finalResults = assembleFinalResults(allPriceResults, analysis, ingredientPlan, logger);
        logger.log('INFO', 'Final results assembled.', { phase: 2 });
        
        await prefetchNutritionData(finalResults, logger);
        logger.log('INFO', 'Nutrition pre-fetching complete.', { phase: 2 });

        const finalPayload = {
            status: 'complete',
            results: finalResults,
            logs: logger.getLogs() // Include the complete, aggregated logs
        };
        await kv.set(jobId, JSON.stringify(finalPayload), { ex: 3600 });
        logger.log('INFO', 'Market Run complete. Final payload stored in KV.', { phase: 2 });

        return response.status(200).json({ message: "Worker completed successfully." });
    } catch (error) {
        logger.log('CRITICAL', `Worker failed with an unrecoverable error.`, { error: error.message, stack: error.stack });
        await kv.set(jobId, JSON.stringify({ status: 'failed', error: error.message, logs: logger.getLogs() }), { ex: 3600 });
        return response.status(500).json({ message: "Worker failed." });
    }
};

// --- Worker Helper Functions ---

async function getAnalysisFromDbCache(allPriceResults, logger) {
    // ... Functionality is the same, but now uses the logger instance ...
    logger.log('INFO', 'Checking persistent DB for product classifications.', { phase: 2, service: 'DB' });
    const analysis = [];
    const uncachedProductsPayload = [];
    // ... rest of the logic
    logger.log('INFO', `DB Cache check complete.`, { phase: 2, service: 'DB', details: { uncachedCount: uncachedProductsPayload.length } });
    return { analysis, uncachedProductsPayload };
}

async function callAIProviderWithFallback(payload, logger) {
    const systemPrompt = `You are a specialized AI Grocery Analyst...`; // Omitted
    const userQuery = `Analyze and classify...\n${JSON.stringify(payload, null, 2)}`;
    const apiPayload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { /* Same */ } } };

    for (const provider of AI_PROVIDERS) {
        try {
            logger.log('INFO', `Calling AI Provider: ${provider.name}`, { phase: 2, service: 'AIClient' });
            const response = await fetch(provider.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiPayload) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("Malformed LLM response.");
            logger.log('INFO', `AI call to ${provider.name} successful.`, { phase: 2, service: 'AIClient' });
            return JSON.parse(jsonText).batchAnalysis || [];
        } catch (error) {
            logger.log('WARN', `AI Provider ${provider.name} failed.`, { phase: 2, service: 'AIClient', error: error.message });
        }
    }
    throw new Error("All AI providers failed.");
}

function assembleFinalResults(allPriceResults, analysis, ingredientPlan, logger) {
    // ... Functionality is the same, but now uses the logger instance ...
    logger.log('INFO', 'Assembling final product list from market and AI data.', { phase: 2 });
    const finalResults = {};
    // ... rest of the logic
    return finalResults;
}

async function prefetchNutritionData(finalResults, logger) {
    logger.log('INFO', 'Pre-fetching nutrition data for selected products.', { phase: 2, service: 'NutritionAPI' });
    const nutritionPromises = Object.values(finalResults).map(result => {
        // ... same logic
    });
    await Promise.all(nutritionPromises);
}
// Other helpers like calculateUnitPrice are omitted for brevity but are present

