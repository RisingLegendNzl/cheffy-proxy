// --- MACRO + PORTION SOLVER (Mark 44) ---
// Responsibilities:
// 1. Build numeric macro contract (calories + P/F/C + tolerances).
// 2. Scale meal portions inside sane bounds to satisfy contract.
// 3. Verify contract satisfaction.

// No external deps. CommonJS module.

"use strict";

///   CONTRACT-BUILDER-START   \\\\

// Helper: estimate maintenance kcal using Mifflin-St Jeor + activity factor
function estimateMaintenanceCalories({ height_cm, weight_kg, age, sex, activityLevel }) {
  // Mifflin-St Jeor BMR
  // male:   10*kg + 6.25*cm - 5*age + 5
  // female: 10*kg + 6.25*cm - 5*age - 161
  const base =
    10 * weight_kg +
    6.25 * height_cm -
    5 * age +
    (sex.toLowerCase() === "female" ? -161 : 5);

  // crude activity factor
  let act = 1.5;
  if (activityLevel === "sedentary") act = 1.2;
  else if (activityLevel === "light") act = 1.375;
  else if (activityLevel === "active") act = 1.55;
  else if (activityLevel === "very_active") act = 1.725;

  return base * act;
}

function buildMacroContract(userProfile) {
  // 1. calories target = maintenance * 1.15 for lean bulk +15%
  const maintenance = estimateMaintenanceCalories(userProfile);
  const caloriesTarget = Math.round(maintenance * 1.15);

  // 2. macros
  // We lock protein high (~3 g/kg). This matches prior Mark 43 behavior.
  const protein_g = Math.round(userProfile.weight_kg * 3.0); // e.g. 73kg -> 219g

  // fat ~25% kcal
  const fat_g = Math.round((caloriesTarget * 0.25) / 9);

  // carbs fill the rest
  const carbCalories =
    caloriesTarget - protein_g * 4 - fat_g * 9;
  const carbs_g = Math.round(carbCalories / 4);

  // Tolerances and caps. You can tune these.
  const tolerance = {
    calories_pct: 0.02,
    protein_pct: 0.05,
    fat_pct: 0.05,
    carbs_pct: 0.05,
    carbs_min_pct_of_target: 0.8
  };

  const hard_caps = {
    protein_g_max: userProfile.weight_kg * 2.8, // safety ceiling
    fat_g_max: fat_g * 1.5,                     // don't explode fat
    carbs_g_min: carbs_g * tolerance.carbs_min_pct_of_target
  };

  return {
    calories: caloriesTarget,
    protein_g,
    fat_g,
    carbs_g,
    tolerance,
    hard_caps
  };
}

///   CONTRACT-BUILDER-END   \\\\



///   SOLVER-START   \\\\
// We solve for meal portion multipliers s_i so that sum_i s_i * m_i ~= target.
//
// Input meals:
// [
//   {
//     mealName,
//     portionNote,
//     estMacrosPerPortion: { kcal, protein_g, fat_g, carbs_g },
//     ingredients: [ { displayName, quantityGrams }, ... ]
//   },
//   ...
// ]
//
// Output:
// {
//   feasible: boolean,
//   reason?: string,
//   meals: [
//     {
//       mealName,
//       portionNote,
//       portionScale,
//       estMacrosScaled,
//       ingredientsScaled: [ { displayName, quantityGrams }, ... ]
//     }
//   ]
// }
//
// This is currently a heuristic scaling solver, not full LP.
// We adjust all meals proportionally by carbs demand first
// then tweak protein and fat within +/-50% bounds.
//
// You can later swap this with a real LP/QP solver or ILP.

function fitMealsToContract(meals, macroContract, { log }) {
  if (!meals || meals.length === 0) {
    return { feasible: false, reason: "NO_MEALS" };
  }

  // initial scale = 1 for each meal
  const working = meals.map(m => ({
    ...m,
    portionScale: 1
  }));

  // helper to compute totals from current scales
  function currentTotals() {
    let kcal = 0,
      p = 0,
      f = 0,
      c = 0;
    for (const m of working) {
      const s = m.portionScale;
      kcal += m.estMacrosPerPortion.kcal * s;
      p += m.estMacrosPerPortion.protein_g * s;
      f += m.estMacrosPerPortion.fat_g * s;
      c += m.estMacrosPerPortion.carbs_g * s;
    }
    return { kcal, p, f, c };
  }

  // iterative heuristic
  for (let iter = 0; iter < 200; iter++) {
    const totals = currentTotals();

    // Check feasibility with macros and caps
    const calRatio = macroContract.calories / (totals.kcal || 1);
    const carbRatio = macroContract.carbs_g / (totals.c || 1);
    const proteinRatio = macroContract.protein_g / (totals.p || 1);
    const fatRatio = macroContract.fat_g / (totals.f || 1);

    // Scale meals primarily by carb demand because carb shortfall
    // is usually the first failure mode in Mark 43.
    // Then bias toward raising carbs without blowing fat.
    let globalScale = carbRatio;

    // Cap globalScale inside sane eating bounds
    if (globalScale < 0.5) globalScale = 0.5;
    if (globalScale > 2.0) globalScale = 2.0;

    for (const m of working) {
      // Meals with high carbs/low fat get slightly higher bump.
      const cPerKcal = m.estMacrosPerPortion.carbs_g / (m.estMacrosPerPortion.kcal || 1);
      const fPerKcal = m.estMacrosPerPortion.fat_g / (m.estMacrosPerPortion.kcal || 1);

      let bias = 1.0 + (cPerKcal - fPerKcal); // crude
      if (bias < 0.5) bias = 0.5;
      if (bias > 1.5) bias = 1.5;

      // update portionScale but constrain 0.5..2.0
      m.portionScale = m.portionScale * (globalScale * 0.5 + bias * 0.5);
      if (m.portionScale < 0.5) m.portionScale = 0.5;
      if (m.portionScale > 2.0) m.portionScale = 2.0;
    }

    // After adjustment, check again
    const newTotals = currentTotals();

    // If within tolerance we're done
    const chk = checkContractSatisfied(
      {
        calories: newTotals.kcal,
        protein_g: newTotals.p,
        fat_g: newTotals.f,
        carbs_g: newTotals.c
      },
      macroContract
    );
    if (chk.ok) {
      // build final output with scaled ingredients
      const solvedMeals = working.map(m => {
        const s = m.portionScale;
        return {
          mealName: m.mealName,
          portionNote: m.portionNote,
          portionScale: parseFloat(s.toFixed(2)),
          estMacrosScaled: {
            kcal: m.estMacrosPerPortion.kcal * s,
            protein_g: m.estMacrosPerPortion.protein_g * s,
            fat_g: m.estMacrosPerPortion.fat_g * s,
            carbs_g: m.estMacrosPerPortion.carbs_g * s
          },
          ingredientsScaled: m.ingredients.map(ing => ({
            displayName: ing.displayName,
            quantityGrams: ing.quantityGrams * s
          }))
        };
      });

      return {
        feasible: true,
        meals: solvedMeals
      };
    }
  }

  // If we exit loop not ok then not feasible with simple scaling
  return {
    feasible: false,
    reason: "COULD_NOT_FIT_WITHIN_BOUNDS"
  };
}

///   SOLVER-END   \\\\



///   CHECKER-START   \\\\
function withinPct(a, b, pct) {
  if (b === 0) return Math.abs(a) < 1e-9;
  const diff = Math.abs(a - b) / b;
  return diff <= pct;
}

// final validation against contract
function checkContractSatisfied(actualTotals, macroContract) {
  const { calories, protein_g, fat_g, carbs_g } = macroContract;
  const tol = macroContract.tolerance;

  // carbs floor
  if (actualTotals.carbs_g < macroContract.hard_caps.carbs_g_min) {
    return { ok: false, reason: "CARBS_TOO_LOW" };
  }

  // hard caps
  if (actualTotals.protein_g > macroContract.hard_caps.protein_g_max) {
    return { ok: false, reason: "PROTEIN_TOO_HIGH" };
  }
  if (actualTotals.fat_g > macroContract.hard_caps.fat_g_max) {
    return { ok: false, reason: "FAT_TOO_HIGH" };
  }

  // tolerance checks
  const calOk = withinPct(actualTotals.calories, calories, tol.calories_pct);
  const protOk = withinPct(actualTotals.protein_g, protein_g, tol.protein_pct);
  const fatOk = withinPct(actualTotals.fat_g, fat_g, tol.fat_pct);
  const carbOk = withinPct(actualTotals.carbs_g, carbs_g, tol.carbs_pct);

  if (calOk && protOk && fatOk && carbOk) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: {
      calOk,
      protOk,
      fatOk,
      carbOk,
      actualTotals,
      macroContract
    }
  };
}
///   CHECKER-END   \\\\



module.exports = {
  buildMacroContract,
  fitMealsToContract,
  checkContractSatisfied
};
