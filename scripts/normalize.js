/**
 * Cheffy Orchestrator
 * Enhanced Key Normalization Utility (CommonJS)
 * Version: 3.0.0 - Canonical Source (Phase 4)
 * * Provides a single, consistent function for turning human-readable
 * ingredient names into standardized database keys.
 */

/**
 * Comprehensive synonym map for ingredient normalization.
 * Maps variations to canonical forms.
 * Identity mappings (e.g., 'rolled_oats': 'rolled_oats') ensure canonical forms 
 * are not accidentally modified by subsequent processing steps.
 */
const SYNONYM_MAP = {
  // =====================================================================
  // OATS - Comprehensive coverage
  // =====================================================================
  'oats': 'rolled_oats',
  'oat': 'rolled_oats',
  'rolled_oat': 'rolled_oats',
  'rolled_oats': 'rolled_oats',
  'quick_oat': 'quick_oats',
  'quick_oats': 'quick_oats',
  'instant_oat': 'instant_oats',
  'instant_oats': 'instant_oats',
  'porridge_oat': 'rolled_oats',
  'porridge': 'rolled_oats',
  'porridge_oats': 'rolled_oats',
  'oatmeal': 'rolled_oats',
  'steel_cut_oat': 'steel_cut_oats',
  'steel_cut_oats': 'steel_cut_oats',
  'scottish_oats': 'steel_cut_oats',
  'overnight_oats': 'rolled_oats',

  // =====================================================================
  // RICE - Comprehensive coverage
  // =====================================================================
  'rice': 'white_rice',
  'white_rice': 'white_rice',
  'brown_rice': 'brown_rice',
  'jasmine_rice': 'jasmine_rice',
  'thai_jasmine_rice': 'jasmine_rice',
  'basmati_rice': 'basmati_rice',
  'basmati': 'basmati_rice',
  'sushi_rice': 'sushi_rice',
  'japanese_rice': 'sushi_rice',
  'short_grain_rice': 'sushi_rice',
  'long_grain_rice': 'white_rice',
  'cooked_rice': 'cooked_rice',
  'steamed_rice': 'cooked_rice',
  'cooked_white_rice': 'cooked_white_rice',
  'arborio_rice': 'white_rice',
  'arborio': 'white_rice',
  'wild_rice': 'wild_rice',
  'black_rice': 'black_rice',

  // =====================================================================
  // PASTA - Comprehensive coverage
  // =====================================================================
  'pasta': 'pasta',
  'spaghetti': 'pasta',
  'penne': 'pasta',
  'fusilli': 'pasta',
  'macaroni': 'pasta',
  'linguine': 'pasta',
  'fettuccine': 'pasta',
  'rigatoni': 'pasta',
  'farfalle': 'pasta',
  'orzo': 'pasta',
  'lasagna_sheet': 'pasta',
  'lasagne_sheet': 'pasta',
  'noodle': 'pasta',
  'noodles': 'pasta',
  'egg_noodle': 'egg_noodles',
  'egg_noodles': 'egg_noodles',

  // =====================================================================
  // MILK - Comprehensive coverage
  // =====================================================================
  'milk': 'whole_milk',
  'full_cream_milk': 'whole_milk',
  'full_fat_milk': 'whole_milk',
  'whole_milk': 'whole_milk',
  'skim_milk': 'skim_milk',
  'skimmed_milk': 'skim_milk',
  'nonfat_milk': 'skim_milk',
  'fat_free_milk': 'skim_milk',
  'low_fat_milk': 'low_fat_milk',
  'lite_milk': 'low_fat_milk',
  'light_milk': 'low_fat_milk',
  '2_milk': 'low_fat_milk',
  '2pct_milk': 'low_fat_milk',
  '1_milk': 'low_fat_milk',
  '1pct_milk': 'low_fat_milk',
  'lactose_free_milk': 'milk',
  'almond_milk': 'almond_milk',
  'oat_milk': 'oat_milk',
  'soy_milk': 'soy_milk',
  'soya_milk': 'soy_milk',
  'coconut_milk': 'coconut_milk',
  'rice_milk': 'rice_milk',

  // =====================================================================
  // PROTEIN POWDERS - Comprehensive coverage
  // =====================================================================
  'whey_protein': 'whey_protein_isolate',
  'whey': 'whey_protein_isolate',
  'whey_isolate': 'whey_protein_isolate',
  'whey_protein_powder': 'whey_protein_isolate',
  'protein_powder': 'whey_protein_isolate',
  'protein': 'whey_protein_isolate',
  'whey_protein_isolate': 'whey_protein_isolate',
  'whey_protein_concentrate': 'whey_protein_concentrate',
  'wpc': 'whey_protein_concentrate',
  'wpi': 'whey_protein_isolate',
  'casein': 'casein_protein',
  'casein_protein': 'casein_protein',
  'pea_protein': 'pea_protein',
  'plant_protein': 'pea_protein',

  // =====================================================================
  // MINCE / GROUND MEAT - Comprehensive coverage
  // =====================================================================
  'mince': 'ground_beef',
  'minced_meat': 'ground_beef',
  'ground_meat': 'ground_beef',
  'beef_mince': 'ground_beef',
  'lean_beef_mince': 'ground_beef',
  'beef_4_star_lean_mince': 'ground_beef',
  'no_added_hormone_beef_4_star_lean_mince': 'ground_beef',
  'minced_beef': 'ground_beef',
  'ground_beef': 'ground_beef',
  'lean_mince': 'ground_beef',
  'extra_lean_mince': 'ground_beef',
  'pork_mince': 'ground_pork',
  'minced_pork': 'ground_pork',
  'ground_pork': 'ground_pork',
  'chicken_mince': 'ground_chicken',
  'minced_chicken': 'ground_chicken',
  'ground_chicken': 'ground_chicken',
  'turkey_mince': 'ground_turkey',
  'minced_turkey': 'ground_turkey',
  'ground_turkey': 'ground_turkey',
  'lamb_mince': 'ground_lamb',
  'minced_lamb': 'ground_lamb',
  'ground_lamb': 'ground_lamb',

  // =====================================================================
  // CHICKEN - Comprehensive coverage
  // =====================================================================
  'chicken': 'chicken',
  'chicken_breast': 'chicken_breast',
  'chicken_thigh': 'chicken_thigh',
  'chicken_drumstick': 'chicken_leg',
  'chicken_leg': 'chicken_leg',
  'whole_chicken': 'chicken',
  'chicken_wing': 'chicken_wing',
  'chicken_tender': 'chicken_breast',

  // =====================================================================
  // BEEF - Comprehensive coverage
  // =====================================================================
  'beef': 'beef',
  'steak': 'beef_steak',
  'beef_steak': 'beef_steak',
  'sirloin': 'beef_steak',
  'ribeye': 'beef_steak',
  'scotch_fillet': 'beef_steak',
  'eye_fillet': 'beef_steak',
  'rump_steak': 'beef_steak',

  // =====================================================================
  // OTHER PROTEINS
  // =====================================================================
  'lamb': 'lamb',
  'lamb_chop': 'lamb',
  'lamb_leg': 'lamb',
  'turkey': 'turkey',
  'turkey_breast': 'turkey_breast',
  'pork': 'pork',
  'pork_chop': 'pork',
  'pork_loin': 'pork',
  'bacon': 'bacon',
  'bacon_rasher': 'bacon',
  'short_cut_bacon': 'bacon',
  'middle_bacon': 'bacon',
  'streaky_bacon': 'bacon',

  // =====================================================================
  // SEAFOOD
  // =====================================================================
  'salmon': 'salmon',
  'salmon_fillet': 'salmon',
  'atlantic_salmon': 'salmon',
  'tuna': 'tuna',
  'tuna_steak': 'tuna',
  'canned_tuna': 'canned_tuna',
  'tuna_in_water': 'canned_tuna',
  'tuna_in_oil': 'canned_tuna',
  'prawn': 'prawns',
  'prawns': 'prawns',
  'shrimp': 'prawns',
  'shrimps': 'prawns',
  'cod': 'white_fish',
  'barramundi': 'white_fish',
  'snapper': 'white_fish',
  'white_fish': 'white_fish',
  'fish': 'white_fish',

  // =====================================================================
  // EGGS
  // =====================================================================
  'egg': 'egg',
  'eggs': 'egg',
  'large_egg': 'egg',
  'free_range_egg': 'egg',
  'cage_free_egg': 'egg',
  'whole_egg': 'egg',
  'egg_white': 'egg_white',
  'egg_yolk': 'egg_yolk',

  // =====================================================================
  // YOGURT
  // =====================================================================
  'yoghurt': 'yogurt',
  'yogurt': 'yogurt',
  'greek_yogurt': 'greek_yogurt',
  'greek_yoghurt': 'greek_yogurt',
  'plain_yogurt': 'yogurt',
  'natural_yogurt': 'yogurt',
  'low_fat_yogurt': 'low_fat_yogurt',
  'nonfat_yogurt': 'low_fat_yogurt',

  // =====================================================================
  // BUTTER & SPREADS
  // =====================================================================
  'butter': 'butter',
  'salted_butter': 'butter',
  'unsalted_butter': 'butter',
  'dairy_butter': 'butter',
  'peanut_butter': 'peanut_butter',
  'pb': 'peanut_butter',
  'almond_butter': 'almond_butter',
  'pb2': 'peanut_butter_powder',
  'peanut_butter_powder': 'peanut_butter_powder',

  // =====================================================================
  // CHEESE
  // =====================================================================
  'cheese': 'cheddar',
  'cheddar_cheese': 'cheddar',
  'cheddar': 'cheddar',
  'cheddar_slice': 'cheddar',
  'cheese_cheddar_slice': 'cheddar',
  'tasty_cheese': 'cheddar',
  'mozzarella_cheese': 'mozzarella',
  'mozzarella': 'mozzarella',
  'parmesan_cheese': 'parmesan',
  'parmesan': 'parmesan',
  'cream_cheese': 'cream_cheese',
  'cottage_cheese': 'cottage_cheese',
  'feta': 'feta',
  'feta_cheese': 'feta',
  'ricotta': 'ricotta',
  'ricotta_cheese': 'ricotta',

  // =====================================================================
  // BREAD
  // =====================================================================
  'bread': 'white_bread',
  'white_bread': 'white_bread',
  'wholemeal_bread': 'whole_wheat_bread',
  'whole_wheat_bread': 'whole_wheat_bread',
  'wholegrain_bread': 'whole_grain_bread',
  'whole_grain_bread': 'whole_grain_bread',
  'multigrain_bread': 'whole_grain_bread',
  'sourdough': 'sourdough_bread',
  'sourdough_bread': 'sourdough_bread',
  'brioche': 'brioche',
  'brioche_bun': 'brioche',
  'brioche_burger_bun': 'brioche',
  'burger_bun': 'burger_bun',
  'bread_roll': 'bread_roll',
  'toast': 'white_bread',

  // =====================================================================
  // OILS
  // =====================================================================
  'oil': 'olive_oil',
  'olive_oil': 'olive_oil',
  'extra_virgin_olive_oil': 'olive_oil',
  'extra_mild_olive_oil': 'olive_oil',
  'evoo': 'olive_oil',
  'vegetable_oil': 'vegetable_oil',
  'canola_oil': 'canola_oil',
  'coconut_oil': 'coconut_oil',
  'sunflower_oil': 'sunflower_oil',
  'avocado_oil': 'avocado_oil',

  // =====================================================================
  // SWEETENERS
  // =====================================================================
  'sugar': 'sugar',
  'white_sugar': 'sugar',
  'caster_sugar': 'sugar',
  'raw_sugar': 'sugar',
  'brown_sugar': 'brown_sugar',
  'maple_syrup': 'maple_syrup',
  'honey': 'honey',
  'pure_honey': 'honey',

  // =====================================================================
  // FRUITS
  // =====================================================================
  'banana': 'banana',
  'bananas': 'banana',
  'ripe_banana': 'banana',
  'apple': 'apple',
  'apples': 'apple',
  'modi_apple': 'apple',
  'granny_smith_apple': 'apple',
  'pink_lady_apple': 'apple',
  'royal_gala_apple': 'apple',
  'fuji_apple': 'apple',
  'green_apple': 'apple',
  'red_apple': 'apple',
  'strawberry': 'strawberry',
  'strawberries': 'strawberry',
  'blueberry': 'blueberry',
  'blueberries': 'blueberry',
  'raspberry': 'raspberry',
  'raspberries': 'raspberry',
  'orange': 'orange',
  'oranges': 'orange',
  'mango': 'mango',
  'mangoes': 'mango',
  'avocado': 'avocado',
  'avocados': 'avocado',
  'grape': 'grape',
  'grapes': 'grape',
  'pear': 'pear',
  'pears': 'pear',
  'peach': 'peach',
  'peaches': 'peach',
  'watermelon': 'watermelon',
  'rockmelon': 'cantaloupe',
  'cantaloupe': 'cantaloupe',
  'honeydew': 'honeydew',
  'kiwi': 'kiwi',
  'kiwifruit': 'kiwi',

  // =====================================================================
  // VEGETABLES
  // =====================================================================
  'potato': 'potato',
  'potatoes': 'potato',
  'sweet_potato': 'sweet_potato',
  'sweet_potatoes': 'sweet_potato',
  'tomato': 'tomato',
  'tomatoes': 'tomato',
  'cherry_tomato': 'tomato',
  'cherry_tomatoes': 'tomato',
  'lettuce': 'lettuce',
  'iceberg_lettuce': 'lettuce',
  'shredded_iceberg_lettuce': 'lettuce',
  'cos_lettuce': 'romaine_lettuce',
  'romaine_lettuce': 'romaine_lettuce',
  'romaine': 'romaine_lettuce',
  'spinach': 'spinach',
  'baby_spinach': 'spinach',
  'broccoli': 'broccoli',
  'carrot': 'carrot',
  'carrots': 'carrot',
  'onion': 'onion',
  'onions': 'onion',
  'brown_onion': 'onion',
  'red_onion': 'red_onion',
  'spring_onion': 'green_onion',
  'green_onion': 'green_onion',
  'scallion': 'green_onion',
  'shallot': 'shallot',
  'capsicum': 'bell_pepper',
  'red_capsicum': 'bell_pepper',
  'green_capsicum': 'bell_pepper',
  'bell_pepper': 'bell_pepper',
  'courgette': 'zucchini',
  'zucchini': 'zucchini',
  'aubergine': 'eggplant',
  'eggplant': 'eggplant',
  'rocket': 'arugula',
  'arugula': 'arugula',
  'coriander': 'cilantro',
  'cilantro': 'cilantro',
  'beetroot': 'beet',
  'beet': 'beet',
  'beets': 'beet',
  'corn': 'corn',
  'sweetcorn': 'corn',
  'mushroom': 'mushroom',
  'mushrooms': 'mushroom',
  'cucumber': 'cucumber',
  'celery': 'celery',
  'asparagus': 'asparagus',
  'green_bean': 'green_beans',
  'green_beans': 'green_beans',

  // =====================================================================
  // LEGUMES
  // =====================================================================
  'lentil': 'lentils',
  'lentils': 'lentils',
  'red_lentil': 'red_lentils',
  'red_lentils': 'red_lentils',
  'chickpea': 'chickpeas',
  'chickpeas': 'chickpeas',
  'garbanzo': 'chickpeas',
  'garbanzo_bean': 'chickpeas',
  'black_bean': 'black_beans',
  'black_beans': 'black_beans',
  'kidney_bean': 'kidney_beans',
  'kidney_beans': 'kidney_beans',
  'cannellini_bean': 'cannellini_beans',
  'cannellini_beans': 'cannellini_beans',
  'baked_beans': 'baked_beans',
  'edamame': 'edamame',
  'edamame_beans': 'edamame',
  'soy_beans': 'edamame',

  // =====================================================================
  // BREAKFAST ITEMS
  // =====================================================================
  'corn_flake': 'corn_flakes',
  'corn_flakes': 'corn_flakes',
  'cornflake': 'corn_flakes',
  'cornflakes': 'corn_flakes',
  'wheat_biscuit': 'wheat_cereal',
  'weetbix': 'wheat_cereal',
  'weet_bix': 'wheat_cereal',
  'granola': 'granola',
  'muesli': 'muesli',

  // =====================================================================
  // BEVERAGES
  // =====================================================================
  'tomato_juice': 'tomato_juice',
  'orange_juice': 'orange_juice',
  'apple_juice': 'apple_juice',
  'soda_water': 'soda_water',
  'sparkling_water': 'soda_water',
  'water': 'water',

  // =====================================================================
  // ASIAN INGREDIENTS
  // =====================================================================
  'dashi': 'dashi',
  'dashi_stock': 'dashi',
  'dashi_broth': 'dashi',
  'japanese_stock': 'dashi',
  'fish_stock': 'dashi',
  'nori': 'nori',
  'nori_seaweed': 'nori',
  'nori_sheet': 'nori',
  'nori_sheets': 'nori',
  'seaweed_sheet': 'nori',
  'dried_seaweed': 'nori',
  'teriyaki_sauce': 'teriyaki_sauce',
  'teriyaki': 'teriyaki_sauce',
  'mirin': 'mirin',
  'sake': 'sake',
  'miso': 'miso_paste',
  'miso_paste': 'miso_paste',
  'white_miso': 'miso_paste',
  'red_miso': 'miso_paste',
  'wakame': 'wakame',

  // =====================================================================
  // COATINGS & BREADCRUMBS
  // =====================================================================
  'panko': 'panko_breadcrumbs',
  'panko_crumbs': 'panko_breadcrumbs',
  'panko_breadcrumbs': 'panko_breadcrumbs',
  'panko_breadcrumb': 'panko_breadcrumbs',
  'japanese_breadcrumbs': 'panko_breadcrumbs',
  'breadcrumbs': 'breadcrumbs',
  'bread_crumbs': 'breadcrumbs',
  'breadcrumb': 'breadcrumbs',
  'flour': 'flour',
  'plain_flour': 'flour',
  'all_purpose_flour': 'flour',
  'ap_flour': 'flour',
  'cornstarch': 'cornstarch',
  'corn_starch': 'cornstarch',
  'corn_flour': 'cornstarch',
  'potato_starch': 'potato_starch',

  // =====================================================================
  // SPICES & CURRY
  // =====================================================================
  'curry_powder': 'curry_powder',
  'curry': 'curry_powder',
  'curry_spice': 'curry_powder',
  'japanese_curry': 'japanese_curry_roux',
  'curry_roux': 'japanese_curry_roux',
  'curry_block': 'japanese_curry_roux',
  'goldencurry': 'japanese_curry_roux',
  'garam_masala': 'garam_masala',
  'curry_paste': 'curry_paste',

  // =====================================================================
  // SUPPLEMENTS / PERFORMANCE
  // =====================================================================
  'maltodextrin': 'maltodextrin',
  'maltodextrin_powder': 'maltodextrin',
  'dextrose': 'dextrose',
  'creatine': 'creatine_monohydrate',
  'creatine_monohydrate': 'creatine_monohydrate',
};

/**
 * Common brand/quality prefixes to strip during normalization
 */
const STRIP_PREFIXES = [
  'coles_',
  'woolworths_',
  'aldi_',
  'no_added_hormone_',
  'free_range_',
  'organic_',
  'premium_',
  'fresh_',
  'australian_',
  'gourmet_',
  'by_laurent_',
  'traditional_',
  'homestyle_',
  'country_',
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
  '_each',
  '_per_kg',
];

/**
 * Words that indicate quality/origin but don't change the ingredient
 */
const QUALITY_WORDS = [
  'premium', 'organic', 'fresh', 'natural', 'pure', 'traditional',
  'gourmet', 'artisan', 'australian', 'local', 'farm', 'free_range',
  'no_added_hormone', 'grass_fed', 'grain_fed', 'wild_caught',
  'extra', 'super', 'ultra', 'best', 'quality', 'choice', 'select',
  'mild', 'strong', 'medium', 'light', 'dark', 'bold',
  'virgin', 'refined', 'unrefined', 'cold_pressed',
  'homemade', 'homestyle',
];

/**
 * Normalizes an ingredient key for consistent lookup.
 * Idempotent: normalizeKey(normalizeKey(x)) === normalizeKey(x).
 * * @param {string} key - Raw ingredient key
 * @returns {string} Normalized key (lowercase, trimmed, snake_case) or empty string if invalid.
 */
function normalizeKey(key) {
  if (!key || typeof key !== 'string') {
    return '';
  }

  let normalized = key.toLowerCase().trim();

  // 1. Handle percent signs
  normalized = normalized.replace(/%|\bpercent\b/g, 'pct');

  // 2. Basic synonym replacement (yoghurt -> yogurt)
  normalized = normalized.replace(/yoghurt/g, 'yogurt');

  // 3. Convert to snake_case and remove invalid characters
  normalized = normalized
    .replace(/[\s&/-]+/g, '_')   // Replace spaces, ampersands, slashes, hyphens with underscore
    .replace(/[^a-z0-9_]/g, '')  // Remove any remaining non-alphanumeric_underscore characters
    .replace(/__+/g, '_')        // Collapse multiple underscores
    .replace(/^_|_+$/g, '');     // Trim leading/trailing underscores

  // 4. Strip common brand prefixes
  for (const prefix of STRIP_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.substring(prefix.length);
      break; // Only strip one prefix
    }
  }

  // 5. Strip common suffixes
  for (const suffix of STRIP_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.substring(0, normalized.length - suffix.length);
      break; // Only strip one suffix
    }
  }

  // 6. Remove quality descriptors if they create multi-part keys
  const parts = normalized.split('_');
  const filteredParts = parts.filter(part => !QUALITY_WORDS.includes(part));
  if (filteredParts.length > 0 && filteredParts.length < parts.length) {
    normalized = filteredParts.join('_');
  }

  // 7. Apply synonym map for comprehensive matching (FIRST PASS)
  if (SYNONYM_MAP[normalized]) {
    normalized = SYNONYM_MAP[normalized];
  }

  // 8. Handle simple plurals (with exceptions)
  if (normalized.endsWith('ies') && normalized.length > 3) {
    normalized = normalized.slice(0, -3) + 'y'; // e.g., berries -> berry
  } else if (normalized.endsWith('oes') && normalized.length > 3) {
    normalized = normalized.slice(0, -2); // e.g., tomatoes -> tomato
  } else if (
    normalized.endsWith('s') &&
    !normalized.endsWith('ss') &&
    // Exceptions list (preserved from original logic)
    normalized !== 'oats' &&
    normalized !== 'rolled_oats' &&
    normalized !== 'quick_oats' &&
    normalized !== 'instant_oats' &&
    normalized !== 'steel_cut_oats' &&
    normalized !== 'hummus' &&
    normalized !== 'couscous' &&
    normalized !== 'asparagus' &&
    normalized !== 'lentils' &&
    normalized !== 'chickpeas' &&
    normalized !== 'prawns' &&
    normalized !== 'green_beans' &&
    normalized !== 'black_beans' &&
    normalized !== 'kidney_beans' &&
    normalized !== 'cannellini_beans' &&
    normalized !== 'baked_beans' &&
    normalized !== 'corn_flakes' &&
    normalized !== 'egg_noodles' &&
    normalized !== 'panko_breadcrumbs' &&
    normalized !== 'breadcrumbs' &&
    normalized.length > 2
  ) {
    normalized = normalized.slice(0, -1); // e.g., apples -> apple
  }

  // 9. Final synonym map check after plural handling (SECOND PASS)
  if (SYNONYM_MAP[normalized]) {
    normalized = SYNONYM_MAP[normalized];
  }

  // 10. Final cleanup
  normalized = normalized.replace(/__+/g, '_').replace(/^_|_+$/g, '');

  return normalized || '';
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

