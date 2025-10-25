// --- MACRO + PORTION SOLVER (Mark 44, patched) ---
// 1) Macro contract (calories + P/F/C + tolerances).
// 2) Portion scaling solver with wider bounds and carb booster.
// 3) Final contract checker.

"use strict";

///   CONTRACT-BUILDER-START   \\\\

// Mifflin-St Jeor + activity factor
function estimateMaintenanceCalories({ height_cm, weight_kg, age, sex, activityLevel }) {
  const base =
    10 * weight_kg +
    6.25 * height_cm -
    5 * age +
    (sex.toLowerCase() === "female" ? -161 : 5);

  let act = 1.5;
  if (activityLevel === "sedentary") act = 1.2;
  else if (activityLevel === "light") act = 1.375;
  else if (activityLevel === "active") act = 1.55;
  else if (activityLevel === "very_active") act = 1.725;

  return base * act;
}

function buildMacroContract(userProfile) {
  const maintenance = estimateMaintenanceCalories(userProfile);
  const caloriesTarget = Math.round(maintenance * 1.15);

  const protein_g = Math.round(userProfile.weight_kg * 3.0); // ~3 g/kg
  const fat_g = Math.round((caloriesTarget * 0.25) / 9);     // ~25% kcal from fat
  const carbCalories = caloriesTarget - protein_g * 4 - fat_g * 9;
  const carbs_g = Math.round(carbCalories / 4);

  // Slightly looser to improve feasibility on real foods
  const tolerance = {
    calories_pct: 0.03,   // 3%
    protein_pct: 0.08,    // 8%
    fat_pct: 0.08,        // 8%
    carbs_pct: 0.08,      // 8%
    carbs_min_pct_of_target: 0.8
  };

  const hard_caps = {
    protein_g_max: userProfile.weight_kg * 2.8,
    fat_g_max: fat_g * 1.5,
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
// Heuristic scaler with widened bounds and a single auto “carb booster”.

function fitMealsToContract(meals, macroContract, { log }) {
  if (!meals || meals.length === 0) return { feasible: false, reason: "NO_MEALS" };

  const working = meals.map(m => ({ ...m, portionScale: 1 }));

  const MIN_SCALE = 0.4;
  const MAX_SCALE = 2.5;
  const MAX_ITERS = 400;

  function totalsFrom(list) {
    let kcal = 0, p = 0, f = 0, c = 0;
    for (const m of list) {
      const s = m.portionScale || 1;
      const em = m.estMacrosPerPortion || { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
      kcal += em.kcal * s;
      p    += em.protein_g * s;
      f    += em.fat_g * s;
      c    += em.carbs_g * s;
    }
    return { kcal, p, f, c };
  }

  function scaledMealsOut(list) {
    return list.map(m => {
      const s = m.portionScale || 1;
      const em = m.estMacrosPerPortion || { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
      return {
        mealName: m.mealName,
        portionNote: m.portionNote,
        portionScale: parseFloat(s.toFixed(2)),
        estMacrosScaled: {
          kcal: em.kcal * s,
          protein_g: em.protein_g * s,
          fat_g: em.fat_g * s,
          carbs_g: em.carbs_g * s
        },
        ingredientsScaled: (m.ingredients || []).map(ing => ({
          displayName: ing.displayName,
          quantityGrams: (ing.quantityGrams || 0) * s
        }))
      };
    });
  }

  function adjustOnce(list) {
    const t = totalsFrom(list);
    const carbRatio = macroContract.carbs_g / Math.max(t.c, 1);
    const calRatio  = macroContract.calories / Math.max(t.kcal, 1);
    let global = 0.7 * carbRatio + 0.3 * calRatio;

    if (global < 0.7) global = 0.7;
    if (global > 1.4) global = 1.4;

    for (const m of list) {
      const em = m.estMacrosPerPortion || { kcal: 1, protein_g: 0, fat_g: 0, carbs_g: 0 };
      const kcal = Math.max(em.kcal, 1);
      const cpk  = em.carbs_g   / kcal;
      const fpk  = em.fat_g     / kcal;
      const ppk  = em.protein_g / kcal;

      let bias = 1 + (cpk * 0.8) - (fpk * 0.6) - (ppk * 0.2);
      if (bias < 0.6) bias = 0.6;
      if (bias > 1.4) bias = 1.4;

      m.portionScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (m.portionScale || 1) * global * bias));
    }
  }

  function check(list) {
    const T = totalsFrom(list);
    return checkContractSatisfied(
      { calories: T.kcal, protein_g: T.p, fat_g: T.f, carbs_g: T.c },
      macroContract
    );
  }

  // 1) Try scaling current meals
  for (let i = 0; i < MAX_ITERS; i++) {
    const chk = check(working);
    if (chk.ok) return { feasible: true, meals: scaledMealsOut(working) };
    adjustOnce(working);
  }

  // 2) Inject one carb booster, then retry
  const booster = {
    mealName: "Carb Booster (Rice+Banana+Honey)",
    portionNote: "booster",
    portionScale: 1,
    estMacrosPerPortion: { kcal: 450, protein_g: 6, fat_g: 2, carbs_g: 100 },
    ingredients: [
      { displayName: "White Rice (Cooked)", quantityGrams: 300 },
      { displayName: "Banana", quantityGrams: 120 },
      { displayName: "Honey", quantityGrams: 15 }
    ]
  };
  working.push(booster);

  for (let i = 0; i < MAX_ITERS; i++) {
    const chk = check(working);
    if (chk.ok) return { feasible: true, meals: scaledMealsOut(working) };
    adjustOnce(working);
  }

  return { feasible: false, reason: "COULD_NOT_FIT_WITHIN_BOUNDS" };
}

///   SOLVER-END   \\\\



///   CHECKER-START   \\\\
function withinPct(a, b, pct) {
  if (b === 0) return Math.abs(a) < 1e-9;
  const diff = Math.abs(a - b) / b;
  return diff <= pct;
}

function checkContractSatisfied(actualTotals, macroContract) {
  const { calories, protein_g, fat_g, carbs_g } = macroContract;
  const tol = macroContract.tolerance;

  if (actualTotals.carbs_g < macroContract.hard_caps.carbs_g_min) {
    return { ok: false, reason: "CARBS_TOO_LOW" };
  }
  if (actualTotals.protein_g > macroContract.hard_caps.protein_g_max) {
    return { ok: false, reason: "PROTEIN_TOO_HIGH" };
  }
  if (actualTotals.fat_g > macroContract.hard_caps.fat_g_max) {
    return { ok: false, reason: "FAT_TOO_HIGH" };
  }

  const calOk  = withinPct(actualTotals.calories,  calories,  tol.calories_pct);
  const protOk = withinPct(actualTotals.protein_g, protein_g, tol.protein_pct);
  const fatOk  = withinPct(actualTotals.fat_g,    fat_g,     tol.fat_pct);
  const carbOk = withinPct(actualTotals.carbs_g,  carbs_g,   tol.carbs_pct);

  if (calOk && protOk && fatOk && carbOk) return { ok: true };
  return {
    ok: false,
    reason: {
      calOk, protOk, fatOk, carbOk, actualTotals, macroContract
    }
  };
}
///   CHECKER-END   \\\\



module.exports = {
  buildMacroContract,
  fitMealsToContract,
  checkContractSatisfied
};
