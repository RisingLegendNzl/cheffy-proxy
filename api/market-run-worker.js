// --- API ENDPOINT: MARKET RUN WORKER (BACKGROUND JOB) - PROMPT FIXED ---
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

// --- CONFIGURATION and UTILITIES ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_PROVIDERS = [
    { name: 'Gemini Flash', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}` },
    { name: 'Gemini Pro', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}` }
];
class Logger { constructor(traceId, initialLogs = []) { this.traceId = traceId; this.logs = [...initialLogs]; } log(level, message, details = {}) { const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), level, message, traceId: this.traceId, ...details }); console.log(logEntry); this.logs.push(logEntry); } getLogs() { return this.logs; } }
const calculateUnitPrice = (price, size) => { if (!price || price <= 0 || typeof size !== 'string' || size.length === 0) return price; const sizeLower = size.toLowerCase().replace(/\s/g, ''); let numericSize = 0; const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/); if (match) { numericSize = parseFloat(match[1]); const unit = match[2]; if (numericSize > 0) { let totalUnits = (unit === 'kg' || unit === 'l') ? numericSize * 1000 : numericSize; if (totalUnits >= 100) return (price / totalUnits) * 100; } } return price; };


// --- MAIN HANDLER ---
module.exports = async function handler(request, response) {
    if (request.method !== 'POST') return response.status(405).end();
    const { jobId, store, ingredientPlan, logs: initialLogs } = request.body;
    const logger = new Logger(jobId, initialLogs);

    if (!process.env.KV_URL || !process.env.RAPIDAPI_KEY) {
        let missingVars = [];
        if (!process.env.KV_URL) missingVars.push("Vercel KV");
        if (!process.env.RAPIDAPI_KEY) missingVars.push("RapidAPI");
        const errorMessage = `Server configuration error: ${missingVars.join(' and ')} connection details are missing.`;
        logger.log('CRITICAL', errorMessage);
        await kv.set(jobId, JSON.stringify({ status: 'failed', error: errorMessage, logs: logger.getLogs() }), { ex: 3600 }).catch(console.error);
        return response.status(500).json({ message: errorMessage });
    }
    
    logger.log('INFO', 'Market Run Worker started.', { phase: 2 });
    try {
        const pricePromises = ingredientPlan.map(item => fetchPriceData(store, item.searchQuery, logger).then(rawProducts => ({ item, rawProducts })));
        const allPriceResults = await Promise.all(pricePromises);
        logger.log('INFO', 'All price searches complete.', { phase: 2, details: { ingredientsProcessed: allPriceResults.length }});

        const { analysis, uncachedProductsPayload } = await getAnalysisFromDbCache(allPriceResults, logger);
        if (uncachedProductsPayload.length > 0) {
            try {
                const newAnalysis = await callAIProviderWithFallback(uncachedProductsPayload, logger);
                analysis.push(...newAnalysis);
                await cacheAnalysisToDb(newAnalysis, logger);
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

// --- HELPER FUNCTIONS ---
async function getAnalysisFromDbCache(allPriceResults, logger) {
    const analysis = [];
    const uncachedProductsPayload = [];
    const uniqueProductCandidates = new Set();
    allPriceResults.forEach(result => {
        result.rawProducts.forEach(p => {
            if(p.barcode) uniqueProductCandidates.add(p.barcode);
        });
    });
    const cacheKeys = Array.from(uniqueProductCandidates).map(barcode => `prod-${barcode}`);
    let cachedData = {};
    if (cacheKeys.length > 0) {
        const results = await kv.mget(...cacheKeys);
        cacheKeys.forEach((key, index) => {
            if (results[index]) cachedData[key.replace('prod-', '')] = results[index];
        });
    }

    allPriceResults.forEach(result => {
        const ingredientName = result.item.originalIngredient;
        const productsWithCacheStatus = result.rawProducts.map(p => ({ ...p, isCached: !!cachedData[p.barcode] }));
        const cachedAnalysisForIngredient = productsWithCacheStatus
            .filter(p => p.isCached)
            .map(p => ({ productName: p.product_name, ...cachedData[p.barcode] }));

        if(cachedAnalysisForIngredient.length > 0) {
            analysis.push({ ingredientName, analysis: cachedAnalysisForIngredient });
        }
        
        const uncachedCandidates = productsWithCacheStatus.filter(p => !p.isCached).map(p => p.product_name);
        if (uncachedCandidates.length > 0) {
            uncachedProductsPayload.push({ ingredientName, productCandidates: uncachedCandidates });
        }
    });

    const cacheKey = `analysis-${crypto.createHash('sha256').update(JSON.stringify(allPriceResults.map(r => r.item.searchQuery).sort())).digest('hex')}`;
    logger.log('INFO', 'Persistent DB cache check complete.', { phase: 2, service: 'DB', details: { uncachedIngredientLists: uncachedProductsPayload.length, totalUniqueProducts: uniqueProductCandidates.size, cacheHits: Object.keys(cachedData).length } });
    return { analysis, uncachedProductsPayload, cacheKey };
}

async function cacheAnalysisToDb(newAnalysis, logger) {
    const pipeline = kv.pipeline();
    let itemsToCache = 0;
    newAnalysis.forEach(ingredientAnalysis => {
        ingredientAnalysis.analysis.forEach(productAnalysis => {
            // Find barcode from original data if possible to use as key
            // This part requires mapping product names back to barcodes, which is complex.
            // For now, we will skip caching new analysis to DB to keep logic simple.
        });
    });
    logger.log('INFO', 'Skipping caching new analysis to DB in this version.', { phase: 2, service: 'DB' });
}


async function callAIProviderWithFallback(payload, logger) {
    // --- PROMPT ENGINEERING FIX ---
    const systemPrompt = `You are a strict, expert-level AI Grocery Analyst. Your mission is to find the best product from a list of noisy, often inaccurate search results from a basic grocery store search engine. Be very critical.
RULES:
1.  Classify each product as "perfect", "substitute", or "irrelevant".
2.  A "perfect" match must be the core ingredient itself. For the ingredient "Rolled Oats", only a product named "Rolled Oats" is perfect. A product like "Oat Milk" is IRRELEVANT. For "Chicken Breast", a product like "Chicken Thighs" is a SUBSTITUTE, not perfect.
3.  If NONE of the product candidates are a good match for the ingredient, you MUST classify ALL of them as "irrelevant". It is critical that you do not force a bad match.
4.  Provide a brief reason for your classification.`;
    // --- END FIX ---

    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(payload, null, 2)}`;
    const apiPayload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING" }, "reason": { "type": "STRING" } } } } } } } } }
        }
    };
    logger.log('INFO', 'Sending single batch for AI product analysis.', { phase: 2, service: 'AIClient', prompt: userQuery });
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
            logger.log('WARN', `AI Provider ${provider.name} failed. Moving to fallback.`, { phase: 2, service: 'AIClient', error: error.message });
        }
    }
    throw new Error("All AI providers failed. Unable to analyze products.");
}

function assembleFinalResults(allPriceResults, analysis, ingredientPlan, logger) {
    logger.log('INFO', 'Assembling final results with AI analysis.', { phase: 2 });
    const finalResults = {};
    const analysisMap = new Map(analysis.map(a => [a.ingredientName, new Map(a.analysis.map(p => [p.productName, p.classification]))]));

    ingredientPlan.forEach(ing => {
        const ingredientKey = ing.originalIngredient;
        const result = allPriceResults.find(r => r.item.originalIngredient === ingredientKey);
        if (!result) {
            finalResults[ingredientKey] = { ...ing, allProducts: [], source: 'failed' };
            return;
        }

        const ingredientAnalysis = analysisMap.get(ingredientKey);
        const perfectMatchProducts = result.rawProducts.filter(p => ingredientAnalysis?.get(p.product_name) === 'perfect');

        const finalProducts = (perfectMatchProducts.length > 0 ? perfectMatchProducts : result.rawProducts)
            .map(p => ({
                name: p.product_name,
                brand: p.product_brand,
                price: p.current_price,
                size: p.product_size,
                url: p.url,
                barcode: p.barcode,
                unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
            }))
            .filter(p => p.price > 0 && p.unit_price_per_100 > 0);

        if (finalProducts.length === 0) {
            finalResults[ingredientKey] = { ...ing, allProducts: [{ name: `${ingredientKey} (Not Found)` }], source: 'failed', userQuantity: 1 };
            return;
        }

        const cheapest = finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]);
        finalResults[ingredientKey] = {
            ...ing,
            allProducts: finalProducts,
            currentSelectionURL: cheapest.url,
            userQuantity: 1,
            source: perfectMatchProducts.length > 0 ? 'discovery' : 'fallback'
        };
    });
    return finalResults;
}

async function prefetchNutritionData(finalResults, logger) {
    logger.log('INFO', 'Pre-fetching nutrition data for selected products.', { phase: 2, service: 'NutritionAPI' });
    const nutritionPromises = Object.values(finalResults).map(async (result) => {
        const selection = result.allProducts.find(p => p.url === result.currentSelectionURL);
        if (selection) {
            selection.nutrition = await fetchNutritionData(selection.barcode, selection.name);
        }
    });
    await Promise.all(nutritionPromises);
}


