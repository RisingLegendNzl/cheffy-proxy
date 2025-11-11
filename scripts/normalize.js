/**
 * Cheffy Orchestrator
 * Enhanced Key Normalization Utility (CommonJS)
 * Version: 2.0.0 - Improved Fuzzy Matching
 * * Provides a single, consistent function for turning human-readable
 * ingredient names into standardized database keys with better matching.
 */

/**
 * Comprehensive synonym map for ingredient normalization.
 * Maps variations to canonical forms.
 */
const SYNONYM_MAP = {
  // Yogurt variations
  'yoghurt': 'yogurt',
  'greek_yogurt': 'yogurt',
  'greek_yoghurt': 'yogurt',
  'plain_yogurt': 'yogurt',
  'natural_yogurt': 'yogurt',

  // Butter variations
  'salted_butter': 'butter',
  'unsalted_butter': 'butter',
  'dairy_butter': 'butter',

  // Apple variations
  'modi_apple': 'apple',
  'granny_smith_apple': 'apple',
  'pink_lady_apple': 'apple',
  'royal_gala_apple': 'apple',
  'fuji_apple': 'apple',
  'green_apple': 'apple',
  'red_apple': 'apple',

  // Beef variations
  'beef_mince': 'ground_beef',
  'lean_beef_mince': 'ground_beef',
  'beef_4_star_lean_mince': 'ground_beef',
  'no_added_hormone_beef_4_star_lean_mince': 'ground_beef',
  'minced_beef': 'ground_beef',
  'lean_mince': 'ground_beef',
  'extra_lean_mince': 'ground_beef',

  // Chicken variations
  'chicken_breast': 'chicken_breast',
  'chicken_thigh': 'chicken_thigh',
  'chicken_drumstick': 'chicken_leg',
  'chicken_leg': 'chicken_leg',
  'whole_chicken': 'chicken',

  // Milk variations
  'full_cream_milk': 'whole_milk',
  'whole_milk': 'whole_milk',
  'skim_milk': 'skim_milk',
  'low_fat_milk': 'low_fat_milk',
  '2_milk': 'low_fat_milk',
  'lactose_free_milk': 'milk',

  // Bread variations
  'white_bread': 'white_bread',
  'wholemeal_bread': 'whole_wheat_bread',
  'whole_wheat_bread': 'whole_wheat_bread',
  'multigrain_bread': 'whole_grain_bread',
  'sourdough': 'sourdough_bread',
  'brioche': 'brioche',
  'brioche_bun': 'brioche',
  'brioche_burger_bun': 'brioche',
  'burger_bun': 'burger_bun',

  // Cheese variations
  'cheddar_cheese': 'cheddar',
  'cheddar_slice': 'cheddar',
  'cheese_cheddar_slice': 'cheddar',
  'tasty_cheese': 'cheddar',
  'mozzarella_cheese': 'mozzarella',
  'parmesan_cheese': 'parmesan',
  'cream_cheese': 'cream_cheese',

  // Oil variations
  'olive_oil': 'olive_oil',
  'extra_virgin_olive_oil': 'olive_oil',
  'extra_mild_olive_oil': 'olive_oil',
  'vegetable_oil': 'vegetable_oil',
  'canola_oil': 'canola_oil',
  'coconut_oil': 'coconut_oil',

  // Rice variations
  'white_rice': 'white_rice',
  'brown_rice': 'brown_rice',
  'jasmine_rice': 'white_rice',
  'basmati_rice': 'white_rice',
  'long_grain_rice': 'white_rice',

  // Pasta variations
  'spaghetti': 'pasta',
  'penne': 'pasta',
  'fusilli': 'pasta',
  'macaroni': 'pasta',
  'linguine': 'pasta',
  'fettuccine': 'pasta',

  // Oats variations
  'oats': 'rolled_oats',
  'rolled_oat': 'rolled_oats',
  'oat': 'rolled_oats',
  'quick_oat': 'quick_oats',
  'instant_oat': 'instant_oats',
  'porridge_oat': 'rolled_oats',

  // Protein powders
  'whey_protein': 'whey_protein_isolate',
  'whey_isolate': 'whey_protein_isolate',
  'protein_powder': 'whey_protein_isolate',

  // Sweeteners
  'white_sugar': 'sugar',
  'caster_sugar': 'sugar',
  'raw_sugar': 'sugar',
  'brown_sugar': 'sugar',
  'maple_syrup': 'maple_syrup',
  'honey': 'honey',
  'pure_honey': 'honey',

  // Vegetables
  'potato': 'potato',
  'sweet_potato': 'sweet_potato',
  'tomato': 'tomato',
  'cherry_tomato': 'tomato',
  'lettuce': 'lettuce',
  'iceberg_lettuce': 'lettuce',
  'shredded_iceberg_lettuce': 'lettuce',
  'spinach': 'spinach',
  'baby_spinach': 'spinach',
  'broccoli': 'broccoli',
  'carrot': 'carrot',
  'onion': 'onion',
  'brown_onion': 'onion',
  'red_onion': 'onion',

  // Beverages
  'tomato_juice': 'tomato_juice',
  'soda_water': 'soda_water',
  'sparkling_water': 'soda_water',

  // Breakfast items
  'corn_flake': 'corn_flakes',
  'cornflake': 'corn_flakes',
  'wheat_biscuit': 'wheat_cereal',
  'weetbix': 'wheat_cereal',

  // Bacon
  'bacon_rasher': 'bacon',
  'short_cut_bacon': 'bacon',
  'middle_bacon': 'bacon',

  // Eggs
  'egg': 'egg',
  'large_egg': 'egg',
  'free_range_egg': 'egg',

  // Fruits
  'banana': 'banana',
  'strawberry': 'strawberry',
  'blueberry': 'blueberry',
  'raspberry': 'raspberry',
  'orange': 'orange',
  'mango': 'mango',

  // Supplements/Performance
  'maltodextrin': 'maltodextrin',
  'maltodextrin_powder': 'maltodextrin',
  'dextrose': 'dextrose',
  'creatine': 'creatine_monohydrate',
};

/**
 * Common brand/quality prefixes to strip during normalization
 */
const STRIP_PREFIXES = [
  'coles_',
  'woolworths_',
  'no_added_hormone_',
  'free_range_',
  'organic_',
  'premium_',
  'fresh_',
  'australian_',
  'gourmet_',
  'by_laurent_',
  'traditional_',
];

/**
 * Common suffixes to strip during normalization
 */
const STRIP_SUFFIXES = [
  '_pack',
  '_value_pack',
  '_multipack',
  '_family_pack',
  '_bulk',
];

/**
 * Words that indicate quality/origin but don’t change the ingredient
 */
const QUALITY_WORDS = [
  'premium', 'organic', 'fresh', 'natural', 'pure', 'traditional',
  'gourmet', 'artisan', 'australian', 'local', 'farm', 'free_range',
  'no_added_hormone', 'grass_fed', 'grain_fed', 'wild_caught',
  'extra', 'super', 'ultra', 'best', 'quality', 'choice', 'select',
  'mild', 'strong', 'medium', 'light', 'dark', 'bold',
  'virgin', 'refined', 'unrefined', 'cold_pressed',
];

/**
 * Normalizes a string into a snake_case database key with enhanced matching.
 * @param {string} name The ingredient name to normalize.
 * @returns {string} The normalized, snake_case key.
 */
function normalizeKey(name) {
  if (typeof name !== 'string' || !name) {
    return 'unknown';
  }

  let key = name.toLowerCase().trim();

  // 1. Handle percent signs
  key = key.replace(/%|\bpercent\b/g, 'pct');

  // 2. Basic synonym replacement (yoghurt -> yogurt)
  key = key.replace(/yoghurt/g, 'yogurt');

  // 3. Convert to snake_case and remove invalid characters
  key = key
    .replace(/[\s&/-]+/g, '_')   // Replace spaces, ampersands, slashes, hyphens with underscore
    .replace(/[^a-z0-9_]/g, '')  // Remove any remaining non-alphanumeric_underscore characters
    .replace(/__+/g, '_')        // Collapse multiple underscores
    .replace(/^_|_+$/g, '');     // Trim leading/trailing underscores

  // 4. Strip common brand prefixes
  for (const prefix of STRIP_PREFIXES) {
    if (key.startsWith(prefix)) {
      key = key.substring(prefix.length);
      break; // Only strip one prefix
    }
  }

  // 5. Strip common suffixes
  for (const suffix of STRIP_SUFFIXES) {
    if (key.endsWith(suffix)) {
      key = key.substring(0, key.length - suffix.length);
      break; // Only strip one suffix
    }
  }

  // 6. Remove quality descriptors if they create multi-part keys
  const parts = key.split('_');
  const filteredParts = parts.filter(part => !QUALITY_WORDS.includes(part));
  if (filteredParts.length > 0 && filteredParts.length < parts.length) {
    key = filteredParts.join('_');
  }

  // 7. Apply synonym map for comprehensive matching
  if (SYNONYM_MAP[key]) {
    key = SYNONYM_MAP[key];
  }

  // 8. Handle simple plurals (with exceptions) - moved after synonym map
  if (key.endsWith('ies') && key.length > 3) {
    key = key.slice(0, -3) + 'y'; // e.g., berries -> berry
  } else if (key.endsWith('oes') && key.length > 3) {
    key = key.slice(0, -2); // e.g., tomatoes -> tomato
  } else if (
    key.endsWith('s') &&
    !key.endsWith('ss') && // avoid 'hummus' -> 'hummu'
    key !== 'oats' &&
    key !== 'hummus' &&
    key !== 'couscous' &&
    key !== 'asparagus' &&
    key !== 'lentils' &&
    key.length > 2
  ) {
    key = key.slice(0, -1); // e.g., apples -> apple
  }

  // 9. Final synonym map check after plural handling
  if (SYNONYM_MAP[key]) {
    key = SYNONYM_MAP[key];
  }

  // 10. Final cleanup
  key = key.replace(/__+/g, '_').replace(/^_|_+$/g, '');

  return key || 'unknown';
}

/**
 * Generates fuzzy match candidates for a given key.
 * Returns an array of possible variations to try when looking up in canonical DB.
 * @param {string} normalizedKey The already-normalized key.
 * @returns {string[]} Array of candidate keys to try, in order of preference.
 */
function getFuzzyMatchCandidates(normalizedKey) {
  const candidates = [normalizedKey]; // Start with exact match

  // If key has underscores, try without quality words
  if (normalizedKey.includes('_')) {
    const parts = normalizedKey.split('_');

    // Try removing quality words one by one
    const filtered = parts.filter(part => !QUALITY_WORDS.includes(part));
    if (filtered.length > 0 && filtered.length < parts.length) {
      candidates.push(filtered.join('_'));
    }

    // Try just the core ingredient (last part if multiple parts)
    if (parts.length > 1) {
      candidates.push(parts[parts.length - 1]); // Last word
      candidates.push(parts[0]); // First word
    }
  }

  // Try without trailing numbers (e.g., "beef_4_star" -> "beef")
  const withoutNumbers = normalizedKey.replace(/_\d+(_star)?/g, '');
  if (withoutNumbers !== normalizedKey) {
    candidates.push(withoutNumbers);
  }

  // Remove duplicates while preserving order
  return [...new Set(candidates)];
}

/**
 * Calculates Levenshtein distance between two strings.
 * Used for fuzzy matching when exact match fails.
 * @param {string} a First string
 * @param {string} b Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Finds the best fuzzy match from a list of available keys.
 * @param {string} searchKey The key to search for
 * @param {string[]} availableKeys Array of keys to search through
 * @param {number} maxDistance Maximum edit distance to consider (default 3)
 * @returns {{key: string, distance: number} | null} Best match or null
 */
function findBestFuzzyMatch(searchKey, availableKeys, maxDistance = 3) {
  let bestMatch = null;
  let bestDistance = maxDistance + 1;

  for (const availableKey of availableKeys) {
    const distance = levenshteinDistance(searchKey, availableKey);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = availableKey;
    }

    // Perfect match - no need to continue
    if (distance === 0) break;
  }

  return bestDistance <= maxDistance ? { key: bestMatch, distance: bestDistance } : null;
}

module.exports = {
  normalizeKey,
  getFuzzyMatchCandidates,
  findBestFuzzyMatch,
  levenshteinDistance,
  SYNONYM_MAP,
};

