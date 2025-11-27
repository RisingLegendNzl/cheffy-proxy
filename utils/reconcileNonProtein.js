/**
 * Cheffy Orchestrator (V11.2 - Phase C & D)
 * Utility to reconcile daily calories by "locking" protein and scaling non-protein (carb/fat) items.
 * Implements optional aggressive protein scaling if target is significantly overshot.
 *
 * This file is in CommonJS format to be compatible with `generate-full-plan.js`.
 */

/**
 * Calculates macros for a single item.
 * @callback getItemMacros
 * @param {object} item - The meal item object (e.g., { key, qty, unit, normalizedKey })
 * @returns {{p: number, f: number, c: number, kcal: number}} - Calculated macros for that item.
 */

// Phase C1: New per-meal reconciliation function
/**
 * Reconciles a single meal to a target calorie count by scaling ALL items,
 * and ensures protein target is not severely undershot.
 * * @param {object} params
 * @param {object} params.meal - The single meal object.
 * @param {number} params.targetKcal - The target calories for this meal.
 * @param {number} params.targetProtein - The target protein for this meal (used for guard).
 * @param {getItemMacros} params.getItemMacros - A synchronous callback function to get macros for an item.
 * @param {number} [params.tolPct=10] - The allowed tolerance percentage (default ±10%).
 * @param {Function} params.log - Logger function from the main orchestrator.
 * @returns {{adjusted: boolean, factor: number|null, meal: object}}
 */
function reconcileMealLevel({ meal, targetKcal, targetProtein, getItemMacros, log, tolPct = 10 }) {
  if (!meal || !Array.isArray(meal.items) || targetKcal <= 0) {
    return { adjusted: false, factor: null, meal };
  }

  // Calculate current macros
  let currentKcal = 0;
  let currentProtein = 0;
  
  meal.items.forEach(it => {
    const mm = getItemMacros(it);
    currentKcal += mm.kcal;
    currentProtein += mm.p;
  });

  const tol = targetKcal * (tolPct / 100);
  const MIN_PROTEIN_RATIO = 0.80; // C4: Guard against protein dropping below 80%

  // 1. Check if already within tolerance
  if (Math.abs(currentKcal - targetKcal) <= tol) {
    return { adjusted: false, factor: null, meal };
  }
  
  // 2. Calculate scaling factor (applies to ALL items)
  const factor = targetKcal / Math.max(currentKcal, 0.0001);

  // 3. Apply scaling factor and check guards
  if (factor < 1.0) { // Only check protein guard when scaling down
      const predictedProtein = currentProtein * factor;
      const proteinGuard = targetProtein * MIN_PROTEIN_RATIO;
      
      if (predictedProtein < proteinGuard) {
            log(`[MEAL_RECON] Aborted scaling down meal "${meal.name}" (Factor ${factor.toFixed(2)}) due to protein floor violation (${predictedProtein.toFixed(1)}g < ${proteinGuard.toFixed(1)}g).`, 'WARN', 'SOLVER');
            // Return original meal, marked as unadjusted
            return { adjusted: false, factor: null, meal };
      }
  }
  
  const outItems = meal.items.map(it => {
    const originalQty = it.qty || it.qty_value || 0;
    
    // Apply robust quantity scaling
    let newQty = originalQty * factor;
    
    if (it.unit === 'ml') {
        newQty = Math.round(newQty / 5) * 5;
    } else {
        newQty = Math.round(newQty);
    }
    
    if (originalQty > 0 && newQty < 1) {
        newQty = 1;
    }

    return { ...it, qty: newQty, qty_value: newQty };
  });

  log(`[MEAL_RECON] Scaled meal "${meal.name}" by factor: ${factor.toFixed(2)}`, 'INFO', 'SOLVER');
  
  return { 
      adjusted: true, 
      factor, 
      meal: {
          ...meal, 
          items: outItems 
      }
  };
}


/**
 * Reconciles a list of meals to a target calorie count by scaling non-protein items.
 * @param {object} params
 * @param {Array<object>} params.meals - The array of meal objects.
 * @param {number} params.targetKcal - The target daily calories.
 * @param {getItemMacros} params.getItemMacros - A synchronous callback function to get macros for an item.
 * @param {number} [params.tolPct=5] - The allowed tolerance percentage.
 * @param {boolean} [params.allowProteinScaling=false] - D2: Whether to aggressively scale protein down if over target.
 * @param {number} params.targetProtein - Required if allowProteinScaling is true.
 * @param {Function} params.log - Required if allowProteinScaling is true.
 * @returns {{adjusted: boolean, factor: number|null, meals: Array<object>}}
 */
function reconcileNonProtein({ meals, targetKcal, getItemMacros, tolPct = 5, allowProteinScaling = false, targetProtein = 0, log = () => {} }) {
  let Pk = 0; // Protein Kcal
  let NPk = 0; // Non-Protein Kcal
  let actualProtein = 0; // D1: Track actual protein intake

  // First pass: Sum Protein Kcal and Non-Protein Kcal for the day
  for (const m of meals) {
    if (!m || !Array.isArray(m.items)) continue;
    for (const it of m.items) {
      const mm = getItemMacros(it); // {p, f, c, kcal}
      const pk = mm.p * 4;
      Pk += pk;
      NPk += Math.max(mm.kcal - pk, 0); // Add non-protein calories
      actualProtein += mm.p;
    }
  }

  const tol = targetKcal * (tolPct / 100);
  let kcalNow = Pk + NPk;
  let proteinFactor = 1.0;

  // D1, D3: Check for aggressive protein scaling requirement
  if (allowProteinScaling && targetProtein > 0 && actualProtein > targetProtein * 1.30) {
      // Daily protein exceeds target by > 30%
      proteinFactor = targetProtein / actualProtein;
      proteinFactor = Math.max(proteinFactor, 0.70); // Capped at 30% reduction (0.7 minimum)
      log(`[DAILY_RECON] Aggressive protein scaling needed. Target ${targetProtein}g, Actual ${actualProtein.toFixed(1)}g. Scaling protein items by factor ${proteinFactor.toFixed(2)}.`, 'WARN', 'SOLVER');
      
      // Update Pk based on the planned reduction
      const reducedProtein = actualProtein * proteinFactor;
      Pk = reducedProtein * 4;
      kcalNow = Pk + NPk; // Recalculate total calories now that Pk is lower
  }


  // 1. Check if already within tolerance
  if (Math.abs(kcalNow - targetKcal) <= tol) {
    return { adjusted: false, factor: null, meals };
  }

  // 2. Calculate scaling factor for NON-PROTEIN items
  const desiredNPk = Math.max(targetKcal - Pk, 0); // Desired non-protein calories
  const nonProteinFactor = desiredNPk / Math.max(NPk, 0.0001); // Avoid division by zero

  // 3. Apply scaling factors
  const out = meals.map(meal => ({
    ...meal,
    items: meal.items.map(it => {
      const mm = getItemMacros(it);
      
      // Check if item is protein-dominant
      const proteinDominant = (mm.p * 4) >= Math.max(mm.c * 4, mm.f * 9);
      
      let factorToApply = nonProteinFactor;
      
      if (proteinDominant) {
          // If we are aggressively scaling protein, use proteinFactor here
          if (proteinFactor < 1.0) {
              factorToApply = proteinFactor;
          } else {
              // Otherwise, lock protein items (factor = 1.0, so no scaling)
              factorToApply = 1.0;
          }
      }
      
      // --- START: MODIFICATION (Robust Quantity Scaling) ---
      const originalQty = it.qty || 0;
      let newQty = originalQty * factorToApply;
      
      // Round 'g' to nearest whole number, 'ml' to nearest 5
      if (it.unit === 'ml') {
        newQty = Math.round(newQty / 5) * 5;
      } else {
        newQty = Math.round(newQty);
      }
      
      // CRITICAL: Enforce a minimum quantity of 1 for any item that isn't 0 to begin with.
      if (originalQty > 0 && newQty < 1) {
        newQty = 1;
      }
      // --- END: MODIFICATION ---
      
      // If no change, return original item structure if possible (for simplicity, we return new object)
      if (factorToApply === 1.0) {
          return it;
      }
      
      return { ...it, qty: newQty };
    })
  }));

  return { adjusted: true, factor: nonProteinFactor, meals: out };
}

module.exports = { reconcileNonProtein, reconcileMealLevel };

