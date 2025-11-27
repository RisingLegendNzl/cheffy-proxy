/**
 * Cheffy Orchestrator
 * Enhanced Key Normalization Utility (CommonJS)
 * Version: 2.3.0 - Phase 4 Update: Massive Synonym Coverage (Rice, Asian, Baking)
 * * PHASE 1 UPDATE (2025): Expanded SYNONYM_MAP to eliminate orphan keys
 * - Added comprehensive oats/grain mappings
 * - Added milk variations (including plant milks)
 * - Added protein powder variations
 * - Added mince/ground meat variations
 * - Added Australian/British terminology
 * - Fixed plural handling for critical items
 * * Provides a single, consistent function for turning human-readable
 * ingredient names into standardized database keys with better matching.
 */

/**
 * Comprehensive synonym map for ingredient normalization.
 * Maps variations to canonical forms.
 * * PHASE 1 NOTE: Identity mappings (e.g., 'rolled_oats': 'rolled_oats') are intentional.
 * They ensure canonical forms are not accidentally modified by subsequent processing steps.
 */
const SYNONYM_MAP = {
  // =====================================================================
  // OATS - Comprehensive coverage (PHASE 1 EXPANSION)
  // =====================================================================
  'oats': 'rolled_oats',
  'oat': 'rolled_oats',
  'rolled_oat': 'rolled_oats',
  'rolled_oats': 'rolled_oats',           // Identity mapping - protect canonical form
  'quick_oat': 'quick_oats',
  'quick_oats': 'quick_oats',             // Identity mapping
  'instant_oat': 'instant_oats',
  'instant_oats': 'instant_oats',         // Identity mapping
  'porridge_oat': 'rolled_oats',
  'porridge': 'rolled_oats',              // PHASE 1: Common name
  'porridge_oats': 'rolled_oats',         // PHASE 1: Common name
  'oatmeal': 'rolled_oats',               // PHASE 1: American term
  'steel_cut_oat': 'steel_cut_oats',      // PHASE 1
  'steel_cut_oats': 'steel_cut_oats',     // PHASE 1: Identity mapping
  'scottish_oats': 'steel_cut_oats',      // PHASE 1
  'overnight_oats': 'rolled_oats',        // PHASE 1: Same base ingredient

  // =====================================================================
  // RICE - Comprehensive coverage (PHASE 1/4 EXPANSION)
  // =====================================================================
  'rice': 'white_rice',                   // PHASE 1: Generic defaults to white
  'white_rice': 'white_rice',
  'brown_rice': 'brown_rice',
  'jasmine_rice': 'jasmine_rice',          // MOD ZONE 2: Identity
  'thai_jasmine_rice': 'jasmine_rice',     // MOD ZONE 2: Alias
  'basmati_rice': 'basmati_rice',          // MOD ZONE 2: Identity
  'basmati': 'basmati_rice',               // MOD ZONE 2: Alias
  'sushi_rice': 'sushi_rice',              // MOD ZONE 2: Identity
  'japanese_rice': 'sushi_rice',           // MOD ZONE 2: Alias
  'short_grain_rice': 'sushi_rice',        // MOD ZONE 2: Alias
  'long_grain_rice': 'white_rice',
  'cooked_rice': 'cooked_rice',            // MOD ZONE 2: Identity
  'steamed_rice': 'cooked_rice',           // MOD ZONE 2: Alias
  'cooked_white_rice': 'cooked_white_rice',// MOD ZONE 2: Identity
  'arborio_rice': 'white_rice',           // PHASE 1: Risotto rice
  'arborio': 'white_rice',                // PHASE 1
  'wild_rice': 'wild_rice',               // PHASE 1: Different nutrition profile
  'black_rice': 'black_rice',             // PHASE 1

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
  'rigatoni': 'pasta',                    // PHASE 1
  'farfalle': 'pasta',                    // PHASE 1
  'orzo': 'pasta',                        // PHASE 1
  'lasagna_sheet': 'pasta',               // PHASE 1
  'lasagne_sheet': 'pasta',               // PHASE 1: British spelling
  'noodle': 'pasta',                      // PHASE 1
  'noodles': 'pasta',                     // PHASE 1
  'egg_noodle': 'egg_noodles',            // PHASE 1
  'egg_noodles': 'egg_noodles',           // PHASE 1

  // =====================================================================
  // MILK - Comprehensive coverage (PHASE 1 EXPANSION)
  // =====================================================================
  'milk': 'whole_milk',                   // PHASE 1: Generic defaults to whole
  'full_cream_milk': 'whole_milk',
  'full_fat_milk': 'whole_milk',          // PHASE 1
  'whole_milk': 'whole_milk',
  'skim_milk': 'skim_milk',
  'skimmed_milk': 'skim_milk',            // PHASE 1: British spelling
  'nonfat_milk': 'skim_milk',             // PHASE 1: American term
  'fat_free_milk': 'skim_milk',           // PHASE 1
  'low_fat_milk': 'low_fat_milk',
  'lite_milk': 'low_fat_milk',            // PHASE 1: Australian term
  'light_milk': 'low_fat_milk',           // PHASE 1
  '2_milk': 'low_fat_milk',
  '2pct_milk': 'low_fat_milk',            // PHASE 1: After % normalization
  '1_milk': 'low_fat_milk',               // PHASE 1
  '1pct_milk': 'low_fat_milk',            // PHASE 1
  'lactose_free_milk': 'milk',
  // Plant milks (PHASE 1)
  'almond_milk': 'almond_milk',
  'oat_milk': 'oat_milk',
  'soy_milk': 'soy_milk',
  'soya_milk': 'soy_milk',                // PHASE 1: British term
  'coconut_milk': 'coconut_milk',
  'rice_milk': 'rice_milk',

  // =====================================================================
  // PROTEIN POWDERS - Comprehensive coverage (PHASE 1 EXPANSION)
  // =====================================================================
  'whey_protein': 'whey_protein_isolate',
  'whey': 'whey_protein_isolate',         // PHASE 1: Short form
  'whey_isolate': 'whey_protein_isolate',
  'whey_protein_powder': 'whey_protein_isolate', // PHASE 1
  'protein_powder': 'whey_protein_isolate',
  'protein': 'whey_protein_isolate',      // PHASE 1: Very common shorthand
  'whey_protein_isolate': 'whey_protein_isolate', // Identity mapping
  'whey_protein_concentrate': 'whey_protein_concentrate', // PHASE 1: Different product
  'wpc': 'whey_protein_concentrate',      // PHASE 1: Abbreviation
  'wpi': 'whey_protein_isolate',          // PHASE 1: Abbreviation
  'casein': 'casein_protein',             // PHASE 1
  'casein_protein': 'casein_protein',     // PHASE 1
  'pea_protein': 'pea_protein',           // PHASE 1: Plant protein
  'plant_protein': 'pea_protein',         // PHASE 1: Default plant protein

  // =====================================================================
  // MINCE / GROUND MEAT - Comprehensive coverage (PHASE 1 EXPANSION)
  // =====================================================================
  'mince': 'ground_beef',                 // PHASE 1: Generic defaults to beef
  'minced_meat': 'ground_beef',           // PHASE 1
  'ground_meat': 'ground_beef',           // PHASE 1
  'beef_mince': 'ground_beef',
  'lean_beef_mince': 'ground_beef',
  'beef_4_star_lean_mince': 'ground_beef',
  'no_added_hormone_beef_4_star_lean_mince': 'ground_beef',
  'minced_beef': 'ground_beef',
  'ground_beef': 'ground_beef',           // Identity mapping
  'lean_mince': 'ground_beef',
  'extra_lean_mince': 'ground_beef',
  // Other ground meats (PHASE 1)
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
  'chicken_wing': 'chicken_wing',         // PHASE 1
  'chicken_tender': 'chicken_breast',     // PHASE 1

  // =====================================================================
  // BEEF - Comprehensive coverage
  // =====================================================================
  'beef': 'beef',
  'steak': 'beef_steak',
  'beef_steak': 'beef_steak',
  'sirloin': 'beef_steak',
  'ribeye': 'beef_steak',
  'scotch_fillet': 'beef_steak',          // PHASE 1: Australian term
  'eye_fillet': 'beef_steak',             // PHASE 1: Australian term
  'rump_steak': 'beef_steak',             // PHASE 1

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
  'streaky_bacon': 'bacon',               // PHASE 1

  // =====================================================================
  // SEAFOOD (PHASE 1 EXPANSION)
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
  'shrimp': 'prawns',                     // PHASE 1: American term
  'shrimps': 'prawns',
  'cod': 'white_fish',
  'barramundi': 'white_fish',             // PHASE 1: Australian fish
  'snapper': 'white_fish',                // PHASE 1
  'white_fish': 'white_fish',
  'fish': 'white_fish',

  // =====================================================================
  // EGGS
  // =====================================================================
  'egg': 'egg',
  'eggs': 'egg',                          // PHASE 1: Explicit plural
  'large_egg': 'egg',
  'free_range_egg': 'egg',
  'cage_free_egg': 'egg',                 // PHASE 1
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
  'low_fat_yogurt': 'low_fat_yogurt',     // PHASE 1
  'nonfat_yogurt': 'low_fat_yogurt',      // PHASE 1

  // =====================================================================
  // BUTTER & SPREADS
  // =====================================================================
  'butter': 'butter',
  'salted_butter': 'butter',
  'unsalted_butter': 'butter',
  'dairy_butter': 'butter',
  'peanut_butter': 'peanut_butter',
  'pb': 'peanut_butter',                  // PHASE 1: Abbreviation
  'almond_butter': 'almond_butter',
  'pb2': 'peanut_butter_powder',          // PHASE 1: Powdered peanut butter
  'peanut_butter_powder': 'peanut_butter_powder',

  // =====================================================================
  // CHEESE
  // =====================================================================
  'cheese': 'cheddar',
  'cheddar_cheese': 'cheddar',
  'cheddar': 'cheddar',
  'cheddar_slice': 'cheddar',
  'cheese_cheddar_slice': 'cheddar',
  'tasty_cheese': 'cheddar',              // Australian term
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
  'bread': 'white_bread',                 // PHASE 1: Generic defaults to white
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
  'toast': 'white_bread',                 // PHASE 1

  // =====================================================================
  // OILS
  // =====================================================================
  'oil': 'olive_oil',                     // PHASE 1: Generic defaults to olive
  'olive_oil': 'olive_oil',
  'extra_virgin_olive_oil': 'olive_oil',
  'extra_mild_olive_oil': 'olive_oil',
  'evoo': 'olive_oil',                    // PHASE 1: Abbreviation
  'vegetable_oil': 'vegetable_oil',
  'canola_oil': 'canola_oil',
  'coconut_oil': 'coconut_oil',
  'sunflower_oil': 'sunflower_oil',       // PHASE 1
  'avocado_oil': 'avocado_oil',           // PHASE 1

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
  // FRUITS - With explicit plural protection (PHASE 1 EXPANSION)
  // =====================================================================
  'banana': 'banana',
  'bananas': 'banana',                    // PHASE 1: Explicit plural
  'ripe_banana': 'banana',                // PHASE 1
  'apple': 'apple',
  'apples': 'apple',                      // PHASE 1: Explicit plural
  'modi_apple': 'apple',
  'granny_smith_apple': 'apple',
  'pink_lady_apple': 'apple',
  'royal_gala_apple': 'apple',
  'fuji_apple': 'apple',
  'green_apple': 'apple',
  'red_apple': 'apple',
  'strawberry': 'strawberry',
  'strawberries': 'strawberry',           // PHASE 1: Explicit plural
  'blueberry': 'blueberry',
  'blueberries': 'blueberry',             // PHASE 1: Explicit plural
  'raspberry': 'raspberry',
  'raspberries': 'raspberry',             // PHASE 1: Explicit plural
  'orange': 'orange',
  'oranges': 'orange',                    // PHASE 1: Explicit plural
  'mango': 'mango',
  'mangoes': 'mango',                     // PHASE 1: Explicit plural
  'avocado': 'avocado',
  'avocados': 'avocado',                  // PHASE 1: Explicit plural
  'grape': 'grape',
  'grapes': 'grape',                      // PHASE 1: Explicit plural
  'pear': 'pear',
  'pears': 'pear',                        // PHASE 1
  'peach': 'peach',
  'peaches': 'peach',                     // PHASE 1
  'watermelon': 'watermelon',
  'rockmelon': 'cantaloupe',              // PHASE 1: Australian term
  'cantaloupe': 'cantaloupe',
  'honeydew': 'honeydew',
  'kiwi': 'kiwi',
  'kiwifruit': 'kiwi',

  // =====================================================================
  // VEGETABLES (PHASE 1 EXPANSION - Including Australian/British terms)
  // =====================================================================
  'potato': 'potato',
  'potatoes': 'potato',                   // PHASE 1: Explicit plural
  'sweet_potato': 'sweet_potato',
  'sweet_potatoes': 'sweet_potato',       // PHASE 1
  'tomato': 'tomato',
  'tomatoes': 'tomato',                   // PHASE 1: Explicit plural
  'cherry_tomato': 'tomato',
  'cherry_tomatoes': 'tomato',            // PHASE 1
  'lettuce': 'lettuce',
  'iceberg_lettuce': 'lettuce',
  'shredded_iceberg_lettuce': 'lettuce',
  'cos_lettuce': 'romaine_lettuce',       // PHASE 1: Australian term
  'romaine_lettuce': 'romaine_lettuce',
  'romaine': 'romaine_lettuce',
  'spinach': 'spinach',
  'baby_spinach': 'spinach',
  'broccoli': 'broccoli',
  'carrot': 'carrot',
  'carrots': 'carrot',                    // PHASE 1
  'onion': 'onion',
  'onions': 'onion',                      // PHASE 1
  'brown_onion': 'onion',
  'red_onion': 'red_onion',
  'spring_onion': 'green_onion',          // PHASE 1: Australian/British term
  'green_onion': 'green_onion',
  'scallion': 'green_onion',              // PHASE 1: American term
  'shallot': 'shallot',
  // Australian/British terminology (PHASE 1)
  'capsicum': 'bell_pepper',              // Australian term
  'red_capsicum': 'bell_pepper',
  'green_capsicum': 'bell_pepper',
  'bell_pepper': 'bell_pepper',
  'courgette': 'zucchini',                // British term
  'zucchini': 'zucchini',
  'aubergine': 'eggplant',                // British term
  'eggplant': 'eggplant',
  'rocket': 'arugula',                    // British/Australian term
  'arugula': 'arugula',
  'coriander': 'cilantro',                // British term (for leaves)
  'cilantro': 'cilantro',
  'beetroot': 'beet',                     // British/Australian term
  'beet': 'beet',
  'beets': 'beet',
  'corn': 'corn',
  'sweetcorn': 'corn',
  'mushroom': 'mushroom',
  'mushrooms': 'mushroom',                // PHASE 1
  'cucumber': 'cucumber',
  'celery': 'celery',
  'asparagus': 'asparagus',
  'green_bean': 'green_beans',
  'green_beans': 'green_beans',

  // =====================================================================
  // LEGUMES (PHASE 1 EXPANSION)
  // =====================================================================
  'lentil': 'lentils',
  'lentils': 'lentils',
  'red_lentil': 'red_lentils',
  'red_lentils': 'red_lentils',
  'chickpea': 'chickpeas',
  'chickpeas': 'chickpeas',
  'garbanzo': 'chickpeas',                // PHASE 1: American term
  'garbanzo_bean': 'chickpeas',
  'black_bean': 'black_beans',
  'black_beans': 'black_beans',
  'kidney_bean': 'kidney_beans',
  'kidney_beans': 'kidney_beans',
  'cannellini_bean': 'cannellini_beans',
  'cannellini_beans': 'cannellini_beans',
  'baked_beans': 'baked_beans',
  // RFC-003: Edamame
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
  'weet_bix': 'wheat_cereal',             // PHASE 1
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
  // ASIAN INGREDIENTS (MOD ZONE 1)
  // =====================================================================
  'dashi': 'dashi',
  'dashi_stock': 'dashi',
  'dashi_broth': 'dashi',
  'japanese_stock': 'dashi',
  'fish_stock': 'dashi',
  'nori': 'nori',
  'nori_seaweed': 'nori',
  'nori_sheet': 'nori',                    // MOD ZONE 1: Alias
  'nori_sheets': 'nori',                   // MOD ZONE 1: Alias (Plural)
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
  // COATINGS & BREADCRUMBS (MOD ZONE 3)
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
  // SPICES & CURRY (MOD ZONE 4)
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
  // SUPPLEMENTS / PERFORMANCE (PHASE 1)
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
  'aldi_',                                // PHASE 1
  'no_added_hormone_',
  'free_range_',
  'organic_',
  'premium_',
  'fresh_',
  'australian_',
  'gourmet_',
  'by_laurent_',
  'traditional_',
  'homestyle_',                           // PHASE 1
  'country_',                             // PHASE 1
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
  '_each',                                // PHASE 1
  '_per_kg',                              // PHASE 1
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
  'homemade', 'homestyle',                // PHASE 1
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

  // 7. Apply synonym map for comprehensive matching (FIRST PASS)
  if (SYNONYM_MAP[key]) {
    key = SYNONYM_MAP[key];
  }

  // 8. Handle simple plurals (with exceptions)
  // PHASE 1 FIX: Extended exceptions list for critical plural-form ingredients
  if (key.endsWith('ies') && key.length > 3) {
    key = key.slice(0, -3) + 'y'; // e.g., berries -> berry
  } else if (key.endsWith('oes') && key.length > 3) {
    key = key.slice(0, -2); // e.g., tomatoes -> tomato
  } else if (
    key.endsWith('s') &&
    !key.endsWith('ss') &&                // avoid 'hummus' -> 'hummu'
    key !== 'oats' &&                     // Preserve oats
    key !== 'rolled_oats' &&              // PHASE 1: Preserve rolled_oats
    key !== 'quick_oats' &&               // PHASE 1: Preserve quick_oats
    key !== 'instant_oats' &&             // PHASE 1: Preserve instant_oats
    key !== 'steel_cut_oats' &&           // PHASE 1: Preserve steel_cut_oats
    key !== 'hummus' &&
    key !== 'couscous' &&
    key !== 'asparagus' &&
    key !== 'lentils' &&
    key !== 'chickpeas' &&                // PHASE 1: Preserve chickpeas
    key !== 'prawns' &&                   // PHASE 1: Preserve prawns
    key !== 'green_beans' &&              // PHASE 1: Preserve green_beans
    key !== 'black_beans' &&              // PHASE 1: Preserve black_beans
    key !== 'kidney_beans' &&             // PHASE 1: Preserve kidney_beans
    key !== 'cannellini_beans' &&         // PHASE 1: Preserve cannellini_beans
    key !== 'baked_beans' &&              // PHASE 1: Preserve baked_beans
    key !== 'corn_flakes' &&              // PHASE 1: Preserve corn_flakes
    key !== 'egg_noodles' &&              // PHASE 1: Preserve egg_noodles
    key !== 'panko_breadcrumbs' &&        // MOD ZONE 5.1: Preserve panko_breadcrumbs
    key !== 'breadcrumbs' &&              // MOD ZONE 5.2: Preserve breadcrumbs
    key.length > 2
  ) {
    key = key.slice(0, -1); // e.g., apples -> apple
  }

  // 9. Final synonym map check after plural handling (SECOND PASS)
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

