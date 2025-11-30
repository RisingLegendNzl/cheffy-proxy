/**
 * utils/invariants.js
 * 
 * Runtime Invariant Assertions for Cheffy
 * 
 * PURPOSE:
 * Provides runtime enforcement of system invariants. These assertions
 * catch logic errors and data corruption before they propagate through
 * the pipeline and cause incorrect macro calculations.
 * 
 * PLAN REFERENCE: Step F4 - Implement Runtime Invariant Assertions
 * 
 * INVARIANTS IMPLEMENTED:
 * - INV-001: Macro-calorie consistency (±5% tolerance)
 * - INV-002: Positive quantities
 * - INV-003: Reasonable portion sizes (5g-1000g)
 * - INV-004: Reconciliation factor bounds (0.5-2.0)
 * - INV-005: YIELDS coverage for cooked items
 * - INV-006: Resolved state for all items
 * - INV-007: LLM schema validation passed
 * 
 * DESIGN PRINCIPLES:
 * 1. Assertions throw InvariantViolationError with context
 * 2. Soft assertions log but don't throw (for monitoring)
 * 3. All violations include the invariant ID for tracking
 * 4. Context is preserved for debugging
 * 
 * ASSUMPTIONS:
 * - Macros object has { kcal, protein, fat, carbs }
 * - Item object has { key, qty_value, qty_unit, stateHint }
 * - Calorie formula: kcal ≈ (protein * 4) + (carbs * 4) + (fat * 9)
 */

/**
 * Custom error class for invariant violations
 */
class InvariantViolationError extends Error {
  constructor(invariantId, message, context = {}) {
    super(`[${invariantId}] ${message}`);
    this.name = 'InvariantViolationError';
    this.invariantId = invariantId;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvariantViolationError);
    }
  }
  
  toJSON() {
    return {
      name: this.name,
      invariantId: this.invariantId,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * Invariant configuration
 */
const INVARIANT_CONFIG = {
  // INV-001: Macro-calorie consistency tolerance
  calorieConsistencyTolerancePct: 5,
  
  // INV-003: Portion size bounds
  portionBounds: {
    minGrams: 5,
    maxGrams: 1000
  },
  
  // INV-004: Reconciliation factor bounds
  reconciliationBounds: {
    min: 0.5,
    max: 2.0
  },
  
  // Calorie calculation constants
  caloriesPerGramProtein: 4,
  caloriesPerGramCarbs: 4,
  caloriesPerGramFat: 9
};

/**
 * Valid states for items
 */
const VALID_STATES = ['dry', 'raw', 'cooked', 'as_pack'];

/**
 * INV-001: Assert macro-calorie consistency
 * 
 * Verifies that the reported calories are consistent with the
 * macro breakdown using the standard formula:
 * kcal ≈ (protein * 4) + (carbs * 4) + (fat * 9)
 * 
 * @param {Object} macros - { kcal, protein, fat, carbs }
 * @param {number} tolerancePct - Allowed deviation percentage (default 5%)
 * @throws {InvariantViolationError} If calories deviate more than tolerance
 */
function assertMacroCalorieConsistency(macros, tolerancePct = INVARIANT_CONFIG.calorieConsistencyTolerancePct) {
  const { kcal, protein, fat, carbs } = macros;
  
  // Skip check if any value is missing or zero calories
  if (kcal === undefined || kcal === null || kcal === 0) {
    return;
  }
  
  if (protein === undefined || fat === undefined || carbs === undefined) {
    return;
  }
  
  // Calculate expected calories from macros
  const expectedKcal = 
    (protein * INVARIANT_CONFIG.caloriesPerGramProtein) +
    (carbs * INVARIANT_CONFIG.caloriesPerGramCarbs) +
    (fat * INVARIANT_CONFIG.caloriesPerGramFat);
  
  // Skip check if expected is zero (avoid division by zero)
  if (expectedKcal === 0) {
    return;
  }
  
  // Calculate deviation percentage
  const deviation = Math.abs((kcal - expectedKcal) / expectedKcal) * 100;
  
  if (deviation > tolerancePct) {
    throw new InvariantViolationError(
      'INV-001',
      `Macro-calorie inconsistency: reported ${kcal} kcal but macros suggest ${expectedKcal.toFixed(0)} kcal (${deviation.toFixed(1)}% deviation, tolerance ${tolerancePct}%)`,
      {
        reportedKcal: kcal,
        expectedKcal: Math.round(expectedKcal),
        protein,
        fat,
        carbs,
        deviationPct: deviation.toFixed(2),
        tolerancePct
      }
    );
  }
}

/**
 * INV-002: Assert positive quantities
 * 
 * Verifies that qty_value is a positive number
 * 
 * @param {Object} item - Item with qty_value field
 * @throws {InvariantViolationError} If quantity is not positive
 */
function assertPositiveQuantities(item) {
  const { key, qty_value } = item;
  
  if (qty_value === undefined || qty_value === null) {
    throw new InvariantViolationError(
      'INV-002',
      `Missing quantity for item '${key}'`,
      { itemKey: key, qty_value }
    );
  }
  
  if (typeof qty_value !== 'number') {
    throw new InvariantViolationError(
      'INV-002',
      `Quantity must be a number for item '${key}', got ${typeof qty_value}`,
      { itemKey: key, qty_value, type: typeof qty_value }
    );
  }
  
  if (qty_value <= 0) {
    throw new InvariantViolationError(
      'INV-002',
      `Quantity must be positive for item '${key}', got ${qty_value}`,
      { itemKey: key, qty_value }
    );
  }
  
  if (!isFinite(qty_value)) {
    throw new InvariantViolationError(
      'INV-002',
      `Quantity must be finite for item '${key}', got ${qty_value}`,
      { itemKey: key, qty_value }
    );
  }
}

/**
 * INV-003: Assert reasonable portion sizes
 * 
 * Verifies that the final portion size in grams is within reasonable bounds.
 * Items outside 5g-1000g are likely errors.
 * 
 * @param {Object} item - Item with grams_as_sold or normalized grams
 * @param {Object} bounds - { minGrams, maxGrams } (optional)
 * @throws {InvariantViolationError} If portion is outside bounds
 */
function assertReasonablePortions(item, bounds = INVARIANT_CONFIG.portionBounds) {
  const { key, qty_value, qty_unit, grams_as_sold } = item;
  
  // Determine the gram value to check
  let grams = grams_as_sold;
  
  // If no grams_as_sold, check if qty_unit is grams
  if (grams === undefined && qty_unit && ['g', 'gram', 'grams'].includes(qty_unit.toLowerCase())) {
    grams = qty_value;
  }
  
  // Skip check if we don't have a gram value
  if (grams === undefined || grams === null) {
    return;
  }
  
  if (grams < bounds.minGrams) {
    throw new InvariantViolationError(
      'INV-003',
      `Portion size ${grams}g for '${key}' is below minimum ${bounds.minGrams}g`,
      { itemKey: key, grams, minGrams: bounds.minGrams, qty_value, qty_unit }
    );
  }
  
  if (grams > bounds.maxGrams) {
    throw new InvariantViolationError(
      'INV-003',
      `Portion size ${grams}g for '${key}' exceeds maximum ${bounds.maxGrams}g`,
      { itemKey: key, grams, maxGrams: bounds.maxGrams, qty_value, qty_unit }
    );
  }
}

/**
 * INV-004: Assert reconciliation factor bounds
 * 
 * Verifies that the reconciliation scaling factor is within acceptable bounds.
 * Factors outside 0.5-2.0 indicate serious calculation issues.
 * 
 * @param {number} factor - Reconciliation factor
 * @param {Object} bounds - { min, max } (optional)
 * @throws {InvariantViolationError} If factor is outside bounds
 */
function assertReconciliationBounds(factor, bounds = INVARIANT_CONFIG.reconciliationBounds) {
  if (factor === undefined || factor === null) {
    return;
  }
  
  if (typeof factor !== 'number' || !isFinite(factor)) {
    throw new InvariantViolationError(
      'INV-004',
      `Reconciliation factor must be a finite number, got ${factor}`,
      { factor, type: typeof factor }
    );
  }
  
  if (factor < bounds.min) {
    throw new InvariantViolationError(
      'INV-004',
      `Reconciliation factor ${factor.toFixed(3)} is below minimum ${bounds.min}`,
      { factor, minBound: bounds.min }
    );
  }
  
  if (factor > bounds.max) {
    throw new InvariantViolationError(
      'INV-004',
      `Reconciliation factor ${factor.toFixed(3)} exceeds maximum ${bounds.max}`,
      { factor, maxBound: bounds.max }
    );
  }
}

/**
 * INV-005: Assert YIELDS coverage for cooked items
 * 
 * Verifies that items with state 'cooked' have a valid yield factor.
 * This is a placeholder that should be called after yield lookup.
 * 
 * @param {Object} item - Item with stateHint
 * @param {Object} yieldResult - Result from yield lookup { found, factor }
 * @throws {InvariantViolationError} If cooked item has no yield
 */
function assertYieldsCoverage(item, yieldResult) {
  const { key, stateHint } = item;
  
  // Only check cooked items
  if (stateHint !== 'cooked') {
    return;
  }
  
  if (!yieldResult || !yieldResult.found) {
    throw new InvariantViolationError(
      'INV-005',
      `Cooked item '${key}' has no YIELDS entry`,
      { itemKey: key, stateHint, yieldResult }
    );
  }
  
  if (yieldResult.factor === undefined || yieldResult.factor === null) {
    throw new InvariantViolationError(
      'INV-005',
      `Cooked item '${key}' has invalid yield factor`,
      { itemKey: key, stateHint, yieldFactor: yieldResult.factor }
    );
  }
}

/**
 * INV-006: Assert resolved state for all items
 * 
 * Verifies that every item has a valid resolved state.
 * 
 * @param {Object} item - Item with stateHint or _stateResolution
 * @throws {InvariantViolationError} If state is not resolved or invalid
 */
function assertResolvedState(item) {
  const { key, stateHint, _stateResolution } = item;
  
  // Check if state hint exists
  if (stateHint === undefined || stateHint === null || stateHint === '') {
    throw new InvariantViolationError(
      'INV-006',
      `Item '${key}' has no resolved state`,
      { itemKey: key, stateHint }
    );
  }
  
  // Check if state is valid
  if (!VALID_STATES.includes(stateHint)) {
    throw new InvariantViolationError(
      'INV-006',
      `Item '${key}' has invalid state '${stateHint}'`,
      { itemKey: key, stateHint, validStates: VALID_STATES }
    );
  }
  
  // If resolution metadata exists, check confidence
  if (_stateResolution && _stateResolution.confidence === 'none') {
    throw new InvariantViolationError(
      'INV-006',
      `Item '${key}' state resolution has no confidence`,
      { itemKey: key, stateHint, resolution: _stateResolution }
    );
  }
}

/**
 * INV-007: Assert LLM schema validation passed
 * 
 * Verifies that the validation result indicates success.
 * 
 * @param {Object} validationResult - Result from validateLLMOutput
 * @throws {InvariantViolationError} If validation failed
 */
function assertLLMSchemaValidation(validationResult) {
  if (!validationResult) {
    throw new InvariantViolationError(
      'INV-007',
      'LLM schema validation result is missing',
      { validationResult }
    );
  }
  
  if (!validationResult.valid) {
    throw new InvariantViolationError(
      'INV-007',
      `LLM schema validation failed with ${validationResult.errors?.length || 0} errors`,
      {
        errors: validationResult.errors,
        corrections: validationResult.corrections
      }
    );
  }
}

/**
 * Assert day totals are reasonable
 * 
 * Verifies that daily totals fall within reasonable ranges for a meal plan.
 * 
 * @param {Object} totals - { kcal, protein, fat, carbs }
 * @param {Object} targets - { kcal, protein } (optional)
 * @throws {InvariantViolationError} If totals are unreasonable
 */
function assertReasonableDayTotals(totals, targets = null) {
  const { kcal, protein, fat, carbs } = totals;
  
  // Check for negative values
  if (kcal < 0 || protein < 0 || fat < 0 || carbs < 0) {
    throw new InvariantViolationError(
      'INV-DAY-001',
      'Day totals contain negative values',
      { totals }
    );
  }
  
  // Check for unreasonably low totals (possible calculation error)
  if (kcal > 0 && kcal < 500) {
    throw new InvariantViolationError(
      'INV-DAY-002',
      `Day total calories ${kcal} is unreasonably low (< 500)`,
      { totals }
    );
  }
  
  // Check for unreasonably high totals
  if (kcal > 10000) {
    throw new InvariantViolationError(
      'INV-DAY-003',
      `Day total calories ${kcal} is unreasonably high (> 10000)`,
      { totals }
    );
  }
  
  // If targets provided, check deviation
  if (targets && targets.kcal) {
    const deviation = Math.abs((kcal - targets.kcal) / targets.kcal) * 100;
    if (deviation > 50) {
      throw new InvariantViolationError(
        'INV-DAY-004',
        `Day calories ${kcal} deviate ${deviation.toFixed(1)}% from target ${targets.kcal}`,
        { totals, targets, deviationPct: deviation }
      );
    }
  }
}

/**
 * Assert meal has items
 * 
 * Verifies that a meal object has at least one item.
 * 
 * @param {Object} meal - Meal object with items array
 * @throws {InvariantViolationError} If meal has no items
 */
function assertMealHasItems(meal) {
  if (!meal.items || !Array.isArray(meal.items) || meal.items.length === 0) {
    throw new InvariantViolationError(
      'INV-MEAL-001',
      `Meal '${meal.name || meal.type}' has no items`,
      { mealType: meal.type, mealName: meal.name }
    );
  }
}

/**
 * Soft assertion - logs violation but doesn't throw
 * 
 * @param {Function} assertFn - Assertion function to run
 * @param {Array} args - Arguments to pass to assertion
 * @param {Function} logger - Optional logger function
 * @returns {Object|null} Violation info if failed, null if passed
 */
function softAssert(assertFn, args, logger = console.warn) {
  try {
    assertFn(...args);
    return null;
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      if (logger) {
        logger(`Soft invariant violation: ${error.message}`, error.context);
      }
      return {
        invariantId: error.invariantId,
        message: error.message,
        context: error.context,
        timestamp: error.timestamp
      };
    }
    throw error;
  }
}

/**
 * Runs all item-level invariant checks
 * 
 * @param {Object} item - Item to check
 * @param {Object} options - { yieldResult, soft }
 * @returns {Array} Array of violations if soft mode, otherwise throws on first
 */
function assertAllItemInvariants(item, options = {}) {
  const { yieldResult, soft = false } = options;
  const violations = [];
  
  const assertions = [
    [assertPositiveQuantities, [item]],
    [assertReasonablePortions, [item]],
    [assertResolvedState, [item]]
  ];
  
  if (yieldResult !== undefined) {
    assertions.push([assertYieldsCoverage, [item, yieldResult]]);
  }
  
  for (const [assertFn, args] of assertions) {
    if (soft) {
      const violation = softAssert(assertFn, args, null);
      if (violation) violations.push(violation);
    } else {
      assertFn(...args);
    }
  }
  
  return violations;
}

/**
 * Runs all macro-level invariant checks
 * 
 * @param {Object} macros - Macro values to check
 * @param {Object} options - { soft }
 * @returns {Array} Array of violations if soft mode
 */
function assertAllMacroInvariants(macros, options = {}) {
  const { soft = false } = options;
  const violations = [];
  
  if (soft) {
    const violation = softAssert(assertMacroCalorieConsistency, [macros], null);
    if (violation) violations.push(violation);
  } else {
    assertMacroCalorieConsistency(macros);
  }
  
  return violations;
}

/**
 * Checks all invariants for a complete day plan
 * 
 * @param {Object} dayPlan - { meals, totals, targets }
 * @param {Object} options - { soft, getYieldResult }
 * @returns {Object} { passed, violations }
 */
function checkDayPlanInvariants(dayPlan, options = {}) {
  const { soft = true, getYieldResult } = options;
  const violations = [];
  
  // Check day totals
  const totalsViolation = softAssert(
    assertReasonableDayTotals,
    [dayPlan.totals, dayPlan.targets],
    null
  );
  if (totalsViolation) violations.push(totalsViolation);
  
  // Check each meal and its items
  for (const meal of dayPlan.meals || []) {
    const mealViolation = softAssert(assertMealHasItems, [meal], null);
    if (mealViolation) violations.push(mealViolation);
    
    for (const item of meal.items || []) {
      const yieldResult = getYieldResult ? getYieldResult(item) : undefined;
      const itemViolations = assertAllItemInvariants(item, { yieldResult, soft: true });
      violations.push(...itemViolations);
    }
  }
  
  // If not soft mode and there are violations, throw the first one
  if (!soft && violations.length > 0) {
    const first = violations[0];
    throw new InvariantViolationError(
      first.invariantId,
      first.message,
      first.context
    );
  }
  
  return {
    passed: violations.length === 0,
    violations
  };
}

/**
 * Creates an invariant checker with custom configuration
 * 
 * @param {Object} config - Configuration overrides
 * @returns {Object} Object with bound assertion functions
 */
function createInvariantChecker(config = {}) {
  const mergedConfig = { ...INVARIANT_CONFIG, ...config };
  
  return {
    assertMacroCalorieConsistency: (macros) => 
      assertMacroCalorieConsistency(macros, mergedConfig.calorieConsistencyTolerancePct),
    
    assertReasonablePortions: (item) => 
      assertReasonablePortions(item, mergedConfig.portionBounds),
    
    assertReconciliationBounds: (factor) => 
      assertReconciliationBounds(factor, mergedConfig.reconciliationBounds),
    
    // Pass-through for others
    assertPositiveQuantities,
    assertYieldsCoverage,
    assertResolvedState,
    assertLLMSchemaValidation,
    assertReasonableDayTotals,
    assertMealHasItems,
    
    // Composite checks
    assertAllItemInvariants,
    assertAllMacroInvariants,
    checkDayPlanInvariants
  };
}

module.exports = {
  // Error class
  InvariantViolationError,
  
  // Individual assertions
  assertMacroCalorieConsistency,
  assertPositiveQuantities,
  assertReasonablePortions,
  assertReconciliationBounds,
  assertYieldsCoverage,
  assertResolvedState,
  assertLLMSchemaValidation,
  assertReasonableDayTotals,
  assertMealHasItems,
  
  // Composite assertions
  assertAllItemInvariants,
  assertAllMacroInvariants,
  checkDayPlanInvariants,
  
  // Utilities
  softAssert,
  createInvariantChecker,
  
  // Configuration
  INVARIANT_CONFIG,
  VALID_STATES
};