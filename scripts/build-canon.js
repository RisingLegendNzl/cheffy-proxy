/**
 * Cheffy Canonical DB Build Script
 *
 * This script runs at build time (via `npm run prebuild`).
 * It reads all raw data files from /Data/CanonicalNutrition/,
 * cleans and parses them, transforms them to the final schema (Plan A),
 * runs sanity checks, and generates a single, fast CommonJS module
 * at /api/_canon.js for in-memory lookups.
 */

const fs = require('fs');
const path = require('path');
const { normalizeKey } = require('./normalize.js'); // Use shared normalizer

// --- [FIX] Use __dirname for robust pathing in Vercel's build environment ---
// __dirname is the directory this script is in (e.g., /project/scripts)
const PROJECT_ROOT = path.join(__dirname, '..'); // Go up one level to the project root
const DATA_DIR = path.join(PROJECT_ROOT, 'Data', 'CanonicalNutrition');
const API_DIR = path.join(PROJECT_ROOT, 'api');
// --- [END FIX] ---

const MANIFEST_FILE = 'manifest.json';
const OUTPUT_MODULE_FILE = '_canon.js';
const OUTPUT_MANIFEST_FILE = '_canon.manifest.json';

/**
 * Cleans header/footer text and parses *all* JSON arrays from a file.
 * @param {string} content - Raw file content.
 * @returns {Array} - A single, merged array of all items found.
 */
function cleanAndParseJson(content) {
  // 1. Clean headers/footers (e.g., "———-Produce-Start————-")
  const cleanedContent = content.replace(/———-.*?———-|\(.*\)/g, '');

  // 2. Find all occurrences of JSON arrays (text blocks starting with '[' and ending with ']')
  const jsonMatches = cleanedContent.match(/\[.*?\]/gs); // 'g' for global, 's' for dotall

  if (!jsonMatches || jsonMatches.length === 0) {
    console.warn('  -> No JSON arrays found in file.');
    return [];
  }

  // 3. Parse each match and concatenate
  let allEntries = [];
  for (const match of jsonMatches) {
    try {
      const parsedArray = JSON.parse(match);
      if (Array.isArray(parsedArray)) {
        allEntries = allEntries.concat(parsedArray);
      }
    } catch (e) {
      console.warn(
        `  -> Found a JSON-like block but failed to parse: ${e.message}`
      );
      console.warn(
        `  -> Block (first 100 chars): ${match.substring(0, 100)}...`
      );
    }
  }

  return allEntries;
}

/**
 * Runs sanity checks on a single transformed CanonRow.
 * @param {object} item - The transformed item (CanonRow schema).
 * @param {Array<string>} warnings - An array to push warnings into.
 */
function runSanityChecks(item, warnings) {
  const {
    key,
    kcal_per_100g: kcal,
    protein_g_per_100g: p,
    fat_g_per_100g: f,
    carb_g_per_100g: c,
    fiber_g_per_100g: fiber,
  } = item;

  // 1. Calorie balance check (±12%)
  const estimatedKcal = p * 4 + c * 4 + f * 9;
  if (kcal > 0.1 && Math.abs(kcal - estimatedKcal) / kcal > 0.12) {
    warnings.push(
      `[${key}] Calorie mismatch: Stated ${kcal} kcal, but P/F/C calculates to ${estimatedKcal.toFixed(
        0
      )} kcal.`
    );
  }

  // 2. Fiber check
  if (fiber > c) {
    warnings.push(
      `[${key}] Fiber > Carbs: Fiber ${fiber}g, Carbs ${c}g. (Note: This is common for high-fiber, low-carb items)`
    );
  }
}

/**
 * Main build function.
 */
async function run() {
  console.log('[build-canon] Starting build...');
  let canonVersion = '0.0.0-dev';
  let filesToProcess = [];
  const allEntries = [];
  const warnings = [];
  const categoryCounts = {};

  // 1. Read Manifest
  try {
    const manifestPath = path.join(DATA_DIR, MANIFEST_FILE);
    console.log(`[build-canon] Reading manifest from: ${manifestPath}`);
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    canonVersion = manifest.canon_version || canonVersion; // Match key in manifest.json
    filesToProcess = manifest.source_files || []; // Match key in manifest.json
    console.log(
      `[build-canon] Loaded manifest version ${canonVersion}. Found ${filesToProcess.length} files.`
    );
  } catch (e) {
    console.error(
      `[build-canon] CRITICAL: Could not read or parse manifest.json: ${e.message}`
    );
    console.error(`[build-canon] Data directory path was: ${DATA_DIR}`);
    process.exit(1);
  }

  // 2. Read and Parse All Files
  for (const fileName of filesToProcess) {
    const filePath = path.join(DATA_DIR, fileName);
    console.log(`[build-canon] Processing file: ${filePath}`);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');

      // Use new robust parser
      const entries = cleanAndParseJson(fileContent);

      if (entries.length > 0) {
        console.log(`  -> Parsed ${entries.length} entries.`);
        allEntries.push(...entries);
      }
    } catch (e) {
      warnings.push(`Failed to read file ${fileName}: ${e.message}`);
    }
  }
  console.log(`[build-canon] Total raw entries found: ${allEntries.length}`);

  // 3. Transform, Normalize, and De-duplicate
  const CANON = {};
  const duplicates = [];

  for (const item of allEntries) {
    if (!item.name) {
      warnings.push(
        `Skipping item with no 'name' field: ${JSON.stringify(item)}`
      );
      continue;
    }

    const key = normalizeKey(item.name);
    if (CANON[key]) {
      duplicates.push(
        `Duplicate key '${key}' (from '${item.name}'). '${CANON[key].name}' won.`
      );
      continue;
    }

    // --- [Plan A] Transform Schema ---
    const canonItem = {
      key: key,
      name: item.display_name || item.name,
      category: item.category || 'misc',
      state: item.state || 'raw',

      kcal_per_100g: item.energy_kcal || 0,
      protein_g_per_100g: item.protein_g || 0,
      fat_g_per_100g: item.fat_g || 0,
      carb_g_per_100g: item.carbs_g || 0,
      fiber_g_per_100g: item.fiber_g || 0,

      source: item.source || 'unknown',
      notes: item.notes || '',
      fallback_source: item.fallback_source || null,
    };
    // --- End Transform ---

    runSanityChecks(canonItem, warnings);

    CANON[key] = canonItem;
    categoryCounts[canonItem.category] =
      (categoryCounts[canonItem.category] || 0) + 1;
  }

  const totalItems = Object.keys(CANON).length;
  console.log(`[build-canon] Processed ${totalItems} unique items.`);
  if (duplicates.length > 0) {
    warnings.push(...duplicates);
  }

  // 4. Generate Output Module (CommonJS format)
  const sortedKeys = Object.keys(CANON).sort();
  const sortedCanon = {};
  sortedKeys.forEach((key) => {
    sortedCanon[key] = CANON[key];
  });

  const outputContent = `
/**
 * AUTO-GENERATED FILE (Do not edit)
 * Source: /Data/CanonicalNutrition/
 * Version: ${canonVersion}
 * Built: ${new Date().toISOString()}
 * Total Items: ${totalItems}
 */

const CANON_VERSION = "${canonVersion}";

const CANON = ${JSON.stringify(sortedCanon, null, 2)};

/**
 * Gets a canonical nutrition item by its normalized key.
 * @param {string} key - The normalized key (e.g., "chicken_breast")
 * @returns {object | null} The canonical item or null if not found.
 */
function canonGet(key) {
  return CANON[key] || null;
}

module.exports = {
  CANON_VERSION,
  CANON,
  canonGet
};
`;

  // 5. Generate Output Manifest
  const manifestData = {
    version: canonVersion,
    builtAt: new Date().toISOString(),
    totalItems: totalItems,
    categories: categoryCounts,
    warnings: warnings,
    duplicateKeysFound: duplicates.length,
  };

  // 6. Write Files
  try {
    // Ensure API directory exists
    if (!fs.existsSync(API_DIR)) {
      fs.mkdirSync(API_DIR, { recursive: true });
    }
    
    const modulePath = path.join(API_DIR, OUTPUT_MODULE_FILE);
    fs.writeFileSync(modulePath, outputContent);
    console.log(`[build-canon] Successfully wrote module to ${modulePath}`);

    // --- [FIX] Renamed second 'manifestPath' variable ---
    const outputManifestPath = path.join(API_DIR, OUTPUT_MANIFEST_FILE);
    fs.writeFileSync(outputManifestPath, JSON.stringify(manifestData, null, 2));
    console.log(
      `[build-canon] Successfully wrote manifest to ${outputManifestPath}`
    );
    // --- End Fix ---

    console.log('[build-canon] Build complete!');
  } catch (e) {
    console.error(
      `[build-canon] CRITICAL: Failed to write output files: ${e.message}`
    );
    process.exit(1);
  }
}

// Run the script
run();

