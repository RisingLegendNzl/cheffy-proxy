/**
 * Cheffy Validation Module
 * Version: 2.0.0 - Phase 4 (Blocking Gatekeeper)
 * * Pre-response validation layer to catch calculation errors before they reach users.
 * Now supports blocking mode, invariant assertions, and critical alerting.
 */

const { emitAlert, ALERT_LEVELS } = require('./alerting.js');
// Invariants are optional/soft-linked to prevent circular dependency issues during initialization if not present
let assertReasonableDayTotals, assertMealHasItems;
try {
  const invariants = require('./invariants.js');
  assertReasonableDayTotals = invariants.assertReasonableDayTotals;
  assertMealHasItems = invariants.assertMealHasItems;
} catch (e) {
  // Fallback if invariants module missing (mostly for tests)
  assertReasonableDayTotals = () => true;
  assertMealHasItems = () => true;
}

// =====================================================================
// CONFIGURATION
// =====================================================================

const VALIDATION_VERSION = '2.0.0';

const ITEM_THRESHOLDS = {
    maxCaloriesPerItem: 1200,
    maxProteinPerItem: 300,
    maxFatPerItem: 300,
    maxCarbsPerItem: 500,
    
    // Warning thresholds
    minPortionGrams: 10,
    maxPortionGrams: 800,
    
    excludeFromCalorieCheck: ['oil', 'butter', 'ghee', 'lard', 'fat', 'dripping'],
    excludeFromProteinCheck: ['whey', 'protein', 'casein', 'isolate', 'collagen'],
};

const MEAL_THRESHOLDS = {
    minCaloriesPerMeal: 50,
    maxMealCaloriePct: 0.60,
    minItemsPerMeal: 1,
    maxItemsPerMeal: 15,
};

const DAY_THRESHOLDS = {
    // Updated per target requirements
    calorieDeviationCritical: 0.50, // >50% deviation is CRITICAL
    calorieDeviationWarning: 0.15,  // 15-50% deviation is WARNING
    
    minDailyCalories: 800,
    maxDailyCalories: 6000,
    
    fallbackRatioCritical: 0.50,    // >50% fallbacks is CRITICAL
    fallbackRatioWarning: 0.30,     // >30% fallbacks is WARNING
};

const SEVERITY = {
    INFO: 'info',
    WARNING: 'warning', 
    CRITICAL: 'critical' // Maps to blocking errors
};

const WARNING_CODES = {
    ITEM_HIGH_CALORIES: 'ITEM_HIGH_CALORIES',
    ITEM_NEGATIVE_VALUE: 'ITEM_NEGATIVE_VALUE',
    ITEM_PORTION_SIZE: 'ITEM_PORTION_SIZE',
    ITEM_ZERO_CALORIES: 'ITEM_ZERO_CALORIES',
    
    MEAL_LOW_CALORIES: 'MEAL_LOW_CALORIES',
    MEAL_EMPTY: 'MEAL_EMPTY',
    
    DAY_CALORIE_DEVIATION: 'DAY_CALORIE_DEVIATION',
    DAY_EXTREME_MACROS: 'DAY_EXTREME_MACROS',
    
    HIGH_FALLBACK_RATIO: 'HIGH_FALLBACK_RATIO',
    RECONCILIATION_BOUNDS: 'RECONCILIATION_BOUNDS',
    INVARIANT_VIOLATION: 'INVARIANT_VIOLATION'
};

// =====================================================================
// RESULT CLASS
// =====================================================================

class ValidationResult {
    constructor() {
        this.issues = [];
        this.itemsValidated = 0;
        this.fallbackCount = 0;
    }
    
    addIssue(code, severity, message, details = {}) {
        this.issues.push({ code, severity, message, details, timestamp: new Date().toISOString() });
    }
    
    hasCriticalIssues() {
        return this.issues.some(i => i.severity === SEVERITY.CRITICAL);
    }
    
    toResponse() {
        return {
            valid: !this.hasCriticalIssues(),
            critical: this.issues.filter(i => i.severity === SEVERITY.CRITICAL),
            warnings: this.issues.filter(i => i.severity === SEVERITY.WARNING),
            info: this.issues.filter(i => i.severity === SEVERITY.INFO)
        };
    }
}

// =====================================================================
// VALIDATION LOGIC
// =====================================================================

function validateItem(item, macros, nutritionSource, result) {
    result.itemsValidated++;
    const key = item?.key || 'unknown';

    // 1. CRITICAL: Negative Macros
    if (macros.kcal < 0 || macros.p < 0 || macros.f < 0 || macros.c < 0) {
        result.addIssue(WARNING_CODES.ITEM_NEGATIVE_VALUE, SEVERITY.CRITICAL, `Item "${key}" has negative macros`, { macros });
        return;
    }

    // 2. WARNING: Portion Sizes
    // Heuristic check: assume qty matches unit g/ml roughly for weight checks if explicit unit is g/ml
    const unit = (item?.unit || item?.qty_unit || '').toLowerCase();
    const qty = item?.qty_value || item?.qty || 0;
    
    if ((unit === 'g' || unit === 'ml') && qty > 0) {
        if (qty < ITEM_THRESHOLDS.minPortionGrams && !['oil','spice','salt'].some(x => key.includes(x))) {
            result.addIssue(WARNING_CODES.ITEM_PORTION_SIZE, SEVERITY.WARNING, `Tiny portion for "${key}": ${qty}${unit}`);
        } else if (qty > ITEM_THRESHOLDS.maxPortionGrams) {
            result.addIssue(WARNING_CODES.ITEM_PORTION_SIZE, SEVERITY.WARNING, `Huge portion for "${key}": ${qty}${unit}`);
        }
    }

    // 3. Track Fallbacks
    if (nutritionSource?.isFallback || nutritionSource?.source === 'fallback') {
        result.fallbackCount++;
    }
    
    // 4. Sanity Cap (Critical)
    if (macros.kcal > ITEM_THRESHOLDS.maxCaloriesPerItem && !ITEM_THRESHOLDS.excludeFromCalorieCheck.some(x => key.includes(x))) {
         result.addIssue(WARNING_CODES.ITEM_HIGH_CALORIES, SEVERITY.CRITICAL, `Item "${key}" exceeds max calories (${macros.kcal.toFixed(0)})`);
    }
}

function validateDayPlan(params) {
    const { meals, dayTotals, targets, nutritionDataMap, getMacros, options = {} } = params;
    const { blocking = false, traceId, reconciliationFactor } = options;
    
    const result = new ValidationResult();
    const targetKcal = targets?.calories || 2000;

    // --- 1. Invariant Checks (CRITICAL) ---
    try {
        assertReasonableDayTotals(dayTotals, targets);
    } catch (err) {
        result.addIssue(WARNING_CODES.INVARIANT_VIOLATION, SEVERITY.CRITICAL, err.message);
    }
    
    for (const meal of (meals || [])) {
        try {
            assertMealHasItems(meal);
        } catch (err) {
            result.addIssue(WARNING_CODES.MEAL_EMPTY, SEVERITY.CRITICAL, `Meal "${meal.name}": ${err.message}`);
        }
    }

    // --- 2. Item & Meal Scan ---
    for (const meal of (meals || [])) {
        for (const item of (meal.items || [])) {
            const macros = getMacros ? getMacros(item) : { p:0, f:0, c:0, kcal:0 };
            const nKey = item.normalizedKey || (item.key || '').toLowerCase().replace(/\s+/g,'_');
            // Support map or object
            const source = (nutritionDataMap instanceof Map ? nutritionDataMap.get(nKey) : nutritionDataMap?.[nKey]) || {};
            validateItem(item, macros, source, result);
        }
    }

    // --- 3. Day Level Checks ---
    const deviation = Math.abs(dayTotals.calories - targetKcal) / (targetKcal || 1);
    
    // Calorie Deviation
    if (deviation > DAY_THRESHOLDS.calorieDeviationCritical) {
        result.addIssue(WARNING_CODES.DAY_CALORIE_DEVIATION, SEVERITY.CRITICAL, `Daily calories deviate by ${(deviation*100).toFixed(0)}%`);
    } else if (deviation > DAY_THRESHOLDS.calorieDeviationWarning) {
        result.addIssue(WARNING_CODES.DAY_CALORIE_DEVIATION, SEVERITY.WARNING, `Daily calories deviate by ${(deviation*100).toFixed(0)}%`);
    }

    // Fallback Ratio
    if (result.itemsValidated > 0) {
        const ratio = result.fallbackCount / result.itemsValidated;
        if (ratio > DAY_THRESHOLDS.fallbackRatioCritical) {
            result.addIssue(WARNING_CODES.HIGH_FALLBACK_RATIO, SEVERITY.CRITICAL, `Extremely low confidence: ${(ratio*100).toFixed(0)}% items used fallback`);
        } else if (ratio > DAY_THRESHOLDS.fallbackRatioWarning) {
            result.addIssue(WARNING_CODES.HIGH_FALLBACK_RATIO, SEVERITY.WARNING, `Low confidence: ${(ratio*100).toFixed(0)}% items used fallback`);
        }
    }

    // --- 4. Context Checks ---
    if (reconciliationFactor !== undefined) {
        if (reconciliationFactor > 2.0 || reconciliationFactor < 0.5) {
            result.addIssue(WARNING_CODES.RECONCILIATION_BOUNDS, SEVERITY.CRITICAL, `Unsafe reconciliation factor: ${reconciliationFactor.toFixed(2)}`);
        }
    }

    // --- 5. Final Actions ---
    const response = result.toResponse();

    // Emit Alert on Critical
    if (response.critical.length > 0) {
        emitAlert(ALERT_LEVELS.CRITICAL, 'validation_critical', {
            issues: response.critical,
            traceId
        });
    }

    // Blocking Mode
    if (blocking && !response.valid) {
        const error = new Error(`Critical validation issues: ${response.critical.map(c => c.message).join('; ')}`);
        error.validationResult = response;
        error.isValidationError = true;
        throw error;
    }

    return response;
}

module.exports = {
    VALIDATION_VERSION,
    validateDayPlan,
    SEVERITY,
    WARNING_CODES,
    getThresholds: () => ({ ITEM_THRESHOLDS, MEAL_THRESHOLDS, DAY_THRESHOLDS })
};

