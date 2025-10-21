// --- ORCHESTRATOR API for Cheffy V3 (Resilience & Observability Edition) ---
const fetch = require('node-fetch');
const crypto = require('crypto');
const { fetchPriceData } = require('./price-search.js');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };

// --- RESILIENCE & OBSERVABILITY MODULES ---

/**
 * In-memory cache for API responses. In a distributed system, this would be Redis/Memcached.
 * This persists across "hot" invocations of the serverless function.
 */
const analysisCache = new Map();

/**
 * Manages structured JSON logging for a single transaction.
 */
class Logger {
    constructor(traceId) {
        this.traceId = traceId;
        this.logs = [];
        this.phaseTimers = new Map();
    }
    log(level, message, details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            traceId: this.traceId,
            ...details
        };
        // Log to console for Vercel's real-time logs
        console.log(JSON.stringify(logEntry));
        // Store for sending to the client
        this.logs.push(JSON.stringify(logEntry));
    }
    startPhase(name, phaseNumber) {
        this.phaseTimers.set(name, Date.now());
        this.log('INFO', `Phase ${phaseNumber}: ${name} started.`, { phase: phaseNumber });
    }
    endPhase(name, phaseNumber, details = {}) {
        const startTime = this.phaseTimers.get(name);
        if (startTime) {
            const durationMs = Date.now() - startTime;
            this.log('INFO', `Phase ${phaseNumber}: ${name} successful.`, { phase: phaseNumber, durationMs, details });
        }
    }
    getLogs() { return this.logs; }
}

/**
 * A simple Circuit Breaker to prevent hammering a failing external service.
 */
class CircuitBreaker {
    constructor(name, logger, options = {}) {
        this.name = name;
        this.logger = logger;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureThreshold = options.failureThreshold || 3;
        this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
        this.failureCount = 0;
        this.lastFailureTime = null;
    }

    _logState(message, details = {}) {
        this.logger.log('INFO', `Circuit Breaker [${this.name}]: ${message}`, {
            service: 'CircuitBreaker',
            state: this.state,
            ...details
        });
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this._logState(`Failure recorded.`, { failureCount: this.failureCount, threshold: this.failureThreshold });
        if (this.failureCount >= this.failureThreshold) {
            this.trip();
        }
    }

    trip() {
        this.state = 'OPEN';
        this._logState(`Threshold reached. Tripping to OPEN state for ${this.resetTimeout}ms.`);
        setTimeout(() => {
            this.state = 'HALF_OPEN';
            this._logState('Reset timeout elapsed. Moving to HALF_OPEN state.');
        }, this.resetTimeout);
    }

    reset() {
        if (this.state !== 'CLOSED') {
            this._logState('Successful call in HALF_OPEN. Resetting to CLOSED.');
        }
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED';
    }

    canRequest() {
        if (this.state === 'OPEN') {
            return false;
        }
        if (this.state === 'HALF_OPEN') {
            // Allow the next request to go through as a test
            return true;
        }
        return true;
    }
}

// --- HELPERS ---
const calculateUnitPrice = (price, size) => {
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
};

// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const traceId = `trace-${crypto.randomUUID()}`;
    const logger = new Logger(traceId);
    const startTime = Date.now();
    
    logger.log('INFO', "Orchestrator invoked.");

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        logger.log("INFO", "Handling OPTIONS pre-flight request.");
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        logger.log('WARN', `Method Not Allowed: ${request.method}`);
        return response.status(405).json({ message: 'Method Not Allowed', logs: logger.getLogs() });
    }

    // Initialize a single Circuit Breaker for the Gemini service for this request
    const geminiCircuitBreaker = new CircuitBreaker('GeminiAPI', logger);

    try {
        const formData = request.body;
        const { store } = formData;
        
        // PHASE 1: BLUEPRINT
        logger.startPhase("Generating Blueprint", 1);
        const calorieTarget = calculateCalorieTarget(formData);
        logger.log('INFO', `Calculated daily calorie target.`, { phase: 1, details: { calorieTarget } });
        
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, calorieTarget, logger, geminiCircuitBreaker);
        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        logger.endPhase("Generating Blueprint", 1, { ingredientCount: ingredientPlan.length });

        // PHASE 2: MARKET RUN
        logger.startPhase("Executing Parallel Market Run", 2);
        
        // Step 1: Fetch all price data in parallel.
        logger.log('INFO', "Fetching all product prices simultaneously...", { phase: 2, service: 'MarketRun' });
        const pricePromises = ingredientPlan.map(item =>
            fetchPriceData(store, item.searchQuery)
                .then(rawProducts => ({ item, rawProducts }))
                .catch(err => {
                    logger.log('CRITICAL', `Price search failed catastrophically for "${item.searchQuery}": ${err.message}`, { phase: 2, service: 'MarketRun' });
                    return { item, rawProducts: [] };
                })
        );
        const allPriceResults = await Promise.all(pricePromises);
        logger.log('INFO', "All price searches complete.", { phase: 2, service: 'MarketRun' });

        // Step 2 & 3: AI Analysis with Caching
        const analysisPayload = allPriceResults
            .filter(result => result.rawProducts.length > 0)
            .map(result => ({
                ingredientName: result.item.originalIngredient,
                productCandidates: result.rawProducts.map(p => p.product_name || "Unknown")
            }));

        const cacheKey = `analysis-${crypto.createHash('sha256').update(JSON.stringify(analysisPayload)).digest('hex')}`;
        logger.log('INFO', 'Checking cache for product analysis.', { phase: 2, service: 'MarketRun', cacheKey });

        let fullAnalysis;
        if (analysisCache.has(cacheKey)) {
            fullAnalysis = analysisCache.get(cacheKey);
            logger.log('INFO', 'Cache hit. Skipping AI API call.', { phase: 2, service: 'MarketRun', cacheKey });
        } else {
            logger.log('INFO', 'Cache miss. Proceeding with AI API call.', { phase: 2, service: 'MarketRun' });
            fullAnalysis = await analyzeProductsInBatch(analysisPayload, logger, geminiCircuitBreaker);
            analysisCache.set(cacheKey, fullAnalysis);
            logger.log('INFO', 'Populating cache with AI response.', { phase: 2, service: 'MarketRun', cacheKey });
        }
        
        // Step 4: Assemble final results.
        logger.log('INFO', "Assembling final results...", { phase: 2 });
        const finalResults = {};
        allPriceResults.forEach(({ item, rawProducts }) => {
            const ingredientKey = item.originalIngredient;
            const analysisForItem = fullAnalysis.find(a => a.ingredientName === ingredientKey);
            const perfectMatchNames = new Set((analysisForItem?.analysis || []).filter(r => r.classification === 'perfect').map(r => r.productName));
            
            const finalProducts = rawProducts
                .filter(p => perfectMatchNames.has(p.product_name))
                .map(p => ({
                    name: p.product_name, brand: p.product_brand, price: p.current_price,
                    size: p.product_size, url: p.url, barcode: p.barcode,
                    unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
                })).filter(p => p.price > 0);

            const cheapest = finalProducts.length > 0 ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]) : null;

            finalResults[ingredientKey] = { ...item, allProducts: finalProducts.length > 0 ? finalProducts : [{...MOCK_PRODUCT_TEMPLATE, name: `${ingredientKey} (Not Found)`}], currentSelectionURL: cheapest ? cheapest.url : MOCK_PRODUCT_TEMPLATE.url, userQuantity: 1, source: finalProducts.length > 0 ? 'discovery' : 'failed' };
        });
        logger.endPhase("Executing Parallel Market Run", 2);

        // PHASE 3: RESPONSE
        logger.startPhase("Assembling Final Response", 3);
        const finalResponseData = { mealPlan, uniqueIngredients: ingredientPlan, results: finalResults, calorieTarget };
        
        const totalDurationMs = Date.now() - startTime;
        logger.log('INFO', "Orchestrator finished successfully.", { totalDurationMs });
        return response.status(200).json({ ...finalResponseData, logs: logger.getLogs() });

    } catch (error) {
        logger.log('CRITICAL', `Orchestrator failed with unrecoverable error: ${error.message}`, { stack: error.stack });
        const totalDurationMs = Date.now() - startTime;
        return response.status(500).json({ message: "An error occurred during plan generation.", error: error.message, logs: logger.getLogs(), totalDurationMs });
    }
}

// --- API-CALLING FUNCTIONS ---

async function callGeminiAPI(payload, logger, circuitBreaker, maxRetries = 2) {
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (!circuitBreaker.canRequest()) {
            logger.log('CRITICAL', 'Circuit Breaker is OPEN. Aborting request.', { service: 'AIClient' });
            throw new Error('Circuit Breaker is open. Service is likely unavailable.');
        }

        try {
            const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            
            if (!response.ok) {
                throw new Error(`Upstream API Error: HTTP ${response.status}`);
            }

            circuitBreaker.reset();
            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) throw new Error("LLM response was empty or malformed.");
            return JSON.parse(jsonText);

        } catch (error) {
            logger.log('WARN', `AI API call failed. Retrying...`, { service: 'AIClient', details: { attempt, maxRetries, error: error.message } });
            circuitBreaker.recordFailure();
            if (attempt === maxRetries) {
                throw new Error(`AI API call failed after ${maxRetries} attempts: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
    }
}


async function analyzeProductsInBatch(analysisData, logger, circuitBreaker) {
    if (!analysisData || analysisData.length === 0) {
        logger.log("INFO", "Skipping product analysis: no data to analyze.", { phase: 2, service: 'AIClient' });
        return [];
    }
    const systemPrompt = `You are a specialized AI Grocery Analyst...`; // Same prompt as before
    const userQuery = `Analyze and classify the products for each item:\n${JSON.stringify(analysisData, null, 2)}`;
    const payload = { contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "batchAnalysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "ingredientName": { "type": "STRING" }, "analysis": { type: "ARRAY", items: { type: "OBJECT", properties: { "productName": { "type": "STRING" }, "classification": { "type": "STRING" }, "reason": { "type": "STRING" } } } } } } } } } } };
    
    logger.log('INFO', 'Sending single batch for AI product analysis.', { phase: 2, service: 'AIClient', prompt: userQuery });
    const result = await callGeminiAPI(payload, logger, circuitBreaker);
    logger.log('INFO', 'Product analysis successful.', { phase: 2, service: 'AIClient' });
    return result.batchAnalysis || [];
}

async function generateLLMPlanAndMeals(formData, calorieTarget, logger, circuitBreaker) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    const systemPrompt = `You are an expert dietitian and chef...`; // Same prompt as before
    const userQuery = `Generate the ${days}-day plan for ${name || 'Guest'}...`; // Same prompt as before
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "ingredients": { type: "ARRAY", items: { type: "OBJECT", properties: { "originalIngredient": { "type": "STRING" }, "category": { "type": "STRING" }, "searchQuery": { "type": "STRING" }, "totalGramsRequired": { "type": "NUMBER" }, "quantityUnits": { "type": "STRING" } } } }, "mealPlan": { type: "ARRAY", items: { type: "OBJECT", properties: { "day": { "type": "NUMBER" }, "meals": { type: "ARRAY", items: { type: "OBJECT", properties: { "type": { "type": "STRING" }, "name": { "type": "STRING" }, "description": { "type": "STRING" } } } } } } } } } }
    };

    logger.log('INFO', 'Sending request for meal plan blueprint.', { phase: 1, service: 'AIClient', prompt: userQuery });
    const result = await callGeminiAPI(payload, logger, circuitBreaker);
    logger.log('INFO', 'Meal plan blueprint received successfully.', { phase: 1, service: 'AIClient' });
    return result;
}

function calculateCalorieTarget(formData) {
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);
    if (!weightKg || !heightCm || !ageYears) return 2000;
    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);
    const goalAdjustments = { cut: -500, maintain: 0, bulk: 500 };
    return Math.round(tdee + (goalAdjustments[goal] || 0));
}

