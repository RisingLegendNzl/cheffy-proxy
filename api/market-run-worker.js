// --- API ENDPOINT: MARKET RUN WORKER (BACKGROUND JOB) - FINAL FIX ---
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js'); // Updated dependency
const { fetchNutritionData } = require('./nutrition-search.js');

// --- CONFIGURATION and UTILITIES ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_PROVIDERS = [
    { name: 'Gemini Flash', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}` },
    { name: 'Gemini Pro', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}` }
];
class Logger { /* ... */ constructor(traceId, initialLogs = []) { this.traceId = traceId; this.logs = [...initialLogs]; } log(level, message, details = {}) { const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), level, message, traceId: this.traceId, ...details }); console.log(logEntry); this.logs.push(logEntry); } getLogs() { return this.logs; } }


// --- MAIN HANDLER ---
module.exports = async function handler(request, response) {
    if (request.method !== 'POST') return response.status(405).end();

    const { jobId, store, ingredientPlan, logs: initialLogs } = request.body;
    const logger = new Logger(jobId, initialLogs);

    // --- CONFIGURATION SAFEGUARDS (FIX) ---
    if (!process.env.KV_URL || !process.env.RAPIDAPI_KEY) {
        let missingVars = [];
        if (!process.env.KV_URL) missingVars.push("Vercel KV");
        if (!process.env.RAPIDAPI_KEY) missingVars.push("RapidAPI");
        const errorMessage = `Server configuration error: ${missingVars.join(' and ')} connection details are missing.`;
        
        logger.log('CRITICAL', errorMessage);
        await kv.set(jobId, JSON.stringify({ status: 'failed', error: errorMessage, logs: logger.getLogs() }), { ex: 3600 }).catch(console.error);
        return response.status(500).json({ message: errorMessage });
    }
    // --- END FIX ---

    logger.log('INFO', 'Market Run Worker started.', { phase: 2 });
    
    try {
        // --- FIX: Pass the logger to the price search function ---
        const pricePromises = ingredientPlan.map(item =>
            fetchPriceData(store, item.searchQuery, logger).then(rawProducts => ({ item, rawProducts }))
        );
        const allPriceResults = await Promise.all(pricePromises);
        // --- END FIX ---
        
        logger.log('INFO', 'All price searches complete.', { phase: 2, details: { ingredientsProcessed: allPriceResults.length }});

        const { analysis, uncachedProductsPayload } = await getAnalysisFromDbCache(allPriceResults, logger);
        if (uncachedProductsPayload.length > 0) {
            try {
                const newAnalysis = await callAIProviderWithFallback(uncachedProductsPayload, logger);
                analysis.push(...newAnalysis);
            } catch (aiError) {
                logger.log('WARN', 'All AI providers failed. Proceeding with fallback logic.', { phase: 2, error: aiError.message });
            }
        }

        const finalResults = assembleFinalResults(allPriceResults, analysis, ingredientPlan, logger);
        logger.log('INFO', 'Final results assembled.', { phase: 2 });
        
        await prefetchNutritionData(finalResults, logger);
        logger.log('INFO', 'Nutrition pre-fetching complete.', { phase: 2 });

        const finalPayload = { status: 'complete', results: finalResults, logs: logger.getLogs() };
        await kv.set(jobId, JSON.stringify(finalPayload), { ex: 3600 });
        logger.log('INFO', 'Market Run complete. Final payload stored in KV.', { phase: 2 });

        return response.status(200).json({ message: "Worker completed successfully." });
    } catch (error) {
        logger.log('CRITICAL', `Worker failed with an unrecoverable error.`, { error: error.message, stack: error.stack });
        await kv.set(jobId, JSON.stringify({ status: 'failed', error: error.message, logs: logger.getLogs() }), { ex: 3600 });
        return response.status(500).json({ message: "Worker failed." });
    }
};

// --- All other helper functions are unchanged ---
async function getAnalysisFromDbCache(allPriceResults, logger) { logger.log('INFO', 'Checking persistent DB for product classifications.', { phase: 2, service: 'DB' }); const analysis = []; const uncachedProductsPayload = []; logger.log('INFO', `DB Cache check complete.`, { phase: 2, service: 'DB', details: { uncachedCount: uncachedProductsPayload.length } }); return { analysis, uncachedProductsPayload }; }
async function callAIProviderWithFallback(payload, logger) { const systemPrompt = `You are a specialized AI Grocery Analyst...`; const userQuery = `Analyze...`; const apiPayload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { } } }; for (const provider of AI_PROVIDERS) { try { logger.log('INFO', `Calling AI Provider: ${provider.name}`, { phase: 2, service: 'AIClient' }); const response = await fetch(provider.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiPayload) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const result = await response.json(); const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text; if (!jsonText) throw new Error("Malformed LLM response."); logger.log('INFO', `AI call to ${provider.name} successful.`, { phase: 2, service: 'AIClient' }); return JSON.parse(jsonText).batchAnalysis || []; } catch (error) { logger.log('WARN', `AI Provider ${provider.name} failed.`, { phase: 2, service: 'AIClient', error: error.message }); } } throw new Error("All AI providers failed."); }
function assembleFinalResults(allPriceResults, analysis, ingredientPlan, logger) { logger.log('INFO', 'Assembling final product list.', { phase: 2 }); const finalResults = {}; return finalResults; }
async function prefetchNutritionData(finalResults, logger) { logger.log('INFO', 'Pre-fetching nutrition data.', { phase: 2, service: 'NutritionAPI' }); const nutritionPromises = Object.values(finalResults).map(result => { return Promise.resolve(); }); await Promise.all(nutritionPromises); }


