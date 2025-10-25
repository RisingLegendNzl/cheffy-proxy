// --- PRICE + PRODUCT DISCOVERY (Mark 44) ---
// Rewritten. The LLM does not pick filters.
// We use CID rules from canonical-ingredients.js.
//
// fetchPriceDataForCID({ cid, cidData, queries, store }, logger)
// -> { acceptedProducts: [...], rawProducts: [...] }

"use strict";

const axios = require("axios");
const { createClient } = require("@vercel/kv");

// Upstash KV client
const kv = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

function isKvConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

// RapidAPI hosts
const RAPID_API_HOSTS = {
  Coles: "coles-product-price-api.p.rapidapi.com",
  Woolworths: "woolworths-products-api.p.rapidapi.com"
};

// env var for RapidAPI key
const RAPID_API_KEY = process.env.RAPID_API_KEY || process.env.RAPIDAPI_KEY || "";

// basic token bucket rate limit per store to avoid hammering
const BUCKET_CAPACITY = 10;
const REFILL_PER_SEC = 2;

async function takeToken(bucketName) {
  if (!isKvConfigured()) return true;
  const now = Date.now();

  const key = `bucket:${bucketName}`;
  const raw = await kv.get(key);
  let state;
  if (!raw) {
    state = { tokens: BUCKET_CAPACITY - 1, lastRefill: now };
  } else {
    state = raw;
    const elapsedMs = now - state.lastRefill;
    const refill = (elapsedMs / 1000) * REFILL_PER_SEC;
    let tokens = Math.min(BUCKET_CAPACITY, state.tokens + refill);
    if (tokens < 1) {
      return false;
    }
    tokens -= 1;
    state.tokens = tokens;
    state.lastRefill = now;
  }
  await kv.set(key, state);
  return true;
}

// category + term + macro guards
function validateProductAgainstCID(product, cidData) {
  // product shape depends on RapidAPI result.
  // We'll assume:
  // {
  //    name, category, unit_price_per_100, barcode, url
  // }

  const nameLower = (product.name || product.title || "").toLowerCase();

  // category allowlist
  if (
    cidData.allowed_product_categories &&
    cidData.allowed_product_categories.length > 0
  ) {
    const cat = (product.category || "").toLowerCase();
    const okCat = cidData.allowed_product_categories.some((allowed) =>
      cat.includes(allowed.toLowerCase())
    );
    if (!okCat) return { accept: false, reason: "CAT_MISMATCH" };
  }

  // include terms
  for (const must of cidData.must_include_terms || []) {
    if (!nameLower.includes(must.toLowerCase())) {
      return { accept: false, reason: "MISSING_TERM:" + must };
    }
  }

  // exclude terms
  for (const bad of cidData.must_exclude_terms || []) {
    if (nameLower.includes(bad.toLowerCase())) {
      return { accept: false, reason: "FORBIDDEN_TERM:" + bad };
    }
  }

  return { accept: true };
}

async function fetchProductsFromRapidAPI(store, query) {
  // We infer simple GET route "search" style. Adjust to match your actual RapidAPI contract.
  // For Coles:
  //   GET https://coles-product-price-api.../search?query=chicken%20breast&page=1
  // For Woolworths similar.
  // We'll return array of { name, category, unit_price_per_100, barcode, url }.

  const host = RAPID_API_HOSTS[store];
  if (!host) {
    throw new Error(`Unsupported store ${store}`);
  }

  const tokenOk = await takeToken(`rapid:${store}`);
  if (!tokenOk) {
    throw new Error("RATE_LIMIT");
  }

  const url = `https://${host}/search`;
  const params = {
    query,
    page: 1
  };

  const resp = await axios.get(url, {
    params,
    headers: {
      "x-rapidapi-key": RAPID_API_KEY,
      "x-rapidapi-host": host
    },
    timeout: 30000
  });

  // TODO adapt mapping to match real API response.
  // For now assume resp.data.items is list.
  const items = Array.isArray(resp.data.items) ? resp.data.items : [];
  return items.map((it) => ({
    name: it.name || it.title || "",
    category: it.category || "",
    unit_price_per_100: it.unit_price_per_100 || it.unitPricePer100 || null,
    barcode: it.barcode || it.gtin || it.sku || "",
    url: it.url || it.product_url || ""
  }));
}

async function fetchPriceDataForCID({ cid, cidData, queries, store }, logger) {
  const acceptedProducts = [];
  const rawProducts = [];

  const qList = [
    queries.tightQuery,
    queries.normalQuery,
    queries.wideQuery
  ];

  for (const q of qList) {
    try {
      const prods = await fetchProductsFromRapidAPI(store, q);
      for (const p of prods) {
        rawProducts.push(p);

        // run CID validation
        const val = validateProductAgainstCID(p, cidData);
        if (!val.accept) continue;

        // create confidence score
        // start high, then penalize distance from must_include terms count etc
        let score = 1.0;

        // more terms that match -> higher
        const nmLower = (p.name || "").toLowerCase();
        let hits = 0;
        for (const w of cidData.must_include_terms || []) {
          if (nmLower.includes(w.toLowerCase())) hits += 1;
        }
        score += hits * 0.05;

        // cheaper per 100g gets small bump
        if (p.unit_price_per_100) {
          const priceNum = parseFloat(p.unit_price_per_100);
          if (!Number.isNaN(priceNum)) {
            score += (1 / (1 + priceNum)) * 0.1;
          }
        }

        acceptedProducts.push({
          ...p,
          confidenceScore: score
        });
      }
    } catch (err) {
      logger.log("WARN", "PRICE_FETCH_FAIL", `fetchProductsFromRapidAPI failed for ${cid} @ ${store}`, {
        query: q,
        error: err.message
      });
    }
  }

  // sort accepted by confidenceScore desc then price asc
  acceptedProducts.sort((a, b) => {
    const diff = (b.confidenceScore || 0) - (a.confidenceScore || 0);
    if (diff !== 0) return diff;
    const pa = parseFloat(a.unit_price_per_100 || "999999");
    const pb = parseFloat(b.unit_price_per_100 || "999999");
    return pa - pb;
  });

  return {
    acceptedProducts,
    rawProducts
  };
}

module.exports = {
  fetchPriceDataForCID
};
