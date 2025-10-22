// --- ORCHESTRATOR API for Cheffy V3 ---
const fetch = require('node-fetch');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, updateDoc } = require('firebase/firestore');
const { fetchPriceDataWithFallback } = require('./price-search.js');

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';

// --- ROBUST FIREBASE INITIALIZATION ---
let db;
try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    if (!firebaseConfig.projectId) {
        throw new Error('"projectId" is missing from the Firebase configuration.');
    }
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) {
    console.error("CRITICAL: Server-side Firebase initialization failed:", e.message);
    db = null; // Ensure db is null if initialization fails
}


// --- HELPERS ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, log) {
    // ... (fetchWithRetry logic remains the same)
}

const calculateUnitPrice = (price, size) => {
    // ... (calculateUnitPrice logic remains the same)
};

// --- NUTRITION CALCULATION ENGINE ---
function calculateNutritionalTargets(formData, log) {
    // ... (calculateNutritionalTargets logic remains the same)
}

// --- BACKGROUND JOB ---
async function runMarketAnalysis(planId, planData, log) {
    const { store, uniqueIngredients } = planData;
    log({ message: `BACKGROUND JOB [${planId}]: Starting Market Run for ${uniqueIngredients.length} ingredients.`, tag: 'BACKGROUND' });

    for (const item of uniqueIngredients) {
        const ingredientKey = item.originalIngredient;
        try {
            // Use the new searchLimit from the blueprint
            const { products, sourceStore } = await fetchPriceDataWithFallback(store, item.searchQuery, item.searchLimit, log);
            
            const analysisPayload = [{
                ingredientName: item.searchQuery,
                productCandidates: products.map(p => p.product_name || "Unknown")
            }];

            let perfectMatchNames = new Set();
            if (products.length > 0) {
                 const analysisResult = await analyzeProductsInBatch(analysisPayload, log);
                 const analysisForItem = analysisResult.find(a => a.ingredientName === item.searchQuery);
                 if(analysisForItem) {
                     perfectMatchNames = new Set(analysisForItem.analysis.filter(r => r.classification === 'perfect').map(r => r.productName));
                 }
            }
            
            const finalProducts = products
                .filter(p => perfectMatchNames.has(p.product_name))
                .map(p => ({
                    name: p.product_name, brand: p.product_brand, price: p.current_price, size: p.product_size, url: p.url, barcode: p.barcode,
                    unit_price_per_100: calculateUnitPrice(p.current_price, p.product_size),
                }));
            
            const cheapest = finalProducts.length > 0 ? finalProducts.reduce((best, current) => current.unit_price_per_100 < best.unit_price_per_100 ? current : best, finalProducts[0]) : null;

            const updatePayload = {
                [`results.${ingredientKey}.status`]: 'completed',
                [`results.${ingredientKey}.allProducts`]: finalProducts,
                [`results.${ingredientKey}.currentSelectionURL`]: cheapest ? cheapest.url : '#not-found',
                [`results.${ingredientKey}.sourceStore`]: sourceStore,
            };
            await updateDoc(doc(db, "plans", planId), updatePayload);

        } catch (error) {
            log({ message: `BACKGROUND JOB [${planId}]: CRITICAL error processing "${ingredientKey}". Error: ${error.message}`, level: 'CRITICAL', tag: 'BACKGROUND' });
            const errorPayload = {
                 [`results.${ingredientKey}.status`]: 'failed',
            };
            await updateDoc(doc(db, "plans", planId), errorPayload);
        }
    }
     log({ message: `BACKGROUND JOB [${planId}]: Market Run Finished.`, level: 'SUCCESS', tag: 'BACKGROUND' });
}


// --- MAIN API HANDLER ---
module.exports = async function handler(request, response) {
    const logs = [];
    const log = (logObject) => {
        // ... (logging logic remains the same)
    };
    
    // ... (request method checks remain the same)

    try {
        if (!db) {
            throw new Error("Server is not connected to the database. Check Firebase configuration.");
        }
        
        const formData = request.body;
        log({ message: "Phase 1: Generating Blueprint...", tag: 'PHASE' });
        
        const nutritionalTargets = calculateNutritionalTargets(formData, log);
        
        const { ingredients: ingredientPlan, mealPlan } = await generateLLMPlanAndMeals(formData, nutritionalTargets, log);
        if (!ingredientPlan || ingredientPlan.length === 0) {
            throw new Error("Blueprint failed: LLM did not return an ingredient plan after retries.");
        }
        log({ message: `Blueprint successful. ${ingredientPlan.length} ingredients found.`, level: 'SUCCESS', tag: 'LLM' });

        const planId = require('crypto').randomUUID();
        const initialResults = {};
        ingredientPlan.forEach(item => {
            initialResults[item.originalIngredient] = { ...item, status: 'searching', allProducts: [], currentSelectionURL: '' };
        });

        const planData = {
            id: planId,
            createdAt: new Date().toISOString(),
            status: 'processing',
            formData: formData,
            nutritionalTargets,
            mealPlan,
            uniqueIngredients: ingredientPlan,
            results: initialResults
        };

        const planDocRef = doc(db, "plans", planId);
        await setDoc(planDocRef, planData);
        log({ message: `Successfully created plan document with ID: ${planId}`, tag: 'FIRESTORE' });

        // Immediately respond to the client
        response.status(200).json({ planId: planId });

        // Start the background job WITHOUT waiting for it to finish
        runMarketAnalysis(planId, planData, log);

    } catch (error) {
        log({ message: `CRITICAL ERROR: ${error.message}`, level: 'CRITICAL', tag: 'SYSTEM' });
        console.error("ORCHESTRATOR CRITICAL ERROR STACK:", error);
        return response.status(500).json({ message: "An error occurred during plan generation.", error: error.message });
    }
}

// --- API-CALLING FUNCTIONS ---
async function analyzeProductsInBatch(analysisData, log) {
    // ... (analyzeProductsInBatch logic remains the same)
}

async function generateLLMPlanAndMeals(formData, nutritionalTargets, log) {
    const { days, store } = formData;
    const GEMINI_API_URL = `${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`;
    
    // --- NEW INTELLIGENT PROMPT ---
    const systemPrompt = `You are an expert dietitian and chef. Your task is to generate a meal plan and a corresponding shopping list.
A key task is to determine an intelligent 'searchLimit' for each grocery item.
- For specific, unambiguous items (e.g., 'banana', 'olive oil', 'eggs'), use a SMALL searchLimit (e.g., 5).
- For broad categories (e.g., 'bread', 'pasta', 'cereal', 'yoghurt'), use a LARGER searchLimit (e.g., 15) to ensure a good variety of options are found.

RULES:
1. Generate a complete meal plan for the specified number of days adhering to the nutritional targets.
2. Generate a consolidated shopping list of unique ingredients.
3. For each ingredient, provide a 'searchQuery' (a generic, searchable keyword).
4. For each ingredient, provide a 'searchLimit' (an integer between 5 and 15) based on the logic above.
5. Provide a user-friendly 'quantityUnits' string.
6. Estimate the 'totalGramsRequired' for the entire plan.`;
    
    const userQuery = `Generate the ${days}-day plan.
- DAILY NUTRITIONAL TARGETS: Calories: ~${nutritionalTargets.calories} kcal, Protein: ~${nutritionalTargets.protein}g, Fat: ~${nutritionalTargets.fat}g, Carbs: ~${nutritionalTargets.carbs}g.
- Other constraints: ${JSON.stringify(formData)}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // --- UPDATED JSON SCHEMA ---
        generationConfig: { 
            responseMimeType: "application/json", 
            responseSchema: { 
                type: "OBJECT", 
                properties: { 
                    "ingredients": { 
                        type: "ARRAY", 
                        items: { 
                            type: "OBJECT", 
                            properties: { 
                                "originalIngredient": { "type": "STRING" }, 
                                "category": { "type": "STRING" }, 
                                "searchQuery": { "type": "STRING" }, 
                                "totalGramsRequired": { "type": "NUMBER" }, 
                                "quantityUnits": { "type": "STRING" },
                                "searchLimit": { "type": "NUMBER" } // New field in schema
                            } 
                        } 
                    }, 
                    "mealPlan": { 
                        type: "ARRAY", 
                        items: { /* ... meal plan schema ... */ }
                    }
                }
            }
        }
    };
    
    const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) {
        throw new Error(`LLM API HTTP error! Status: ${response.status}.`);
    }
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("LLM response was empty or malformed.");
    return JSON.parse(jsonText);
}


