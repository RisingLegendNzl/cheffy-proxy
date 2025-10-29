/**
 * Cheffy Orchestrator (V11.1 Patch)
 * Utility to reconcile daily calories by "locking" protein and scaling non-protein (carb/fat) items.
 * This is a curative patch to fix AI-generated plans that deviate from the calorie target.
 *
 * This file is in CommonJS format to be compatible with `generate-full-plan.js`.
 */

/**
 * Calculates macros for a single item.
 * @callback getItemMacros
 * @param {object} item - The meal item object (e.g., { key, qty, unit, normalizedKey })
 * @returns {{p: number, f: number, c: number, kcal: number}} - Calculated macros for that item.
 */

/**
 * Reconciles a list of meals to a target calorie count by scaling non-protein items.
 * @param {object} params
 * @param {Array<object>} params.meals - The array of meal objects (e.g., [{ name, items: [...] }]).
 * @param {number} params.targetKcal - The target daily calories.
 * @param {getItemMacros} params.getItemMacros - A synchronous callback function to get macros for an item.
 * @param {number} [params.tolPct=5] - The allowed tolerance percentage (e.g., 5 for ±5%).
 * @returns {{adjusted: boolean, factor: number|null, meals: Array<object>}}
 */
function reconcileNonProtein({ meals, targetKcal, getItemMacros, tolPct = 5 }) {
  let Pk = 0; // Protein Kcal
  let NPk = 0; // Non-Protein Kcal

  // First pass: Sum Protein Kcal and Non-Protein Kcal for the day
  for (const m of meals) {
    if (!m || !Array.isArray(m.items)) continue;
    for (const it of m.items) {
      const mm = getItemMacros(it); // {p, f, c, kcal}
      const pk = mm.p * 4;
      Pk += pk;
      NPk += Math.max(mm.kcal - pk, 0); // Add non-protein calories
    }
  }

  const tol = targetKcal * (tolPct / 100); // e.g., 3548 * 0.05 = 177.4
  const kcalNow = Pk + NPk;

  // 1. Check if already within tolerance
  if (Math.abs(kcalNow - targetKcal) <= tol) {
    return { adjusted: false, factor: null, meals };
  }

  // 2. Calculate scaling factor
  const desiredNPk = Math.max(targetKcal - Pk, 0); // Desired non-protein calories
  const factor = desiredNPk / Math.max(NPk, 0.0001); // Avoid division by zero

  // 3. Apply scaling factor to non-protein-dominant items
  const out = meals.map(meal => ({
    ...meal,
    items: meal.items.map(it => {
      const mm = getItemMacros(it);
      
      // Check if item is protein-dominant
      const proteinDominant = (mm.p * 4) >= Math.max(mm.c * 4, mm.f * 9);
      
      if (proteinDominant) {
        return it; // Lock protein-dominant items, return as-is
      }
      
      // --- START: MODIFICATION (Robust Quantity Scaling) ---
      const originalQty = it.qty || 0;
      let newQty = originalQty * factor;
      
      // Round 'g' to nearest whole number, 'ml' to nearest 5
      if (it.unit === 'ml') {
        newQty = Math.round(newQty / 5) * 5;
      } else {
        newQty = Math.round(newQty);
      }
      
      // CRITICAL: Enforce a minimum quantity of 1 for any item that isn't 0 to begin with.
      // This prevents the qty: 0 crash.
      if (originalQty > 0 && newQty < 1) {
        newQty = 1;
      }
      // --- END: MODIFICATION ---
      
      return { ...it, qty: newQty };
    })
  }));

  return { adjusted: true, factor, meals: out };
}

module.exports = { reconcileNonProtein };

