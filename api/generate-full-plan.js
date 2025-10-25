// --- ORCHESTRATOR API for Cheffy V3 ---

// Mark 45: FINAL ARCHITECTURE: Code-as-Truth.
// - ADDED hard-coded INGREDIENT_DB as the single source of truth for search, category, and nutrition.
// - REWROTE AI prompt to be a simple "creative proposer" (meal names + gram estimates).
// - AI no longer provides any search data, categories, or nutrition estimates.
// - Auditor/Fixer loop now runs on perfect, reliable data from our DB.
// - This fixes all cascading failures: AI slowness, checklist errors, and fixer errors.
//
// Mark 44: Implemented Generator -> Auditor -> Fixer loop.
// Mark 42: Replaced macro calculation with industry-standard, dual-validation system.

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

/// ===== IMPORTS-END ===== ////

// --- CONFIGURATION ---

/// ===== CONFIG-START ===== \\\\

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';
const MAX_RETRIES = 3; // Retries for external API calls
const MAX_NUTRITION_CONCURRENCY = 5;
const MAX_MARKET_RUN_CONCURRENCY = 5;

// Tolerances & Limits for Code-Based Fixer (Point 4)
const MAX_FIXER_ATTEMPTS = 5;
const CALORIE_TOLERANCE_ABSOLUTE = 75; // ±75 kcal minimum
const CALORIE_TOLERANCE_PERCENT = 0.02; // ±2%
const PROTEIN_TOLERANCE_GRAMS = 5; // ±5 g
const FAT_TOLERANCE_GRAMS = 5; // ±5 g
const CARB_TOLERANCE_GRAMS = 10; // ±10 g
// ---

const BANNED_KEYWORDS = ['cigarette', 'capsule', 'deodorant', 'pet', 'cat', 'dog', 'bird', 'toy', 'non-food', 'supplement', 'vitamin', 'tobacco', 'vape', 'roll-on', 'binder', 'folder', 'stationery', 'lighter', 'gift', 'bag', 'wrap', 'battery', 'filter', 'paper', 'tip', 'shampoo', 'conditioner', 'soap', 'lotion', 'cleaner', 'spray', 'polish', 'air freshener', 'mouthwash', 'toothpaste', 'floss', 'gum'];
const PRICE_OUTLIER_Z_SCORE = 2.0;

/// ===== CONFIG-END ===== ////


/// ===== MOCK-START ===== \\\\

const MOCK_PRODUCT_TEMPLATE = { name: "Placeholder (Not Found)", brand: "MOCK DATA", price: 0, size: "N/A", url: "#", unit_price_per_100: 0, barcode: null };
const FALLBACK_NUTRITION = { status: 'not_found', calories: 0, protein: 0, fat: 0, carbs: 0, p_per_g: 0, f_per_g: 0, c_per_g: 0, kcal_per_g: 0 };

/// ===== MOCK-END ===== ////


// --- MODIFICATION (Mark 45): The new hard-coded "Single Source of Truth" Database ---
/**
 * This DB is the new brain of the application.
 * - `key`: The simple food name the AI will use (e.g., "chicken breast").
 * - `id`: The unique ID for our system.
 * - `category`: "Protein", "Fat", "Carbohydrate", "Produce", "Other" (for the Fixer Loop).
 * - `query`: The *perfect* search query for RapidAPI.
 * - `requiredWords`: The *perfect* checklist words to guarantee a match.
 * - `negativeKeywords`: The *perfect* filter words to prevent mismatches.
 * - `fallbackNutrition`: Our *own* nutrition data (per gram) to use if Open Food Facts fails.
 */
const INGREDIENT_DB = new Map([
  ['chicken breast', {
    id: 'chicken_breast',
    category: 'Protein',
    query: 'Coles chicken breast fillet',
    requiredWords: ['chicken', 'breast'],
    negativeKeywords: ['cooked', 'canned', 'sauce', 'cacciatore', 'schnitzel', 'breaded', 'flavour'],
    fallbackNutrition: { p_per_g: 0.22, f_per_g: 0.02, c_per_g: 0, kcal_per_g: (0.22 * 4 + 0.02 * 9) }
  }],
  ['lean beef mince', {
    id: 'lean_beef_mince',
    category: 'Protein',
    query: 'Coles lean beef mince 5 star',
    requiredWords: ['beef', 'mince', 'lean'],
    negativeKeywords: ['sauce', 'lasagne', 'organic', 'burger', 'meatball', 'cooked'],
    fallbackNutrition: { p_per_g: 0.21, f_per_g: 0.05, c_per_g: 0, kcal_per_g: (0.21 * 4 + 0.05 * 9) }
  }],
  ['whey protein isolate', {
    id: 'whey_protein_isolate',
    category: 'Protein',
    query: 'whey protein isolate powder',
    requiredWords: ['whey', 'protein', 'isolate'],
    negativeKeywords: ['water', 'bar', 'ready to drink', 'cookie', 'blend', 'concentrate'],
    fallbackNutrition: { p_per_g: 0.85, f_per_g: 0.02, c_per_g: 0.05, kcal_per_g: (0.85 * 4 + 0.02 * 9 + 0.05 * 4) }
  }],
  ['rolled oats', {
    id: 'rolled_oats',
    category: 'Carbohydrate',
    query: 'Coles rolled oats',
    requiredWords: ['rolled', 'oats'],
    negativeKeywords: ['quick', 'sachet', 'bar', 'milk', 'cup', 'baby'],
    fallbackNutrition: { p_per_g: 0.13, f_per_g: 0.08, c_per_g: 0.60, kcal_per_g: (0.13 * 4 + 0.08 * 9 + 0.60 * 4) }
  }],
  ['brown rice', {
    id: 'brown_rice',
    category: 'Carbohydrate',
    query: 'Coles brown rice',
    requiredWords: ['brown', 'rice'],
    negativeKeywords: ['cooked', 'pouch', 'microwave', 'crackers', 'cup', 'crisps', 'flour'],
    fallbackNutrition: { p_per_g: 0.08, f_per_g: 0.03, c_per_g: 0.77, kcal_per_g: (0.08 * 4 + 0.03 * 9 + 0.77 * 4) }
  }],
  ['sweet potato', {
    id: 'sweet_potato',
    category: 'Carbohydrate',
    query: 'sweet potato',
    requiredWords: ['sweet', 'potato'],
    negativeKeywords: ['cooked', 'canned', 'chips', 'fries', 'mash', 'pouch'],
    fallbackNutrition: { p_per_g: 0.016, f_per_g: 0.001, c_per_g: 0.20, kcal_per_g: (0.016 * 4 + 0.001 * 9 + 0.20 * 4) }
  }],
  ['wholemeal bread', {
    id: 'wholemeal_bread',
    category: 'Carbohydrate',
    query: 'wholemeal bread loaf',
    requiredWords: ['wholemeal', 'bread'],
    negativeKeywords: ['mix', 'flour', 'roll', 'wrap', 'sourdough', 'white', 'rye'],
    fallbackNutrition: { p_per_g: 0.09, f_per_g: 0.03, c_per_g: 0.41, kcal_per_g: (0.09 * 4 + 0.03 * 9 + 0.41 * 4) }
  }],
  ['wholemeal wraps', {
    id: 'wholemeal_wraps',
    category: 'Carbohydrate',
    query: 'wholemeal wraps',
    requiredWords: ['wholemeal', 'wraps'],
    negativeKeywords: ['mix', 'flour', 'bread', 'low carb'],
    fallbackNutrition: { p_per_g: 0.09, f_per_g: 0.05, c_per_g: 0.50, kcal_per_g: (0.09 * 4 + 0.05 * 9 + 0.50 * 4) }
  }],
  ['low fat cottage cheese', {
    id: 'low_fat_cottage_cheese',
    category: 'Protein',
    query: 'low fat cottage cheese',
    requiredWords: ['cottage', 'cheese', 'low', 'fat'],
    negativeKeywords: ['milk', 'cream', 'ricotta', 'full fat', 'slice'],
    fallbackNutrition: { p_per_g: 0.11, f_per_g: 0.015, c_per_g: 0.03, kcal_per_g: (0.11 * 4 + 0.015 * 9 + 0.03 * 4) }
  }],
  ['large eggs', {
    id: 'large_eggs',
    category: 'Protein',
    query: 'Coles large free range eggs',
    requiredWords: ['eggs'],
    negativeKeywords: ['cooked', 'powder', 'mayo', 'mayonnaise', 'sauce', 'chocolate'],
    fallbackNutrition: { p_per_g: 0.125, f_per_g: 0.095, c_per_g: 0.01, kcal_per_g: (0.125 * 4 + 0.095 * 9 + 0.01 * 4) }
  }],
  ['natural peanut butter', {
    id: 'natural_peanut_butter',
    category: 'Fat',
    query: 'natural peanut butter',
    requiredWords: ['natural', 'peanut', 'butter'],
    negativeKeywords: ['crunchy', 'smooth', 'light', 'no added', 'sugar', 'salt'], // Let user choose texture
    fallbackNutrition: { p_per_g: 0.25, f_per_g: 0.50, c_per_g: 0.16, kcal_per_g: (0.25 * 4 + 0.50 * 9 + 0.16 * 4) }
  }],
  ['olive oil', {
    id: 'olive_oil',
    category: 'Fat',
    query: 'extra virgin olive oil',
    requiredWords: ['olive', 'oil'],
    negativeKeywords: ['spread', 'margarine', 'spray', 'infused', 'light'],
    fallbackNutrition: { p_per_g: 0, f_per_g: 1, c_per_g: 0, kcal_per_g: 9 }
  }],
  ['banana', {
    id: 'banana',
    category: 'Carbohydrate', // Produce, but carb-dense
    query: 'banana',
    requiredWords: ['banana'],
    negativeKeywords: ['chips', 'lollies', 'dried', 'bread', 'cake', 'drink'],
    fallbackNutrition: { p_per_g: 0.01, f_per_g: 0.003, c_per_g: 0.23, kcal_per_g: (0.01 * 4 + 0.003 * 9 + 0.23 * 4) }
  }],
  ['spinach', {
    id: 'spinach',
    category: 'Produce',
    query: 'baby spinach leaves',
    requiredWords: ['spinach'],
    negativeKeywords: ['canned', 'cooked', 'frozen', 'dip', 'pie', 'roll'],
    fallbackNutrition: { p_per_g: 0.029, f_per_g: 0.004, c_per_g: 0.036, kcal_per_g: (0.029 * 4 + 0.004 * 9 + 0.036 * 4) }
  }],
  ['tomato', {
    id: 'tomato',
    category: 'Produce',
    query: 'truss tomatoes',
    requiredWords: ['tomato', 'tomatoes'],
    negativeKeywords: ['paste', 'sauce', 'canned', 'sun dried', 'soup', 'juice'],
    fallbackNutrition: { p_per_g: 0.009, f_per_g: 0.002, c_per_g: 0.039, kcal_per_g: (0.009 * 4 + 0.002 * 9 + 0.039 * 4) }
  }],
  ['onion', {
    id: 'onion',
    category: 'Produce',
    query: 'brown onion',
    requiredWords: ['onion', 'onions'],
    negativeKeywords: ['powder', 'flakes', 'ring', 'fried', 'frozen', 'dip', 'sauce'],
    fallbackNutrition: { p_per_g: 0.011, f_per_g: 0.001, c_per_g: 0.09, kcal_per_g: (0.011 * 4 + 0.001 * 9 + 0.09 * 4) }
  }],
  ['skim milk', {
    id: 'skim_milk',
    category: 'Protein', // Protein/Carb, but good for protein fixing
    query: 'Coles skim milk',
    requiredWords: ['skim', 'milk'],
    negativeKeywords: ['powder', 'long life', 'uht', 'cheese', 'yoghurt', 'chocolate'],
    fallbackNutrition: { p_per_g: 0.034, f_per_g: 0.001, c_per_g: 0.05, kcal_per_g: (0.034 * 4 + 0.001 * 9 + 0.05 * 4) }
  }],
]);
// --- END OF INGREDIENT_DB ---


/// ===== HELPERS-START ===== \\\\

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getSanitizedFormData(formData) {
    try {
        const { name, height, weight, age, bodyFat, ...rest } = formData;
        return {
            ...rest,
            user_profile: "[REDACTED]"
        };
    } catch (e) {
        return { error: "Failed to sanitize form data." };
    }
}

async function concurrentlyMap(array, limit, asyncMapper) {
    const results = [];
    const executing = [];
    for (const item of array) {
        const promise = asyncMapper(item)
            .then(result => {
                const index = executing.indexOf(promise);
                if (index > -1) {
                    executing.splice(index, 1);
                }
                return result;
            })
            .catch(error => {
                console.error(`Error processing item "${item?.food_name || 'unknown'}" in concurrentlyMap:`, error);
                const index = executing.indexOf(promise);
                if (index > -1) {
                    executing.splice(index, 1);
                }
                return {
                    error: error.message || 'Unknown error during async mapping',
                    item: item?.food_name || 'unknown'
                };
            });

        executing.push(promise);
        results.push(promise);

        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}


async function fetchWithRetry(url, options, log) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log(`Attempt ${attempt}: Fetching from ${url}`, 'DEBUG', 'HTTP');
            const response = await fetch(url, options); 
            if (response.ok) {
                return response;
            }
            if (response.status === 429 || response.status >= 500) {
                log(`Attempt ${attempt}: Received retryable error ${response.status} from API. Retrying...`, 'WARN', 'HTTP');
            } else {
                const errorBody = await response.text();
                log(`Attempt ${attempt}: Received non-retryable client error ${response.status} from API.`, 'CRITICAL', 'HTTP', { body: errorBody });
                throw new Error(`API call failed with client error ${response.status}. Body: ${errorBody}`);
            }
        } catch (error) {
             if (!error.message?.startsWith('API call failed with client error')) {
                log(`Attempt ${attempt}: Fetch failed for API with error: ${error.message}. Retrying...`, 'WARN', 'HTTP');
                console.error(`Fetch Error Details (Attempt ${attempt}):`, error);
            } else {
                 throw error;
            }
        }
        if (attempt < MAX_RETRIES) {
            const delayTime = Math.pow(2, attempt - 1) * 2000;
            await delay(delayTime);
        }
    }
    log(`API call failed definitively after ${MAX_RETRIES} attempts.`, 'CRITICAL', 'HTTP');
    throw new Error(`API call to ${url} failed after ${MAX_RETRIES} attempts.`);
}


const calculateUnitPrice = (price, size) => {
    if (!price || price <= 0 || typeof size !== 'string' || size.length === 0) return 0; // Return 0 if no price
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
    return price; // Fallback to price if unit is weird (e.g., "each")
};


// --- MODIFICATION (Mark 45): Checklist now uses the `ingredient` object from *our DB*. ---
function runSmarterChecklist(product, ingredient, log) {
    const productNameLower = product.product_name?.toLowerCase() || '';
    if (!productNameLower) {
        return { pass: false, score: 0 };
    }
    
    // `ingredient` is now an object from our INGREDIENT_DB
    const { food_name, requiredWords = [], negativeKeywords = [], allowedCategories = [] } = ingredient;
    const checkLogPrefix = `Checklist [${food_name}] for "${product.product_name}"`;

    // 1. Banned Words (Global)
    const bannedWordFound = BANNED_KEYWORDS.find(kw => productNameLower.includes(kw));
    if (bannedWordFound) {
        log(`${checkLogPrefix}: FAIL (Global Banned: '${bannedWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // 2. Negative Keywords (From our DB)
    const negativeWordFound = negativeKeywords.find(kw => productNameLower.includes(kw.toLowerCase()));
    if (negativeWordFound) {
        log(`${checkLogPrefix}: FAIL (DB Negative Keyword: '${negativeWordFound}')`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // 3. Required Words (From our DB)
    let wordsFound = 0;
    for (const kw of requiredWords) {
        const regex = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (regex.test(productNameLower)) {
            wordsFound++;
        }
    }
    
    if (wordsFound !== requiredWords.length) {
         log(`${checkLogPrefix}: FAIL (Required Words: Did not find all of [${requiredWords.join(', ')}])`, 'DEBUG', 'CHECKLIST');
        return { pass: false, score: 0 };
    }

    // 4. Category Allowlist (From our DB, if present)
    const productCategory = product.product_category?.toLowerCase() || '';
    if (allowedCategories && allowedCategories.length > 0 && productCategory) {
        const hasCategoryMatch = allowedCategories.some(allowedCat => productCategory.includes(allowedCat.toLowerCase()));
        if (!hasCategoryMatch) {
            log(`${checkLogPrefix}: FAIL (Category Mismatch: Product category "${productCategory}" not in allowlist [${allowedCategories.join(', ')}])`, 'DEBUG', 'CHECKLIST');
            return { pass: false, score: 0 };
        }
    }

    log(`${checkLogPrefix}: PASS`, 'DEBUG', 'CHECKLIST');
    return { pass: true, score: 1 }; // Score is now binary: pass/fail
}


function isCreativePrompt(cuisinePrompt) {
    if (!cuisinePrompt || cuisinePrompt.toLowerCase() === 'none') return false;
    const simpleKeywords = ['italian', 'mexican', 'chinese', 'thai', 'indian', 'japanese', 'mediterranean', 'french', 'spanish', 'korean', 'vietnamese', 'greek', 'american', 'british', 'german', 'russian', 'brazilian', 'caribbean', 'african', 'middle eastern', 'spicy', 'mild', 'sweet', 'sour', 'savoury', 'quick', 'easy', 'simple', 'fast', 'budget', 'cheap', 'healthy', 'low carb', 'keto', 'low fat', 'high protein', 'high fiber', 'vegetarian', 'vegan', 'gluten free', 'dairy free', 'pescatarian', 'paleo'];
    const promptLower = cuisinePrompt.toLowerCase().trim();
    if (simpleKeywords.some(kw => promptLower === kw)) return false;
    if (promptLower.startsWith("high ") || promptLower.startsWith("low ")) return false;
    return cuisinePrompt.length > 30 || cuisinePrompt.includes(' like ') || cuisinePrompt.includes(' inspired by ') || cuisinePrompt.includes(' themed ');
}

/// ===== HELPERS-END ===== ////


/// ===== ROUTE-HANDLER-START ===== \\\\

module.exports = async function handler(request, response) {
    const logs = [];
    const log = (message, level = 'INFO', tag = 'SYSTEM', data = null) => {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    typeof value === 'object' && value !== null ? value : value
                )) : null
            };
            logs.push(logEntry);
            console.log(`[${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
            if (data && (level === 'ERROR' || level === 'CRITICAL' || level === 'WARN')) {
                 console.warn("Log Data:", data);
            }
            return logEntry;
        } catch (error) {
            const fallbackEntry = {
                 timestamp: new Date().toISOString(),
                 level: 'ERROR',
                 tag: 'LOGGING',
                 message: `Failed to serialize log data for message: ${message}`,
                 data: { serializationError: error.message }
            }
            logs.push(fallbackEntry);
            console.error(JSON.stringify(fallbackEntry));
            return fallbackEntry;
        }
    };


    log("Orchestrator invoked (Mark 45: Code-as-Truth).", 'INFO', 'SYSTEM');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP');
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        response.setHeader('Allow', 'POST, OPTIONS');
        return response.status(405).json({ message: `Method ${request.method} Not Allowed.` });
    }

    try {
        if (!request.body) {
            log("Orchestrator fail: Received empty request body.", 'CRITICAL', 'SYSTEM');
            throw new Error("Request body is missing or invalid.");
        }
        const formData = request.body;
        const { store, cuisine, days, goal, weight } = formData;
        
        if (!store || !days || !goal || isNaN(parseFloat(formData.weight)) || isNaN(parseFloat(formData.height))) {
             log("CRITICAL: Missing core form data (store, days, goal, weight, or height). Cannot calculate plan.", 'CRITICAL', 'INPUT', getSanitizedFormData(formData));
             throw new Error("Missing critical profile data required for plan generation (store, days, goal, weight, height).");
        }
        
        const numDays = parseInt(days, 10);
        const weightKg = parseFloat(weight);

        // --- Phase 1: Creative Router ---
        log("Phase 1: Creative Router...", 'INFO', 'PHASE');
        let creativeIdeas = null;
        if (isCreativePrompt(cuisine)) {
            log(`Creative prompt: "${cuisine}". Calling AI...`, 'INFO', 'LLM');
            creativeIdeas = await generateCreativeIdeas(cuisine, log);
        } else {
            log("Simple prompt. Skipping Creative AI.", 'INFO', 'SYSTEM');
        }

        // --- Phase 2: Technical Blueprint (Immutable Targets) ---
        log("Phase 2: Technical Blueprint (Code-Based Targets)...", 'INFO', 'PHASE');
        
        const targetCalories = calculateCalorieTarget(formData, log);
        const { proteinGrams, fatGrams, carbGrams } = calculateMacroTargets(targetCalories, goal, weightKg, log); 
        const targetTotals = {
            calories: targetCalories,
            protein: proteinGrams,
            fat: fatGrams,
            carbs: carbGrams
        };
        log(`IMMUTABLE TARGETS SET:`, 'INFO', 'CALC', targetTotals);

        // --- Phase 2.5: AI Generator (Proposer) ---
        log("Phase 2.5: AI Generator (Proposer)...", 'INFO', 'PHASE');
        const llmResult = await generateLLMPlan(formData, targetTotals, creativeIdeas, log);
        
        const { mealPlan: aiMealPlan = [] } = llmResult || {};

        if (!aiMealPlan.length) {
             log("Blueprint fail: AI returned no mealPlan.", 'CRITICAL', 'LLM', { result: llmResult });
             throw new Error("Blueprint fail: AI did not return a valid plan structure.");
        }

        // Create a mutable copy of the meal plan for the fixer loop
        let planToFix = JSON.parse(JSON.stringify(aiMealPlan));
        
        // --- Phase 3: Auditor (Market Run & Nutrition Fetch) ---
        log("Phase 3: Auditor (Market Run & Nutrition Fetch)...", 'INFO', 'PHASE');
        
        // 1. Get unique list of ingredients from AI plan
        const uniqueFoodNames = new Set();
        planToFix.forEach(day => day.meals.forEach(meal => meal.items.forEach(item => uniqueFoodNames.add(item.food_name))));
        
        // 2. Map food names to our DB
        const ingredientList = [];
        for (const foodName of uniqueFoodNames) {
            const dbEntry = INGREDIENT_DB.get(foodName);
            if (dbEntry) {
                ingredientList.push(dbEntry);
            } else {
                log(`AI proposed unknown ingredient: "${foodName}". It will be ignored.`, 'WARN', 'DATA');
            }
        }
        
        // 3. Fetch data for all ingredients in parallel
        const nutritionData = new Map(); // Stores { p_per_g, f_per_g, c_per_g, ... }
        const marketResults = new Map(); // Stores { name, price, url, ... }

        const fetchIngredientData = async (ingredient) => {
            const { id: ingredientId, food_name, query, fallbackNutrition } = ingredient;
            log(`[${food_name}] Attempting market run...`, 'DEBUG', 'HTTP');

            try {
                // 1. Fetch Price Data
                const { data: priceData } = await fetchPriceData(store, query, 1, log);
                
                if (priceData.error || !priceData.results || !priceData.results.length) {
                    log(`[${food_name}] Market run failed (query: "${query}"). Using fallback nutrition.`, 'WARN', 'HTTP', { error: priceData.error });
                    marketResults.set(ingredientId, { ...MOCK_PRODUCT_TEMPLATE, source: 'market_fail' });
                    nutritionData.set(ingredientId, { ...fallbackNutrition, source: 'db_fallback' });
                    return;
                }
                
                const rawProducts = priceData.results || [];
                log(`[${food_name}] Raw results (${rawProducts.length}):`, 'DEBUG', 'DATA', rawProducts.map(p => p.product_name));

                // 2. Run Checklist (using our DB rules)
                const validProductsWithScore = [];
                for (const rawProduct of rawProducts) {
                    const productWithCategory = { ...rawProduct, product_category: rawProduct.product_category };
                    const checklistResult = runSmarterChecklist(productWithCategory, ingredient, log); 
                    if (checklistResult.pass) {
                        validProductsWithScore.push({
                            product: rawProduct,
                            score: checklistResult.score 
                        });
                    }
                }
                
                // 3. Apply Price Outlier Guard
                const outlierGuardedProducts = applyPriceOutlierGuard(
                    validProductsWithScore.map(vp => ({
                        ...vp,
                        product: {
                            ...vp.product,
                            unit_price_per_100: calculateUnitPrice(vp.product.current_price, vp.product.product_size)
                        }
                    })),
                    log,
                    food_name
                ).map(ogp => ogp.product); // Get back the raw product
                
                if (!outlierGuardedProducts.length) {
                     log(`[${food_name}] No products passed checklist & outlier guard. Using fallback nutrition.`, 'WARN', 'DATA');
                     marketResults.set(ingredientId, { ...MOCK_PRODUCT_TEMPLATE, source: 'checklist_fail' });
                     nutritionData.set(ingredientId, { ...fallbackNutrition, source: 'db_fallback' });
                     return;
                }
                
                // 4. Select Best Product (Cheapest unit price > 0)
                const bestProduct = outlierGuardedProducts
                    .map(p => ({ ...p, unit_price: calculateUnitPrice(p.current_price, p.product_size) }))
                    .filter(p => p.unit_price > 0) // Filter out 0 price items
                    .reduce((best, current) => (current.unit_price < best.unit_price) ? current : best, 
                            { unit_price: Infinity }); // Find the cheapest
                
                if (bestProduct.unit_price === Infinity) {
                    log(`[${food_name}] All valid products had $0 price. Using first valid product.`, 'WARN', 'DATA');
                    const firstProduct = outlierGuardedProducts[0];
                    marketResults.set(ingredientId, {
                        name: firstProduct.product_name, brand: firstProduct.product_brand, price: firstProduct.current_price,
                        size: firstProduct.product_size, url: firstProduct.url, barcode: firstProduct.barcode,
                        unit_price_per_100: 0, source: 'discovery'
                    });
                    // Still try to fetch nutrition for it
                    bestProduct.barcode = firstProduct.barcode;
                    bestProduct.product_name = firstProduct.product_name;
                } else {
                     marketResults.set(ingredientId, {
                        name: bestProduct.product_name, brand: bestProduct.product_brand, price: bestProduct.current_price,
                        size: bestProduct.product_size, url: bestProduct.url, barcode: bestProduct.barcode,
                        unit_price_per_100: bestProduct.unit_price, source: 'discovery'
                    });
                }
                
                // 5. Fetch Nutrition Data for the chosen product
                log(`[${food_name}] Fetching nutrition for "${bestProduct.product_name}"...`, 'DEBUG', 'HTTP');
                const nutri = await fetchNutritionData(bestProduct.barcode, bestProduct.product_name, log);
                
                if (nutri.status === 'found') {
                    const p = nutri.protein || 0;
                    const f = nutri.fat || 0;
                    const c = nutri.carbs || 0;
                    nutritionData.set(ingredientId, {
                        ...nutri,
                        p_per_g: p / 100,
                        f_per_g: f / 100,
                        c_per_g: c / 100,
                        kcal_per_g: ((p * 4) + (f * 9) + (c * 4)) / 100,
                        source: 'api'
                    });
                } else {
                    // 6. Fallback to DB Estimates if nutrition API fails
                    log(`[${food_name}] Nutrition API failed. Using DB fallback.`, 'WARN', 'CALC');
                    nutritionData.set(ingredientId, { ...fallbackNutrition, source: 'db_fallback' });
                }

            } catch (e) {
                log(`CRITICAL Error processing ingredient "${food_name}": ${e.message}. Using DB fallback.`, 'CRITICAL', 'MARKET_RUN', { stack: e.stack?.substring(0, 300) });
                marketResults.set(ingredientId, { ...MOCK_PRODUCT_TEMPLATE, source: 'error' });
                nutritionData.set(ingredientId, { ...fallbackNutrition, source: 'db_fallback' });
            }
        }; // End fetchIngredientData

        await concurrentlyMap(ingredientList, MAX_MARKET_RUN_CONCURRENCY, fetchIngredientData);
        log("Auditor: Market Run & Nutrition Fetch complete.", 'SUCCESS', 'PHASE');
        
        // --- Phase 4: Code-Based Fixer Loop ---
        log("Phase 4: Code-Based Fixer Loop...", 'INFO', 'PHASE');

        /**
         * Helper to sum the totals for the *current state* of `planToFix`.
         */
        const calculateActualTotals = (currentPlan, dailyAvgFactor) => {
            const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
            for (const day of currentPlan) {
                for (const meal of day.meals) {
                    for (const item of meal.items) {
                        const dbEntry = INGREDIENT_DB.get(item.food_name);
                        if (!dbEntry) continue; // Skip unknown ingredients
                        
                        const nut = nutritionData.get(dbEntry.id) || FALLBACK_NUTRITION;
                        totals.protein += item.grams * nut.p_per_g;
                        totals.fat += item.grams * nut.f_per_g;
                        totals.carbs += item.grams * nut.c_per_g;
                    }
                }
            }
            // Average over the number of days
            totals.protein /= dailyAvgFactor;
            totals.fat /= dailyAvgFactor;
            totals.carbs /= dailyAvgFactor;
            totals.calories = (totals.protein * 4) + (totals.fat * 9) + (totals.carbs * 4);
            return totals;
        };

        const dailyAvgFactor = (planToFix.length > 0 ? planToFix.length : 1);
        let actualTotals = calculateActualTotals(planToFix, dailyAvgFactor);
        let finalPlan = planToFix;

        for (let attempt = 1; attempt <= MAX_FIXER_ATTEMPTS; attempt++) {
            actualTotals = calculateActualTotals(finalPlan, dailyAvgFactor);
            const roundedTotals = {
                kcal: Math.round(actualTotals.calories), p: Math.round(actualTotals.protein),
                f: Math.round(actualTotals.fat), c: Math.round(actualTotals.carbs)
            };
            log(`Fixer Loop [${attempt}/${MAX_FIXER_ATTEMPTS}] Daily Totals:`, 'DEBUG', 'FIXER_LOOP', roundedTotals);
            
            // Check Tolerances (Point 4)
            const calDiff = actualTotals.calories - targetTotals.calories;
            const protDiff = actualTotals.protein - targetTotals.protein;
            const fatDiff = actualTotals.fat - targetTotals.fat;
            const carbDiff = actualTotals.carbs - targetTotals.carbs;
            
            const calTolerance = Math.max(CALORIE_TOLERANCE_ABSOLUTE, targetTotals.calories * CALORIE_TOLERANCE_PERCENT);
            
            const isCalOk = Math.abs(calDiff) <= calTolerance;
            const isProtOk = Math.abs(protDiff) <= PROTEIN_TOLERANCE_GRAMS;
            const isFatOk = Math.abs(fatDiff) <= FAT_TOLERANCE_GRAMS;
            const isCarbOk = Math.abs(carbDiff) <= CARB_TOLERANCE_GRAMS;

            if (isCalOk && isProtOk && isFatOk && isCarbOk) {
                log(`Fixer Loop: SUCCESS. Plan is within all tolerances on attempt ${attempt}.`, 'SUCCESS', 'FIXER_LOOP');
                break; // All targets met, exit loop
            }
            
            if (attempt === MAX_FIXER_ATTEMPTS) {
                log(`Fixer Loop: FAILED. Max attempts reached. Returning last plan.`, 'WARN', 'FIXER_LOOP', {
                    calDiff, protDiff, fatDiff, carbDiff
                });
                break; // Max attempts, exit loop
            }
            
            // --- Apply Delta Rules (Point 3) ---
            log(`Fixer Loop [${attempt}]: Adjusting plan...`, 'INFO', 'FIXER_LOOP', { calDiff, protDiff, fatDiff, carbDiff });
            const newPlan = JSON.parse(JSON.stringify(finalPlan)); // Work on a new copy
            
            // Rule: Fix calories via Carbs first, then Fats. NEVER Protein. (Point 3)
            if (!isCalOk) {
                // We adjust based on the *remaining* deficit, not the original one
                const targetCalAdjustment = targetTotals.calories - actualTotals.calories; // e.g., 3500 - 3000 = +500
                
                // Find all carb/fat items to get a total pool of calories
                let adjustableCarbKcal = 0;
                let adjustableFatKcal = 0;

                for (const day of newPlan) {
                    for (const meal of day.meals) {
                        for (const item of meal.items) {
                            const dbEntry = INGREDIENT_DB.get(item.food_name);
                            if (!dbEntry) continue;
                            const nut = nutritionData.get(dbEntry.id) || FALLBACK_NUTRITION;
                            
                            if (dbEntry.category === 'Carbohydrate' || dbEntry.category === 'Produce') {
                                adjustableCarbKcal += (item.grams * nut.c_per_g * 4);
                            } else if (dbEntry.category === 'Fat') {
                                adjustableFatKcal += (item.grams * nut.f_per_g * 9);
                            }
                        }
                    }
                }
                
                // Prioritize Carbs
                let carbAdjustmentFactor = 1.0;
                let fatAdjustmentFactor = 1.0;
                
                if (adjustableCarbKcal > 0) {
                    carbAdjustmentFactor = (adjustableCarbKcal + targetCalAdjustment) / adjustableCarbKcal;
                } else if (adjustableFatKcal > 0) {
                    // No carbs to adjust, fall back to fats
                    fatAdjustmentFactor = (adjustableFatKcal + targetCalAdjustment) / adjustableFatKcal;
                }

                // Apply adjustments
                for (const day of newPlan) {
                    for (const meal of day.meals) {
                        for (const item of meal.items) {
                            const dbEntry = INGREDIENT_DB.get(item.food_name);
                            if (!dbEntry) continue;
                            
                            if (dbEntry.category === 'Carbohydrate' || dbEntry.category === 'Produce') {
                                item.grams = Math.max(0, item.grams * carbAdjustmentFactor);
                            } else if (dbEntry.category === 'Fat') {
                                item.grams = Math.max(0, item.grams * fatAdjustmentFactor);
                            }
                        }
                    }
                }
            }
            
            // TODO: Add granular adjustments for P/F/C if they are individually off
            // This simple calorie-fix is the first step.
            
            finalPlan = newPlan;
        }
        
        // --- Final Recalculation ---
        const finalDailyTotals = calculateActualTotals(finalPlan, dailyAvgFactor);
        finalDailyTotals.calories = Math.round(finalDailyTotals.calories);
        finalDailyTotals.protein = Math.round(finalDailyTotals.protein);
        finalDailyTotals.fat = Math.round(finalDailyTotals.fat);
        finalDailyTotals.carbs = Math.round(finalDailyTotals.carbs);

        log("Code-Based Fixer Loop complete.", 'SUCCESS', 'PHASE');
        
        // --- Phase 5: Assembling Final Response ---
        log("Phase 5: Final Response...", 'INFO', 'PHASE');
        
        // Build the final `results` object (shopping list)
        const finalResults = {};
        for (const ingredient of ingredientList) {
            const id = ingredient.id;
            const marketData = marketResults.get(id) || { ...MOCK_PRODUCT_TEMPLATE, source: 'unknown' };
            const nutrition = nutritionData.get(id) || { ...FALLBACK_NUTRITION, source: 'unknown' };
            
            // Calculate total grams required from the *fixed* plan
            let totalGramsRequired = 0;
            for (const day of finalPlan) {
                for (const meal of day.meals) {
                    for (const item of meal.items) {
                        if (item.food_name === ingredient.food_name) {
                            totalGramsRequired += item.grams;
                        }
                    }
                }
            }

            finalResults[id] = {
                ...ingredient, // DB data (category, query, words, etc.)
                totalGramsRequired: Math.round(totalGramsRequired),
                chosenProduct: { ...marketData, nutrition: { ...nutrition } }
            };
        }

        const finalResponseData = { 
            mealPlan: finalPlan,
            results: finalResults,
            nutritionalTargets: finalDailyTotals, // The *actual* totals
            codeTargets: targetTotals // The *original* code-generated targets
        };
        log("Orchestrator finished successfully.", 'SUCCESS', 'SYSTEM');
        return response.status(200).json({ ...finalResponseData, logs });

    } catch (error) {
        log(`CRITICAL Orchestrator ERROR: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 500) });
        console.error("ORCHESTRATOR UNHANDLED ERROR:", error);
        return response.status(500).json({ message: "An unrecoverable server error occurred during plan generation.", error: error.message, logs });
    }
}


/// ===== ROUTE-HANDLER-END ===== ////


/// ===== API-CALLERS-START ===== \\\\

async function generateCreativeIdeas(cuisinePrompt, log) {
    const GEMINI_API_URL = GEMINI_API_URL_BASE; 
    const sysPrompt=`Creative chef... comma-separated list.`;
    const userQuery=`Theme: "${cuisinePrompt}"...`;
    log("Creative Prompt",'INFO','LLM_PROMPT',{userQuery});
    const payload={contents:[{parts:[{text:userQuery}]}],systemInstruction:{parts:[{text:sysPrompt}]}};
    try{
        const res=await fetchWithRetry(
            GEMINI_API_URL,
            {
                method:'POST',
                headers:{ 'Content-Type':'application/json', 'x-goog-api-key': GEMINI_API_KEY },
                body:JSON.stringify(payload)
            },
            log
        );
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (typeof text !== 'string' || text.length === 0) {
             log("Creative AI returned non-string or empty text.", 'WARN', 'LLM', { result });
             throw new Error("Creative AI empty or invalid text.");
         }

        log("Creative Raw",'INFO','LLM',{raw:text.substring(0,500)});
        return text;
    } catch(e){
        log(`Creative AI failed: ${e.message}`,'CRITICAL','LLM');
        return "";
    }
}

// --- MODIFICATION (Mark 45): Completely new AI prompt and schema ---
async function generateLLMPlan(formData, targetTotals, creativeIdeas, log) {
    const { name, height, weight, age, gender, goal, dietary, days, store, eatingOccasions, costPriority, mealVariety, cuisine } = formData;
    
    const GEMINI_API_URL = GEMINI_API_URL_BASE;
    const mealTypesMap = {'3':['B','L','D'],'4':['B','L','D','S1'],'5':['B','L','D','S1','S2']};
    const requiredMeals = mealTypesMap[eatingOccasions]||mealTypesMap['3'];
    const costInstruction = {'Extreme Budget':"STRICTLY lowest cost...",'Quality Focus':"Premium quality...",'Best Value':"Balance cost/quality..."}[costPriority]||"Balance cost/quality...";
    const maxRepetitions = {'High Repetition':3,'Low Repetition':1,'Balanced Variety':2}[mealVariety]||2;
    const cuisineInstruction = creativeIdeas ? `Use creative ideas: ${creativeIdeas}` : (cuisine&&cuisine.trim()?`Focus: ${cuisine}.`:'Neutral.');
    
    // Get the list of known food names from our DB to guide the AI
    const knownFoodNames = Array.from(INGREDIENT_DB.keys());

    const toleranceBlock = `
    TARGETS (FOR YOUR GUIDANCE):
    - Calories: ${targetTotals.calories} kcal
    - Protein: ${targetTotals.protein} g
    - Fat: ${targetTotals.fat} g
    - Carbs: ${targetTotals.carbs} g
    `;

    const systemPrompt = `You are an expert dietitian and creative chef. Your ONLY job is to create a structured meal plan JSON.
    My code will handle all ingredient searching, nutrition math, and verification.
    
    RULES:
    1.  You MUST generate a JSON object with one key: "mealPlan".
    2.  "mealPlan": An array of Day objects for ${days} days.
    3.  Each Day object has a "day" number and a "meals" array.
    4.  Each Meal object has "type" (e.g., "B", "L", "D"), "name" (a creative meal name), and an "items" array.
    5.  Each Item object MUST have "food_name" and "grams".
    6.  "food_name": Must be a simple string that EXACTLY MATCHES one of the following known food names:
        ${knownFoodNames.join(', ')}
    7.  "grams": Your BEST ESTIMATE of the gram amount for this item in the meal.
    8.  CRITICAL: You MUST adhere to the user's meal plan constraints (days, meal types, variety, dietary).
    9.  Try to create a plan whose total estimated nutrition is close to the user's targets. My code will fix small errors.
    10. ${costInstruction}
    11. MEAL VARIETY: Do not repeat the same meal "name" more than ${maxRepetitions} times.
    `;
    
    const userQuery = `
    ${toleranceBlock}
    
    USER PROFILE:
    - ${age}yo ${gender}, ${height}cm, ${weight}kg.
    - Activity: ${formData.activityLevel}
    - Goal: ${goal}
    - Dietary: ${dietary}
    - Meals per day: ${eatingOccasLgions} (${requiredMeals.join(', ')})
    - Variety: ${mealVariety} (Max ${maxRepetitions} reps)
    - Cuisine: ${cuisineInstruction}
    
    Generate the ${days}-day JSON plan.
    `;
    
    log("Technical Prompt (Mark 45)", 'INFO', 'LLM_PROMPT', { userQuery: userQuery.substring(0, 1000) + '...', sanitizedData: getSanitizedFormData(formData) });

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.0, // Deterministic output
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "mealPlan": {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "day": { "type": "NUMBER" },
                                "meals": {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            "type": { "type": "STRING" },
                                            "name": { "type": "STRING" },
                                            "items": {
                                                type: "ARRAY",
                                                items: {
                                                    type: "OBJECT",
                                                    properties: {
                                                        "food_name": { "type": "STRING" },
                                                        "grams": { "type": "NUMBER" }
                                                    },
                                                    required: ["food_name", "grams"]
                                                }
                                            }
                                        },
                                        required: ["type", "name", "items"]
                                    }
                                }
                            },
                            required: ["day", "meals"]
                        }
                    }
                },
                required: ["mealPlan"]
            }
        }
    };

    try {
        const response = await fetchWithRetry(
            GEMINI_API_URL, 
            { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
                body: JSON.stringify(payload) 
            }, 
            log
        );
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) {
            log("Technical AI returned no JSON text.", 'CRITICAL', 'LLM', result);
            throw new Error("LLM response was empty or contained no text part.");
        }
        log("Technical Raw", 'INFO', 'LLM', { raw: jsonText.substring(0, 1000) + '...' });
        try {
            const parsed = JSON.parse(jsonText);
            log("Parsed Technical", 'INFO', 'DATA', { hasMealPlan: !!parsed.mealPlan?.length });
            if (!parsed || !parsed.mealPlan) {
                 log("Validation Error: Root response is not valid.", 'CRITICAL', 'LLM', parsed);
                 throw new Error("LLM response was not a valid object with required keys.");
            }
            return parsed;
        } catch (e) {
            log("Failed to parse Technical AI JSON.", 'CRITICAL', 'LLM', { jsonText: jsonText.substring(0, 1000), error: e.message });
            throw new Error(`Failed to parse LLM JSON: ${e.message}`);
        }
    } catch (error) {
         log(`Technical AI call failed definitively: ${error.message}`, 'CRITICAL', 'LLM');
         throw error;
    }
}
// --- END MODIFICATION (Mark 45) ---

/// ===== NUTRITION-CALC-START ===== \\\\
// This block contains the industry-standard calculation stack.
// No changes from Mark 42.

function calculateCalorieTarget(formData, log = console.log) {
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);

    if (isNaN(weightKg) || isNaN(heightCm) || isNaN(ageYears) || !gender || !activityLevel || !goal) {
        log("Missing or invalid profile data for calorie calculation, using default 2000.", 'WARN', 'CALC', getSanitizedFormData({ weight, height, age, gender, activityLevel, goal}));
        return 2000;
    }

    // 1. BMR (Mifflin-St Jeor): (10W + 6.25H - 5A + S)
    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);
    
    // 2. TDEE (Activity Factor)
    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    let multiplier = activityMultipliers[activityLevel];
     if (!multiplier) {
         log(`Invalid activityLevel "${activityLevel}", using default 1.55.`, 'WARN', 'CALC');
         multiplier = 1.55;
     }
    const tdee = bmr * multiplier;
    
    // 3. Goal Adjustment (Energy Modifier)
    const goalAdjustments = {
        maintain: 0,
        cut_moderate: - (tdee * 0.15), // -15% deficit
        cut_aggressive: - (tdee * 0.25), // -25% deficit
        bulk_lean: + (tdee * 0.15),    // +15% surplus
        bulk_aggressive: + (tdee * 0.25)     // +25% surplus
    };
    
    let adjustment = goalAdjustments[goal];
    if (adjustment === undefined) {
         log(`Invalid goal "${goal}", using default 'maintain' (0 adjustment).`, 'WARN', 'CALC');
         adjustment = 0;
    }
    
    log(`Calorie Calc: BMR=${bmr.toFixed(0)}, TDEE=${tdee.toFixed(0)}, Goal=${goal}, Adjustment=${adjustment.toFixed(0)}`, 'INFO', 'CALC');
    
    return Math.max(1200, Math.round(tdee + adjustment));
}


function calculateMacroTargets(calorieTarget, goal, weightKg, log) {
    
    // 4a. Define Macronutrient Percentages by Goal
    const macroSplits = {
        'cut_aggressive': { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'cut_moderate':   { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'maintain':       { pPct: 0.30, fPct: 0.30, cPct: 0.40 },
        'bulk_lean':      { pPct: 0.25, fPct: 0.25, cPct: 0.50 },
        'bulk_aggressive':{ pPct: 0.20, fPct: 0.25, cPct: 0.55 }
    };

    const split = macroSplits[goal] || macroSplits['maintain'];
    if (!macroSplits[goal]) {
        log(`Invalid goal "${goal}" for macro split, using 'maintain' defaults.`, 'WARN', 'CALC');
    }

    let proteinGrams = (calorieTarget * split.pPct) / 4;
    let fatGrams = (calorieTarget * split.fPct) / 9;
    let carbGrams = (calorieTarget * split.cPct) / 4;

    // 4b & 5. Validation Layers
    const validWeightKg = (typeof weightKg === 'number' && weightKg > 0) ? weightKg : 75;
    let proteinPerKg = proteinGrams / validWeightKg;
    let fatPerKg = fatGrams / validWeightKg;
    let fatPercent = (fatGrams * 9) / calorieTarget;
    let carbsNeedRecalc = false;

    // --- Sanity Check 1: Protein (Layer 5) ---
    const PROTEIN_MAX_G_PER_KG = 3.0;
    if (proteinPerKg > PROTEIN_MAX_G_PER_KG) {
        log(`ADJUSTMENT: Initial protein ${proteinPerKg.toFixed(1)}g/kg > ${PROTEIN_MAX_G_PER_KG}g/kg. Capping protein.`, 'WARN', 'CALC');
        proteinGrams = PROTEIN_MAX_G_PER_KG * validWeightKg;
        carbsNeedRecalc = true;
    }

    // --- Sanity Check 2: Fat (Layer 5) ---
    const FAT_MAX_PERCENT = 0.35;
    if (fatPercent > FAT_MAX_PERCENT) {
        log(`ADJUSTMENT: Initial fat ${fatPercent.toFixed(1)}% > ${FAT_MAX_PERCENT}%. Capping fat.`, 'WARN', 'CALC');
        fatGrams = (calorieTarget * FAT_MAX_PERCENT) / 9;
        carbsNeedRecalc = true;
    }

    // --- Recalculate Carbs (if any cap was hit) ---
    if (carbsNeedRecalc) {
        const proteinCalories = proteinGrams * 4;
        const fatCalories = fatGrams * 9;
        const carbCalories = calorieTarget - proteinCalories - fatCalories;
        carbGrams = carbCalories / 4;
        log(`RECALC: New Carb Target: ${carbGrams.toFixed(0)}g`, 'INFO', 'CALC');
    }

    // --- Guideline Logging (Layer 4b) ---
    const PROTEIN_MIN_G_PER_KG = 1.6;
    const PROTEIN_CUT_MAX_G_PER_KG = 2.4;
    proteinPerKg = proteinGrams / validWeightKg;
    if (proteinPerKg < PROTEIN_MIN_G_PER_KG) {
        log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is below the optimal ${PROTEIN_MIN_G_PER_KG}g/kg range.`, 'INFO', 'CALC');
    }
    if ((goal === 'cut_aggressive' || goal === 'cut_moderate') && proteinPerKg > PROTEIN_CUT_MAX_G_PER_KG) {
         log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/king is above the ${PROTEIN_CUT_MAX_G_PER_KG}g/kg recommendation for cutting.`, 'INFO', 'CALC');
    }

    const FAT_MIN_G_PER_KG = 0.8;
    fatPerKg = fatGrams / validWeightKg;
    if (fatPerKg < FAT_MIN_G_PER_KG) {
         log(`GUIDELINE: Fat target ${fatPerKg.toFixed(1)}g/kg is below the optimal ${FAT_MIN_G_PER_KG}g/kg minimum.`, 'INFO', 'CALC');
    }

    const finalProteinGrams = Math.round(proteinGrams);
    const finalFatGrams = Math.round(fatGrams);
    const finalCarbGrams = Math.round(carbGrams);
    
    log(`Calculated Macro Targets (Dual-Validation) (Goal: ${goal}, Cals: ${calorieTarget}, Weight: ${validWeightKg}kg): P ${finalProteinGrams}g, F ${finalFatGrams}g, C ${finalCarbGrams}g`, 'INFO', 'CALC');

    return { 
        proteinGrams: finalProteinGrams, 
        fatGrams: finalFatGrams, 
        carbGrams: finalCarbGrams 
    };
}

/// ===== NUTRITION-CALC-END ===== \\\\

