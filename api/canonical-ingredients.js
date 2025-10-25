// --- CANONICAL INGREDIENT DICTIONARY (CID) ---
// Mark 44: All supermarket search + nutrition validation must flow through this.
// The LLM does NOT get to invent requiredWords, negativeKeywords, etc.

"use strict";

///   CID-REGISTRY-START   \\\\
// Each entry defines semantic expectations for an ingredient class.

const CID_REGISTRY = {
  "chicken_breast_raw_skinless": {
    display_name: "Chicken Breast Fillet (Raw, Skinless)",
    category: "Protein > Chicken Breast",
    allowed_product_categories: [
      "Meat & Seafood > Chicken Breast Fillets",
      "Meat > Chicken Breast"
    ],
    must_include_terms: ["chicken", "breast", "fillet"],
    must_exclude_terms: [
      "crumb",
      "crumbed",
      "schnitzel",
      "tender",
      "kiev",
      "marinated",
      "sauce",
      "cacciatore",
      "seasoned",
      "ready meal",
      "soup"
    ],
    expected_macros_per_100g: {
      calories_kcal: 110,
      protein_g: 22,
      fat_g: 2,
      carbs_g: 0
    },
    typical_pack_sizes_g: [500, 1000]
  },

  "white_rice_cooked": {
    display_name: "Cooked White Rice",
    category: "Carb > Rice",
    allowed_product_categories: [
      "Rice > White Rice",
      "Grains & Rice > White Rice",
      "Microwave Rice"
    ],
    must_include_terms: ["white", "rice"],
    must_exclude_terms: [
      "fried",
      "sauce",
      "flavoured",
      "flavored",
      "butter",
      "curry",
      "sushi"
    ],
    expected_macros_per_100g: {
      calories_kcal: 130,
      protein_g: 2.5,
      fat_g: 0.3,
      carbs_g: 28
    },
    typical_pack_sizes_g: [250, 500]
  },

  "olive_oil": {
    display_name: "Olive Oil",
    category: "Fat > Oil",
    allowed_product_categories: [
      "Pantry > Olive Oil",
      "Oil & Vinegar > Olive Oil"
    ],
    must_include_terms: ["olive", "oil"],
    must_exclude_terms: [
      "spray",
      "blend",
      "canola",
      "garlic",
      "infused",
      "spread"
    ],
    expected_macros_per_100g: {
      calories_kcal: 884,
      protein_g: 0,
      fat_g: 100,
      carbs_g: 0
    },
    typical_pack_sizes_g: [250, 500, 1000]
  },

  "broccoli_raw": {
    display_name: "Broccoli (Raw/Fresh)",
    category: "Veg > Greens",
    allowed_product_categories: [
      "Fresh Vegetables > Broccoli"
    ],
    must_include_terms: ["broccoli"],
    must_exclude_terms: [
      "soup",
      "packaged meal",
      "sauce"
    ],
    expected_macros_per_100g: {
      calories_kcal: 34,
      protein_g: 3,
      fat_g: 0.4,
      carbs_g: 7
    },
    typical_pack_sizes_g: [200, 500]
  },

  "rolled_oats": {
    display_name: "Rolled Oats",
    category: "Carb > Oats",
    allowed_product_categories: [
      "Pantry > Oats",
      "Breakfast Cereal > Oats"
    ],
    must_include_terms: ["rolled", "oats"],
    must_exclude_terms: [
      "protein bar",
      "muesli",
      "granola",
      "flavoured",
      "flavored",
      "sachet"
    ],
    expected_macros_per_100g: {
      calories_kcal: 380,
      protein_g: 13,
      fat_g: 7,
      carbs_g: 60
    },
    typical_pack_sizes_g: [750, 1000]
  },

  "whey_protein_powder": {
    display_name: "Whey Protein Powder",
    category: "Supp > Whey",
    allowed_product_categories: [
      "Supplement > Whey Protein",
      "Sports Nutrition > Whey"
    ],
    must_include_terms: ["whey", "protein"],
    must_exclude_terms: [
      "plant",
      "vegan",
      "collagen",
      "clear",
      "mass gainer",
      "ready to drink",
      "rt d",
      "rtd",
      "water"
    ],
    expected_macros_per_100g: {
      calories_kcal: 400,
      protein_g: 80,
      fat_g: 7,
      carbs_g: 7
    },
    typical_pack_sizes_g: [500, 1000]
  },

  "banana_raw": {
    display_name: "Banana",
    category: "Fruit > Banana",
    allowed_product_categories: [
      "Fresh Fruit > Bananas"
    ],
    must_include_terms: ["banana"],
    must_exclude_terms: ["chips", "dried", "puree", "custard"],
    expected_macros_per_100g: {
      calories_kcal: 89,
      protein_g: 1.1,
      fat_g: 0.3,
      carbs_g: 23
    },
    typical_pack_sizes_g: [1000]
  },

  "peanut_butter": {
    display_name: "Peanut Butter",
    category: "Fat > Nut Butter",
    allowed_product_categories: [
      "Peanut Butter",
      "Nut Butters"
    ],
    must_include_terms: ["peanut", "butter"],
    must_exclude_terms: [
      "reduced fat spread",
      "sauce",
      "satay sauce",
      "dressing"
    ],
    expected_macros_per_100g: {
      calories_kcal: 589,
      protein_g: 25,
      fat_g: 50,
      carbs_g: 20
    },
    typical_pack_sizes_g: [375, 500]
  },

  "greek_yogurt_low_fat": {
    display_name: "Greek Yogurt (Low Fat)",
    category: "Dairy > Yogurt",
    allowed_product_categories: [
      "Yogurt > Greek Yogurt",
      "Dairy > Greek Yogurt"
    ],
    must_include_terms: ["greek", "yogurt"],
    must_exclude_terms: [
      "dessert",
      "custard",
      "ice cream",
      "cream",
      "honey",
      "coconut",
      "blueberry",
      "mango",
      "vanilla"
    ],
    expected_macros_per_100g: {
      calories_kcal: 60,
      protein_g: 10,
      fat_g: 1,
      carbs_g: 4
    },
    typical_pack_sizes_g: [170, 500, 900]
  },

  "blueberries": {
    display_name: "Blueberries",
    category: "Fruit > Berries",
    allowed_product_categories: [
      "Fresh Fruit > Berries",
      "Frozen Fruit > Berries"
    ],
    must_include_terms: ["blueberries", "blueberry"],
    must_exclude_terms: [
      "jam",
      "yogurt",
      "topping",
      "syrup"
    ],
    expected_macros_per_100g: {
      calories_kcal: 57,
      protein_g: 0.7,
      fat_g: 0.3,
      carbs_g: 14
    },
    typical_pack_sizes_g: [125, 500]
  },

  "honey": {
    display_name: "Honey",
    category: "Carb > Sugar",
    allowed_product_categories: [
      "Pantry > Honey",
      "Sweeteners > Honey"
    ],
    must_include_terms: ["honey"],
    must_exclude_terms: [
      "sauce",
      "mustard",
      "bbq",
      "marinade"
    ],
    expected_macros_per_100g: {
      calories_kcal: 304,
      protein_g: 0.3,
      fat_g: 0,
      carbs_g: 82
    },
    typical_pack_sizes_g: [250, 500]
  }
};

///   CID-REGISTRY-END   \\\\



///   MAP-HELPERS-START   \\\\
// crude text matching from ingredient name -> CID key.
// In production you should write a better resolver or table map.

function guessCIDFromName(nameLower) {
  if (nameLower.includes("chicken breast")) return "chicken_breast_raw_skinless";
  if (nameLower.includes("breast fillet")) return "chicken_breast_raw_skinless";

  if (nameLower.includes("white rice")) return "white_rice_cooked";
  if (nameLower.includes("rice")) return "white_rice_cooked";

  if (nameLower.includes("olive oil")) return "olive_oil";

  if (nameLower.includes("broccoli")) return "broccoli_raw";

  if (nameLower.includes("rolled oats")) return "rolled_oats";
  if (nameLower.includes("oats")) return "rolled_oats";

  if (nameLower.includes("whey")) return "whey_protein_powder";
  if (nameLower.includes("protein powder")) return "whey_protein_powder";

  if (nameLower.includes("banana")) return "banana_raw";

  if (nameLower.includes("peanut butter")) return "peanut_butter";

  if (
    nameLower.includes("greek") &&
    nameLower.includes("yogurt")
  ) return "greek_yogurt_low_fat";

  if (nameLower.includes("blueberries")) return "blueberries";
  if (nameLower.includes("blueberry")) return "blueberries";

  if (nameLower.includes("honey")) return "honey";

  return null;
}

// mapIngredientsToCID([{name, gramsUsed}]) -> array with canonical_id added
function mapIngredientsToCID(ingredients, logger) {
  return ingredients.map((ing) => {
    const guess = guessCIDFromName((ing.name || "").toLowerCase().trim());
    if (!guess) {
      logger.log("WARN", "CID_GUESS_FAIL", `No CID guess for "${ing.name}"`);
      return {
        ...ing,
        canonical_id: null
      };
    }
    return {
      ...ing,
      canonical_id: guess
    };
  });
}

///   MAP-HELPERS-END   \\\\



///   QUERY-BUILDER-START   \\\\
// buildQueriesForCID(cidData, "Coles") -> { tightQuery, normalQuery, wideQuery, filters }

function buildQueriesForCID(cidData, storeName) {
  // We don't trust the LLM here. Everything comes from CID.
  // The UI currently distinguishes tight/normal/wide.

  const coreWords = cidData.must_include_terms.join(" ");
  const tightQuery = `${storeName} ${coreWords}`; // highest specificity
  const normalQuery = `${storeName} ${cidData.must_include_terms.slice(0, 2).join(" ")}`;
  const wideQuery = `${storeName} ${cidData.must_include_terms[0]}`;

  return {
    tightQuery,
    normalQuery,
    wideQuery,
    must_include_terms: cidData.must_include_terms,
    must_exclude_terms: cidData.must_exclude_terms,
    allowed_categories: cidData.allowed_product_categories
  };
}

///   QUERY-BUILDER-END   \\\\



///   FINGERPRINT-START   \\\\
function getExpectedMacroFingerprint(cidData) {
  return cidData.expected_macros_per_100g;
}
///   FINGERPRINT-END   \\\\



module.exports = {
  CID_REGISTRY,
  mapIngredientsToCID,
  buildQueriesForCID,
  getExpectedMacroFingerprint
};
