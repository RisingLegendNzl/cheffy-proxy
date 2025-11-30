/**
 * utils/stateResolver.js
 * 
 * Deterministic State Resolution Engine for Cheffy
 * 
 * PURPOSE:
 * Replaces the fragile keyword-based inferHints() function with a
 * deterministic, rule-based state resolution system. Rules are ordered
 * by priority (lower number = higher priority), and first match wins.
 * 
 * PLAN REFERENCE: Steps B1, B2, B4
 * - B1: Create State Resolution Engine
 * - B2: Define Exhaustive Category Mappings
 * - B4: Add Cooking Keyword Detection
 * 
 * DESIGN PRINCIPLES:
 * 1. Explicit over implicit - no substring guessing
 * 2. Rules ordered by specificity (most specific first)
 * 3. Every resolution returns ruleId for auditability
 * 4. LLM state hint is advisory, rules are authoritative
 * 
 * ASSUMPTIONS:
 * - Item keys are lowercase strings (normalized upstream)
 * - Valid states: 'dry', 'raw', 'cooked', 'as_pack'
 * - Valid methods: null, 'boiled', 'fried', 'baked', 'steamed', 'grilled', 'roasted', 'sauteed'
 */

/**
 * Valid state values
 */
const VALID_STATES = ['dry', 'raw', 'cooked', 'as_pack'];

/**
 * Valid cooking method values
 */
const VALID_METHODS = [null, 'boiled', 'fried', 'baked', 'steamed', 'grilled', 'roasted', 'sauteed', 'poached', 'braised'];

/**
 * Cooking keywords that indicate cooked state
 * When present in item key, state is definitively 'cooked'
 */
const COOKING_KEYWORDS = [
  { keyword: 'cooked', method: null },
  { keyword: 'fried', method: 'fried' },
  { keyword: 'baked', method: 'baked' },
  { keyword: 'steamed', method: 'steamed' },
  { keyword: 'boiled', method: 'boiled' },
  { keyword: 'grilled', method: 'grilled' },
  { keyword: 'roasted', method: 'roasted' },
  { keyword: 'sauteed', method: 'sauteed' },
  { keyword: 'sautéed', method: 'sauteed' },
  { keyword: 'pan-fried', method: 'fried' },
  { keyword: 'stir-fried', method: 'fried' },
  { keyword: 'deep-fried', method: 'fried' },
  { keyword: 'poached', method: 'poached' },
  { keyword: 'braised', method: 'braised' },
  { keyword: 'toasted', method: 'baked' },
  { keyword: 'charred', method: 'grilled' },
  { keyword: 'caramelized', method: 'sauteed' },
  { keyword: 'scrambled', method: 'fried' },
  { keyword: 'hard-boiled', method: 'boiled' },
  { keyword: 'soft-boiled', method: 'boiled' },
  { keyword: 'poached', method: 'poached' }
];

/**
 * Category definitions with default states
 * Each ingredient belongs to exactly one category
 */
const CATEGORIES = {
  GRAINS: {
    defaultState: 'dry',
    defaultMethod: null,
    description: 'Rice, pasta, oats, quinoa, couscous, etc.'
  },
  PROTEINS: {
    defaultState: 'raw',
    defaultMethod: null,
    description: 'Chicken, beef, fish, tofu, eggs, etc.'
  },
  DAIRY: {
    defaultState: 'as_pack',
    defaultMethod: null,
    description: 'Milk, cheese, yogurt, butter, cream, etc.'
  },
  PRODUCE: {
    defaultState: 'raw',
    defaultMethod: null,
    description: 'Fresh vegetables and fruits'
  },
  PACKAGED: {
    defaultState: 'as_pack',
    defaultMethod: null,
    description: 'Canned, jarred, bottled items'
  },
  PREPARED: {
    defaultState: 'cooked',
    defaultMethod: null,
    description: 'Pre-cooked or ready-to-eat items'
  },
  CONDIMENTS: {
    defaultState: 'as_pack',
    defaultMethod: null,
    description: 'Sauces, oils, vinegars, spices'
  },
  LEGUMES: {
    defaultState: 'dry',
    defaultMethod: null,
    description: 'Beans, lentils, chickpeas (dry form)'
  },
  NUTS_SEEDS: {
    defaultState: 'as_pack',
    defaultMethod: null,
    description: 'Nuts, seeds, nut butters'
  },
  BEVERAGES: {
    defaultState: 'as_pack',
    defaultMethod: null,
    description: 'Drinks, juices, milk alternatives'
  }
};

/**
 * State resolution rules
 * 
 * Format:
 * {
 *   id: string,           // Unique rule identifier
 *   pattern: RegExp,      // Pattern to match against item key
 *   category: string,     // Category from CATEGORIES
 *   state: string,        // Resolved state
 *   method: string|null,  // Resolved cooking method
 *   priority: number,     // Lower = higher priority
 *   confidence: string,   // 'high', 'medium', 'low'
 *   notes: string         // Documentation
 * }
 * 
 * Rules are sorted by priority and first match wins.
 */
const STATE_RULES = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 0-99: Cooking keyword overrides (highest priority)
  // These fire when item name explicitly contains cooking words
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Note: Cooking keyword rules are handled dynamically in resolveState()
  // They take absolute priority over all other rules
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 100-199: Compound/specific item overrides
  // These handle items where substring matching would fail
  // ═══════════════════════════════════════════════════════════════════════════
  
  {
    id: 'COMPOUND_FRIED_RICE',
    pattern: /fried\s*rice/i,
    category: 'PREPARED',
    state: 'cooked',
    method: 'fried',
    priority: 100,
    confidence: 'high',
    notes: 'Fried rice is always cooked, not dry rice'
  },
  {
    id: 'COMPOUND_RICE_PAPER',
    pattern: /rice\s*paper/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 101,
    confidence: 'high',
    notes: 'Rice paper is a packaged product, not a grain'
  },
  {
    id: 'COMPOUND_RICE_NOODLES',
    pattern: /rice\s*noodle/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 102,
    confidence: 'high',
    notes: 'Rice noodles are dry by default'
  },
  {
    id: 'COMPOUND_RICE_CRACKER',
    pattern: /rice\s*cracker/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 103,
    confidence: 'high',
    notes: 'Rice crackers are packaged snacks'
  },
  {
    id: 'COMPOUND_RICE_CAKE',
    pattern: /rice\s*cake/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 104,
    confidence: 'high',
    notes: 'Rice cakes are packaged products'
  },
  {
    id: 'COMPOUND_RICE_PUDDING',
    pattern: /rice\s*pudding/i,
    category: 'PREPARED',
    state: 'cooked',
    method: null,
    priority: 105,
    confidence: 'high',
    notes: 'Rice pudding is a prepared dessert'
  },
  {
    id: 'COMPOUND_RICE_MILK',
    pattern: /rice\s*milk/i,
    category: 'BEVERAGES',
    state: 'as_pack',
    method: null,
    priority: 106,
    confidence: 'high',
    notes: 'Rice milk is a packaged beverage'
  },
  {
    id: 'COMPOUND_GOAT_CHEESE',
    pattern: /goat\s*cheese|goat's?\s*cheese/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 110,
    confidence: 'high',
    notes: 'Goat cheese is dairy, not protein - prevents goat/oat collision'
  },
  {
    id: 'COMPOUND_GOAT_MILK',
    pattern: /goat\s*milk|goat's?\s*milk/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 111,
    confidence: 'high',
    notes: 'Goat milk is dairy'
  },
  {
    id: 'COMPOUND_OAT_MILK',
    pattern: /oat\s*milk/i,
    category: 'BEVERAGES',
    state: 'as_pack',
    method: null,
    priority: 112,
    confidence: 'high',
    notes: 'Oat milk is a packaged beverage, not dry oats'
  },
  {
    id: 'COMPOUND_PEANUT_BUTTER',
    pattern: /peanut\s*butter/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 115,
    confidence: 'high',
    notes: 'Peanut butter is a nut product, not raw peanuts'
  },
  {
    id: 'COMPOUND_ALMOND_BUTTER',
    pattern: /almond\s*butter/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 116,
    confidence: 'high',
    notes: 'Almond butter is a nut product'
  },
  {
    id: 'COMPOUND_COCONUT_MILK',
    pattern: /coconut\s*milk/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 117,
    confidence: 'high',
    notes: 'Coconut milk is a packaged liquid'
  },
  {
    id: 'COMPOUND_COCONUT_CREAM',
    pattern: /coconut\s*cream/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 118,
    confidence: 'high',
    notes: 'Coconut cream is a packaged product'
  },
  {
    id: 'COMPOUND_COCONUT_OIL',
    pattern: /coconut\s*oil/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 119,
    confidence: 'high',
    notes: 'Coconut oil is a cooking fat'
  },
  {
    id: 'COMPOUND_OLIVE_OIL',
    pattern: /olive\s*oil/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 120,
    confidence: 'high',
    notes: 'Olive oil is a cooking fat, not produce'
  },
  {
    id: 'COMPOUND_EGG_WHITE',
    pattern: /egg\s*white/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 125,
    confidence: 'high',
    notes: 'Egg whites are raw protein component'
  },
  {
    id: 'COMPOUND_EGG_YOLK',
    pattern: /egg\s*yolk/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 126,
    confidence: 'high',
    notes: 'Egg yolks are raw protein component'
  },
  {
    id: 'COMPOUND_CANNED_BEANS',
    pattern: /canned\s*(kidney|black|pinto|navy|cannellini|butter)?\s*beans?/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 130,
    confidence: 'high',
    notes: 'Canned beans are pre-cooked and packaged'
  },
  {
    id: 'COMPOUND_CANNED_TUNA',
    pattern: /canned\s*tuna|tuna\s*in\s*(oil|water|brine)/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 131,
    confidence: 'high',
    notes: 'Canned tuna is pre-cooked and packaged'
  },
  {
    id: 'COMPOUND_CANNED_SALMON',
    pattern: /canned\s*salmon/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 132,
    confidence: 'high',
    notes: 'Canned salmon is pre-cooked and packaged'
  },
  {
    id: 'COMPOUND_TOMATO_PASTE',
    pattern: /tomato\s*paste/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 135,
    confidence: 'high',
    notes: 'Tomato paste is a packaged product'
  },
  {
    id: 'COMPOUND_TOMATO_SAUCE',
    pattern: /tomato\s*sauce/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 136,
    confidence: 'high',
    notes: 'Tomato sauce is a packaged product'
  },
  {
    id: 'COMPOUND_MINCED_MEAT',
    pattern: /minced?\s*(beef|pork|lamb|chicken|turkey)|ground\s*(beef|pork|lamb|chicken|turkey)/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 140,
    confidence: 'high',
    notes: 'Minced/ground meat is raw protein'
  },
  {
    id: 'COMPOUND_SMOKED_SALMON',
    pattern: /smoked\s*salmon|lox/i,
    category: 'PREPARED',
    state: 'cooked',
    method: null,
    priority: 145,
    confidence: 'high',
    notes: 'Smoked salmon is cured/ready-to-eat'
  },
  {
    id: 'COMPOUND_DELI_MEAT',
    pattern: /deli\s*(meat|turkey|ham|chicken)|sliced\s*(ham|turkey|chicken|salami|bologna)/i,
    category: 'PREPARED',
    state: 'cooked',
    method: null,
    priority: 146,
    confidence: 'high',
    notes: 'Deli meats are pre-cooked'
  },
  {
    id: 'COMPOUND_BACON',
    pattern: /^bacon$|rashers?|streaky\s*bacon/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 147,
    confidence: 'high',
    notes: 'Bacon is raw by default, cooked bacon should use cooking keyword'
  },
  {
    id: 'COMPOUND_INSTANT_NOODLES',
    pattern: /instant\s*noodles?|ramen\s*noodles?/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 150,
    confidence: 'high',
    notes: 'Instant noodles are packaged products'
  },
  {
    id: 'COMPOUND_BREAD',
    pattern: /^bread$|sliced\s*bread|sandwich\s*bread|sourdough|ciabatta|baguette|focaccia/i,
    category: 'PREPARED',
    state: 'cooked',
    method: 'baked',
    priority: 155,
    confidence: 'high',
    notes: 'Bread is pre-baked'
  },
  {
    id: 'COMPOUND_TORTILLA',
    pattern: /tortilla|wrap|flatbread|pita|naan/i,
    category: 'PREPARED',
    state: 'cooked',
    method: null,
    priority: 156,
    confidence: 'high',
    notes: 'Flatbreads are pre-cooked'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 200-299: Specific ingredient patterns
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Grains (priority 200-219)
  {
    id: 'GRAINS_RICE_JASMINE',
    pattern: /jasmine\s*rice/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 200,
    confidence: 'high',
    notes: 'Jasmine rice - specific variant for YIELDS lookup'
  },
  {
    id: 'GRAINS_RICE_BROWN',
    pattern: /brown\s*rice/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 201,
    confidence: 'high',
    notes: 'Brown rice - specific variant for YIELDS lookup'
  },
  {
    id: 'GRAINS_RICE_BASMATI',
    pattern: /basmati\s*rice/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 202,
    confidence: 'high',
    notes: 'Basmati rice - specific variant for YIELDS lookup'
  },
  {
    id: 'GRAINS_RICE_WILD',
    pattern: /wild\s*rice/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 203,
    confidence: 'high',
    notes: 'Wild rice - specific variant for YIELDS lookup'
  },
  {
    id: 'GRAINS_RICE_ARBORIO',
    pattern: /arborio\s*rice|risotto\s*rice/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 204,
    confidence: 'high',
    notes: 'Arborio/risotto rice - specific variant'
  },
  {
    id: 'GRAINS_RICE_GENERIC',
    pattern: /^rice$|white\s*rice/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 205,
    confidence: 'high',
    notes: 'Generic rice defaults to dry'
  },
  {
    id: 'GRAINS_PASTA_SPAGHETTI',
    pattern: /spaghetti/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 210,
    confidence: 'high',
    notes: 'Spaghetti - specific pasta variant'
  },
  {
    id: 'GRAINS_PASTA_PENNE',
    pattern: /penne/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 211,
    confidence: 'high',
    notes: 'Penne - specific pasta variant'
  },
  {
    id: 'GRAINS_PASTA_MACARONI',
    pattern: /macaroni/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 212,
    confidence: 'high',
    notes: 'Macaroni - specific pasta variant'
  },
  {
    id: 'GRAINS_PASTA_FUSILLI',
    pattern: /fusilli/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 213,
    confidence: 'high',
    notes: 'Fusilli - specific pasta variant'
  },
  {
    id: 'GRAINS_PASTA_FETTUCCINE',
    pattern: /fettuccine|fettucine/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 214,
    confidence: 'high',
    notes: 'Fettuccine - specific pasta variant'
  },
  {
    id: 'GRAINS_PASTA_GENERIC',
    pattern: /^pasta$/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 215,
    confidence: 'high',
    notes: 'Generic pasta defaults to dry'
  },
  {
    id: 'GRAINS_OATS',
    pattern: /^oats?$|rolled\s*oats?|steel\s*cut\s*oats?|oatmeal/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 216,
    confidence: 'high',
    notes: 'Oats default to dry'
  },
  {
    id: 'GRAINS_QUINOA',
    pattern: /quinoa/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 217,
    confidence: 'high',
    notes: 'Quinoa defaults to dry'
  },
  {
    id: 'GRAINS_COUSCOUS',
    pattern: /couscous/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 218,
    confidence: 'high',
    notes: 'Couscous defaults to dry'
  },
  {
    id: 'GRAINS_BARLEY',
    pattern: /barley|pearl\s*barley/i,
    category: 'GRAINS',
    state: 'dry',
    method: null,
    priority: 219,
    confidence: 'high',
    notes: 'Barley defaults to dry'
  },
  
  // Proteins (priority 220-249)
  {
    id: 'PROTEINS_CHICKEN_BREAST',
    pattern: /chicken\s*breast/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 220,
    confidence: 'high',
    notes: 'Chicken breast - specific cut for YIELDS lookup'
  },
  {
    id: 'PROTEINS_CHICKEN_THIGH',
    pattern: /chicken\s*thigh/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 221,
    confidence: 'high',
    notes: 'Chicken thigh - specific cut for YIELDS lookup'
  },
  {
    id: 'PROTEINS_CHICKEN_DRUMSTICK',
    pattern: /chicken\s*(drumstick|leg)/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 222,
    confidence: 'high',
    notes: 'Chicken drumstick/leg - specific cut'
  },
  {
    id: 'PROTEINS_CHICKEN_WING',
    pattern: /chicken\s*wing/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 223,
    confidence: 'high',
    notes: 'Chicken wing - specific cut'
  },
  {
    id: 'PROTEINS_CHICKEN_GENERIC',
    pattern: /^chicken$/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 224,
    confidence: 'high',
    notes: 'Generic chicken defaults to raw'
  },
  {
    id: 'PROTEINS_BEEF_STEAK',
    pattern: /beef\s*steak|steak|sirloin|ribeye|scotch\s*fillet|eye\s*fillet|rump/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 225,
    confidence: 'high',
    notes: 'Beef steak cuts default to raw'
  },
  {
    id: 'PROTEINS_BEEF_MINCE',
    pattern: /beef\s*mince/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 226,
    confidence: 'high',
    notes: 'Beef mince defaults to raw'
  },
  {
    id: 'PROTEINS_BEEF_GENERIC',
    pattern: /^beef$/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 227,
    confidence: 'high',
    notes: 'Generic beef defaults to raw'
  },
  {
    id: 'PROTEINS_PORK_CHOP',
    pattern: /pork\s*chop/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 228,
    confidence: 'high',
    notes: 'Pork chop defaults to raw'
  },
  {
    id: 'PROTEINS_PORK_GENERIC',
    pattern: /^pork$/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 229,
    confidence: 'high',
    notes: 'Generic pork defaults to raw'
  },
  {
    id: 'PROTEINS_LAMB',
    pattern: /^lamb$|lamb\s*(chop|leg|shoulder|cutlet)/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 230,
    confidence: 'high',
    notes: 'Lamb defaults to raw'
  },
  {
    id: 'PROTEINS_FISH_SALMON',
    pattern: /^salmon$|salmon\s*fillet/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 231,
    confidence: 'high',
    notes: 'Salmon defaults to raw'
  },
  {
    id: 'PROTEINS_FISH_TUNA_FRESH',
    pattern: /^tuna$|fresh\s*tuna|tuna\s*(steak|fillet)/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 232,
    confidence: 'high',
    notes: 'Fresh tuna defaults to raw'
  },
  {
    id: 'PROTEINS_FISH_COD',
    pattern: /^cod$|cod\s*fillet/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 233,
    confidence: 'high',
    notes: 'Cod defaults to raw'
  },
  {
    id: 'PROTEINS_FISH_GENERIC',
    pattern: /^fish$|fish\s*fillet/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 234,
    confidence: 'high',
    notes: 'Generic fish defaults to raw'
  },
  {
    id: 'PROTEINS_PRAWNS',
    pattern: /prawn|shrimp/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 235,
    confidence: 'high',
    notes: 'Prawns/shrimp default to raw'
  },
  {
    id: 'PROTEINS_EGGS',
    pattern: /^eggs?$|large\s*eggs?|chicken\s*eggs?/i,
    category: 'PROTEINS',
    state: 'raw',
    method: null,
    priority: 240,
    confidence: 'high',
    notes: 'Eggs default to raw'
  },
  {
    id: 'PROTEINS_TOFU',
    pattern: /^tofu$|firm\s*tofu|silken\s*tofu/i,
    category: 'PROTEINS',
    state: 'as_pack',
    method: null,
    priority: 241,
    confidence: 'high',
    notes: 'Tofu is packaged'
  },
  {
    id: 'PROTEINS_TEMPEH',
    pattern: /tempeh/i,
    category: 'PROTEINS',
    state: 'as_pack',
    method: null,
    priority: 242,
    confidence: 'high',
    notes: 'Tempeh is packaged'
  },
  
  // Dairy (priority 250-269)
  {
    id: 'DAIRY_MILK',
    pattern: /^milk$|cow'?s?\s*milk|full\s*cream\s*milk|skim\s*milk|low\s*fat\s*milk/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 250,
    confidence: 'high',
    notes: 'Milk is packaged'
  },
  {
    id: 'DAIRY_CHEESE_CHEDDAR',
    pattern: /cheddar/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 251,
    confidence: 'high',
    notes: 'Cheddar cheese'
  },
  {
    id: 'DAIRY_CHEESE_MOZZARELLA',
    pattern: /mozzarella/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 252,
    confidence: 'high',
    notes: 'Mozzarella cheese'
  },
  {
    id: 'DAIRY_CHEESE_PARMESAN',
    pattern: /parmesan|parmigiano/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 253,
    confidence: 'high',
    notes: 'Parmesan cheese'
  },
  {
    id: 'DAIRY_CHEESE_FETA',
    pattern: /feta/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 254,
    confidence: 'high',
    notes: 'Feta cheese'
  },
  {
    id: 'DAIRY_CHEESE_CREAM_CHEESE',
    pattern: /cream\s*cheese/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 255,
    confidence: 'high',
    notes: 'Cream cheese'
  },
  {
    id: 'DAIRY_CHEESE_COTTAGE',
    pattern: /cottage\s*cheese/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 256,
    confidence: 'high',
    notes: 'Cottage cheese'
  },
  {
    id: 'DAIRY_CHEESE_GENERIC',
    pattern: /^cheese$/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 257,
    confidence: 'high',
    notes: 'Generic cheese'
  },
  {
    id: 'DAIRY_YOGURT',
    pattern: /yogurt|yoghurt|greek\s*yogurt/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 258,
    confidence: 'high',
    notes: 'Yogurt is packaged'
  },
  {
    id: 'DAIRY_BUTTER',
    pattern: /^butter$|unsalted\s*butter|salted\s*butter/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 259,
    confidence: 'high',
    notes: 'Butter is packaged'
  },
  {
    id: 'DAIRY_CREAM',
    pattern: /^cream$|heavy\s*cream|whipping\s*cream|thickened\s*cream|double\s*cream|single\s*cream/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 260,
    confidence: 'high',
    notes: 'Cream is packaged'
  },
  {
    id: 'DAIRY_SOUR_CREAM',
    pattern: /sour\s*cream/i,
    category: 'DAIRY',
    state: 'as_pack',
    method: null,
    priority: 261,
    confidence: 'high',
    notes: 'Sour cream is packaged'
  },
  
  // Produce - Vegetables (priority 270-299)
  {
    id: 'PRODUCE_ONION',
    pattern: /^onion$|brown\s*onion|red\s*onion|white\s*onion|yellow\s*onion|spanish\s*onion/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 270,
    confidence: 'high',
    notes: 'Onions default to raw'
  },
  {
    id: 'PRODUCE_GARLIC',
    pattern: /^garlic$|garlic\s*clove/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 271,
    confidence: 'high',
    notes: 'Garlic defaults to raw'
  },
  {
    id: 'PRODUCE_TOMATO',
    pattern: /^tomato$|^tomatoes$|cherry\s*tomato|roma\s*tomato/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 272,
    confidence: 'high',
    notes: 'Fresh tomatoes default to raw'
  },
  {
    id: 'PRODUCE_POTATO',
    pattern: /^potato$|^potatoes$/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 273,
    confidence: 'high',
    notes: 'Potatoes default to raw'
  },
  {
    id: 'PRODUCE_SWEET_POTATO',
    pattern: /sweet\s*potato/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 274,
    confidence: 'high',
    notes: 'Sweet potatoes default to raw'
  },
  {
    id: 'PRODUCE_CARROT',
    pattern: /^carrot/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 275,
    confidence: 'high',
    notes: 'Carrots default to raw'
  },
  {
    id: 'PRODUCE_BROCCOLI',
    pattern: /^broccoli$/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 276,
    confidence: 'high',
    notes: 'Broccoli defaults to raw'
  },
  {
    id: 'PRODUCE_SPINACH',
    pattern: /^spinach$|baby\s*spinach/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 277,
    confidence: 'high',
    notes: 'Spinach defaults to raw'
  },
  {
    id: 'PRODUCE_KALE',
    pattern: /^kale$/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 278,
    confidence: 'high',
    notes: 'Kale defaults to raw'
  },
  {
    id: 'PRODUCE_CAPSICUM',
    pattern: /capsicum|bell\s*pepper/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 279,
    confidence: 'high',
    notes: 'Capsicum/bell pepper defaults to raw'
  },
  {
    id: 'PRODUCE_ZUCCHINI',
    pattern: /zucchini|courgette/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 280,
    confidence: 'high',
    notes: 'Zucchini defaults to raw'
  },
  {
    id: 'PRODUCE_CUCUMBER',
    pattern: /cucumber/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 281,
    confidence: 'high',
    notes: 'Cucumber defaults to raw'
  },
  {
    id: 'PRODUCE_LETTUCE',
    pattern: /lettuce|iceberg|cos\s*lettuce|romaine/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 282,
    confidence: 'high',
    notes: 'Lettuce defaults to raw'
  },
  {
    id: 'PRODUCE_MUSHROOM',
    pattern: /mushroom/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 283,
    confidence: 'high',
    notes: 'Mushrooms default to raw'
  },
  {
    id: 'PRODUCE_AVOCADO',
    pattern: /avocado/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 284,
    confidence: 'high',
    notes: 'Avocado defaults to raw'
  },
  {
    id: 'PRODUCE_CELERY',
    pattern: /celery/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 285,
    confidence: 'high',
    notes: 'Celery defaults to raw'
  },
  {
    id: 'PRODUCE_ASPARAGUS',
    pattern: /asparagus/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 286,
    confidence: 'high',
    notes: 'Asparagus defaults to raw'
  },
  {
    id: 'PRODUCE_BEANS_GREEN',
    pattern: /green\s*beans?|string\s*beans?/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 287,
    confidence: 'high',
    notes: 'Green beans default to raw'
  },
  {
    id: 'PRODUCE_CORN',
    pattern: /^corn$|sweet\s*corn|corn\s*on\s*the\s*cob/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 288,
    confidence: 'high',
    notes: 'Fresh corn defaults to raw'
  },
  {
    id: 'PRODUCE_EGGPLANT',
    pattern: /eggplant|aubergine/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 289,
    confidence: 'high',
    notes: 'Eggplant defaults to raw'
  },
  {
    id: 'PRODUCE_CAULIFLOWER',
    pattern: /cauliflower/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 290,
    confidence: 'high',
    notes: 'Cauliflower defaults to raw'
  },
  {
    id: 'PRODUCE_CABBAGE',
    pattern: /cabbage/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 291,
    confidence: 'high',
    notes: 'Cabbage defaults to raw'
  },
  {
    id: 'PRODUCE_PEAS',
    pattern: /^peas$|green\s*peas|garden\s*peas/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 292,
    confidence: 'high',
    notes: 'Fresh peas default to raw'
  },
  {
    id: 'PRODUCE_GINGER',
    pattern: /^ginger$|fresh\s*ginger/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 293,
    confidence: 'high',
    notes: 'Fresh ginger defaults to raw'
  },
  
  // Produce - Fruits (priority 300-329)
  {
    id: 'PRODUCE_APPLE',
    pattern: /^apple/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 300,
    confidence: 'high',
    notes: 'Apples default to raw'
  },
  {
    id: 'PRODUCE_BANANA',
    pattern: /banana/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 301,
    confidence: 'high',
    notes: 'Bananas default to raw'
  },
  {
    id: 'PRODUCE_ORANGE',
    pattern: /^orange/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 302,
    confidence: 'high',
    notes: 'Oranges default to raw'
  },
  {
    id: 'PRODUCE_LEMON',
    pattern: /lemon/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 303,
    confidence: 'high',
    notes: 'Lemons default to raw'
  },
  {
    id: 'PRODUCE_LIME',
    pattern: /^lime/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 304,
    confidence: 'high',
    notes: 'Limes default to raw'
  },
  {
    id: 'PRODUCE_BERRIES',
    pattern: /berries|strawberr|blueberr|raspberr|blackberr/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 305,
    confidence: 'high',
    notes: 'Berries default to raw'
  },
  {
    id: 'PRODUCE_MANGO',
    pattern: /mango/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 306,
    confidence: 'high',
    notes: 'Mango defaults to raw'
  },
  {
    id: 'PRODUCE_PINEAPPLE',
    pattern: /pineapple/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 307,
    confidence: 'high',
    notes: 'Pineapple defaults to raw'
  },
  {
    id: 'PRODUCE_GRAPES',
    pattern: /grape/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 308,
    confidence: 'high',
    notes: 'Grapes default to raw'
  },
  {
    id: 'PRODUCE_MELON',
    pattern: /melon|watermelon|cantaloupe|honeydew/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 309,
    confidence: 'high',
    notes: 'Melons default to raw'
  },
  {
    id: 'PRODUCE_PEACH',
    pattern: /peach|nectarine/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 310,
    confidence: 'high',
    notes: 'Stone fruit defaults to raw'
  },
  {
    id: 'PRODUCE_PEAR',
    pattern: /^pear/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 311,
    confidence: 'high',
    notes: 'Pears default to raw'
  },
  {
    id: 'PRODUCE_KIWI',
    pattern: /kiwi/i,
    category: 'PRODUCE',
    state: 'raw',
    method: null,
    priority: 312,
    confidence: 'high',
    notes: 'Kiwi defaults to raw'
  },
  
  // Legumes (priority 330-349)
  {
    id: 'LEGUMES_LENTILS',
    pattern: /^lentils?$|red\s*lentils?|green\s*lentils?|brown\s*lentils?|puy\s*lentils?/i,
    category: 'LEGUMES',
    state: 'dry',
    method: null,
    priority: 330,
    confidence: 'high',
    notes: 'Dry lentils'
  },
  {
    id: 'LEGUMES_CHICKPEAS_DRY',
    pattern: /^chickpeas?$|^garbanzo/i,
    category: 'LEGUMES',
    state: 'dry',
    method: null,
    priority: 331,
    confidence: 'high',
    notes: 'Dry chickpeas - see COMPOUND_CANNED_BEANS for canned'
  },
  {
    id: 'LEGUMES_BLACK_BEANS',
    pattern: /^black\s*beans?$/i,
    category: 'LEGUMES',
    state: 'dry',
    method: null,
    priority: 332,
    confidence: 'high',
    notes: 'Dry black beans'
  },
  {
    id: 'LEGUMES_KIDNEY_BEANS',
    pattern: /^kidney\s*beans?$/i,
    category: 'LEGUMES',
    state: 'dry',
    method: null,
    priority: 333,
    confidence: 'high',
    notes: 'Dry kidney beans'
  },
  {
    id: 'LEGUMES_SPLIT_PEAS',
    pattern: /split\s*peas?/i,
    category: 'LEGUMES',
    state: 'dry',
    method: null,
    priority: 334,
    confidence: 'high',
    notes: 'Dry split peas'
  },
  
  // Nuts and Seeds (priority 350-369)
  {
    id: 'NUTS_ALMONDS',
    pattern: /^almonds?$/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 350,
    confidence: 'high',
    notes: 'Almonds are packaged'
  },
  {
    id: 'NUTS_WALNUTS',
    pattern: /^walnuts?$/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 351,
    confidence: 'high',
    notes: 'Walnuts are packaged'
  },
  {
    id: 'NUTS_CASHEWS',
    pattern: /^cashews?$/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 352,
    confidence: 'high',
    notes: 'Cashews are packaged'
  },
  {
    id: 'NUTS_PEANUTS',
    pattern: /^peanuts?$/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 353,
    confidence: 'high',
    notes: 'Peanuts are packaged'
  },
  {
    id: 'NUTS_MACADAMIA',
    pattern: /macadamia/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 354,
    confidence: 'high',
    notes: 'Macadamias are packaged'
  },
  {
    id: 'SEEDS_CHIA',
    pattern: /chia\s*seeds?/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 360,
    confidence: 'high',
    notes: 'Chia seeds are packaged'
  },
  {
    id: 'SEEDS_FLAX',
    pattern: /flax\s*seeds?|linseed/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 361,
    confidence: 'high',
    notes: 'Flax seeds are packaged'
  },
  {
    id: 'SEEDS_SUNFLOWER',
    pattern: /sunflower\s*seeds?/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 362,
    confidence: 'high',
    notes: 'Sunflower seeds are packaged'
  },
  {
    id: 'SEEDS_PUMPKIN',
    pattern: /pumpkin\s*seeds?|pepitas?/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 363,
    confidence: 'high',
    notes: 'Pumpkin seeds are packaged'
  },
  {
    id: 'SEEDS_SESAME',
    pattern: /sesame\s*seeds?/i,
    category: 'NUTS_SEEDS',
    state: 'as_pack',
    method: null,
    priority: 364,
    confidence: 'high',
    notes: 'Sesame seeds are packaged'
  },
  
  // Condiments and Oils (priority 370-399)
  {
    id: 'CONDIMENTS_SOY_SAUCE',
    pattern: /soy\s*sauce/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 370,
    confidence: 'high',
    notes: 'Soy sauce is packaged'
  },
  {
    id: 'CONDIMENTS_FISH_SAUCE',
    pattern: /fish\s*sauce/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 371,
    confidence: 'high',
    notes: 'Fish sauce is packaged'
  },
  {
    id: 'CONDIMENTS_OYSTER_SAUCE',
    pattern: /oyster\s*sauce/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 372,
    confidence: 'high',
    notes: 'Oyster sauce is packaged'
  },
  {
    id: 'CONDIMENTS_VINEGAR',
    pattern: /vinegar|balsamic/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 373,
    confidence: 'high',
    notes: 'Vinegars are packaged'
  },
  {
    id: 'CONDIMENTS_MUSTARD',
    pattern: /mustard/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 374,
    confidence: 'high',
    notes: 'Mustard is packaged'
  },
  {
    id: 'CONDIMENTS_MAYONNAISE',
    pattern: /mayonnaise|mayo/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 375,
    confidence: 'high',
    notes: 'Mayonnaise is packaged'
  },
  {
    id: 'CONDIMENTS_KETCHUP',
    pattern: /ketchup|tomato\s*sauce/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 376,
    confidence: 'high',
    notes: 'Ketchup is packaged'
  },
  {
    id: 'CONDIMENTS_HOT_SAUCE',
    pattern: /hot\s*sauce|sriracha|tabasco|chili\s*sauce/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 377,
    confidence: 'high',
    notes: 'Hot sauces are packaged'
  },
  {
    id: 'CONDIMENTS_HONEY',
    pattern: /^honey$/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 378,
    confidence: 'high',
    notes: 'Honey is packaged'
  },
  {
    id: 'CONDIMENTS_MAPLE_SYRUP',
    pattern: /maple\s*syrup/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 379,
    confidence: 'high',
    notes: 'Maple syrup is packaged'
  },
  {
    id: 'CONDIMENTS_VEGETABLE_OIL',
    pattern: /vegetable\s*oil|canola\s*oil|sunflower\s*oil/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 380,
    confidence: 'high',
    notes: 'Cooking oils are packaged'
  },
  {
    id: 'CONDIMENTS_SESAME_OIL',
    pattern: /sesame\s*oil/i,
    category: 'CONDIMENTS',
    state: 'as_pack',
    method: null,
    priority: 381,
    confidence: 'high',
    notes: 'Sesame oil is packaged'
  },
  
  // Packaged/Canned items (priority 400-429)
  {
    id: 'PACKAGED_CANNED_TOMATOES',
    pattern: /canned\s*tomato|diced\s*tomato|crushed\s*tomato|tinned\s*tomato/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 400,
    confidence: 'high',
    notes: 'Canned tomatoes'
  },
  {
    id: 'PACKAGED_CANNED_CORN',
    pattern: /canned\s*corn|tinned\s*corn|creamed\s*corn/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 401,
    confidence: 'high',
    notes: 'Canned corn'
  },
  {
    id: 'PACKAGED_FROZEN_PEAS',
    pattern: /frozen\s*peas/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 402,
    confidence: 'high',
    notes: 'Frozen peas'
  },
  {
    id: 'PACKAGED_FROZEN_VEGETABLES',
    pattern: /frozen\s*(vegetable|veg|mixed\s*veg)/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 403,
    confidence: 'high',
    notes: 'Frozen vegetables'
  },
  {
    id: 'PACKAGED_STOCK',
    pattern: /stock|broth|bouillon/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 410,
    confidence: 'high',
    notes: 'Stock/broth is packaged'
  },
  {
    id: 'PACKAGED_COCONUT',
    pattern: /desiccated\s*coconut|shredded\s*coconut|coconut\s*flakes/i,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 411,
    confidence: 'high',
    notes: 'Dried coconut is packaged'
  },
  
  // Beverages (priority 430-449)
  {
    id: 'BEVERAGES_JUICE',
    pattern: /juice|orange\s*juice|apple\s*juice/i,
    category: 'BEVERAGES',
    state: 'as_pack',
    method: null,
    priority: 430,
    confidence: 'high',
    notes: 'Juice is packaged'
  },
  {
    id: 'BEVERAGES_ALMOND_MILK',
    pattern: /almond\s*milk/i,
    category: 'BEVERAGES',
    state: 'as_pack',
    method: null,
    priority: 431,
    confidence: 'high',
    notes: 'Almond milk is packaged'
  },
  {
    id: 'BEVERAGES_SOY_MILK',
    pattern: /soy\s*milk|soya\s*milk/i,
    category: 'BEVERAGES',
    state: 'as_pack',
    method: null,
    priority: 432,
    confidence: 'high',
    notes: 'Soy milk is packaged'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 900-999: Catch-all category defaults (lowest priority)
  // ═══════════════════════════════════════════════════════════════════════════
  
  {
    id: 'CATCHALL_UNMAPPED',
    pattern: /.*/,
    category: 'PACKAGED',
    state: 'as_pack',
    method: null,
    priority: 999,
    confidence: 'low',
    notes: 'Catch-all for unmapped items - defaults to as_pack'
  }
];

// Sort rules by priority (lower = higher priority)
const SORTED_RULES = [...STATE_RULES].sort((a, b) => a.priority - b.priority);

/**
 * Checks if item key contains any cooking keywords
 * 
 * @param {string} itemKey - The item key to check
 * @returns {Object|null} { keyword, method } if found, null otherwise
 */
function detectCookingKeyword(itemKey) {
  const lowerKey = itemKey.toLowerCase();
  
  for (const { keyword, method } of COOKING_KEYWORDS) {
    // Use word boundary matching to avoid false positives
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(lowerKey)) {
      return { keyword, method };
    }
  }
  
  return null;
}

/**
 * Resolves state for an item key using deterministic rules
 * 
 * @param {string} itemKey - The item key to resolve
 * @returns {Object} { state, method, confidence, ruleId, category }
 */
function resolveState(itemKey) {
  if (!itemKey || typeof itemKey !== 'string') {
    return {
      state: 'as_pack',
      method: null,
      confidence: 'low',
      ruleId: 'ERROR_INVALID_KEY',
      category: null
    };
  }
  
  const normalizedKey = itemKey.toLowerCase().trim();
  
  // STEP 1: Check for cooking keywords first (highest priority)
  const cookingMatch = detectCookingKeyword(normalizedKey);
  if (cookingMatch) {
    return {
      state: 'cooked',
      method: cookingMatch.method,
      confidence: 'high',
      ruleId: `COOKING_KEYWORD_${cookingMatch.keyword.toUpperCase().replace(/[^A-Z]/g, '_')}`,
      category: 'PREPARED'
    };
  }
  
  // STEP 2: Apply pattern rules in priority order
  for (const rule of SORTED_RULES) {
    if (rule.pattern.test(normalizedKey)) {
      return {
        state: rule.state,
        method: rule.method,
        confidence: rule.confidence,
        ruleId: rule.id,
        category: rule.category
      };
    }
  }
  
  // STEP 3: Fallback (should never reach here due to catch-all rule)
  return {
    state: 'as_pack',
    method: null,
    confidence: 'low',
    ruleId: 'FALLBACK_UNREACHABLE',
    category: 'PACKAGED'
  };
}

/**
 * Validates if a state value is valid
 * 
 * @param {string} state - State value to validate
 * @returns {boolean} True if valid
 */
function isValidState(state) {
  return VALID_STATES.includes(state);
}

/**
 * Validates if a method value is valid
 * 
 * @param {string|null} method - Method value to validate
 * @returns {boolean} True if valid
 */
function isValidMethod(method) {
  return VALID_METHODS.includes(method);
}

/**
 * Gets the category definition for a category name
 * 
 * @param {string} categoryName - Category name
 * @returns {Object|null} Category definition or null
 */
function getCategoryDefinition(categoryName) {
  return CATEGORIES[categoryName] || null;
}

/**
 * Lists all rules for a given category
 * 
 * @param {string} categoryName - Category name
 * @returns {Array} Array of rules for that category
 */
function getRulesForCategory(categoryName) {
  return SORTED_RULES.filter(rule => rule.category === categoryName);
}

/**
 * Gets statistics about rule coverage
 * 
 * @returns {Object} Statistics about rules by category
 */
function getRuleStatistics() {
  const stats = {
    totalRules: SORTED_RULES.length,
    byCategory: {},
    byConfidence: {
      high: 0,
      medium: 0,
      low: 0
    }
  };
  
  for (const rule of SORTED_RULES) {
    // Count by category
    if (!stats.byCategory[rule.category]) {
      stats.byCategory[rule.category] = 0;
    }
    stats.byCategory[rule.category]++;
    
    // Count by confidence
    stats.byConfidence[rule.confidence]++;
  }
  
  return stats;
}

/**
 * Finds rules that match a given item key (for debugging)
 * 
 * @param {string} itemKey - Item key to match
 * @returns {Array} Array of matching rules (first match will be used)
 */
function findMatchingRules(itemKey) {
  const normalizedKey = itemKey.toLowerCase().trim();
  const matches = [];
  
  // Check cooking keywords
  const cookingMatch = detectCookingKeyword(normalizedKey);
  if (cookingMatch) {
    matches.push({
      type: 'cooking_keyword',
      keyword: cookingMatch.keyword,
      method: cookingMatch.method,
      priority: -1,
      isWinner: true
    });
  }
  
  // Check pattern rules
  for (const rule of SORTED_RULES) {
    if (rule.pattern.test(normalizedKey)) {
      matches.push({
        type: 'pattern_rule',
        ruleId: rule.id,
        pattern: rule.pattern.toString(),
        priority: rule.priority,
        state: rule.state,
        isWinner: matches.length === 0 || (matches.length === 1 && !matches[0].isWinner)
      });
    }
  }
  
  return matches;
}

module.exports = {
  resolveState,
  detectCookingKeyword,
  isValidState,
  isValidMethod,
  getCategoryDefinition,
  getRulesForCategory,
  getRuleStatistics,
  findMatchingRules,
  
  // Export constants for external use
  VALID_STATES,
  VALID_METHODS,
  COOKING_KEYWORDS,
  CATEGORIES,
  STATE_RULES: SORTED_RULES
};