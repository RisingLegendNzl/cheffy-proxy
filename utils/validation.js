/**
 * Cheffy Validation Module
 * Version: 1.0.0 - Phase 3
 * 
 * Pre-response validation layer to catch calculation errors before they reach users.
 * Provides item-level, meal-level, and day-level validation with configurable thresholds.
 * 
 * PHASE 3 FEATURES:
 * - Item validation: Check individual ingredient macros for sanity
 * - Meal validation: Check meal composition and totals
 * - Day validation: Check daily totals against nutritional targets
 * - Warning system: Capture non-fatal issues for logging/telemetry
 * - Confidence scoring: Rate overall plan reliability
 */

// =====================================================================
// CONFIGURATION
// =====================================================================

const VALIDATION_VERSION = '1.0.0';

/**
 * Thresholds for item-level validation.
 * All values are per 100g unless noted.
 */
const ITEM_THRESHOLDS = {
    // Maximum reasonable values per item (absolute)
    maxCaloriesPerItem: 1200,       // Already in day.js, but centralized here
    maxProteinPerItem: 300,         // 300g protein in one item is impossible
    maxFatPerItem: 300,             // 300g fat in one item (except pure oils)
    maxCarbsPerItem: 500,           // 500g carbs in one item is impossible
    
    // Minimum non-zero values (if item has macros, they should be at least this)
    minCaloriesIfPresent: 1,        // If item has weight, should have some calories
    
    // Per-100g sanity bounds (for detecting data errors)
    maxCaloriesPer100g: 900,        // Pure fat is ~884 kcal/100g
    maxProteinPer100g: 95,          // Whey isolate is ~90g/100g
    maxFatPer100g: 100,             // Pure oil is 100g/100g
    maxCarbsPer100g: 100,           // Pure sugar is 100g/100g
    
    // Calorie balance tolerance (|calculated - (4P + 4C + 9F)| / calculated)
    calorieBalanceTolerance: 0.15,  // 15% tolerance for macro-calorie mismatch
    
    // Items to exclude from certain checks
    excludeFromCalorieCheck: ['oil', 'butter', 'ghee', 'lard', 'fat', 'dripping'],
    excludeFromProteinCheck: ['whey', 'protein', 'casein', 'isolate', 'collagen'],
};

/**
 * Thresholds for meal-level validation.
 */
const MEAL_THRESHOLDS = {
    // Meal should have some calories (unless it's water/tea)
    minCaloriesPerMeal: 50,
    
    // Single meal shouldn't exceed this % of daily target
    maxMealCaloriePct: 0.60,        // 60% of daily calories in one meal is suspicious
    
    // Minimum items per meal (a meal with 0-1 items is suspicious)
    minItemsPerMeal: 1,
    
    // Maximum items per meal (>15 items suggests parsing error)
    maxItemsPerMeal: 15,
    
    // Protein as % of meal calories (should be reasonable)
    minProteinPct: 0.05,            // At least 5% of meal from protein
    maxProteinPct: 0.70,            // Max 70% of meal from protein
};

/**
 * Thresholds for day-level validation.
 */
const DAY_THRESHOLDS = {
    // Deviation from calorie target
    calorieDeviationWarning: 0.08,  // Warn if >8% deviation
    calorieDeviationError: 0.15,    // Error if >15% deviation
    
    // Absolute bounds (regardless of target)
    minDailyCalories: 800,          // Below this is dangerous
    maxDailyCalories: 6000,         // Above this is suspicious
    
    // Protein bounds (absolute, not %)
    minDailyProtein: 30,            // g - Below is insufficient
    maxDailyProtein: 400,           // g - Above is excessive
    
    // Fat bounds
    minDailyFat: 20,                // g - Below is dangerous for hormones
    maxDailyFat: 300,               // g - Above is excessive
    
    // Carbs bounds  
    minDailyCarbs: 0,               // Keto can be ~0
    maxDailyCarbs: 800,             // g - Above is excessive
    
    // Number of meals
    minMealsPerDay: 1,
    maxMealsPerDay: 8,
};

// =====================================================================
// WARNING TYPES
// =====================================================================

/**
 * Warning severity levels.
 */
const SEVERITY = {
    INFO: 'info',           // FYI, not a problem
    WARNING: 'warning',     // Suspicious but may be valid
    ERROR: 'error',         // Likely a bug, but recoverable
    CRITICAL: 'critical',   // Plan should not be used
};

/**
 * Warning codes for categorization and filtering.
 */
const WARNING_CODES = {
    // Item-level
    ITEM_HIGH_CALORIES: 'ITEM_HIGH_CALORIES',
    ITEM_ZERO_CALORIES: 'ITEM_ZERO_CALORIES',
    ITEM_HIGH_PROTEIN: 'ITEM_HIGH_PROTEIN',
    ITEM_HIGH_FAT: 'ITEM_HIGH_FAT',
    ITEM_HIGH_CARBS: 'ITEM_HIGH_CARBS',
    ITEM_CALORIE_MISMATCH: 'ITEM_CALORIE_MISMATCH',
    ITEM_NEGATIVE_VALUE: 'ITEM_NEGATIVE_VALUE',
    ITEM_USES_FALLBACK: 'ITEM_USES_FALLBACK',
    
    // Meal-level
    MEAL_LOW_CALORIES: 'MEAL_LOW_CALORIES',
    MEAL_HIGH_CALORIES: 'MEAL_HIGH_CALORIES',
    MEAL_FEW_ITEMS: 'MEAL_FEW_ITEMS',
    MEAL_MANY_ITEMS: 'MEAL_MANY_ITEMS',
    MEAL_PROTEIN_IMBALANCE: 'MEAL_PROTEIN_IMBALANCE',
    
    // Day-level
    DAY_CALORIE_DEVIATION: 'DAY_CALORIE_DEVIATION',
    DAY_LOW_CALORIES: 'DAY_LOW_CALORIES',
    DAY_HIGH_CALORIES: 'DAY_HIGH_CALORIES',
    DAY_LOW_PROTEIN: 'DAY_LOW_PROTEIN',
    DAY_HIGH_PROTEIN: 'DAY_HIGH_PROTEIN',
    DAY_LOW_FAT: 'DAY_LOW_FAT',
    DAY_HIGH_FAT: 'DAY_HIGH_FAT',
    DAY_HIGH_CARBS: 'DAY_HIGH_CARBS',
    DAY_FEW_MEALS: 'DAY_FEW_MEALS',
    DAY_MANY_MEALS: 'DAY_MANY_MEALS',
    
    // Fallback-related
    PLAN_USES_FALLBACKS: 'PLAN_USES_FALLBACKS',
    HIGH_FALLBACK_RATIO: 'HIGH_FALLBACK_RATIO',
};

// =====================================================================
// VALIDATION RESULT CLASSES
// =====================================================================

/**
 * Represents a single validation warning or error.
 */
class ValidationIssue {
    constructor(code, severity, message, details = {}) {
        this.code = code;
        this.severity = severity;
        this.message = message;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
    
    toJSON() {
        return {
            code: this.code,
            severity: this.severity,
            message: this.message,
            details: this.details,
        };
    }
}

/**
 * Aggregates validation results across items, meals, and day.
 */
class ValidationResult {
    constructor() {
        this.issues = [];
        this.itemsValidated = 0;
        this.mealsValidated = 0;
        this.isValid = true;
        this.confidenceScore = 100;
        this.fallbackCount = 0;
    }
    
    addIssue(code, severity, message, details = {}) {
        const issue = new ValidationIssue(code, severity, message, details);
        this.issues.push(issue);
        
        // Update validity based on severity
        if (severity === SEVERITY.CRITICAL) {
            this.isValid = false;
            this.confidenceScore = Math.max(0, this.confidenceScore - 30);
        } else if (severity === SEVERITY.ERROR) {
            this.confidenceScore = Math.max(0, this.confidenceScore - 15);
        } else if (severity === SEVERITY.WARNING) {
            this.confidenceScore = Math.max(0, this.confidenceScore - 5);
        }
        
        return issue;
    }
    
    getIssuesBySeverity(severity) {
        return this.issues.filter(i => i.severity === severity);
    }
    
    getIssuesByCode(code) {
        return this.issues.filter(i => i.code === code);
    }
    
    hasIssues() {
        return this.issues.length > 0;
    }
    
    hasCriticalIssues() {
        return this.issues.some(i => i.severity === SEVERITY.CRITICAL);
    }
    
    hasErrors() {
        return this.issues.some(i => i.severity === SEVERITY.ERROR || i.severity === SEVERITY.CRITICAL);
    }
    
    getSummary() {
        const bySeverity = {
            [SEVERITY.CRITICAL]: this.issues.filter(i => i.severity === SEVERITY.CRITICAL).length,
            [SEVERITY.ERROR]: this.issues.filter(i => i.severity === SEVERITY.ERROR).length,
            [SEVERITY.WARNING]: this.issues.filter(i => i.severity === SEVERITY.WARNING).length,
            [SEVERITY.INFO]: this.issues.filter(i => i.severity === SEVERITY.INFO).length,
        };
        
        return {
            totalIssues: this.issues.length,
            bySeverity,
            isValid: this.isValid,
            confidenceScore: this.confidenceScore,
            itemsValidated: this.itemsValidated,
            mealsValidated: this.mealsValidated,
            fallbackCount: this.fallbackCount,
        };
    }
    
    toJSON() {
        return {
            isValid: this.isValid,
            confidenceScore: this.confidenceScore,
            summary: this.getSummary(),
            issues: this.issues.map(i => i.toJSON()),
        };
    }
}

// =====================================================================
// VALIDATION FUNCTIONS
// =====================================================================

/**
 * Validates a single item's calculated macros.
 * 
 * @param {object} item - The item object with key, qty_value, qty_unit
 * @param {object} macros - Calculated macros { p, f, c, kcal }
 * @param {object} nutritionSource - The nutrition data used (to check for fallback)
 * @param {ValidationResult} result - The result object to add issues to
 * @returns {boolean} True if item passes validation
 */
function validateItem(item, macros, nutritionSource, result) {
    const key = item?.key || 'unknown';
    const keyLower = key.toLowerCase();
    
    result.itemsValidated++;
    
    // Check for negative values
    if (macros.kcal < 0 || macros.p < 0 || macros.f < 0 || macros.c < 0) {
        result.addIssue(
            WARNING_CODES.ITEM_NEGATIVE_VALUE,
            SEVERITY.CRITICAL,
            `Item "${key}" has negative macro values`,
            { item: key, macros }
        );
        return false;
    }
    
    // Check if using fallback nutrition
    if (nutritionSource?.source === 'FALLBACK' || nutritionSource?.isFallback) {
        result.fallbackCount++;
        result.addIssue(
            WARNING_CODES.ITEM_USES_FALLBACK,
            SEVERITY.WARNING,
            `Item "${key}" uses fallback nutrition estimate`,
            { 
                item: key, 
                inferredCategory: nutritionSource?.inferredCategory,
                confidence: nutritionSource?.confidence 
            }
        );
    }
    
    // Check for zero calories on non-zero quantity
    const qty = item?.qty_value || item?.qty || 0;
    if (qty > 0 && macros.kcal === 0) {
        // Exclude items that legitimately have 0 calories (water, black coffee, etc.)
        const zeroCalOk = ['water', 'tea', 'coffee', 'diet', 'zero', 'sparkling'].some(w => keyLower.includes(w));
        if (!zeroCalOk) {
            result.addIssue(
                WARNING_CODES.ITEM_ZERO_CALORIES,
                SEVERITY.WARNING,
                `Item "${key}" has 0 calories despite having quantity ${qty}`,
                { item: key, qty, macros }
            );
        }
    }
    
    // Check for excessively high calories (unless it's oil/fat)
    const excludeCalorie = ITEM_THRESHOLDS.excludeFromCalorieCheck.some(w => keyLower.includes(w));
    if (!excludeCalorie && macros.kcal > ITEM_THRESHOLDS.maxCaloriesPerItem) {
        result.addIssue(
            WARNING_CODES.ITEM_HIGH_CALORIES,
            SEVERITY.ERROR,
            `Item "${key}" has unusually high calories (${macros.kcal.toFixed(0)} kcal)`,
            { item: key, kcal: macros.kcal, threshold: ITEM_THRESHOLDS.maxCaloriesPerItem }
        );
    }
    
    // Check for excessively high protein (unless it's protein powder)
    const excludeProtein = ITEM_THRESHOLDS.excludeFromProteinCheck.some(w => keyLower.includes(w));
    if (!excludeProtein && macros.p > ITEM_THRESHOLDS.maxProteinPerItem) {
        result.addIssue(
            WARNING_CODES.ITEM_HIGH_PROTEIN,
            SEVERITY.ERROR,
            `Item "${key}" has unusually high protein (${macros.p.toFixed(0)}g)`,
            { item: key, protein: macros.p, threshold: ITEM_THRESHOLDS.maxProteinPerItem }
        );
    }
    
    // Check for excessively high fat
    if (macros.f > ITEM_THRESHOLDS.maxFatPerItem) {
        result.addIssue(
            WARNING_CODES.ITEM_HIGH_FAT,
            SEVERITY.ERROR,
            `Item "${key}" has unusually high fat (${macros.f.toFixed(0)}g)`,
            { item: key, fat: macros.f, threshold: ITEM_THRESHOLDS.maxFatPerItem }
        );
    }
    
    // Check for excessively high carbs
    if (macros.c > ITEM_THRESHOLDS.maxCarbsPerItem) {
        result.addIssue(
            WARNING_CODES.ITEM_HIGH_CARBS,
            SEVERITY.ERROR,
            `Item "${key}" has unusually high carbs (${macros.c.toFixed(0)}g)`,
            { item: key, carbs: macros.c, threshold: ITEM_THRESHOLDS.maxCarbsPerItem }
        );
    }
    
    // Check calorie balance (calculated vs 4P + 4C + 9F)
    if (macros.kcal > 10) {  // Only check if meaningful calories
        const expectedKcal = (macros.p * 4) + (macros.c * 4) + (macros.f * 9);
        const diff = Math.abs(macros.kcal - expectedKcal);
        const diffPct = diff / macros.kcal;
        
        if (diffPct > ITEM_THRESHOLDS.calorieBalanceTolerance) {
            result.addIssue(
                WARNING_CODES.ITEM_CALORIE_MISMATCH,
                SEVERITY.WARNING,
                `Item "${key}" has calorie mismatch: ${macros.kcal.toFixed(0)} kcal vs expected ${expectedKcal.toFixed(0)} kcal`,
                { item: key, reported: macros.kcal, expected: expectedKcal, diffPct: (diffPct * 100).toFixed(1) + '%' }
            );
        }
    }
    
    return !result.hasCriticalIssues();
}

/**
 * Validates a meal's composition and totals.
 * 
 * @param {object} meal - The meal object with items array
 * @param {number} dailyCalorieTarget - The day's calorie target
 * @param {ValidationResult} result - The result object to add issues to
 * @returns {boolean} True if meal passes validation
 */
function validateMeal(meal, dailyCalorieTarget, result) {
    const mealName = meal?.name || 'Unnamed Meal';
    const items = meal?.items || [];
    const mealKcal = meal?.subtotal_kcal || 0;
    const mealP = meal?.subtotal_protein || 0;
    const mealF = meal?.subtotal_fat || 0;
    const mealC = meal?.subtotal_carbs || 0;
    
    result.mealsValidated++;
    
    // Check for too few items
    if (items.length < MEAL_THRESHOLDS.minItemsPerMeal) {
        result.addIssue(
            WARNING_CODES.MEAL_FEW_ITEMS,
            SEVERITY.WARNING,
            `Meal "${mealName}" has only ${items.length} items`,
            { meal: mealName, itemCount: items.length }
        );
    }
    
    // Check for too many items
    if (items.length > MEAL_THRESHOLDS.maxItemsPerMeal) {
        result.addIssue(
            WARNING_CODES.MEAL_MANY_ITEMS,
            SEVERITY.WARNING,
            `Meal "${mealName}" has ${items.length} items (may indicate parsing error)`,
            { meal: mealName, itemCount: items.length }
        );
    }
    
    // Check for low calories (unless meal is legitimately small)
    if (mealKcal < MEAL_THRESHOLDS.minCaloriesPerMeal && items.length > 0) {
        result.addIssue(
            WARNING_CODES.MEAL_LOW_CALORIES,
            SEVERITY.WARNING,
            `Meal "${mealName}" has only ${mealKcal.toFixed(0)} kcal`,
            { meal: mealName, kcal: mealKcal }
        );
    }
    
    // Check for meal being too large relative to daily target
    if (dailyCalorieTarget > 0) {
        const mealPct = mealKcal / dailyCalorieTarget;
        if (mealPct > MEAL_THRESHOLDS.maxMealCaloriePct) {
            result.addIssue(
                WARNING_CODES.MEAL_HIGH_CALORIES,
                SEVERITY.WARNING,
                `Meal "${mealName}" is ${(mealPct * 100).toFixed(0)}% of daily calories`,
                { meal: mealName, kcal: mealKcal, pctOfDaily: (mealPct * 100).toFixed(1) + '%' }
            );
        }
    }
    
    // Check protein balance in meal
    if (mealKcal > 100) {
        const proteinPct = (mealP * 4) / mealKcal;
        
        if (proteinPct < MEAL_THRESHOLDS.minProteinPct) {
            result.addIssue(
                WARNING_CODES.MEAL_PROTEIN_IMBALANCE,
                SEVERITY.INFO,
                `Meal "${mealName}" has low protein (${(proteinPct * 100).toFixed(0)}% of calories)`,
                { meal: mealName, proteinPct: (proteinPct * 100).toFixed(1) + '%' }
            );
        }
        
        if (proteinPct > MEAL_THRESHOLDS.maxProteinPct) {
            result.addIssue(
                WARNING_CODES.MEAL_PROTEIN_IMBALANCE,
                SEVERITY.INFO,
                `Meal "${mealName}" has very high protein (${(proteinPct * 100).toFixed(0)}% of calories)`,
                { meal: mealName, proteinPct: (proteinPct * 100).toFixed(1) + '%' }
            );
        }
    }
    
    return !result.hasCriticalIssues();
}

/**
 * Validates daily totals against nutritional targets.
 * 
 * @param {object} dayTotals - { calories, protein, fat, carbs }
 * @param {object} targets - { calories, protein, fat, carbs }
 * @param {Array} meals - Array of meal objects for the day
 * @param {ValidationResult} result - The result object to add issues to
 * @returns {boolean} True if day passes validation
 */
function validateDay(dayTotals, targets, meals, result) {
    const { calories, protein, fat, carbs } = dayTotals;
    const targetKcal = targets?.calories || 2000;
    
    // Check meal count
    const mealCount = (meals || []).length;
    if (mealCount < DAY_THRESHOLDS.minMealsPerDay) {
        result.addIssue(
            WARNING_CODES.DAY_FEW_MEALS,
            SEVERITY.WARNING,
            `Day has only ${mealCount} meals`,
            { mealCount }
        );
    }
    
    if (mealCount > DAY_THRESHOLDS.maxMealsPerDay) {
        result.addIssue(
            WARNING_CODES.DAY_MANY_MEALS,
            SEVERITY.WARNING,
            `Day has ${mealCount} meals (unusual)`,
            { mealCount }
        );
    }
    
    // Check calorie deviation from target
    const calorieDeviation = Math.abs(calories - targetKcal) / targetKcal;
    
    if (calorieDeviation > DAY_THRESHOLDS.calorieDeviationError) {
        result.addIssue(
            WARNING_CODES.DAY_CALORIE_DEVIATION,
            SEVERITY.ERROR,
            `Daily calories (${calories.toFixed(0)}) deviate ${(calorieDeviation * 100).toFixed(1)}% from target (${targetKcal})`,
            { actual: calories, target: targetKcal, deviationPct: (calorieDeviation * 100).toFixed(1) + '%' }
        );
    } else if (calorieDeviation > DAY_THRESHOLDS.calorieDeviationWarning) {
        result.addIssue(
            WARNING_CODES.DAY_CALORIE_DEVIATION,
            SEVERITY.WARNING,
            `Daily calories (${calories.toFixed(0)}) deviate ${(calorieDeviation * 100).toFixed(1)}% from target (${targetKcal})`,
            { actual: calories, target: targetKcal, deviationPct: (calorieDeviation * 100).toFixed(1) + '%' }
        );
    }
    
    // Check absolute calorie bounds
    if (calories < DAY_THRESHOLDS.minDailyCalories) {
        result.addIssue(
            WARNING_CODES.DAY_LOW_CALORIES,
            SEVERITY.ERROR,
            `Daily calories (${calories.toFixed(0)}) are dangerously low`,
            { actual: calories, minimum: DAY_THRESHOLDS.minDailyCalories }
        );
    }
    
    if (calories > DAY_THRESHOLDS.maxDailyCalories) {
        result.addIssue(
            WARNING_CODES.DAY_HIGH_CALORIES,
            SEVERITY.ERROR,
            `Daily calories (${calories.toFixed(0)}) are unusually high`,
            { actual: calories, maximum: DAY_THRESHOLDS.maxDailyCalories }
        );
    }
    
    // Check protein bounds
    if (protein < DAY_THRESHOLDS.minDailyProtein) {
        result.addIssue(
            WARNING_CODES.DAY_LOW_PROTEIN,
            SEVERITY.WARNING,
            `Daily protein (${protein.toFixed(0)}g) is below recommended minimum`,
            { actual: protein, minimum: DAY_THRESHOLDS.minDailyProtein }
        );
    }
    
    if (protein > DAY_THRESHOLDS.maxDailyProtein) {
        result.addIssue(
            WARNING_CODES.DAY_HIGH_PROTEIN,
            SEVERITY.WARNING,
            `Daily protein (${protein.toFixed(0)}g) is unusually high`,
            { actual: protein, maximum: DAY_THRESHOLDS.maxDailyProtein }
        );
    }
    
    // Check fat bounds
    if (fat < DAY_THRESHOLDS.minDailyFat) {
        result.addIssue(
            WARNING_CODES.DAY_LOW_FAT,
            SEVERITY.WARNING,
            `Daily fat (${fat.toFixed(0)}g) is below healthy minimum`,
            { actual: fat, minimum: DAY_THRESHOLDS.minDailyFat }
        );
    }
    
    if (fat > DAY_THRESHOLDS.maxDailyFat) {
        result.addIssue(
            WARNING_CODES.DAY_HIGH_FAT,
            SEVERITY.WARNING,
            `Daily fat (${fat.toFixed(0)}g) is unusually high`,
            { actual: fat, maximum: DAY_THRESHOLDS.maxDailyFat }
        );
    }
    
    // Check carb bounds
    if (carbs > DAY_THRESHOLDS.maxDailyCarbs) {
        result.addIssue(
            WARNING_CODES.DAY_HIGH_CARBS,
            SEVERITY.WARNING,
            `Daily carbs (${carbs.toFixed(0)}g) are unusually high`,
            { actual: carbs, maximum: DAY_THRESHOLDS.maxDailyCarbs }
        );
    }
    
    // Check fallback ratio
    if (result.fallbackCount > 0 && result.itemsValidated > 0) {
        const fallbackRatio = result.fallbackCount / result.itemsValidated;
        
        if (fallbackRatio > 0.3) {  // >30% items use fallback
            result.addIssue(
                WARNING_CODES.HIGH_FALLBACK_RATIO,
                SEVERITY.WARNING,
                `${(fallbackRatio * 100).toFixed(0)}% of items use fallback nutrition`,
                { fallbackCount: result.fallbackCount, totalItems: result.itemsValidated }
            );
        } else if (result.fallbackCount > 0) {
            result.addIssue(
                WARNING_CODES.PLAN_USES_FALLBACKS,
                SEVERITY.INFO,
                `${result.fallbackCount} items use fallback nutrition estimates`,
                { fallbackCount: result.fallbackCount }
            );
        }
    }
    
    return !result.hasCriticalIssues();
}

/**
 * Validates an entire day's meal plan.
 * This is the main entry point for validation.
 * 
 * @param {object} params - Validation parameters
 * @param {Array} params.meals - Array of meal objects with items
 * @param {object} params.dayTotals - { calories, protein, fat, carbs }
 * @param {object} params.targets - Nutritional targets { calories, protein, fat, carbs }
 * @param {Map|object} params.nutritionDataMap - Map of normalizedKey -> nutrition data
 * @param {function} params.getMacros - Function to get macros for an item: (item) => { p, f, c, kcal }
 * @param {function} [params.log] - Optional logger function
 * @returns {ValidationResult} Complete validation result
 */
function validateDayPlan({ meals, dayTotals, targets, nutritionDataMap, getMacros, log = console.log }) {
    const result = new ValidationResult();
    
    try {
        // Convert Map to object if needed
        const nutritionMap = nutritionDataMap instanceof Map 
            ? Object.fromEntries(nutritionDataMap) 
            : (nutritionDataMap || {});
        
        // Validate each item in each meal
        for (const meal of (meals || [])) {
            for (const item of (meal?.items || [])) {
                try {
                    const macros = getMacros ? getMacros(item) : { p: 0, f: 0, c: 0, kcal: 0 };
                    const normalizedKey = item?.normalizedKey || item?.key?.toLowerCase().replace(/\s+/g, '_');
                    const nutritionSource = nutritionMap[normalizedKey] || null;
                    
                    validateItem(item, macros, nutritionSource, result);
                } catch (itemError) {
                    result.addIssue(
                        WARNING_CODES.ITEM_NEGATIVE_VALUE,
                        SEVERITY.ERROR,
                        `Error validating item "${item?.key}": ${itemError.message}`,
                        { item: item?.key, error: itemError.message }
                    );
                }
            }
            
            // Validate the meal
            validateMeal(meal, targets?.calories || 2000, result);
        }
        
        // Validate day totals
        validateDay(dayTotals, targets, meals, result);
        
        // Log summary
        const summary = result.getSummary();
        if (summary.totalIssues > 0) {
            log(`[VALIDATION] Completed: ${summary.totalIssues} issues found (${summary.bySeverity.critical} critical, ${summary.bySeverity.error} errors, ${summary.bySeverity.warning} warnings)`, 'INFO', 'VALIDATION');
        } else {
            log(`[VALIDATION] Completed: No issues found. Confidence: ${result.confidenceScore}%`, 'DEBUG', 'VALIDATION');
        }
        
    } catch (validationError) {
        result.addIssue(
            'VALIDATION_ERROR',
            SEVERITY.CRITICAL,
            `Validation system error: ${validationError.message}`,
            { error: validationError.message }
        );
        log(`[VALIDATION] Critical error: ${validationError.message}`, 'CRITICAL', 'VALIDATION');
    }
    
    return result;
}

/**
 * Quick validation check - returns true if plan is usable.
 * Use for fast pass/fail decisions.
 * 
 * @param {object} params - Same as validateDayPlan
 * @returns {boolean} True if plan passes basic validation
 */
function quickValidate(params) {
    const result = validateDayPlan(params);
    return result.isValid && result.confidenceScore >= 50;
}

/**
 * Get validation thresholds (for external configuration/display).
 */
function getThresholds() {
    return {
        item: { ...ITEM_THRESHOLDS },
        meal: { ...MEAL_THRESHOLDS },
        day: { ...DAY_THRESHOLDS },
    };
}

// =====================================================================
// EXPORTS
// =====================================================================

module.exports = {
    // Version
    VALIDATION_VERSION,
    
    // Main validation functions
    validateDayPlan,
    validateItem,
    validateMeal,
    validateDay,
    quickValidate,
    
    // Classes
    ValidationResult,
    ValidationIssue,
    
    // Constants
    SEVERITY,
    WARNING_CODES,
    
    // Configuration
    getThresholds,
    ITEM_THRESHOLDS,
    MEAL_THRESHOLDS,
    DAY_THRESHOLDS,
};