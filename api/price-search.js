// api/price-search.js
// Rate-limit safe RapidAPI proxy with caching and query normalization
// Env: RAPIDAPI_KEY, COLES_HOST, WOOLWORTHS_HOST

const axios = require("axios");

// ---------- CORS ----------
const cors = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
};

// ---------- In-memory cache (per lambda instance) ----------
const CACHE = global.__priceCache || (global.__priceCache = new Map());
const TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCache(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { CACHE.delete(key); return null; }
  return hit.data;
}
function setCache(key, data) { CACHE.set(key, { data, exp: Date.now() + TTL_MS }); }

// ---------- Utils ----------
const str = v => (v == null ? "" : String(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeQuery(q) {
  // Remove pack sizes for fresh produce to reduce duplicate queries
  const cleaned = str(q).toLowerCase().replace(/\b(\d+(?:\.\d+)?)(?:\s*)(g|kg|ml|l)\b/g, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || str(q).trim();
}

function mapProduct(raw) {
  // Map RapidAPI store result to unified output
  const name = str(raw.name || raw.product_name || raw.title);
  const brand = str(raw.brand || raw.product_brand || raw.manufacturer);
  const price = Number(raw.price || raw.current_price || raw.sale_price || raw.unit_price);
  const size  = str(raw.size || raw.product_size || raw.pack_size || raw.net_content);
  const url   = str(raw.url || raw.link || raw.product_url);
  const barcode = str(raw.barcode || raw.ean || raw.gtin);
  if (!name || !brand || !url || !Number.isFinite(price) || price <= 0) return null;
  return { name, brand, price: Number(price.toFixed(2)), size, url, ...(barcode ? { barcode } : {}) };
}

function axiosConfigForStore(store, query) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("RAPIDAPI_KEY missing");

  if (store === "Coles") {
    const host = process.env.COLES_HOST; // e.g., 'coles2.p.rapidapi.com'
    const url = `https://${host}/products/search`;
    return {
      method: "GET",
      url,
      params: { q: query, page: 1 },
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": host }
    };
  }
  if (store === "Woolworths") {
    const host = process.env.WOOLWORTHS_HOST; // e.g., 'woolworths.p.rapidapi.com'
    const url = `https://${host}/products/search`;
    return {
      method: "GET",
      url,
      params: { q: query, page: 1 },
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": host }
    };
  }
  throw new Error(`Unsupported store: ${store}`);
}

function isTransient(err) {
  const s = err.response?.status;
  return s === 408 || s === 429 || (s >= 500 && s < 600) || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
}

async function withRateLimitRetry(config, logs, max = 4) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      logs && logs.push({ level: "INFO", tag: "HTTP", timestamp: new Date().toISOString(), message: `GET ${config.url}`, data: { params: config.params } });
      const res = await axios({ ...config, timeout: 12000 });
      logs && logs.push({ level: "SUCCESS", tag: "HTTP", timestamp: new Date().toISOString(), message: `${res.status} ${config.url}` });
      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const ra = Number(err.response?.headers?.["retry-after"]) * 1000;
      const backoff = Math.min(2000 * Math.pow(2, i), 12000); // 2s,4s,8s,12s
      const jitter = Math.floor(Math.random() * 400);
      const waitMs = status === 429 && ra ? ra : backoff + jitter;
      logs && logs.push({ level: i < max - 1 ? "WARN" : "CRITICAL", tag: "HTTP", timestamp: new Date().toISOString(), message: `RapidAPI error ${status || err.code} — retrying in ${waitMs}ms` });
      if (!isTransient(err) || i === max - 1) break;
      await sleep(waitMs);
      continue;
    }
  }
  throw lastErr;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const store = str(req.query.store || "Woolworths");
  const rawQuery = str(req.query.query || "");
  const query = normalizeQuery(rawQuery);
  const cacheKey = `${store}|${query}`;

  try {
    // Cache first
    const cached = getCache(cacheKey);
    if (cached) return res.status(200).json({ cached: true, products: cached });

    // Build request
    const config = axiosConfigForStore(store, query);

    // Call RapidAPI with retry
    const data = await withRateLimitRetry(config);

    // Map results to unified structure
    const rawList = data?.products || data?.items || data?.data || [];
    const products = (Array.isArray(rawList) ? rawList : []).map(mapProduct).filter(Boolean);

    // Save and return
    setCache(cacheKey, products);
    return res.status(200).json({ cached: false, products });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg = err.response?.data || err.message || "unknown_error";

    // If rate limited, try soft fallback: return last cached similar query if any
    if (status === 429) {
      // try loosening the query once (e.g., drop adjectives)
      const loose = normalizeQuery(query.split(/\s+/).slice(0, 2).join(" "));
      const alt = getCache(`${store}|${loose}`);
      if (alt) return res.status(200).json({ cached: true, products: alt, note: "returned cached fallback due to 429" });
    }

    return res.status(status).json({ error: "rapidapi_error", detail: msg, status });
  }
};
