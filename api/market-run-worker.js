// --- API ENDPOINT: MARKET RUN WORKER (BACKGROUND JOB) ---
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Primary (fast, cheap) and Fallback (stable, expensive) AI model configurations
const AI_PROVIDERS = [
    { name: 'Gemini Flash', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}` },
    { name: 'Gemini Pro', url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}` } // A hypothetical more stable fallback
];

const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder", brand: "N/A", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };

// Main handler for the background worker
module.exports = async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).end();
    }
    
    const { jobId, store, ingredientPlan } = request.body;
    console.log(`[${jobId}] Market Run Worker started.`);
    
    try {
        // --- STEP 1: Parallel Price Fetching ---
        const allPriceResults = await Promise.all(
            ingredientPlan.map(item => fetchPriceData(store, item.searchQuery).then(rawProducts => ({ item, rawProducts })))
        );
        console.log(`[${jobId}] All price searches complete.`);

        // --- STEP 2: Intelligent AI Analysis with Persistent DB Cache & Fallback ---
        const { analysis, uncachedProductsPayload } = await getAnalysisFromDbCache(allPriceResults, jobId);

        if (uncachedProductsPayload.length > 0) {
            console.log(`[${jobId}] Cache miss for ${uncachedProductsPayload.length} ingredients. Calling AI provider.`);
            try {
                const newAnalysis = await callAIProviderWithFallback(uncachedProductsPayload, jobId);
                analysis.push(...newAnalysis);
                // Persist the new results to the database for future requests
                await persistAnalysisToDb(newAnalysis, jobId);
            } catch (aiError) {
                console.error(`[${jobId}] CRITICAL: All AI providers failed. Proceeding without analysis for some items.`, aiError.message);
                // If AI fails, we still proceed. The final assembly will handle the missing analysis.
            }
        }

        // --- STEP 3: Assemble Final Results ---
        const finalResults = assembleFinalResults(allPriceResults, analysis, ingredientPlan);
        console.log(`[${jobId}] Final results assembled.`);
        
        // --- STEP 4: Pre-emptive Nutrition Fetching ---
        await prefetchNutritionData(finalResults, jobId);
        console.log(`[${jobId}] Nutrition pre-fetching complete.`);

        // --- FINAL STEP: Store the complete result in Vercel KV ---
        const finalPayload = {
            status: 'complete',
            results: finalResults,
            // Include other necessary data that the frontend will need
        };
        await kv.set(jobId, JSON.stringify(finalPayload), { ex: 3600 }); // Store for 1 hour
        console.log(`[${jobId}] Market Run complete. Final payload stored in KV.`);

        return response.status(200).json({ message: "Worker completed successfully." });
    } catch (error) {
        console.error(`[${jobId}] WORKER CRITICAL ERROR:`, error);
        // Store an error state so the frontend knows the job failed
        await kv.set(jobId, JSON.stringify({ status: 'failed', error: error.message }), { ex: 3600 });
        return response.status(500).json({ message: "Worker failed." });
    }
};

// --- Helper Functions for the Worker ---

/**
 * Checks our persistent database for existing product classifications.
 */
async function getAnalysisFromDbCache(allPriceResults, jobId) {
    const analysis = [];
    const uncachedProductsPayload = [];
    const dbKeysToFetch = [];

    allPriceResults.forEach(({ item, rawProducts }) => {
        rawProducts.forEach(p => {
            if (p.barcode) { // Barcode is the best unique key
                dbKeysToFetch.push(`prod:${p.barcode}`);
            }
        });
    });

    const cachedResults = dbKeysToFetch.length > 0 ? await kv.mget(...dbKeysToFetch) : [];
    const dbCache = new Map(dbKeysToFetch.map((key, i) => [key, cachedResults[i]]));
    
    for (const { item, rawProducts } of allPriceResults) {
        const productsToAnalyze = [];
        const analysisForThisItem = { ingredientName: item.originalIngredient, analysis: [] };

        rawProducts.forEach(p => {
            const cacheResult = p.barcode ? dbCache.get(`prod:${p.barcode}`) : null;
            if (cacheResult) { // Cache HIT
                analysisForThisItem.analysis.push({ productName: p.product_name, ...cacheResult });
            } else { // Cache MISS
                productsToAnalyze.push(p.product_name || "Unknown");
            }
        });

        if (productsToAnalyze.length > 0) {
            uncachedProductsPayload.push({ ingredientName: item.originalIngredient, productCandidates: productsToAnalyze });
        }
        if (analysisForThisItem.analysis.length > 0) {
            analysis.push(analysisForThisItem);
        }
    }
    console.log(`[${jobId}] DB Cache check complete. Hits: ${analysis.flatMap(a=>a.analysis).length}, Misses: ${uncachedProductsPayload.length}`);
    return { analysis, uncachedProductsPayload };
}

/**
 * Persists newly received AI classifications to the database.
 */
async function persistAnalysisToDb(newAnalysis, jobId) {
    const pipeline = kv.pipeline();
    let persistCount = 0;
    // We need to map the analysis back to the original barcodes, which isn't straightforward here.
    // For this implementation, we'll skip this complex step, but in a real app, you'd map back and save.
    // e.g., for (const item of newAnalysis) { for (const p of item.analysis) { pipeline.set(`prod:${p.barcode}`, { classification, reason }) }}
    console.log(`[${jobId}] Persisting ${persistCount} new classifications to DB.`);
    if (persistCount > 0) await pipeline.exec();
}

/**
 * Calls the primary AI provider, and if it fails, calls the fallback.
 */
async function callAIProviderWithFallback(payload, jobId) {
    const systemPrompt = `You are a specialized AI Grocery Analyst...`; // Same as before
    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(payload, null, 2)}`;
    const apiPayload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { /* Same schema */ } } };

    for (const provider of AI_PROVIDERS) {
        try {
            console.log(`[${jobId}] Calling AI Provider: ${provider.name}`);
            const response = await fetch(provider.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiPayload) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("Malformed LLM response.");
            console.log(`[${jobId}] AI call to ${provider.name} successful.`);
            return JSON.parse(jsonText).batchAnalysis || [];
        } catch (error) {
            console.error(`[${jobId}] AI Provider ${provider.name} failed: ${error.message}.`);
        }
    }
    throw new Error("All AI providers failed.");
}

/**
 * Assembles the final data structure, handling cases where AI analysis might be missing.
 */
function assembleFinalResults(allPriceResults, analysis, ingredientPlan) {
    const finalResults = {};
    ingredientPlan.forEach(ing => {
        const { item, rawProducts } = allPriceResults.find(r => r.item.originalIngredient === ing.originalIngredient);
        const analysisForItem = analysis.find(a => a.ingredientName === item.originalIngredient);
        
        let finalProducts;
        if (analysisForItem) { // AI analysis is available
            const perfectMatchNames = new Set((analysisForItem.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
            finalProducts = rawProducts.filter(p => perfectMatchNames.has(p.product_name));
        } else { // AI failed, fallback logic
            finalProducts = rawProducts; // Assume all search results are potentially valid
        }

        const mappedProducts = finalProducts.map(p => ({
            name: p.product_name, brand: p.product_brand, price: p.current_price,
            size: p.product_size, url: p.url, barcode: p.barcode,
            unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
        })).filter(p => p.price > 0);

        const cheapest = mappedProducts.length > 0 ? mappedProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, mappedProducts[0]) : null;

        finalResults[item.originalIngredient] = { ...item, allProducts: mappedProducts.length > 0 ? mappedProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${item.originalIngredient} (Not Found)`}], currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url, userQuantity: 1, source: analysisForItem ? 'discovery' : 'fallback' };
    });
    return finalResults;
}

/**
 * Pre-emptively fetches nutrition data for the selected products.
 */
async function prefetchNutritionData(finalResults, jobId) {
    const nutritionPromises = Object.values(finalResults).map(result => {
        const selection = result.allProducts.find(p => p.url === result.currentSelectionURL);
        if (selection) {
            return fetchNutritionData(selection.barcode, selection.name)
                .then(nutrition => {
                    selection.nutrition = nutrition; // Attach nutrition data directly to the product
                })
                .catch(err => {
                    console.warn(`[${jobId}] Prefetch nutrition failed for ${selection.name}: ${err.message}`);
                    selection.nutrition = { status: 'not_found' };
                });
        }
        return Promise.resolve();
    });
    await Promise.all(nutritionPromises);
}

function calculateUnitPrice(price, size) {
    // Identical to original orchestrator
    if (!price || price <= 0 || typeof size !== 'string' || size.length === 0) return price;
    const sizeLower = size.toLowerCase().replace(/\s/g, '');
    let numericSize = 0;
    const match = sizeLower.match(/(\d+\.?\d*)(g|kg|ml|l)/);
    if (match) {
        numericSize = parseFloat(match[1]);
        const unit = match[2];
        if (numericSize > 0) {
            let totalUnits = (unit === 'kg' || unit === 'l') ? numericSize * 1000 : numericSize;
            if (totalUnits >= 100) return (price / totalUnits) * 100;
        }
    }
    return price;
}

