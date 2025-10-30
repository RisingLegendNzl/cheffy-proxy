/**
 * Cheffy Orchestrator (V12)
 * Cooking Transforms & Nutrition Calculation Logic
 *
 * This module contains the canonical logic for:
 * 1. Cooking yield/loss factors (dry -> cooked, raw -> cooked).
 * 2. Oil absorption rates based on cooking methods.
 * 3. Functions to convert "cooked" user-facing quantities back to "as_sold" (dry/raw) equivalents
 * for accurate calorie calculation.
 *
 * This file is in CommonJS format.
 */

const TRANSFORM_VERSION = "2025-10-30.1";

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

    // Meats (Raw to Cooked, by weight - represents water/fat loss)
    // 100g raw -> 75g cooked (so, cooked_weight / 0.75 = raw_weight)
    chicken: { raw_to_cooked: 0.75 },
    beef_lean: { raw_to_cooked: 0.70 },
    beef_fatty: { raw_to_cooked: 0.65 },
    pork: { raw_to_cooked: 0.72 },
    salmon: { raw_to_cooked: 0.80 },
    fish_white: { raw_to_cooked: 0.85 },

    // Veggies (mostly stable, but good to have)
    veg_watery: { raw_to_cooked: 0.85 }, // e.g., mushrooms, spinach
    veg_dense: { raw_to_cooked: 0.95 },  // e.g., broccoli, carrots
    potato: { raw_to_cooked: 0.90 },    // baked/boiled

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
 * Helper to pick the right yield factor based on the item key.
 * @param {string} itemKey - The generic ingredient name (e.g., "Cooked brown rice").
 * @returns {{yieldFactor: number, factorType: 'dry_to_cooked' | 'raw_to_cooked'}}
 */
function getYield(itemKey) {
    const key = (itemKey || '').toLowerCase();

    if (key.includes('rice')) return { yieldFactor: YIELDS.rice.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('pasta') || key.includes('noodle')) return { yieldFactor: YIELDS.pasta.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('oat') || key.includes('porridge')) return { yieldFactor: YIELDS.oats.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('quinoa')) return { yieldFactor: YIELDS.quinoa.dry_to_cooked, factorType: 'dry_to_cooked' };
    if (key.includes('lentil')) return { yieldFactor: YIELDS.lentils.dry_to_cooked, factorType: 'dry_to_cooked' };

    if (key.includes('chicken')) return { yieldFactor: YIELDS.chicken.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('beef') || key.includes('steak') || key.includes('mince')) {
        const factor = key.includes('lean') ? YIELDS.beef_lean.raw_to_cooked : YIELDS.beef_fatty.raw_to_cooked;
        return { yieldFactor: factor, factorType: 'raw_to_cooked' };
    }
    if (key.includes('pork')) return { yieldFactor: YIELDS.pork.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('salmon')) return { yieldFactor: YIELDS.salmon.raw_to_cooked, factorType: 'raw_to_cooked' };
    if (key.includes('fish')) return { yieldFactor: YIELDS.fish_white.raw_to_cooked, factorType: 'raw_to_cooked' };

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
 * @param {object} item - The meal item object.
 * @param {function} log - The logger function.
 * @returns {{stateHint: string, methodHint: string | null}}
 */
function inferHints(item, log) {
    let { key, stateHint, methodHint } = item;
    const keyLower = (key || '').toLowerCase();

    // If stateHint is provided and valid, trust it.
    const validHints = ["dry", "raw", "cooked", "as_pack"];
    if (stateHint && validHints.includes(stateHint)) {
        return { stateHint, methodHint };
    }

    // AI did not provide state, we must infer
    log(`[inferHints] No/invalid stateHint '${stateHint}' for '${key}', inferring...`, 'WARN', 'CALC');

    if (keyLower.includes('cooked') || keyLower.includes('baked') || keyLower.includes('grilled') || keyLower.includes('steamed') || keyLower.includes('boiled')) {
        stateHint = 'cooked';
    } else if (keyLower.includes('rice') || keyLower.includes('pasta') || keyLower.includes('oats') || keyLower.includes('quinoa')) {
        // Assumption: If AI gives a grain quantity, it's the final *cooked* amount.
        stateHint = 'cooked';
        log(`[inferHints] Inferred '${key}' as 'cooked'.`, 'DEBUG', 'CALC');
    } else if (keyLower.includes('chicken') || keyLower.includes('beef') || keyLower.includes('pork') || keyLower.includes('salmon') || keyLower.includes('fish') || keyLower.includes('mince') || keyLower.includes('steak')) {
        // Assumption: If AI gives a meat quantity, it's the *raw* (as-sold) amount.
        stateHint = 'raw';
        log(`[inferHints] Inferred '${key}' as 'raw'.`, 'DEBUG', 'CALC');
    } else {
        // Default assumption: as_pack (e.g., yogurt, milk, bread, oil, sauce, cheese)
        stateHint = 'as_pack';
        log(`[inferHints] Inferred '${key}' as 'as_pack'.`, 'DEBUG', 'CALC');
    }

    // Simple method inference if not provided
    if (!methodHint) {
        if (keyLower.includes('baked')) methodHint = 'baked';
        else if (keyLower.includes('grilled')) methodHint = 'grilled';
        else if (keyLower.includes('boiled') || keyLower.includes('steamed')) methodHint = 'boiled';
        else if (keyLower.includes('rice') || keyLower.includes('pasta')) methodHint = 'boiled';
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
    const { stateHint, methodHint } = inferHints(item, log);
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

    log(`[toAsSold] ${key}: ${log_msg}`, 'DEBUG', 'CALC');
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
    const oilAbsorptionRate = getOilAbsorptionRate(methodHint);

    if (oilAbsorptionRate === 0) {
        return { absorbed_oil_g: 0, log_msg: `method='${methodHint || 'none'}', oil_abs=0%` };
    }

    // Find the oil in the meal. Assumes *one* oil item per meal.
    const oilItem = mealItems.find(i => (i.key || '').toLowerCase().includes('oil'));
    if (!oilItem || !oilItem.qty_value) { // [V12] Check qty_value
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
        const m = (inferHints(i, () => {}).methodHint || '').toLowerCase();
        return (m.includes('pan_fried') || m.includes('roasted')) && !(i.key || '').toLowerCase().includes('oil');
    });

    if (friedItems.length === 0) {
        return { absorbed_oil_g: 0, log_msg: `method='${methodHint}', no fried items found` };
    }

    // Calculate total weight of fried items to get proportion
    let totalFriedWeight = 0;
    for (const friedItem of friedItems) {
        const { value: gOrMl } = normalizeToGramsOrMl(friedItem, log);
        const { grams_as_sold } = toAsSold(friedItem, gOrMl, log);
        totalFriedWeight += grams_as_sold;
    }

    if (totalFriedWeight === 0) {
         return { absorbed_oil_g: 0, log_msg: `method='${methodHint}', total fried weight is 0` };
    }
    
    // Get this item's as_sold weight
    const { value: currentGOrMl } = normalizeToGramsOrMl(item, log);
    const { grams_as_sold: currentAsSoldWeight } = toAsSold(item, currentGOrMl, log);

    // Calculate this item's share of the absorbed oil
    const thisItemProportion = currentAsSoldWeight / totalFriedWeight;
    const absorbed_oil_g = (oil_g_total_in_meal * oilAbsorptionRate) * thisItemProportion;
    
    const log_msg = `method='${methodHint}', absorbed ${absorbed_oil_g.toFixed(1)}g oil (${(thisItemProportion * 100).toFixed(0)}% of total abs.)`;
    log(`[getAbsorbedOil] ${item.key}: ${log_msg}`, 'DEBUG', 'CALC');
    return { absorbed_oil_g, log_msg };
}

module.exports = {
    TRANSFORM_VERSION,
    YIELDS,
    OIL_ABSORPTION,
    toAsSold,
    getAbsorbedOil,
    inferHints,
    getOilAbsorptionRate,
    getYield
};


