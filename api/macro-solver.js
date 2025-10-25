// --- MACRO + PORTION SOLVER (Mark 44, NNLS variant) ---
// 1) Macro contract (calories + P/F/C + tolerances).
// 2) Box-constrained least-squares fit (projected gradient) for meal scales.
// 3) Single carb-booster fallback.
// 4) Final contract checker.

"use strict";

//// CONTRACT ///////////////////////////////////////////////////////////////

function estimateMaintenanceCalories({ height_cm, weight_kg, age, sex, activityLevel }) {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age + (sex.toLowerCase() === "female" ? -161 : 5);
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
  const protein_g = Math.round(userProfile.weight_kg * 3.0);
  const fat_g = Math.round((caloriesTarget * 0.25) / 9);
  const carbCalories = caloriesTarget - protein_g * 4 - fat_g * 9;
  const carbs_g = Math.round(carbCalories / 4);

  const tolerance = {
    calories_pct: 0.03,
    protein_pct: 0.08,
    fat_pct: 0.08,
    carbs_pct: 0.08,
    carbs_min_pct_of_target: 0.8
  };

  const hard_caps = {
    protein_g_max: userProfile.weight_kg * 2.8,
    fat_g_max: fat_g * 1.5,
    carbs_g_min: carbs_g * tolerance.carbs_min_pct_of_target
  };

  return { calories: caloriesTarget, protein_g, fat_g, carbs_g, tolerance, hard_caps };
}

//// SOLVER (PROJECTED GRADIENT NNLS) //////////////////////////////////////

// Build A (4 x N) and T (4) from meals
function buildSystem(meals) {
  const A = [[], [], [], []]; // kcal, P, F, C
  for (const m of meals) {
    const e = m.estMacrosPerPortion || { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
    A[0].push(e.kcal || 0);
    A[1].push(e.protein_g || 0);
    A[2].push(e.fat_g || 0);
    A[3].push(e.carbs_g || 0);
  }
  return A;
}

function matVec(A, s) { // y = A*s ; A: (4 x N)
  const N = s.length;
  const y = [0, 0, 0, 0];
  for (let j = 0; j < N; j++) {
    const sj = s[j];
    y[0] += A[0][j] * sj;
    y[1] += A[1][j] * sj;
    y[2] += A[2][j] * sj;
    y[3] += A[3][j] * sj;
  }
  return y;
}

function vecSub(a, b) { return a.map((x, i) => x - b[i]); }
function vecAdd(a, b) { return a.map((x, i) => x + b[i]); }
function vecScale(a, k) { return a.map(x => x * k); }

// g = 2 * A^T * (A s - T)  with per-macro weights
function grad(A, s, T, w) {
  const r = vecSub(matVec(A, s), T);               // residual 4
  const wr = [w[0]*r[0], w[1]*r[1], w[2]*r[2], w[3]*r[3]];
  const N = s.length;
  const g = new Array(N).fill(0);
  for (let j = 0; j < N; j++) {
    g[j] = 2 * (A[0][j] * wr[0] + A[1][j] * wr[1] + A[2][j] * wr[2] + A[3][j] * wr[3]);
  }
  return g;
}

function clampBox(v, lo, hi) {
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    out[i] = x < lo ? lo : x > hi ? hi : x;
  }
  return out;
}

function totalsFromMeals(meals, scales) {
  let kcal=0,p=0,f=0,c=0;
  for (let i=0;i<meals.length;i++) {
    const s = scales[i] || 1;
    const e = meals[i].estMacrosPerPortion || {kcal:0, protein_g:0, fat_g:0, carbs_g:0};
    kcal += e.kcal * s;
    p    += e.protein_g * s;
    f    += e.fat_g * s;
    c    += e.carbs_g * s;
  }
  return { calories: kcal, protein_g: p, fat_g: f, carbs_g: c };
}

function scaledMealsOut(meals, scales) {
  return meals.map((m, i) => {
    const s = parseFloat((scales[i] || 1).toFixed(2));
    const e = m.estMacrosPerPortion || {kcal:0, protein_g:0, fat_g:0, carbs_g:0};
    return {
      mealName: m.mealName,
      portionNote: m.portionNote,
      portionScale: s,
      estMacrosScaled: {
        kcal: e.kcal * s,
        protein_g: e.protein_g * s,
        fat_g: e.fat_g * s,
        carbs_g: e.carbs_g * s
      },
      ingredientsScaled: (m.ingredients || []).map(ing => ({
        displayName: ing.displayName,
        quantityGrams: (ing.quantityGrams || 0) * s
      }))
    };
  });
}

function fitWithProjectedGD(meals, macroContract, { log }, opts) {
  const { MIN_SCALE, MAX_SCALE, MAX_ITERS, STEP_INIT } = opts;
  const A = buildSystem(meals);
  const T = [macroContract.calories, macroContract.protein_g, macroContract.fat_g, macroContract.carbs_g];

  // Weight carbs highest to avoid fat/protein exploits
  const w = [1.0, 1.2, 1.2, 1.6];

  let s = new Array(meals.length).fill(1);
  let step = STEP_INIT;

  for (let it=0; it<MAX_ITERS; it++) {
    const g = grad(A, s, T, w);
    // backtracking if needed
    let improved = false;
    for (let bt=0; bt<6; bt++) {
      const s_try = clampBox(s.map((x,i)=> x - step*g[i]), MIN_SCALE, MAX_SCALE);
      const r_old = vecSub(matVec(A, s), T);
      const r_new = vecSub(matVec(A, s_try), T);
      const loss_old = w[0]*r_old[0]*r_old[0] + w[1]*r_old[1]*r_old[1] + w[2]*r_old[2]*r_old[2] + w[3]*r_old[3]*r_old[3];
      const loss_new = w[0]*r_new[0]*r_new[0] + w[1]*r_new[1]*r_new[1] + w[2]*r_new[2]*r_new[2] + w[3]*r_new[3]*r_new[3];

      if (loss_new <= loss_old) {
        s = s_try;
        improved = true;
        step *= 1.1; // small acceleration
        break;
      } else {
        step *= 0.5; // backtrack
      }
    }

    const totals = totalsFromMeals(meals, s);
    const chk = checkContractSatisfied(totals, macroContract);
    if (chk.ok) return { feasible: true, meals: scaledMealsOut(meals, s) };

    if (!improved) {
      // stalled; gently jitter toward carbs
      for (let j=0;j<s.length;j++) s[j] = Math.min(MAX_SCALE, s[j]*1.02);
    }
  }
  return { feasible: false, reason: "COULD_NOT_FIT_WITHIN_BOUNDS" };
}

function fitMealsToContract(meals, macroContract, { log }) {
  if (!meals || meals.length === 0) return { feasible: false, reason: "NO_MEALS" };

  const OPTS = { MIN_SCALE: 0.3, MAX_SCALE: 3.0, MAX_ITERS: 800, STEP_INIT: 1e-4 };

  // Try NNLS fit on given meals
  let r1 = fitWithProjectedGD(meals, macroContract, { log }, OPTS);
  if (r1.feasible) return r1;

  // Inject one carb booster then retry
  const booster = {
    mealName: "Carb Booster (Rice+Banana+Honey)",
    portionNote: "booster",
    estMacrosPerPortion: { kcal: 450, protein_g: 6, fat_g: 2, carbs_g: 100 },
    ingredients: [
      { displayName: "White Rice (Cooked)", quantityGrams: 300 },
      { displayName: "Banana", quantityGrams: 120 },
      { displayName: "Honey", quantityGrams: 15 }
    ]
  };
  const meals2 = meals.concat([booster]);
  let r2 = fitWithProjectedGD(meals2, macroContract, { log }, OPTS);
  if (r2.feasible) return r2;

  return { feasible: false, reason: "COULD_NOT_FIT_WITHIN_BOUNDS" };
}

//// CHECKER ////////////////////////////////////////////////////////////////

function withinPct(a, b, pct) {
  if (b === 0) return Math.abs(a) < 1e-9;
  const diff = Math.abs(a - b) / b;
  return diff <= pct;
}

function checkContractSatisfied(actualTotals, macroContract) {
  const { calories, protein_g, fat_g, carbs_g } = macroContract;
  const tol = macroContract.tolerance;

  if (actualTotals.carbs_g < macroContract.hard_caps.carbs_g_min) return { ok: false, reason: "CARBS_TOO_LOW" };
  if (actualTotals.protein_g > macroContract.hard_caps.protein_g_max) return { ok: false, reason: "PROTEIN_TOO_HIGH" };
  if (actualTotals.fat_g > macroContract.hard_caps.fat_g_max) return { ok: false, reason: "FAT_TOO_HIGH" };

  const calOk  = withinPct(actualTotals.calories,  calories,  tol.calories_pct);
  const protOk = withinPct(actualTotals.protein_g, protein_g, tol.protein_pct);
  const fatOk  = withinPct(actualTotals.fat_g,    fat_g,     tol.fat_pct);
  const carbOk = withinPct(actualTotals.carbs_g,  carbs_g,   tol.carbs_pct);

  if (calOk && protOk && fatOk && carbOk) return { ok: true };
  return { ok: false, reason: { calOk, protOk, fatOk, carbOk, actualTotals, macroContract } };
}

module.exports = {
  buildMacroContract,
  fitMealsToContract,
  checkContractSatisfied
};
