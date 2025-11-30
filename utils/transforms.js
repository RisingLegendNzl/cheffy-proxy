/**
 * Cheffy Orchestrator (V15.1)
 * Cooking Transforms & Nutrition Calculation Logic
 *
 * This module contains the canonical logic for:
 * 1. Unit Normalization (g/ml, heuristics).
 * 2. Cooking yield/loss factors (dry -> cooked, raw -> cooked) with CONFIDENCE BANDS.
 * 3. Oil absorption rates based on cooking methods.
 * 4. Functions to convert "cooked" user-facing quantities back to "as_sold" (dry/raw) equivalents.
 *
 * REFACTOR NOTES:
 * - Deprecated internal keyword-based inference (inferHints).
 * - Now uses deterministic resolveState() from utils/stateResolver.js as fallback.
 * - Prioritizes explicit stateHint provided by the pipeline.
 */

const { emitAlert, alertYieldUnmapped, ALERT_LEVELS } = require('./alerting.js');
const { assertYieldsCoverage } = require('./invariants.js');
// [NEW] Single source of truth for state resolution
const { resolveState } = require('./stateResolver.js');

const TRANSFORM_VERSION = "2025-11-30.2-state-resolver";

// --- Unit Normalization Dependencies (Preserved) ---
const CANONICAL_UNIT_WEIGHTS_G = {
    'egg': 50, 'slice': 35, 'piece': 150, 'banana': 120, 'potato': 200, 'medium pancake': 60, 'large tortilla': 60, 'bun': 55
};

const UNIT_WEIGHTS = {
    egg: { default: 50, small: 40, medium: 50, large: 55, xl: 65, jumbo: 70, extra_large: 65 },
    banana: { default: 120, small: 100, medium: 120, large: 150 },
    apple: { default: 180, small: 150, medium: 180, large: 220 },
    orange: { default: 130, small: 100, medium: 130, large: 180 },
    avocado: { default: 150, small: 120, medium: 150, large: 200, hass: 150 },
    mango: { default: 200, small: 150, medium: 200, large: 280 },
    pear: { default: 180, small: 140, medium: 180, large: 220 },
    peach: { default: 150, small: 120, medium: 150, large: 180 },
    kiwi: { default: 75, small: 60, medium: 75, large: 90 },
    potato: { default: 200, small: 150, medium: 200, large: 280, baby: 50 },
    sweet_potato: { default: 200, small: 150, medium: 200, large: 280 },
    tomato: { default: 120, small: 80, medium: 120, large: 180, cherry: 15, roma: 60 },
    onion: { default: 150, small: 100, medium: 150, large: 200 },
    carrot: { default: 80, small: 50, medium: 80, large: 120, baby: 10 },
    chicken_breast: { default: 175, small: 140, medium: 175, large: 225 },
    chicken_thigh: { default: 110, small: 85, medium: 110, large: 140 },
    chicken_drumstick: { default: 100, small: 80, medium: 100, large: 130 },
    slice: { default: 35, thin: 25, regular: 35, thick: 50 },
    bun: { default: 55, small: 45, regular: 55, large: 70, brioche: 60 },
    tortilla: { default: 45, small: 30, medium: 45, large: 65, wrap: 65 },
    pancake: { default: 60, small: 40, medium: 60, large: 90 },
    muffin: { default: 115, mini: 30, regular: 115, large: 140 },
    bagel: { default: 100, mini: 60, regular: 100, large: 130 },
    croissant: { default: 60, mini: 30, regular: 60, large: 80 },
    piece: { default: 150 },
};

const DENSITY_MAP = {
    'milk': 1.03, 'cream': 1.01, 'oil': 0.92, 'sauce': 1.05, 'water': 1.0,
    'juice': 1.04, 'yogurt': 1.05, 'wine': 0.98, 'beer': 1.01, 'syrup': 1.33
};

// --- Expanded YIELDS Table (Preserved) ---
const YIELDS = {
    rice: { typical: 3.0, min: 2.5, max: 3.5, type: 'dry_to_cooked', confidence: 'high' },
    rice_jasmine: { typical: 2.8, min: 2.5, max: 3.2, type: 'dry_to_cooked', confidence: 'high' },
    rice_basmati: { typical: 3.0, min: 2.7, max: 3.3, type: 'dry_to_cooked', confidence: 'high' },
    rice_brown: { typical: 2.4, min: 2.1, max: 2.8, type: 'dry_to_cooked', confidence: 'high' },
    pasta: { typical: 2.5, min: 2.2, max: 2.8, type: 'dry_to_cooked', confidence: 'high' },
    pasta_spaghetti: { typical: 2.4, min: 2.1, max: 2.7, type: 'dry_to_cooked', confidence: 'high' },
    oats: { typical: 3.5, min: 3.0, max: 4.0, type: 'dry_to_cooked', confidence: 'medium' },
    quinoa: { typical: 3.0, min: 2.8, max: 3.2, type: 'dry_to_cooked', confidence: 'high' },
    couscous: { typical: 2.5, min: 2.0, max: 3.0, type: 'dry_to_cooked', confidence: 'high' },
    lentils: { typical: 2.8, min: 2.3, max: 3.0, type: 'dry_to_cooked', confidence: 'high' },
    bulgur: { typical: 2.8, min: 2.5, max: 3.1, type: 'dry_to_cooked', confidence: 'high' },
    barley: { typical: 3.5, min: 3.0, max: 4.0, type: 'dry_to_cooked', confidence: 'high' },
    chickpea: { typical: 2.5, min: 2.1, max: 2.9, type: 'dry_to_cooked', confidence: 'high' },
    black_bean: { typical: 2.5, min: 2.1, max: 2.9, type: 'dry_to_cooked', confidence: 'high' },
    kidney_bean: { typical: 2.5, min: 2.1, max: 2.9, type: 'dry_to_cooked', confidence: 'high' },
    chicken: { typical: 0.75, min: 0.70, max: 0.80, type: 'raw_to_cooked', confidence: 'high' },
    chicken_breast: { typical: 0.75, min: 0.70, max: 0.80, type: 'raw_to_cooked', confidence: 'high' },
    chicken_thigh: { typical: 0.70, min: 0.65, max: 0.75, type: 'raw_to_cooked', confidence: 'high' },
    beef_lean: { typical: 0.70, min: 0.65, max: 0.75, type: 'raw_to_cooked', confidence: 'high' },
    beef_fatty: { typical: 0.65, min: 0.60, max: 0.70, type: 'raw_to_cooked', confidence: 'high' },
    beef_steak: { typical: 0.75, min: 0.70, max: 0.80, type: 'raw_to_cooked', confidence: 'high' },
    pork: { typical: 0.72, min: 0.68, max: 0.76, type: 'raw_to_cooked', confidence: 'high' },
    salmon: { typical: 0.80, min: 0.75, max: 0.85, type: 'raw_to_cooked', confidence: 'high' },
    fish_white: { typical: 0.85, min: 0.80, max: 0.90, type: 'raw_to_cooked', confidence: 'high' },
    tuna: { typical: 0.80, min: 0.75, max: 0.85, type: 'raw_to_cooked', confidence: 'high' },
    shrimp: { typical: 0.85, min: 0.80, max: 0.90, type: 'raw_to_cooked', confidence: 'high' },
    potato: { typical: 0.90, min: 0.85, max: 0.95, type: 'raw_to_cooked', confidence: 'high' },
    sweet_potato: { typical: 0.85, min: 0.80, max: 0.90, type: 'raw_to_cooked', confidence: 'high' },
    veg_watery: { typical: 0.85, min: 0.75, max: 0.90, type: 'raw_to_cooked', confidence: 'medium' },
    veg_dense: { typical: 0.95, min: 0.90, max: 0.98, type: 'raw_to_cooked', confidence: 'medium' },
    default_grain: { typical: 2.8, min: 2.5, max: 3.5, type: 'dry_to_cooked', confidence: 'low' },
    default_meat: { typical: 0.75, min: 0.65, max: 0.85, type: 'raw_to_cooked', confidence: 'low' },
};

const OIL_ABSORPTION = {
    pan_fried: 0.30,
    pan_fried_lean_meat: 0.25,
    pan_fried_veg: 0.30,
    roasted: 0.15,
    baked: 0.05,
    grilled: 0.0,
    boiled: 0.0,
    steamed: 0.0,
    default: 0.0
};

// --- Functions ---

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

function getUnitWeight(key, unit, sizeHint = null) {
    const keyLower = (key || '').toLowerCase();
    const unitLower = (unit || '').toLowerCase().replace(/s$/, '');
    
    let config = null;
    for (const [itemKey, weights] of Object.entries(UNIT_WEIGHTS)) {
        if (keyLower.includes(itemKey.replace(/_/g, ' ')) || keyLower.includes(itemKey)) {
            config = weights;
            break;
        }
    }
    if (!config && UNIT_WEIGHTS[unitLower]) config = UNIT_WEIGHTS[unitLower];
    if (!config) return CANONICAL_UNIT_WEIGHTS_G[unitLower] || CANONICAL_UNIT_WEIGHTS_G['piece'] || 150;
    
    if (sizeHint) {
        const sizeNormalized = sizeHint.toLowerCase().replace(/[- ]/g, '_');
        if (config[sizeNormalized] !== undefined) return config[sizeNormalized];
    }
    return config.default;
}

function normalizeToGramsOrMl(item, log) {
    const safeLog = typeof log === 'function' ? log : () => {};
    if (!item || typeof item !== 'object') return { value: 0, unit: 'g' };

    let { qty_value: qty, qty_unit: unit, key } = item;
    if (typeof qty !== 'number' || isNaN(qty) || !unit || !key) return { value: 0, unit: 'g' };

    unit = unit.toLowerCase().trim().replace(/s$/, '');
    key = key.toLowerCase();

    if (unit === 'g' || unit === 'ml') return { value: qty, unit: unit };
    if (unit === 'kg') return { value: qty * 1000, unit: 'g' };
    if (unit === 'l') return { value: qty * 1000, unit: 'ml' };

    if (unit === 'ml') {
        let density = 1.0;
        const foundDensityKey = Object.keys(DENSITY_MAP).find(k => key.includes(k));
        if (foundDensityKey) density = DENSITY_MAP[foundDensityKey];
        return { value: qty * density, unit: 'g' };
    }

    const sizeHint = extractSizeHint(key);
    let weightPerUnit = getUnitWeight(key, unit, sizeHint);
    
    const grams = qty * weightPerUnit;
    safeLog(`[Unit Conversion] ${qty} ${unit} '${key}' -> ${grams}g (heuristic: ${weightPerUnit}g/unit)`, 'DEBUG', 'TRANSFORMS');
    
    return { value: grams, unit: 'g' };
}

function getYieldEntry(itemKey) {
    const key = (itemKey || '').toLowerCase();

    // 1. Specific Variant Checks
    if (key.includes('rice')) {
        if (key.includes('jasmine')) return YIELDS.rice_jasmine;
        if (key.includes('basmati')) return YIELDS.rice_basmati;
        if (key.includes('brown')) return YIELDS.rice_brown;
        return YIELDS.rice;
    }
    if (key.includes('pasta') || key.includes('noodle')) {
        if (key.includes('spaghetti')) return YIELDS.pasta_spaghetti;
        return YIELDS.pasta;
    }
    if (key.includes('chicken')) {
        if (key.includes('breast')) return YIELDS.chicken_breast;
        if (key.includes('thigh')) return YIELDS.chicken_thigh;
        return YIELDS.chicken;
    }
    if (key.includes('beef') || key.includes('steak') || key.includes('mince')) {
        return key.includes('lean') ? YIELDS.beef_lean : YIELDS.beef_fatty;
    }

    // 2. Direct Category Matches
    if (key.includes('oat') || key.includes('porridge')) return YIELDS.oats;
    if (key.includes('quinoa')) return YIELDS.quinoa;
    if (key.includes('couscous')) return YIELDS.couscous;
    if (key.includes('lentil')) return YIELDS.lentils;
    if (key.includes('bulgur')) return YIELDS.bulgur;
    if (key.includes('barley')) return YIELDS.barley;

    if (key.includes('chickpea')) return YIELDS.chickpea;
    if (key.includes('black bean') || key.includes('black_bean')) return YIELDS.black_bean;
    if (key.includes('kidney bean') || key.includes('kidney_bean')) return YIELDS.kidney_bean;

    if (key.includes('pork')) return YIELDS.pork;
    if (key.includes('salmon')) return YIELDS.salmon;
    if (key.includes('fish')) return YIELDS.fish_white;
    if (key.includes('tuna')) return YIELDS.tuna;
    if (key.includes('shrimp') || key.includes('prawn')) return YIELDS.shrimp;

    // 3. Veggies
    if (key.includes('sweet potato') || key.includes('sweet_potato')) return YIELDS.sweet_potato;
    if (key.includes('potato')) return YIELDS.potato;
    if (key.includes('spinach') || key.includes('mushroom')) return YIELDS.veg_watery;
    if (key.includes('broccoli') || key.includes('carrot') || key.includes('bean') || key.includes('veg')) return YIELDS.veg_dense;

    // 4. Fallbacks
    if (key.includes('grain') || key.includes('cereal')) return YIELDS.default_grain;
    if (key.includes('meat') || key.includes('poultry')) return YIELDS.default_meat;

    return null;
}

function getOilAbsorptionRate(methodHint) {
    const method = (methodHint || '').toLowerCase();
    if (method.includes('pan_fried')) return OIL_ABSORPTION.pan_fried;
    if (method.includes('roasted')) return OIL_ABSORPTION.roasted;
    if (method.includes('baked')) return OIL_ABSORPTION.baked;
    return OIL_ABSORPTION.default;
}

/**
 * @deprecated Since 2025-11-30. Use resolveState() from utils/stateResolver.js instead.
 * This function is retained for backward compatibility only.
 * All production code paths now use the deterministic state resolver.
 * Do NOT use in new code.
 */
function inferHints(item, log) {
    const safeLog = typeof log === 'function' ? log : () => {};
    safeLog('[DEPRECATED] inferHints() called. Use resolveState() from utils/stateResolver.js', 'WARN', 'DEPRECATION');
    
    // Legacy implementation preserved for emergency fallback
    let { key, stateHint, methodHint } = item;
    const keyLower = (key || '').toLowerCase();
    const validHints = ["dry", "raw", "cooked", "as_pack"];
    if (stateHint && validHints.includes(stateHint)) return { stateHint, methodHint };

    if (/cooked|baked|grilled|steamed|boiled|roasted|fried/.test(keyLower)) stateHint = 'cooked';
    else if (/rice|pasta|oat|quinoa|couscous|lentil|bulgur|barley|millet|porridge/.test(keyLower)) stateHint = 'dry';
    else if (/chicken|beef|pork|salmon|fish|mince|steak|lamb|turkey|prawn|shrimp|tuna|tofu/.test(keyLower)) stateHint = 'raw';
    else if (/yogurt|milk|cheese|bread|butter|cream|juice|sauce|oil|cereal/.test(keyLower)) stateHint = 'as_pack';
    else stateHint = 'as_pack';

    if (!methodHint) {
        if (/baked/.test(keyLower)) methodHint = 'baked';
        else if (/grilled/.test(keyLower)) methodHint = 'grilled';
        else if (/boiled|steamed/.test(keyLower)) methodHint = 'boiled';
        else if (/fried/.test(keyLower)) methodHint = 'pan_fried';
        else if (/roasted/.test(keyLower)) methodHint = 'roasted';
        else if (stateHint === 'cooked' && /rice|pasta|grain/.test(keyLower)) methodHint = 'boiled';
        else if (stateHint === 'cooked' && /meat|chicken|beef/.test(keyLower)) methodHint = 'pan_fried';
        else if (stateHint === 'cooked' && /veg|potato/.test(keyLower)) methodHint = 'boiled';
    }
    return { stateHint, methodHint };
}

/**
 * Converts cooked quantity to as_sold (raw/dry) with confidence bands.
 * Now uses deterministic state resolution as primary logic.
 */
function toAsSold(item, gramsOrMl, log) {
    const safeLog = typeof log === 'function' ? log : () => {};
    const { key, normalizedKey } = item;
    
    // [NEW] Use deterministic state resolver instead of keyword-based inference
    let { stateHint, methodHint } = item;
    
    // If stateHint is missing or invalid, resolve deterministically using the shared helper
    const validHints = ['dry', 'raw', 'cooked', 'as_pack'];
    if (!stateHint || !validHints.includes(stateHint)) {
        const lookupKey = normalizedKey || key || '';
        const resolution = resolveState(lookupKey);
        stateHint = resolution.state;
        methodHint = methodHint || resolution.method;
        
        safeLog(`[toAsSold] State resolved via rule engine for '${key}': state='${stateHint}', ruleId='${resolution.ruleId}'`, 'DEBUG', 'TRANSFORMS');
    }

    // Passthrough for known raw/dry states
    if (['raw', 'dry', 'as_pack'].includes(stateHint)) {
        return {
            grams_as_sold: gramsOrMl,
            grams_as_sold_min: gramsOrMl,
            grams_as_sold_max: gramsOrMl,
            yieldFactor: 1.0,
            confidence: 'exact',
            log_msg: `state='${stateHint}', using 1:1`,
            inferredState: stateHint,
            inferredMethod: methodHint
        };
    }

    // State is 'cooked' -> Must look up yield
    const yieldEntry = getYieldEntry(key);

    if (!yieldEntry) {
        alertYieldUnmapped(key, stateHint, { normalizedKey });
        safeLog(`[TRANSFORMS] Unmapped cooked item: ${key}. Defaulting to 1.0 but flagging error.`, 'ERROR', 'TRANSFORMS');
        return {
            grams_as_sold: gramsOrMl,
            grams_as_sold_min: gramsOrMl,
            grams_as_sold_max: gramsOrMl,
            yieldFactor: 1.0,
            confidence: 'none',
            error: 'YIELD_UNMAPPED',
            log_msg: `state='cooked' but NO YIELD FOUND. Used 1.0 fallback.`,
            inferredState: stateHint,
            inferredMethod: methodHint
        };
    }

    const grams_as_sold = gramsOrMl / yieldEntry.typical;
    const grams_as_sold_min = gramsOrMl / yieldEntry.max;
    const grams_as_sold_max = gramsOrMl / yieldEntry.min;

    safeLog(`[TRANSFORMS] ${key}: Cooked ${gramsOrMl}g -> AsSold ${grams_as_sold.toFixed(1)}g (Factor ${yieldEntry.typical})`, 'DEBUG', 'TRANSFORMS');

    return {
        grams_as_sold,
        grams_as_sold_min,
        grams_as_sold_max,
        yieldFactor: yieldEntry.typical,
        confidence: yieldEntry.confidence,
        log_msg: `state='cooked', factor=${yieldEntry.typical} (${yieldEntry.type})`,
        inferredState: stateHint,
        inferredMethod: methodHint
    };
}

function getAbsorbedOil(item, methodHint, mealItems, log) {
    const safeLog = typeof log === 'function' ? log : () => {};
    const oilAbsorptionRate = getOilAbsorptionRate(methodHint);
    
    if (oilAbsorptionRate === 0) return { absorbed_oil_g: 0, log_msg: `method='${methodHint || 'none'}', oil_abs=0%` };

    const oilItem = mealItems.find(i => (i.key || '').toLowerCase().includes('oil'));
    if (!oilItem || !oilItem.qty_value) return { absorbed_oil_g: 0, log_msg: `no oil in meal` };

    const oil_g_total_in_meal = oilItem.qty_value * 0.92;
    if ((item.key || '').toLowerCase().includes('oil')) return { absorbed_oil_g: 0, log_msg: `item is oil` };

    // Use deterministic checking for other items in the meal
    const friedItems = mealItems.filter(i => {
        let m = i.methodHint;
        // If other item is missing method, we must resolve it quickly to know if it absorbs oil
        if (!m) {
             const resolution = resolveState(i.normalizedKey || i.key || '');
             m = resolution.method;
        }
        m = (m || '').toLowerCase();
        return (m.includes('pan_fried') || m.includes('roasted')) && !(i.key || '').toLowerCase().includes('oil');
    });

    if (friedItems.length === 0) return { absorbed_oil_g: 0, log_msg: `no fried items` };

    let totalFriedWeight = 0;
    for (const friedItem of friedItems) {
        const { value: gOrMl } = normalizeToGramsOrMl(friedItem, safeLog);
        const { grams_as_sold } = toAsSold(friedItem, gOrMl, safeLog);
        totalFriedWeight += grams_as_sold;
    }

    if (totalFriedWeight <= 0) return { absorbed_oil_g: 0, log_msg: `total fried weight 0` };

    const { value: currentGOrMl } = normalizeToGramsOrMl(item, safeLog);
    const { grams_as_sold: currentAsSoldWeight } = toAsSold(item, currentGOrMl, safeLog);

    const proportion = currentAsSoldWeight / totalFriedWeight;
    const absorbed_oil_g = (oil_g_total_in_meal * oilAbsorptionRate) * proportion;

    return { absorbed_oil_g, log_msg: `absorbed ${absorbed_oil_g.toFixed(1)}g oil` };
}

module.exports = {
    TRANSFORM_VERSION,
    YIELDS,
    OIL_ABSORPTION,
    UNIT_WEIGHTS,
    normalizeToGramsOrMl,
    toAsSold,
    getAbsorbedOil,
    getOilAbsorptionRate,
    getYieldEntry,
    getUnitWeight,
    extractSizeHint
};


