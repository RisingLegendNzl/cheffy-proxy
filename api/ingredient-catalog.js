const fs = require('fs');
const path = require('path');

const CAT_DEFAULTS = {
  protein: { solver_min: 100, solver_max: 350, display_round: 5, household_units: [] },
  starch:  { solver_min: 30,  solver_max: 250, display_round: 5, household_units: [] },
  veg:     { solver_min: 60,  solver_max: 500, display_round: 5, household_units: [] },
  dairy:   { solver_min: 100, solver_max: 400, display_round: 5, household_units: [] },
  fat:     { solver_min: 5,   solver_max: 60,  display_round: 1, household_units: [] }
};

let CATALOG = {};
try {
  const p = path.join(process.cwd(), 'db', 'ingredient_catalog.json');
  const raw = fs.readFileSync(p, 'utf8');
  for (const row of JSON.parse(raw)) CATALOG[row.id] = row;
} catch { /* empty catalog ok */ }

function getMeta(id, category) {
  const meta = CATALOG[id] || {};
  const base = CAT_DEFAULTS[String(category || '').toLowerCase()] || CAT_DEFAULTS.protein;
  return {
    id,
    category: category || meta.category || 'protein',
    unit: meta.unit || 'g',
    solver_min: Number.isFinite(meta.solver_min) ? meta.solver_min : base.solver_min,
    solver_max: Number.isFinite(meta.solver_max) ? meta.solver_max : base.solver_max,
    display_round: Number.isFinite(meta.display_round) ? meta.display_round : base.display_round,
    household_units: Array.isArray(meta.household_units) ? meta.household_units : base.household_units
  };
}

function toHousehold(grams, meta) {
  const u = meta.household_units && meta.household_units[0];
  if (!u) return `${Math.round(grams / meta.display_round) * meta.display_round}g`;
  const n = grams / u.grams_per_unit;
  const rounded = Math.max(1, Math.round(n * 2) / 2); // halves
  return `${rounded} ${u.unit}`;
}

module.exports = { getMeta, toHousehold };