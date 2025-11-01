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
// [MODIFIED] Use the normalize script from its correct location
const { normalizeKey } = require('./normalize.js'); // Use shared normalizer

// --- [FIX] Use __dirname to create reliable paths ---
// __dirname is the directory of the *current script* (e.g., /vercel/path/scripts)
const SCRIPT_DIR = __dirname;
// Project root is one level up (e.g., /vercel/path)
const PROJECT_ROOT = path.join(SCRIPT_DIR, '..');

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
  // [FIX] Also remove single-line JS comments
  const cleanedContent = content.replace(/———-.*?———-|\(.*\)/g, '').replace(/\/\/.*/g, '');

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
      // This is a WARNING, not an ERROR. We log it and continue.
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
  console.log('=======================================');
  console.log('[build-canon] SCRIPT EXECUTION STARTED');
  console.log('=======================================');
  console.log(`[build-canon] Node.js CWD: ${process.cwd()}`);
  console.log(`[build-canon] __dirname (SCRIPT_DIR): ${SCRIPT_DIR}`);
  console.log(`[build-canon] Resolved PROJECT_ROOT: ${PROJECT_ROOT}`);
  console.log(`[build-canon] Resolved DATA_DIR: ${DATA_DIR}`);
  console.log(`[build-canon] Resolved API_DIR: ${API_DIR}`);

  // --- [FIX] Declare all variables in the outer scope, *before* the try block ---
  let manifestData = {
    version: '0.0.0-error',
    builtAt: new Date().toISOString(),
    totalItems: 0,
    categories: {},
    warnings: ['Build script failed during initialization'],
    duplicateKeysFound: 0,
  };
  let canonVersion = '0.0.0-dev';
  let filesToProcess = [];
  const allEntries = [];
  const warnings = [];
  const categoryCounts = {};
  let totalItems = 0;
  let duplicates = [];
  // --- [END FIX] ---

  try {
    // 1. Read Manifest
    const manifestPath = path.join(DATA_DIR, MANIFEST_FILE);
    console.log(`[build-canon] Reading manifest from: ${manifestPath}`);
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    canonVersion = manifest.canon_version || canonVersion;
    filesToProcess = manifest.source_files || [];

    console.log(
      `[build-canon] Manifest OK. Version ${canonVersion}. Found ${filesToProcess.length} files.`
    );
    console.log(`[build-canon] Reading source data files...`);

    // 2. Read and Parse All Files
    for (const fileName of filesToProcess) {
      const filePath = path.join(DATA_DIR, fileName);
      console.log(`[build-canon] Processing file: ${fileName}`);
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const entries = cleanAndParseJson(fileContent);

        if (entries.length > 0) {
          console.log(`  -> Parsed ${entries.length} entries from ${fileName}.`);
          allEntries.push(...entries);
        }
      } catch (e) {
        warnings.push(`Failed to read file ${fileName}: ${e.message}`);
      }
    }
    console.log(`[build-canon] Total raw entries aggregated: ${allEntries.length}`);

    // 3. Transform, Normalize, and De-duplicate
    console.log('[build-canon] Normalizing and transforming entries...');
    const CANON = {};
    duplicates = []; // Assign to outer scope var

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

    totalItems = Object.keys(CANON).length; // Assign to outer scope var
    console.log(`[build-canon] Processed ${totalItems} unique items.`);

    // 4. Generate Output Module (CommonJS format)
    console.log('[build-canon] Generating module content...');
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

    if (duplicates.length > 0) {
      console.log(`[build-canon] Found ${duplicates.length} duplicate keys. See manifest for details.`);
      warnings.push(...duplicates);
    }

    // 5. Generate Output Manifest
    console.log('[build-canon] Generating build manifest...');
    // --- [FIX] Assign to the outer-scoped variable ---
    manifestData = {
      version: canonVersion,
      builtAt: new Date().toISOString(),
      totalItems: totalItems,
      categories: categoryCounts,
      warnings: warnings,
      duplicateKeysFound: duplicates.length,
    };
    // --- [END FIX] ---

    // 6. Write Files
    // Create api directory if it doesn't exist
    if (!fs.existsSync(API_DIR)) {
      console.log(`[build-canon] API directory not found. Creating: ${API_DIR}`);
      fs.mkdirSync(API_DIR, { recursive: true });
    }

    const modulePath = path.join(API_DIR, OUTPUT_MODULE_FILE);
    fs.writeFileSync(modulePath, outputContent);
    console.log(`[build-canon] Successfully wrote module to ${modulePath}`);

    const outputManifestPath = path.join(API_DIR, OUTPUT_MANIFEST_FILE);
    fs.writeFileSync(outputManifestPath, JSON.stringify(manifestData, null, 2));
    console.log(
      `[build-canon] Successfully wrote manifest to ${outputManifestPath}`
    );

    console.log('=========================================');
    console.log('[build-canon] SCRIPT EXECUTION SUCCEEDED');
    console.log('=========================================');
  } catch (e) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[build-canon] SCRIPT EXECUTION FAILED');
    console.error(e); // This will print the error

    // --- [FIX] Write a failure manifest using the outer-scoped variable ---
    warnings.push(`FATAL BUILD ERROR: ${e.message}`);
    // Check if manifestData is still at its initial error state or was populated
    if (manifestData.totalItems === 0) {
        manifestData.warnings = warnings;
    } else {
        // If error happened after parsing, we can still provide some data
        manifestData = {
           ...manifestData,
           warnings: warnings,
           builtAt: new Date().toISOString(),
        };
    }
    
    try {
      const outputManifestPath = path.join(API_DIR, OUTPUT_MANIFEST_FILE);
      // We are *guaranteed* manifestData is initialized now.
      fs.writeFileSync(outputManifestPath, JSON.stringify(manifestData, null, 2));
      console.log('[build-canon] Wrote failure manifest.');
    } catch (writeError) {
      console.error('[build-canon] Could not even write failure manifest.', writeError);
    }
    // --- [END FIX] ---

    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    process.exit(1); // Fail the build
  }
}

// Run the script
run();


