/**
 * Cheffy Orchestrator
 * Shared Key Normalization Utility (CommonJS)
 *
 * Provides a single, consistent function for turning human-readable
 * ingredient names into standardized database keys.
 */

/**
 * Normalizes a string into a snake_case database key.
 * e.g., "Chicken Breast (Raw)" -> "chicken_breast_raw"
 * @param {string} name The ingredient name to normalize.
 * @returns {string} The normalized, snake_case key.
 */
function normalizeKey(name) {
  if (typeof name !== 'string' || !name) {
    return 'unknown';
  }

  let key = name.toLowerCase().trim();

  // 1. Handle simple, common synonyms first
  key = key.replace(/yoghurt/g, 'yogurt');
  key = key.replace(/%|\bpercent\b/g, 'pct');

  // 2. Handle simple plurals (with exceptions)
  if (key.endsWith('ies') && key.length > 3) {
    key = key.slice(0, -3) + 'y'; // e.g., berries -> berry
  } else if (key.endsWith('oes') && key.length > 2) {
    key = key.slice(0, -2); // e.g., tomatoes -> tomato
  } else if (
    key.endsWith('s') &&
    !key.endsWith('ss') && // avoid 'hummus' -> 'hummu'
    key !== 'oats' &&
    key !== 'hummus' &&
    key !== 'couscous' &&
    key !== 'asparagus'
  ) {
    key = key.slice(0, -1); // e.g., apples -> apple
  }

  // 3. Convert to snake_case and remove invalid characters
  return key
    .replace(/[\s&/-]+/g, '_')   // Replace spaces, ampersands, slashes, hyphens with underscore
    .replace(/[^a-z0-9_]/g, '')  // Remove any remaining non-alphanumeric_underscore characters
    .replace(/__+/g, '_');       // Collapse multiple underscores
}

module.exports = { normalizeKey };

