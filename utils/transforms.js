/**
 * Cheffy Orchestrator (V14.0)
 * Cooking Transforms & Nutrition Calculation Logic
 *
 * This module contains the canonical logic for:
 * 1. Unit Normalization (g/ml, heuristics).
 * 2. Cooking yield/loss factors (dry -> cooked, raw -> cooked).
 * 3. Oil absorption rates based on cooking methods.
 * 4. Functions to convert "cooked" user-facing quantities back to "as_sold" (dry/raw) equivalents
 * for accurate calorie calculation.
 *
 * ARCHITECTURAL VERIFICATION (Phase 4): Confirmed logic relies ONLY on generic ingredient key/state
 * and is entirely independent of market run product data (barcode, product name).
 *
 * This file is in CommonJS format.
 */

const TRANSFORM_VERSION = "2025-11-27.3"; // Phase 4 update: Ingredient-centric architecture verified.

// --- Moved from day.js: Unit Normalization Dependencies ---
// PHASE 2: Expanded to support size hints (small/medium/large)
const CANONICAL_UNIT_WEIGHTS_G = {
    'egg': 50, 'slice': 35, 'piece': 150, 'banana': 120, 'potato': 200, 'medium pancake': 60, 'large tortilla': 60, 'bun': 55
    // --- TACTICAL FIX (Solution 1) ---
    // Removed ambiguous generic keys: 'medium': 150, 'large': 200
    // These keys caused "1 large egg" to be mis-calculated as 200g (1360 kcal)
    // instead of allowing the logic to fall back to the key-based heuristic ('egg': 50).
    // This directly fixes the bug identified in the logs.
    // ---------------------------------
};

// --- PHASE 2: Dynamic Unit Weights with Size Hints ---
/**
 * Size-aware unit weight lookup table.
 * Each item has a default weight and optional size variants.
 * Values are in grams.
 */
const UNIT_WEIGHTS = {
    // Eggs
    egg: { default: 50, small: 40, medium: 50, large: 55, xl: 65, jumbo: 70, extra_large: 65 },
    
    // Fruits
    banana: { default: 120, small: 100, medium: 120, large: 150 },
    apple: { default: 180, small: 150, medium: 180, large: 220 },
    orange: { default: 130, small: 100, medium: 130, large: 180 },
    avocado: { default: 150, small: 120, medium: 150, large: 200, hass: 150 },
    mango: { default: 200, small: 150, medium: 200, large: 280 },
    pear: { default: 180, small: 140, medium: 180, large: 220 },
    peach: { default: 150, small: 120, medium: 150, large: 180 },
    kiwi: { default: 75, small: 60, medium: 75, large: 90 },
    
    // Vegetables
    potato: { default: 200, small: 150, medium: 200, large: 280, baby: 50 },
    sweet_potato: { default: 200, small: 150, medium: 200, large: 280 },
    tomato: { default: 120, small: 80, medium: 120, large: 180, cherry: 15, roma: 60 },
    onion: { default: 150, small: 100, medium: 150, large: 200 },
    carrot: { default: 80, small: 50, medium: 80, large: 120, baby: 10 },
    
    // Proteins
    chicken_breast: { default: 175, small: 140, medium: 175, large: 225 },
    chicken_thigh: { default: 110, small: 85, medium: 110, large: 140 },
    chicken_drumstick: { default: 100, small: 80, medium: 100, large: 130 },
    
    // Bread/Bakery
    slice: { default: 35, thin: 25, regular: 35, thick: 50 },
    bun: { default: 55, small: 45, regular: 55, large: 70, brioche: 60 },
    tortilla: { default: 45, small: 30, medium: 45, large: 65, wrap: 65 },
    pancake: { default: 60, small: 40, medium: 60, large: 90 },
    muffin: { default: 115, mini: 30, regular: 115, large: 140 },
    bagel: { default: 100, mini: 60, regular: 100, large: 130 },
    croissant: { default: 60, mini: 30, regular: 60, large: 80 },
    
    // Generic fallbacks
    piece: { default: 150 },
};

/**
 * Extracts a size hint from an ingredient key.
 * * @param {string} key - The ingredient key
 * @returns {string|null} Size hint or null
 */
function extractSizeHint(key) {
    const keyLower = (key || '').toLowerCase();
    
    if (keyLower.includes('jumbo')) return 'jumbo';
    if (keyLower.includes('extra large') || keyLower.includes('extra_large') || keyLower.includes('xl')) return 'xl';
    if (keyLower.includes('large')) return 'large';
    if (keyLower.includes('medium')) return 'medium';
    if (keyLower.includes('small')) return 'small';
    if (keyLower.includes('mini')) return 'mini';
    if (keyLower.includes('baby')) return 'baby';
    if (keyLower.includes('thin')) return 'thin';
    if (keyLower.includes('thick')) return 'thick';
    if (keyLower.includes('cherry')) return 'cherry';
    if (keyLower.includes('roma')) return 'roma';
    if (keyLower.includes('hass')) return 'hass';
    if (keyLower.includes('brioche')) return 'brioche';
    
    return null;
}

/**
 * Gets the weight for a unit-based item, considering size hints.
 * * @param {string} key - The ingredient key
 * @param {string} unit - The unit (e.g., 'egg', 'slice')
 * @param {string|null} sizeHint - Optional size hint
 * @returns {number} Weight in grams
 */
function getUnitWeight(key, unit, sizeHint = null) {
    const keyLower = (key || '').toLowerCase();
    const unitLower = (unit || '').toLowerCase().replace(/s$/, ''); // Remove trailing 's'
    
    // First, try to find a matching config by key (e.g., 'chicken_breast')
    let config = null;
    for (const [itemKey, weights] of Object.entries(UNIT_WEIGHTS)) {
        if (keyLower.includes(itemKey.replace(/_/g, ' ')) || keyLower.includes(itemKey)) {
            config = weights;
            break;
        }
    }
    
    // If no key match, try unit itself (e.g., 'slice', 'bun')
    if (!config && UNIT_WEIGHTS[unitLower]) {
        config = UNIT_WEIGHTS[unitLower];
    }
    
    // If still no config, fall back to CANONICAL_UNIT_WEIGHTS_G
    if (!config) {
        return CANONICAL_UNIT_WEIGHTS_G[unitLower] || CANONICAL_UNIT_WEIGHTS_G['piece'] || 150;
    }
    
    // Apply size hint if provided
    if (sizeHint) {
        const sizeNormalized = sizeHint.toLowerCase().replace(/[- ]/g, '_');
        if (config[sizeNormalized] !== undefined) {
            return config[sizeNormalized];
        }
    }
    
    return config.default;
}
// --- END PHASE 2 ADDITION ---
const DENSITY_MAP = {
    'milk': 1.03, 'cream': 1.01, 'oil': 0.92, 'sauce': 1.05, 'water': 1.0,
    'juice': 1.04, 'yogurt': 1.05, 'wine': 0.98, 'beer': 1.01, 'syrup': 1.33
};
// --- End Moved Dependencies ---

// 1. Yields Table (YIELDS[key].dry_to_cooked = 2.75 means 100g dry -> 275g cooked)
// To convert "cooked" back to "dry", we divide: cooked_weight / dry_to_cooked
const YIELDS = {
    // Grains (Dry to Cooked, by weight)
    rice: { dry_to_cooked: 3.0 },       // 100g dry rice -> ~300g cooked
    pasta: { dry_to_cooked: 2.5 },      // 100g dry pasta -> ~250g cooked
    oats: { dry_to_cooked: 3.5 },       // 100g dry oats -> ~350g cooked (varies greatly)
    quinoa: { dry_to_cooked: 3.0 },
    couscous: { dry_to_cooked: 2.5 },
    lentils: { dry_to_cooked: 2.8 },

    // --- PHASE 1 ADDITION: Additional grains ---
    bulgur: { dry_to_cooked: 2.8 },
    barley: { dry_to_cooked: 3.5 },
    farro: { dry_to_cooked: 3.0 },
    buckwheat: { dry_to_cooked: 3.0 },
    millet: { dry_to_cooked: 3.5 },
    
    // --- PHASE 1 ADDITION: Additional legumes ---
    chickpea: { dry_to_cooked: 2.5 },
    chickpeas: { dry_to_cooked: 2.5 },
    black_bean: { dry_to_cooked: 2.5 },
    kidney_bean: { dry_to_cooked: 2.5 },
    // --- END PHASE 1 ADDITION ---
    
    // --- PHASE 2 ADDITION: Additional grains ---
    freekeh: { dry_to_cooked: 2.5 },
    spelt: { dry_to_cooked: 2.8 },
    teff: { dry_to_cooked: 3.5 },
    amaranth: { dry_to_cooked: 2.5 },
    // --- END PHASE 2 ADDITION ---
    
    // --- PHASE 2 ADDITION: Additional legumes ---
    split_pea: { dry_to_cooked: 2.5 },
    black_eyed_pea: { dry_to_cooked: 2.5 },
    navy_bean: { dry_to_cooked: 2.5 },
    pinto_bean: { dry_to_cooked: 2.5 },
    // --- END PHASE 2 ADDITION ---

    // Meats (Raw to Cooked, by weight - represents water/fat loss)
    // 100g raw -> 75g cooked (so, cooked_weight / 0.75 = raw_weight)
    chicken: { raw_to_cooked: 0.75 },
    beef_lean: { raw_to_cooked: 0.70 },
    beef_fatty: { raw_to_cooked: 0.65 },
    pork: { raw_to_cooked: 0.72 },
    salmon: { raw_to_cooked: 0.80 },
    fish_white: { raw_to_cooked: 0.85 },
    
    // --- PHASE 1 ADDITION: Additional proteins ---
    lamb: { raw_to_cooked: 0.70 },
    turkey: { raw_to_cooked: 0.75 },
    prawn: { raw_to_cooked: 0.85 },
    shrimp: { raw_to_cooked: 0.85 },
    tuna: { raw_to_cooked: 0.80 },
    // --- END PHASE 1 ADDITION ---
    
    // --- PHASE 2 ADDITION: Additional proteins ---
    duck: { raw_to_cooked: 0.65 },      // Higher fat loss
    goat: { raw_to_cooked: 0.72 },
    veal: { raw_to_cooked: 0.75 },
    venison: { raw_to_cooked: 0.75 },
    kangaroo: { raw_to_cooked: 0.72 },  // Australian game meat
    // --- END PHASE 2 ADDITION ---

    // Veggies (mostly stable, but good to have)
    veg_watery: { raw_to_cooked: 0.85 }, // e.g., mushrooms, spinach
    veg_dense: { raw_to_cooked: 0.95 },  // e.g., broccoli, carrots
    potato: { raw_to_cooked: 0.90 },    // baked/boiled
    
    // --- PHASE 1 ADDITION: Sweet potato (distinct from potato) ---
    sweet_potato: { raw_to_cooked: 0.85 },
    // --- END PHASE 1 ADDITION ---

    // Default catch-alls
    default_grain: { dry_to_cooked: 2.8 },
    default_meat: { raw_to_cooked: 0.75 },
    default_veg: { raw_to_cooked: 0.90 },
    default: { raw_to_cooked: 1.0 } // 1:1, no change
};

// 2. Oil Absorption Table
// Represents the % of *added* oil that is absorbed by the food.
// 10ml oil (9.2g) * 0.25 = 2.3g oil absorbed
const OIL_ABSORPTION = {
    pan_fried: 0.30, // 30%
    pan_fried_lean_meat: 0.25, // 25%
    pan_fried_veg: 0.30, // 30%
    roasted: 0.15, // 15%
    baked: 0.05, // 5%
    grilled: 0.0,
    boiled: 0.0,
    steamed: 0.0,
    default: 0.0 // Assume no absorption if unknown
};

/**
 * --- Moved from day.js: Unit Normalization Function ---
 * Normalizes item quantity to grams or ml.
 * @param {object} item - The meal item object.
 * @param {function} log - The logger function.
 * @returns {{ value: number, unit: 'g' | 'ml' }}
 */
function normalizeToGramsOrMl(item, log) {
    // Ensure log is a function, provide a dummy if not
    const safeLog = typeof log === 'function' ? log : () => {};

    if (!item || typeof item !== 'object') {
        safeLog(`[Unit Conversion] Invalid item received: ${item}`, 'ERROR', 'CALC');
        return { value: 0, unit: 'g' }; // Default to 0g on error
    }

    let { qty_value: qty, qty_unit: unit, key } = item;

    // Basic validation
    if (typeof qty !== 'number' || isNaN(qty) || typeof unit !== 'string' || typeof key !== 'string') {
        safeLog(`[Unit Conversion] Invalid fields in item:`, 'ERROR', 'CALC', item);
        return { value: 0, unit: 'g' };
    }

    unit = unit.toLowerCase().trim().replace(/s$/, '');
    key = key.toLowerCase();

    if (unit === 'g' || unit === 'ml') return { value: qty, unit: unit };
    if (unit === 'kg') return { value: qty * 1000, unit: 'g' };
    if (unit === 'l') return { value: qty * 1000, unit: 'ml' };

    // Use density map for ml conversion first (converts ml to g)
    if (unit === 'ml') {
        let density = 1.0;
        const foundDensityKey = Object.keys(DENSITY_MAP).find(k => key.includes(k));
        if (foundDensityKey) {
            density = DENSITY_MAP[foundDensityKey];
        }
        safeLog(`[Unit Conversion] Converting ${qty}ml of '${key}' to ${qty * density}g using density ${density}.`, 'DEBUG', 'CALC');
        return { value: qty * density, unit: 'g' }; // Convert ml to g for calculation consistency
    }

    // Heuristic unit weights (converts pieces/slices etc. to g)
    // PHASE 2: Use dynamic unit weights with size hints
    const sizeHint = extractSizeHint(key);
    let weightPerUnit = getUnitWeight(key, unit, sizeHint);
    let usedHeuristic = true;

    // Log if size hint was detected
    if (sizeHint) {
        safeLog(`[Unit Conversion] Detected size hint '${sizeHint}' for '${key}'`, 'DEBUG', 'CALC');
    }

    // Final check for weightPerUnit
    if (typeof weightPerUnit !== 'number' || isNaN(weightPerUnit) || weightPerUnit <= 0) {
        safeLog(`[Unit Conversion] Could not determine valid weight for unit '${unit}' key '${key}'. Defaulting to 150g.`, 'WARN', 'CALC', item);
        weightPerUnit = 150; // Use a reasonable default if lookup fails
        usedHeuristic = true;
    }

    const grams = qty * weightPerUnit;

    if (!['g', 'ml', 'kg', 'l'].includes(unit)) { // Log only non-standard conversions
        safeLog(`[Unit Conversion] Converting ${qty} ${unit} of '${key}' to ${grams}g using ${weightPerUnit}g/unit.`, 'DEBUG', 'CALC', { key, fromUnit: unit, qty, toGrams: grams, heuristic: usedHeuristic });
    }
    return { value: grams, unit: 'g' }; // Always return 'g' after heuristic conversion
}
// --- End Moved Unit Normalization ---


/**
 * Helper to pick the right yield factor based on the item key.
 * @param {string} itemKey - The generic ingredient name (e.g., "Cooked brown rice").
 * @returns {{yieldFactor: number, factorType: 'dry_to_cooked' | 'raw_to_cooked'}}
 */
function getYield(itemKey) {
    const key = (itemKey || '').toLowerCase();

    // --- PRIORITY CHECKS: Items that contain substrings of other items ---
    // Check 'goat' before 'oat' since 'goat' contains 'oat'
    if (key.includes('goat')) return { yieldFactor: YIELDS.goat.raw_to_cooked, factorType: 'raw_to_cooked' };

    // --- Grains (dry -> cooked) ---
    if (key.includes('rice')) return { yieldFactor: YIELDS.rice.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('pasta') || key.includes('noodle')) return { yieldFactor: YIELDS.pasta.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('oat') || key.includes('porridge')) return { yieldFactor: YIELDS.oats.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('quinoa')) return { yieldFactor: YIELDS.quinoa.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('couscous')) return { yieldFactor: YIELDS.couscous.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('lentil')) return { yieldFactor: YIELDS.lentils.dry_to_cooked, factorType: 'dry_to_cooked' };
    
    // --- PHASE 1 ADDITION: Additional grains ---
    if (key.includes('bulgur')) return { yieldFactor: YIELDS.bulgur.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('barley')) return { yieldFactor: YIELDS.barley.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('farro')) return { yieldFactor: YIELDS.farro.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('buckwheat')) return { yieldFactor: YIELDS.buckwheat.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('millet')) return { yieldFactor: YIELDS.millet.dry_to_cooked, factorType: 'dry_to_cooked' };
    
    // --- PHASE 1 ADDITION: Additional legumes ---
    if (key.includes('chickpea')) return { yieldFactor: YIELDS.chickpea.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('black bean') || key.includes('black_bean')) return { yieldFactor: YIELDS.black_bean.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('kidney bean') || key.includes('kidney_bean')) return { yieldFactor: YIELDS.kidney_bean.dry_to_cooked, factorType: 'dry_to_cooked' };
    // --- END PHASE 1 ADDITION ---
    
    // --- PHASE 2 ADDITION: Additional grains ---
    if (key.includes('freekeh')) return { yieldFactor: YIELDS.freekeh.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('spelt')) return { yieldFactor: YIELDS.spelt.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('teff')) return { yieldFactor: YIELDS.teff.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('amaranth')) return { yieldFactor: YIELDS.amaranth.dry_to_cooked, factorType: 'dry_to_cooked' };
    // --- END PHASE 2 ADDITION ---
    
    // --- PHASE 2 ADDITION: Additional legumes ---
    if (key.includes('split pea') || key.includes('split_pea')) return { yieldFactor: YIELDS.split_pea.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('black eyed') || key.includes('black_eyed')) return { yieldFactor: YIELDS.black_eyed_pea.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('navy bean') || key.includes('navy_bean')) return { yieldFactor: YIELDS.navy_bean.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('pinto bean') || key.includes('pinto_bean')) return { yieldFactor: YIELDS.pinto_bean.dry_to_cooked, factorType: 'dry_to_cooked' };
    // --- END PHASE 2 ADDITION ---

    // --- Meats (raw -> cooked) ---
    if (key.includes('chicken')) return { yieldFactor: YIELDS.chicken.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('beef') || key.includes('steak') || key.includes('mince')) {
        const factor = key.includes('lean') ? YIELDS.beef_lean.raw_to_cooked : YIELDS.beef_fatty.raw_to_cooked;
        return { yieldFactor: factor, factorType: 'raw_to_cooked' };
    }
    if (key.includes('pork')) return { yieldFactor: YIELDS.pork.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('salmon')) return { yieldFactor: YIELDS.salmon.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('fish')) return { yieldFactor: YIELDS.fish_white.raw_to_cooked, factorType: 'raw_to_cooked' };
    
    // --- PHASE 1 ADDITION: Additional proteins ---
    if (key.includes('lamb')) return { yieldFactor: YIELDS.lamb.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('turkey')) return { yieldFactor: YIELDS.turkey.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('prawn')) return { yieldFactor: YIELDS.prawn.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('shrimp')) return { yieldFactor: YIELDS.shrimp.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('tuna')) return { yieldFactor: YIELDS.tuna.raw_to_cooked, factorType: 'raw_to_cooked' };
    // --- END PHASE 1 ADDITION ---
    
    // --- PHASE 2 ADDITION: Additional proteins ---
    if (key.includes('duck')) return { yieldFactor: YIELDS.duck.raw_to_cooked, factorType: 'raw_to_cooked' };
    // Note: 'goat' is checked at the top of this function (before 'oat') to prevent false matching
    if (key.includes('veal')) return { yieldFactor: YIELDS.veal.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('venison')) return { yieldFactor: YIELDS.venison.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('kangaroo')) return { yieldFactor: YIELDS.kangaroo.raw_to_cooked, factorType: 'raw_to_cooked' };
    // --- END PHASE 2 ADDITION ---

    // --- Vegetables ---
    // PHASE 1 FIX: Check sweet_potato BEFORE potato to avoid incorrect matching
    if (key.includes('sweet potato') || key.includes('sweet_potato')) return { yieldFactor: YIELDS.sweet_potato.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('potato')) return { yieldFactor: YIELDS.potato.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('spinach') || key.includes('mushroom')) return { yieldFactor: YIELDS.veg_watery.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('broccoli') || key.includes('carrot') || key.includes('bean') || key.includes('veg')) {
        return { yieldFactor: YIELDS.veg_dense.raw_to_cooked, factorType: 'raw_to_cooked' };
    }

    // Fallback logic
    if (key.includes('grain') || key.includes('cereal')) return { yieldFactor: YIELDS.default_grain.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('meat') || key.includes('poultry')) return { yieldFactor: YIELDS.default_meat.raw_to_cooked, factorType: 'raw_to_cooked' };

    return { yieldFactor: YIELDS.default.raw_to_cooked, factorType: 'raw_to_cooked' }; // Default 1:1
}

/**
 * Helper to pick the right oil absorption factor.
 * @param {string} methodHint - The cooking method (e.g., "pan_fried").
 * @returns {number} The absorption rate (0.0 to 1.0).
 */
function getOilAbsorptionRate(methodHint) {
    const method = (methodHint || '').toLowerCase();
    if (method.includes('pan_fried')) return OIL_ABSORPTION.pan_fried;
    if (method.includes('roasted')) return OIL_ABSORPTION.roasted;
    if (method.includes('baked')) return OIL_ABSORPTION.baked;
    if (method.includes('grilled') || method.includes('boiled') || method.includes('steamed')) {
        return OIL_ABSORPTION.grilled; // 0.0
    }
    return OIL_ABSORPTION.default; // 0.0
}

/**
 * Infers stateHint and methodHint if the LLM fails to provide them.
 * * PHASE 1 UPDATE (2025): Aligned defaults with new prompt semantics.
 * - Grains now default to "dry" (was incorrectly "cooked")
 * - Expanded detection for proteins and packaged items
 * - Added telemetry logging when fallback is triggered
 * * @param {object} item - The meal item object.
 * @param {function} log - The logger function.
 * @returns {{stateHint: string, methodHint: string | null}}
 */
function inferHints(item, log) {
    // Ensure log is a function, provide a dummy if not
    const safeLog = typeof log === 'function' ? log : () => {};
    let { key, stateHint, methodHint } = item;
    const keyLower = (key || '').toLowerCase();

    // If stateHint is provided and valid, trust it.
    const validHints = ["dry", "raw", "cooked", "as_pack"];
    if (stateHint && validHints.includes(stateHint)) {
        return { stateHint, methodHint };
    }

    // --- PHASE 1 ADDITION: Telemetry for inference frequency ---
    // Every time this code path is hit, the LLM failed to provide valid stateHint.
    // This should be visible in logs for monitoring prompt compliance.
    safeLog(`[inferHints] FALLBACK TRIGGERED for '${key}' (stateHint was '${stateHint}'). LLM did not provide valid stateHint.`, 'WARN', 'CALC');
    // --- END PHASE 1 ADDITION ---

    // --- Priority 1: Explicit cooking words in the key ---
    if (keyLower.includes('cooked') || keyLower.includes('baked') || keyLower.includes('grilled') || 
        keyLower.includes('steamed') || keyLower.includes('boiled') || keyLower.includes('roasted') ||
        keyLower.includes('fried')) {
        stateHint = 'cooked';
        safeLog(`[inferHints] Inferred '${key}' as 'cooked' (cooking word in name).`, 'DEBUG', 'CALC');
    } 
    // --- Priority 2: Grains default to DRY (PHASE 1 FIX - was incorrectly "cooked") ---
    else if (keyLower.includes('rice') || keyLower.includes('pasta') || keyLower.includes('oats') || 
             keyLower.includes('oat') || keyLower.includes('quinoa') || keyLower.includes('couscous') || 
             keyLower.includes('lentil') || keyLower.includes('bulgur') || keyLower.includes('barley') || 
             keyLower.includes('farro') || keyLower.includes('buckwheat') || keyLower.includes('millet') ||
             keyLower.includes('porridge')) {
        // PHASE 1 FIX: Grains default to "dry" - quantities typically measured in dry weight
        stateHint = 'dry';
        safeLog(`[inferHints] Inferred '${key}' as 'dry' (grain - default to dry weight).`, 'DEBUG', 'CALC');
    } 
    // --- Priority 3: Proteins default to RAW ---
    else if (keyLower.includes('chicken') || keyLower.includes('beef') || keyLower.includes('pork') || 
             keyLower.includes('salmon') || keyLower.includes('fish') || keyLower.includes('mince') || 
             keyLower.includes('steak') || keyLower.includes('lamb') || keyLower.includes('turkey') ||
             keyLower.includes('prawn') || keyLower.includes('shrimp') || keyLower.includes('tuna') ||
             keyLower.includes('cod') || keyLower.includes('tofu') || keyLower.includes('tempeh')) {
        // Meats/proteins default to "raw" (as-sold weight from butcher/supermarket)
        stateHint = 'raw';
        safeLog(`[inferHints] Inferred '${key}' as 'raw' (protein).`, 'DEBUG', 'CALC');
    } 
    // --- Priority 4: Packaged items default to AS_PACK ---
    else if (keyLower.includes('yogurt') || keyLower.includes('yoghurt') || keyLower.includes('milk') || 
             keyLower.includes('cheese') || keyLower.includes('bread') || keyLower.includes('butter') || 
             keyLower.includes('cream') || keyLower.includes('juice') || keyLower.includes('sauce') || 
             keyLower.includes('oil') || keyLower.includes('honey') || keyLower.includes('syrup') || 
             keyLower.includes('jam') || keyLower.includes('whey') || keyLower.includes('protein powder') ||
             keyLower.includes('cereal') || keyLower.includes('granola')) {
        stateHint = 'as_pack';
        safeLog(`[inferHints] Inferred '${key}' as 'as_pack' (packaged item).`, 'DEBUG', 'CALC');
    } 
    // --- Default: as_pack (safest assumption for unknown items) ---
    else {
        stateHint = 'as_pack';
        safeLog(`[inferHints] Inferred '${key}' as 'as_pack' (default fallback).`, 'DEBUG', 'CALC');
    }

    // --- Method inference (only relevant if state is 'cooked') ---
    if (!methodHint) {
        if (keyLower.includes('baked')) methodHint = 'baked';
        else if (keyLower.includes('grilled')) methodHint = 'grilled';
        else if (keyLower.includes('boiled') || keyLower.includes('steamed')) methodHint = 'boiled';
        else if (keyLower.includes('fried')) methodHint = 'pan_fried';
        else if (keyLower.includes('roasted')) methodHint = 'roasted';
        // PHASE 1 FIX: Only infer boiled for grains if state is actually 'cooked'
        else if (stateHint === 'cooked' && (keyLower.includes('rice') || keyLower.includes('pasta') || 
                 keyLower.includes('quinoa') || keyLower.includes('oats'))) {
            methodHint = 'boiled'; // Common default for cooked grains
        }
        else if (stateHint === 'cooked') {
            // If cooked state was inferred but method wasn't obvious from name, default based on type
            if (keyLower.includes('chicken') || keyLower.includes('beef') || keyLower.includes('pork') || 
                keyLower.includes('mince') || keyLower.includes('steak')) {
                methodHint = 'pan_fried'; // Common default for meats
            } else if (keyLower.includes('potato') || keyLower.includes('veg')) {
                methodHint = 'boiled'; // Common default for veggies
            }
        }
    }

    return { stateHint, methodHint };
}

/**
 * Converts a meal item's quantity to its "as_sold" (raw/dry) equivalent.
 * e.g., "250g cooked rice" -> 83.3g dry rice
 * @param {object} item - The meal item object (must have key, qty_value, qty_unit).
 * @param {number} gramsOrMl - The quantity already normalized to g/ml.
 * @param {function} log - The logger function.
 * @returns {{grams_as_sold: number, log_msg: string, inferredState: string, inferredMethod: string | null}}
 */
function toAsSold(item, gramsOrMl, log) {
    // Ensure log is a function, provide a dummy if not
    const safeLog = typeof log === 'function' ? log : () => {};
    const { stateHint, methodHint } = inferHints(item, safeLog);
    const { key } = item;

    // "raw", "dry", and "as_pack" are all considered "as_sold". No conversion needed.
    if (stateHint === 'raw' || stateHint === 'dry' || stateHint === 'as_pack') {
        return {
            grams_as_sold: gramsOrMl,
            log_msg: `state='${stateHint}', using 'as_sold'`,
            inferredState: stateHint,
            inferredMethod: methodHint
        };
    }

    // --- State is 'cooked', must convert ---
    const { yieldFactor, factorType } = getYield(key);

    if (yieldFactor === 1.0) {
        return {
            grams_as_sold: gramsOrMl,
            log_msg: `state='cooked', no yield factor found`,
            inferredState: stateHint,
            inferredMethod: methodHint
        };
    }

    let grams_as_sold = gramsOrMl;
    let log_msg = '';

    if (factorType === 'dry_to_cooked') {
        // e.g., Rice: 250g cooked / 3.0 = 83.3g dry
        grams_as_sold = gramsOrMl / yieldFactor;
        log_msg = `state='cooked', ${gramsOrMl.toFixed(0)}g cooked -> ${grams_as_sold.toFixed(0)}g dry (/${yieldFactor.toFixed(2)})`;
    } else if (factorType === 'raw_to_cooked') {
        // e.g., Chicken: 150g cooked / 0.75 = 200g raw
        grams_as_sold = gramsOrMl / yieldFactor;
        log_msg = `state='cooked', ${gramsOrMl.toFixed(0)}g cooked -> ${grams_as_sold.toFixed(0)}g raw (/${yieldFactor.toFixed(2)})`;
    }

    safeLog(`[toAsSold] ${key}: ${log_msg}`, 'DEBUG', 'CALC');
    return {
        grams_as_sold,
        log_msg,
        inferredState: stateHint,
        inferredMethod: methodHint
    };
}

/**
 * Calculates absorbed oil for a *single* item based on its method and meal context.
 * @param {object} item - The specific item being calculated.
 * @param {string} methodHint - The inferred or provided cooking method.
 * @param {Array} mealItems - All items in the same meal (to find the oil).
 * @param {function} log - The logger function.
 * @returns {{absorbed_oil_g: number, log_msg: string}}
 */
function getAbsorbedOil(item, methodHint, mealItems, log) {
    // Ensure log is a function, provide a dummy if not
    const safeLog = typeof log === 'function' ? log : () => {};
    const oilAbsorptionRate = getOilAbsorptionRate(methodHint);

    if (oilAbsorptionRate === 0) {
        return { absorbed_oil_g: 0, log_msg: `method='${methodHint || 'none'}', oil_abs=0%` };
    }

    // Find the oil in the meal. Assumes *one* oil item per meal.
    const oilItem = mealItems.find(i => (i.key || '').toLowerCase().includes('oil'));
    if (!oilItem || !oilItem.qty_value) {
        return { absorbed_oil_g: 0, log_msg: `method='${methodHint}', no oil in meal` };
    }

    // Assume oil is in ml, convert to grams (density ~0.92)
    const oil_ml = oilItem.qty_value;
    const oil_g_total_in_meal = oil_ml * 0.92;

    // Check if *this* item is the one being cooked (not the oil itself)
    const keyLower = (item.key || '').toLowerCase();
    if (keyLower.includes('oil')) {
        return { absorbed_oil_g: 0, log_msg: `item is oil, no abs` };
    }
    
    // Simple model: Distribute absorbed oil proportionally by "as_sold" weight of fried items
    const friedItems = mealItems.filter(i => {
        const m = (inferHints(i, safeLog).methodHint || '').toLowerCase();
        // Consider roasted items as potentially absorbing oil too
        return (m.includes('pan_fried') || m.includes('roasted')) && !(i.key || '').toLowerCase().includes('oil');
    });

    if (friedItems.length === 0) {
        return { absorbed_oil_g: 0, log_msg: `method='${methodHint}', no fried/roasted items found` };
    }

    // Calculate total weight of fried/roasted items to get proportion
    let totalFriedWeight = 0;
    for (const friedItem of friedItems) {
        const { value: gOrMl } = normalizeToGramsOrMl(friedItem, safeLog);
        const { grams_as_sold } = toAsSold(friedItem, gOrMl, safeLog);
        totalFriedWeight += grams_as_sold;
    }

    if (totalFriedWeight <= 0) {
        return { absorbed_oil_g: 0, log_msg: `method='${methodHint}', total fried/roasted weight is ${totalFriedWeight}` };
    }
    
    // Get this item's as_sold weight
    const { value: currentGOrMl } = normalizeToGramsOrMl(item, safeLog);
    const { grams_as_sold: currentAsSoldWeight } = toAsSold(item, currentGOrMl, safeLog);

    // Calculate this item's share of the absorbed oil
    const thisItemProportion = currentAsSoldWeight >= 0 ? currentAsSoldWeight / totalFriedWeight : 0;
    const absorbed_oil_g = (oil_g_total_in_meal * oilAbsorptionRate) * thisItemProportion;
    
    const log_msg = `method='${methodHint}', absorbed ${absorbed_oil_g.toFixed(1)}g oil (${(thisItemProportion * 100).toFixed(0)}% of total abs.)`;
    safeLog(`[getAbsorbedOil] ${item.key}: ${log_msg}`, 'DEBUG', 'CALC');
    return { absorbed_oil_g, log_msg };
}

module.exports = {
    TRANSFORM_VERSION,
    YIELDS,
    OIL_ABSORPTION,
    UNIT_WEIGHTS,              // PHASE 2: Export new unit weights table
    normalizeToGramsOrMl,
    toAsSold,
    getAbsorbedOil,
    inferHints,
    getOilAbsorptionRate,
    getYield,
    getUnitWeight,             // PHASE 2: Export new function
    extractSizeHint,           // PHASE 2: Export new function
};

