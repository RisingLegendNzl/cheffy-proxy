// --- NUTRITION LOOKUP + MACRO FINGERPRINT CHECK (Mark 44) ---
// For each chosen SKU we pull nutrition per 100g.
// Then we compare with CID.expected_macros_per_100g to reject mismatches.
//
// fetchNutritionForProduct(product, expectedFingerprint, logger)
// -> { nutritionPer100g: {...}, reject: boolean }

"use strict";

const fetch = require("node-fetch");
const { createClient } = require("@vercel/kv");

const kv = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

function isKvConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

// cache key helper
function cacheKeyForBarcode(barcode) {
  return `nutri:${barcode}`;
}

// naive cache ttl
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

async function getCachedNutrition(barcode) {
  if (!isKvConfigured()) return null;
  const raw = await kv.get(cacheKeyForBarcode(barcode));
  if (!raw) return null;
  const age = Date.now() - (raw.ts || 0);
  if (age > TTL_MS) return null;
  return raw.data;
}

async function setCachedNutrition(barcode, data) {
  if (!isKvConfigured()) return;
  await kv.set(cacheKeyForBarcode(barcode), {
    ts: Date.now(),
    data
  });
}

// Pull nutrition
async function fetchNutritionFromAPI(product) {
  // We assume we can query Open Food Facts or supermarket nutrition by barcode or name.
  // We'll try barcode first.
  // You already have this logic in Mark 43, including kcal-from-kJ fallback.
  // Re-implement simplified version.

  const barcode = product.barcode || product.gtin || product.sku || "";
  if (!barcode) {
    return null;
  }

  // try cache
  const cached = await getCachedNutrition(barcode);
  if (cached) return cached;

  // Open Food Facts style endpoint
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;

  const resp = await fetch(url, { timeout: 15000 });
  if (!resp.ok) {
    return null;
  }
  const data = await resp.json();
  if (!data || !data.product || !data.product.nutriments) {
    return null;
  }

  const n = data.product.nutriments;

  // kcal may be missing so derive from kJ if needed
  let kcal100 = parseFloat(n["energy-kcal_100g"] || 0);
  if (!kcal100 || kcal100 === 0) {
    const kj100 = parseFloat(n["energy-kj_100g"] || 0);
    if (kj100 && kj100 > 0) {
      kcal100 = kj100 / 4.184; // kJ -> kcal conversion
    }
  }

  const nutritionPer100g = {
    calories_kcal: kcal100 || 0,
    protein_g: parseFloat(n["proteins_100g"] || n["protein_100g"] || 0),
    fat_g: parseFloat(n["fat_100g"] || 0),
    carbs_g: parseFloat(n["carbohydrates_100g"] || n["carbs_100g"] || 0)
  };

  // write cache
  await setCachedNutrition(barcode, nutritionPer100g);

  return nutritionPer100g;
}

// Fingerprint check
function macroFingerprintAccept(nutritionPer100g, expectedFingerprint) {
  // expectedFingerprint example:
  // { calories_kcal:110, protein_g:22, fat_g:2, carbs_g:0 }
  //
  // We allow loose tolerance because products vary but same food class should be close.
  //
  // Heuristics:
  // - protein within +/-30%
  // - fat cannot exceed 3x expected
  // - carbs cannot exceed expected+5g if expected is ~0
  // - calories within +/-40%
  //
  // Tweak as needed.

  function pctDiff(a, b) {
    if (b === 0) return Math.abs(a) < 1e-9 ? 0 : 999;
    return Math.abs(a - b) / b;
  }

  // protein check
  const protDiff = pctDiff(nutritionPer100g.protein_g, expectedFingerprint.protein_g);
  if (protDiff > 0.30) return false;

  // fat check
  if (nutritionPer100g.fat_g > expectedFingerprint.fat_g * 3.0 + 1) {
    return false;
  }

  // carbs check
  if (expectedFingerprint.carbs_g < 2) {
    if (nutritionPer100g.carbs_g > expectedFingerprint.carbs_g + 5) {
      return false;
    }
  }

  // calories check
  const calDiff = pctDiff(nutritionPer100g.calories_kcal, expectedFingerprint.calories_kcal);
  if (calDiff > 0.40) return false;

  return true;
}

// exported main
async function fetchNutritionForProduct(product, expectedFingerprint, logger) {
  try {
    const nutri100 = await fetchNutritionFromAPI(product);
    if (!nutri100) {
      logger.log("WARN", "NUTRI_LOOKUP_FAIL", "No nutrition found", {
        productName: product.name || product.title || ""
      });
      return { reject: true };
    }

    const accept = macroFingerprintAccept(nutri100, expectedFingerprint);
    if (!accept) {
      logger.log("WARN", "FINGERPRINT_REJECT", "Macro mismatch vs CID expected", {
        productName: product.name || product.title || "",
        nutri100,
        expectedFingerprint
      });
      return { reject: true };
    }

    return {
      reject: false,
      nutritionPer100g: nutri100
    };
  } catch (err) {
    logger.log("ERROR", "NUTRI_EXCEPTION", "fetchNutritionForProduct threw", {
      message: err.message
    });
    return { reject: true };
  }
}

module.exports = {
  fetchNutritionForProduct
};
