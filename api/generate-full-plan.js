/**
 * Cheffy Orchestrator — Direct Macro Quantification Edition
 * Part 1/4
 */

/// ===== IMPORTS-START ===== \\\\

const fetch = require('node-fetch');
const { fetchPriceData } = require('./price-search.js');
const { fetchNutritionData } = require('./nutrition-search.js');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent';

/// ===== IMPORTS-END ===== ////


// ==================================================
// USER → CALORIES → MACROS
// ==================================================

function calcMacrosFromUser(formData) {
  const weightKg = Number(formData.weight) || 70;
  const heightCm = Number(formData.height) || 175;
  const age = Number(formData.age) || 25;
  const bodyFat = Number(formData.bodyFat) || 15;
  const activity = String(formData.activity || 'moderate');

  // Lean mass
  const leanMass = weightKg * (1 - bodyFat / 100);

  // Basal Metabolic Rate (Mifflin-St Jeor)
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;

  const mult =
    activity === 'light' ? 1.375 :
    activity === 'active' ? 1.55 :
    activity === 'very' ? 1.725 : 1.2;

  const tdee = bmr * mult;

  const goal = formData.goal || 'bulk';
  const calories =
    goal === 'bulk' ? Math.round(tdee + 300) :
    goal === 'cut' ? Math.round(tdee - 300) :
    Math.round(tdee);

  // Protein from lean mass
  const protein = Math.round(2.2 * leanMass); // g

  // Fat: ~28% calories
  const fat = Math.round((0.28 * calories) / 9); // g

  // Carbs remainder
  const carbs = Math.round((calories - (protein * 4 + fat * 9)) / 4);

  return { calories, protein, carbs, fat };
}


// ==================================================
// MEAL BUDGET SPLITS (weighted)
// ==================================================

function getWeightedSplits(mealCount) {
  switch (mealCount) {
    case 3:
      return { B: 0.30, L: 0.40, D: 0.30 };
    case 4:
      return { B: 0.25, L: 0.35, D: 0.30, S1: 0.10 };
    case 5:
    default:
      return { B: 0.20, L: 0.30, D: 0.30, S1: 0.10, S2: 0.10 };
  }
}


// ==================================================
// GEMINI REQUEST HELPERS
// ==================================================

async function callGemini(prompt) {
  const res = await fetch(`${GEMINI_API_URL_BASE}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })
  });
  const js = await res.json().catch(() => ({}));
  const text =
    js?.candidates?.[0]?.content?.parts?.[0]?.text ||
    js?.candidates?.[0]?.output_text ||
    '';
  return text;
}


// ==================================================
// PART 2 STARTS BELOW THIS COMMENT
// ==================================================


/**
 * Part 2/4 — Gemini quantification and correction loop
 */


// --- Macro tolerance ---
const TOL = 0.05; // 5%
const MAX_ATTEMPTS = 3;


// Validate macro totals
function withinTol(target, actual) {
  return (
    Math.abs(actual.protein - target.protein) <= target.protein * TOL &&
    Math.abs(actual.carbs - target.carbs)   <= target.carbs   * TOL &&
    Math.abs(actual.fat - target.fat)       <= target.fat     * TOL
  );
}


// Extract numbers from model output
function parseTotals(text) {
  const g = (r) => {
    const m = text.match(r);
    return m ? Number(m[1]) : null;
  };
  return {
    calories: g(/total\s*kcal.*?(\d+)/i) || g(/calories.*?(\d+)/i),
    protein:  g(/protein.*?(\d+)\s*g/i),
    carbs:    g(/carbs.*?(\d+)\s*g/i),
    fat:      g(/fat.*?(\d+)\s*g/i)
  };
}


// Gemini prompt builder for a day
function makeDayPrompt(dayLabel, targets, mealSplits) {
  const mealOrder = Object.keys(mealSplits);

  return `
Day ${dayLabel}
Hit EXACT totals:
- ${targets.calories} kcal
- ${targets.protein} g protein
- ${targets.carbs} g carbs
- ${targets.fat} g fat

Meals: ${mealOrder.join(', ')}

For each meal:
- Propose foods you choose
- Assign exact grams per item
- Sum macros for that meal

End with:
"TOTAL: X kcal, P g protein, C g carbs, F g fat"

If totals miss by >5%: Adjust quantities and return updated totals.
Respond ONLY with the plan and totals.`;
}


// One-day generate + correct
async function generateDay(dayLabel, targets, mealSplits) {
  let attempt = 0;
  let finalText = '';

  while (attempt < MAX_ATTEMPTS) {
    attempt++;

    const prompt = makeDayPrompt(dayLabel, targets, mealSplits) +
      (attempt > 1 ? `\nNote: Correct macros. Keep same foods. Attempt ${attempt}` : '');

    const text = await callGemini(prompt);
    finalText = text;

    const totals = parseTotals(text);
    if (!totals.calories || !totals.protein) continue;
    if (withinTol(targets, totals)) return { text, totals, ok: true };
  }

  return { text: finalText, totals: parseTotals(finalText), ok: false };
}


// ==================================================
// PART 3 STARTS BELOW THIS COMMENT
// ==================================================


/**
 * Part 3/4 — Nutrition fetch + Market Run integration
 */


// Parse ingredient lines with grams
function extractIngredientsFromText(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(/([\w\s]+):\s*(\d+)\s*g/i);
    if (!m) continue;
    out.push({
      raw: line.trim(),
      name: m[1].trim(),
      grams: Number(m[2])
    });
  }
  return out;
}


// Nutrition lookup per ingredient
async function enrichWithNutrition(ings) {
  const out = [];
  for (const ing of ings) {
    const data = await fetchNutritionData(ing.name);
    const n = data || {};
    const per100 = {
      calories: Number(n.calories) || 0,
      protein: Number(n.protein) || 0,
      carbs: Number(n.carbs) || 0,
      fat: Number(n.fat) || 0
    };
    out.push({
      ...ing,
      calories: Math.round((per100.calories * ing.grams) / 100),
      protein:  Math.round((per100.protein  * ing.grams) / 100),
      carbs:    Math.round((per100.carbs    * ing.grams) / 100),
      fat:      Math.round((per100.fat      * ing.grams) / 100)
    });
  }
  return out;
}


// Market run
async function runMarket(ings) {
  const results = [];
  for (const ing of ings) {
    const q = ing.name;
    const storeResults = await Promise.all([
      fetchPriceData('Coles', q),
      fetchPriceData('Woolworths', q)
    ]);
    results.push({
      ...ing,
      market: storeResults
    });
  }
  return results;
}


// Map one day full pipeline
async function processDay(dayLabel, text) {
  const ingredients = extractIngredientsFromText(text);
  const withNutri = await enrichWithNutrition(ingredients);
  const withMarket = await runMarket(withNutri);
  return {
    day: dayLabel,
    text,
    ingredients: withMarket
  };
}


// ==================================================
// PART 4 STARTS BELOW THIS COMMENT
// ==================================================





/**
 * Part 4/4 — Final response builder + main handler
 */


// Build response object
function assembleResponse(daysArray, totalsPerDay, targets) {
  return {
    status: 'success',
    targets,
    days: daysArray,
    totals: totalsPerDay
  };
}


// Main HTTP handler
module.exports = async function handler(req, res) {
  try {
    const formData = req.body || {};
    const dayCount = Number(formData.days) || 5;
    const splits = getWeightedSplits(dayCount);

    // Compute base user macros
    const targets = calcMacrosFromUser(formData);

    const results = [];
    const totalsArr = [];

    for (let i = 1; i <= dayCount; i++) {
      const r = await generateDay(i, targets, splits);

      const dayProcessed = await processDay(i, r.text);
      results.push(dayProcessed);

      totalsArr.push({
        day: i,
        totals: r.totals,
        ok: r.ok
      });
    }

    res.status(200).json(assembleResponse(results, totalsArr, targets));

  } catch (err) {
    console.error('GEN-PLAN ERROR:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
};


// ========== End of File ==========