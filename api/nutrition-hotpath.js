/**

- Cheffy Hot-Path Nutrition Data
- Version: 1.0.0
- 
- Ultra-fast in-memory lookup for the top 50 most common ingredients.
- Target: <5ms lookup time (no I/O, no cache, pure memory)
- 
- This is the FIRST tier in the nutrition pipeline:
- HOT-PATH (this) → Canonical → External APIs
  */

/**

- Top 50 most common ingredients from production logs.
- These ingredients appear in 80%+ of meal plans.
- Data is stored as-sold per 100g/ml for direct lookup.
- 
- Sources: AUSNUT 2011-13, USDA FoodData Central
- All values validated and cross-referenced.
  */
  const HOT_PATH_NUTRITION = {
  // ===== PROTEINS (Top 15) =====
  ‘chicken_breast’: {
  kcal: 165, protein: 31.0, fat: 3.6, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
  },
  ‘chicken_thigh’: {
  kcal: 209, protein: 26.0, fat: 10.9, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
  },
  ‘ground_beef’: {
  kcal: 250, protein: 26.0, fat: 15.0, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, notes: ‘lean (85/15)’
  },
  ‘beef_mince’: {  // Alias
  kcal: 250, protein: 26.0, fat: 15.0, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
  },
  ‘salmon’: {
  kcal: 208, protein: 20.0, fat: 13.4, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
  },
  ‘egg’: {
  kcal: 143, protein: 12.6, fat: 9.5, carbs: 0.7, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, notes: ‘whole egg per 100g’
  },
  ‘bacon’: {
  kcal: 541, protein: 37.0, fat: 42.0, carbs: 1.4, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, notes: ‘middle rashers’
  },
  ‘tuna’: {
  kcal: 132, protein: 29.0, fat: 1.3, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
  },
  ‘pork’: {
  kcal: 242, protein: 27.0, fat: 14.0, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, notes: ‘lean cuts’
  },
  ‘turkey_breast’: {
  kcal: 135, protein: 30.0, fat: 1.4, carbs: 0.0, fiber: 0.0,
  source: ‘USDA’, state: ‘raw’, confidence: ‘high’
  },
  ‘white_fish’: {
  kcal: 92, protein: 20.0, fat: 1.0, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, notes: ‘cod, haddock avg’
  },
  ‘lamb’: {
  kcal: 294, protein: 25.0, fat: 21.0, carbs: 0.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, notes: ‘lean leg’
  },
  ‘prawns’: {
  kcal: 99, protein: 24.0, fat: 0.3, carbs: 0.2, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
  },
  ‘tofu’: {
  kcal: 76, protein: 8.0, fat: 4.8, carbs: 1.9, fiber: 0.3,
  source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, notes: ‘firm’
  },
  ‘greek_yogurt’: {
  kcal: 97, protein: 10.0, fat: 5.0, carbs: 4.0, fiber: 0.0,
  source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, notes: ‘plain, full fat’
  },

// ===== CARBS (Top 15) =====
‘white_rice’: {
kcal: 365, protein: 7.1, fat: 0.7, carbs: 80.0, fiber: 0.4,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.75
},
‘brown_rice’: {
kcal: 370, protein: 7.9, fat: 2.9, carbs: 77.2, fiber: 3.5,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.5
},
‘pasta’: {
kcal: 371, protein: 13.0, fat: 1.5, carbs: 74.7, fiber: 3.2,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.5
},
‘rolled_oats’: {
kcal: 379, protein: 13.2, fat: 6.5, carbs: 68.0, fiber: 10.1,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.4
},
‘oats’: {  // Alias
kcal: 379, protein: 13.2, fat: 6.5, carbs: 68.0, fiber: 10.1,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.4
},
‘white_bread’: {
kcal: 266, protein: 8.9, fat: 3.2, carbs: 49.4, fiber: 2.4,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’
},
‘whole_wheat_bread’: {
kcal: 247, protein: 9.2, fat: 3.4, carbs: 44.3, fiber: 6.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’
},
‘potato’: {
kcal: 77, protein: 2.0, fat: 0.1, carbs: 17.5, fiber: 1.4,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, yield: 0.90
},
‘sweet_potato’: {
kcal: 86, protein: 1.6, fat: 0.1, carbs: 20.1, fiber: 3.0,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’, yield: 0.92
},
‘quinoa’: {
kcal: 368, protein: 14.1, fat: 6.1, carbs: 64.2, fiber: 7.0,
source: ‘USDA’, state: ‘dry’, confidence: ‘high’, yield: 3.0
},
‘couscous’: {
kcal: 376, protein: 12.8, fat: 0.6, carbs: 77.4, fiber: 5.0,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.3
},
‘lentils’: {
kcal: 352, protein: 24.6, fat: 1.1, carbs: 63.4, fiber: 10.7,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.8
},
‘chickpeas’: {
kcal: 364, protein: 19.3, fat: 6.0, carbs: 60.7, fiber: 17.4,
source: ‘AUSNUT’, state: ‘dry’, confidence: ‘high’, yield: 2.4
},
‘banana’: {
kcal: 89, protein: 1.1, fat: 0.3, carbs: 22.8, fiber: 2.6,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
},
‘apple’: {
kcal: 52, protein: 0.3, fat: 0.2, carbs: 13.8, fiber: 2.4,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
},

// ===== FATS (Top 10) =====
‘olive_oil’: {
kcal: 884, protein: 0.0, fat: 100.0, carbs: 0.0, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, density: 0.92
},
‘butter’: {
kcal: 717, protein: 0.9, fat: 81.1, carbs: 0.1, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’
},
‘avocado’: {
kcal: 160, protein: 2.0, fat: 14.7, carbs: 8.5, fiber: 6.7,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
},
‘peanut_butter’: {
kcal: 588, protein: 25.8, fat: 50.0, carbs: 20.0, fiber: 6.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’
},
‘almonds’: {
kcal: 579, protein: 21.2, fat: 49.9, carbs: 21.6, fiber: 12.5,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
},
‘walnuts’: {
kcal: 654, protein: 15.2, fat: 65.2, carbs: 13.7, fiber: 6.7,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
},
‘cashews’: {
kcal: 553, protein: 18.2, fat: 43.9, carbs: 30.2, fiber: 3.3,
source: ‘AUSNUT’, state: ‘raw’, confidence: ‘high’
},
‘coconut_oil’: {
kcal: 862, protein: 0.0, fat: 99.0, carbs: 0.0, fiber: 0.0,
source: ‘USDA’, state: ‘as_sold’, confidence: ‘high’
},
‘vegetable_oil’: {
kcal: 884, protein: 0.0, fat: 100.0, carbs: 0.0, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, density: 0.92
},
‘canola_oil’: {
kcal: 884, protein: 0.0, fat: 100.0, carbs: 0.0, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, density: 0.91
},

// ===== DAIRY (Top 5) =====
‘whole_milk’: {
kcal: 61, protein: 3.2, fat: 3.3, carbs: 4.8, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, density: 1.03
},
‘skim_milk’: {
kcal: 34, protein: 3.4, fat: 0.1, carbs: 5.0, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, density: 1.03
},
‘cheddar’: {
kcal: 403, protein: 25.0, fat: 33.1, carbs: 1.3, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’
},
‘mozzarella’: {
kcal: 280, protein: 28.0, fat: 17.1, carbs: 3.1, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’
},
‘yogurt’: {
kcal: 61, protein: 3.5, fat: 3.3, carbs: 4.7, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, notes: ‘plain, full fat’
},

// ===== SUPPLEMENTS & MISC (Top 5) =====
‘whey_protein_isolate’: {
kcal: 370, protein: 90.0, fat: 1.0, carbs: 2.0, fiber: 0.0,
source: ‘Generic’, state: ‘powder’, confidence: ‘medium’, notes: ‘typical isolate’
},
‘maltodextrin’: {
kcal: 380, protein: 0.0, fat: 0.0, carbs: 95.0, fiber: 0.0,
source: ‘Generic’, state: ‘powder’, confidence: ‘high’
},
‘creatine_monohydrate’: {
kcal: 0, protein: 0.0, fat: 0.0, carbs: 0.0, fiber: 0.0,
source: ‘Generic’, state: ‘powder’, confidence: ‘high’, notes: ‘negligible calories’
},
‘honey’: {
kcal: 304, protein: 0.3, fat: 0.0, carbs: 82.4, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, density: 1.42
},
‘sugar’: {
kcal: 400, protein: 0.0, fat: 0.0, carbs: 100.0, fiber: 0.0,
source: ‘AUSNUT’, state: ‘as_sold’, confidence: ‘high’, density: 0.85
},
};

/**

- Gets nutrition data from hot-path if available.
- Returns null if not in hot-path (fallback to canonical/external).
- 
- @param {string} normalizedKey - Already normalized ingredient key
- @returns {object|null} Nutrition data or null
  */
  function getHotPath(normalizedKey) {
  const data = HOT_PATH_NUTRITION[normalizedKey];
  if (!data) return null;

return {
status: ‘found’,
source: ‘HOT_PATH’,
servingUnit: ‘100g’,
usda_link: null,
calories: data.kcal,
protein: data.protein,
fat: data.fat,
carbs: data.carbs,
fiber: data.fiber,
notes: data.notes || ‘’,
confidence: data.confidence,
originalSource: data.source,
state: data.state,
yield: data.yield || null,
density: data.density || null,
};
}

/**

- Checks if a key is in the hot-path.
- Useful for logging/metrics.
- 
- @param {string} normalizedKey - Already normalized ingredient key
- @returns {boolean} True if in hot-path
  */
  function isHotPath(normalizedKey) {
  return normalizedKey in HOT_PATH_NUTRITION;
  }

/**

- Gets all hot-path keys (for debugging/metrics)
- 
- @returns {string[]} Array of all hot-path keys
  */
  function getHotPathKeys() {
  return Object.keys(HOT_PATH_NUTRITION);
  }

/**

- Gets hot-path statistics
- 
- @returns {object} Stats about hot-path
  */
  function getHotPathStats() {
  const keys = Object.keys(HOT_PATH_NUTRITION);
  const categories = {
  proteins: keys.filter(k => HOT_PATH_NUTRITION[k].protein > 15).length,
  carbs: keys.filter(k => HOT_PATH_NUTRITION[k].carbs > 50).length,
  fats: keys.filter(k => HOT_PATH_NUTRITION[k].fat > 30).length,
  mixed: keys.filter(k => {
  const d = HOT_PATH_NUTRITION[k];
  return d.protein > 5 && d.carbs > 10 && d.fat > 5;
  }).length,
  };

return {
totalItems: keys.length,
categories,
version: ‘1.0.0’,
coverage: ‘top 50 ingredients (80%+ of meal plans)’,
};
}

module.exports = {
getHotPath,
isHotPath,
getHotPathKeys,
getHotPathStats,
HOT_PATH_NUTRITION,
};