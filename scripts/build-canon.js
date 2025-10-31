/**
 * Cheffy Orchestrator - Canonical DB Build Script
 *
 * This script runs at build time (e.g., Vercel 'prebuild') to:
 * 1. Read all raw canonical nutrition files from /Data/CanonicalNutrition/.
 * 2. Normalize and de-duplicate item keys using the shared normalizer.
 * 3. Transform the data from the "authoring" schema (e.g., `energy_kcal`)
 * to the "runtime" schema (e.g., `kcal_per_100g`).
 * 4. Perform sanity checks (Kcal vs Macros, Fiber vs Carbs).
 * 5. Generate `api/_canon.js` - A single, fast, in-memory JS module.
 * 6. Generate `api/_canon.manifest.json` - A summary of the build with stats and warnings.
 *
 * This script uses CommonJS (`require`/`module.exports`) to match the
 * existing Node.js environment in the `api/` functions.
 */

const fs = require('fs');
const path = require('path');
const { normalizeKey } = require('./normalize.js'); // Shared normalizer

// --- File Paths ---
// Root directory of the project
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(PROJECT_ROOT, 'Data', 'CanonicalNutrition');
const API_DIR = path.resolve(PROJECT_ROOT, 'api');
const MANIFEST_PATH = path.resolve(DATA_DIR, 'manifest.json');

// --- Output Files ---
// We generate a .js (CommonJS) file for compatibility with other api/ files.
const OUTPUT_MODULE_PATH = path.resolve(API_DIR, '_canon.js');
const OUTPUT_MANIFEST_PATH = path.resolve(API_DIR, '_canon.manifest.json');

/**
 * Performs a sanity check on macro vs calorie claims.
 * @param {object} row - The CanonRow object.
 * @returns {string|null} An error message if sanity check fails, else null.
 */
function sanityCheck(row) {
  const p = row.protein_g_per_100g;
  const f = row.fat_g_per_100g;
  const c = row.carb_g_per_100g;
  const kcal = row.kcal_per_100g;
  const fiber = row.fiber_g_per_100g;

  // 1. Check if fiber is greater than carbs
  if (c > 0 && fiber > c) {
    return `Fiber (${fiber}g) exceeds carbs (${c}g).`;
  }

  // 2. Check calorie calculation
  const estimatedKcal = p * 4 + f * 9 + c * 4;
  if (kcal > 0 && estimatedKcal > 0) {
    const deviation = Math.abs(kcal - estimatedKcal) / kcal;
    if (deviation > 0.12) { // 12% tolerance
      return `Kcal (${kcal}) deviates >12% from macros (Est: ${estimatedKcal.toFixed(0)}).`;
    }
  }
  return null;
}

/**
 * Parses the raw text content of a data file, which may contain
 * multiple JSON arrays and markers.
 * @param {string} fileContent - The raw text from the file.
 * @returns {Array<object>} A flattened array of all items found.
 */
function parseDataFileContent(fileContent) {
  const allItems = [];
  // Regex to find all [..._] blocks, even if separated by other text
  const jsonRegex = /\[[\s\S]*?\]/g;
  const matches = fileContent.match(jsonRegex);

  if (!matches) {
    throw new Error('No valid JSON arrays [...] found in the file.');
  }

  matches.forEach(block => {
    const items = JSON.parse(block);
    if (Array.isArray(items)) {
      allItems.push(...items);
    }
  });

  return allItems;
}

/**
 * Main build function.
 */
async function buildCanonicalDb() {
  console.log('--- Starting Canonical DB Build ---');
  const stats = {
    canon_version: 'unknown',
    build_timestamp: new Date().toISOString(),
    total_items_processed: 0,
    total_items_added: 0,
    by_category: {},
    duplicates: [], // { key, value }
    warnings: [],   // { key, message }
    errors: [],     // { file, message }
  };
  const finalCanonMap = new Map();

  // 1. Read and parse manifest.json
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    stats.canon_version = manifest.canon_version || 'unknown_version';
    if (!manifest.source_files || !Array.isArray(manifest.source_files)) {
      throw new Error('manifest.json is missing "source_files" array.');
    }
    console.log(`Building version: ${stats.canon_version}`);
  } catch (e) {
    console.error(`FATAL: Could not read manifest.json: ${e.message}`);
    stats.errors.push({ file: 'manifest.json', message: e.message });
    writeOutputFiles(stats, finalCanonMap, 'unknown'); // Write error manifest
    process.exit(1); // Fail the build
  }

  // 2. Read, parse, and transform all source files
  for (const fileName of manifest.source_files) {
    const filePath = path.resolve(DATA_DIR, fileName);
    const categoryName = normalizeKey(fileName.split('.')[0]);
    stats.by_category[categoryName] = 0;

    console.log(`Processing file: ${fileName}...`);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const allItems = parseDataFileContent(fileContent);

      for (const item of allItems) {
        stats.total_items_processed++;
        if (!item.name) {
          stats.warnings.push({ key: 'unknown', message: `Item in ${fileName} missing 'name' field.` });
          continue;
        }

        // Normalize the key
        const key = normalizeKey(item.name);

        // Check for duplicates
        if (finalCanonMap.has(key)) {
          stats.duplicates.push({
            key: key,
            original: item.name,
            file: fileName,
          });
          continue;
        }

        // Transform to CanonRow schema (Plan A)
        const canonRow = {
          key: key,
          name: item.display_name || item.name,
          state: item.state || 'raw',
          category: item.category || 'misc',
          kcal_per_100g: item.energy_kcal || 0,
          protein_g_per_100g: item.protein_g || 0,
          fat_g_per_100g: item.fat_g || 0,
          carb_g_per_100g: item.carbs_g || 0,
          fiber_g_per_100g: item.fiber_g || 0,
          source: item.source || 'unknown',
          notes: item.notes || null,
          fallback_source: item.fallback_source || null,
        };

        // Perform sanity checks
        const warningMsg = sanityCheck(canonRow);
        if (warningMsg) {
          stats.warnings.push({ key: key, message: warningMsg });
        }

        // Add to map
        finalCanonMap.set(key, canonRow);
        stats.total_items_added++;
        stats.by_category[categoryName]++;
      }
    } catch (e) {
      console.error(`ERROR processing ${fileName}: ${e.message}`);
      stats.errors.push({ file: fileName, message: e.message });
      // Continue to next file
    }
  }

  // 3. Write output files
  writeOutputFiles(stats, finalCanonMap, stats.canon_version);

  // 4. Log summary to console
  console.log('\n--- Canonical DB Build Complete ---');
  console.log(`  Version:         ${stats.canon_version}`);
  console.log(`  Total Items:     ${stats.total_items_added} (from ${stats.total_items_processed} processed)`);
  console.log(`  Duplicates:      ${stats.duplicates.length}`);
  console.log(`  Warnings:        ${stats.warnings.length}`);
  console.log(`  Errors:          ${stats.errors.length}`);
  console.log(`  Output Module:   ${path.relative(PROJECT_ROOT, OUTPUT_MODULE_PATH)}`);
  console.log(`  Output Manifest: ${path.relative(PROJECT_ROOT, OUTPUT_MANIFEST_PATH)}`);

  if (stats.errors.length > 0) {
    console.error('\n!! BUILD FINISHED WITH ERRORS. Please review manifest. !!');
    // Do not exit(1) per user spec to "warn, do not fail"
  } else if (stats.warnings.length > 0 || stats.duplicates.length > 0) {
    console.warn('\n!! Build finished with warnings/duplicates. Please review manifest. !!');
  } else {
    console.log('\n✅ Build finished successfully.');
  }
}

/**
 * Writes the final module and manifest files.
 * @param {object} stats - The build statistics object.
 * @param {Map} canonMap - The map of all CanonRow items.
 * @param {string} version - The canonical version string.
 */
function writeOutputFiles(stats, canonMap, version) {
  // 1. Generate api/_canon.js (CommonJS Module)
  try {
    const sortedKeys = Array.from(canonMap.keys()).sort();
    const canonObject = {};
    for (const key of sortedKeys) {
      canonObject[key] = canonMap.get(key);
    }

    let moduleContent = `/* eslint-disable */\n// @ts-nocheck\n`;
    moduleContent += `// --- Auto-generated by scripts/build-canon.js on ${new Date().toISOString()} ---\n`;
    moduleContent += `// --- DO NOT EDIT THIS FILE MANUALLY. --- \n\n`;
    moduleContent += `const CANON_VERSION = "${version}";\n\n`;
    moduleContent += `const CANON = ${JSON.stringify(canonObject, null, 2)};\n\n`;
    moduleContent += `/**\n * Gets a canonical nutrition entry by its normalized key.\n * @param {string} key - The normalized key (e.g., "chicken_breast")\n * @returns {object|null} The canonical row or null if not found.\n */\n`;
    moduleContent += `function canonGet(key) { return CANON[key] || null; }\n\n`;
    moduleContent += `module.exports = {\n  CANON_VERSION,\n  CANON,\n  canonGet\n};\n`;

    fs.writeFileSync(OUTPUT_MODULE_PATH, moduleContent, 'utf8');
  } catch (e) {
    console.error(`FATAL: Could not write ${OUTPUT_MODULE_PATH}: ${e.message}`);
    stats.errors.push({ file: OUTPUT_MODULE_PATH, message: `File write error: ${e.message}` });
  }

  // 2. Generate api/_canon.manifest.json
  try {
    fs.writeFileSync(OUTPUT_MANIFEST_PATH, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    console.error(`FATAL: Could not write ${OUTPUT_MANIFEST_PATH}: ${e.message}`);
  }
}

// --- Run the build ---
buildCanonicalDb();

