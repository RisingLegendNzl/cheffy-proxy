const fs = require('fs');
const path = require('path');
// Use the shared normalizer
const { normalizeKey } = require('./normalize.js');

// --- Configuration ---
const dataDir = path.join(__dirname, '..', 'Data', 'CanonicalNutrition');
const apiDir = path.join(__dirname, '..', 'api');
const manifestPath = path.join(dataDir, 'manifest.json');
const canonModulePath = path.join(apiDir, '_canon.js'); // Output module (CommonJS)
const canonManifestPath = path.join(apiDir, '_canon.manifest.json'); // Output manifest

/**
 * Reads and parses a single data file.
 * [FIXED] This now reads files without a .json extension and strips headers/footers.
 */
function readAndParseFile(fileName) {
  const filePath = path.join(dataDir, fileName); // <-- FIX 1: No .json extension
  let fileContent;

  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { items: [], error: `File not found or unreadable: ${fileName}. ${err.message}` };
  }

  // --- FIX 2: Strip non-JSON headers/footers ---
  const startIndex = fileContent.indexOf('[');
  const endIndex = fileContent.lastIndexOf(']');

  if (startIndex === -1 || endIndex === -1) {
    return { items: [], error: `No JSON array found in file: ${fileName}` };
  }

  const jsonContent = fileContent.substring(startIndex, endIndex + 1);
  // --- End FIX 2 ---

  try {
    const items = JSON.parse(jsonContent);
    if (!Array.isArray(items)) {
      return { items: [], error: `File content is not a JSON array: ${fileName}` };
    }
    return { items, error: null };
  } catch (err) {
    return { items: [], error: `Failed to parse JSON in ${fileName}. ${err.message}` };
  }
}

/**
 * Performs sanity checks on a transformed CanonRow.
 */
function sanityCheck(item) {
  const warnings = [];
  const { key, kcal_per_100g, protein_g_per_100g, fat_g_per_100g, carb_g_per_100g, fiber_g_per_100g } = item;

  // Check calorie math (±12% tolerance)
  const calculatedKcal = (protein_g_per_100g * 4) + (fat_g_per_100g * 9) + (carb_g_per_100g * 4);
  const diff = Math.abs(kcal_per_100g - calculatedKcal);
  if (kcal_per_100g > 0 && diff / kcal_per_100g > 0.12) {
    warnings.push(`'${key}': Kcal mismatch. Stated: ${kcal_per_100g}, Calculated: ${calculatedKcal.toFixed(0)}`);
  }

  // Check fiber vs carbs
  if (fiber_g_per_100g > carb_g_per_100g) {
    warnings.push(`'${key}': Fiber (${fiber_g_per_100g}g) exceeds total Carbs (${carb_g_per_100g}g).`);
  }

  return warnings;
}

/**
 * Main build function.
 */
async function buildCanon() {
  console.log('Starting Cheffy Canonical DB build...');
  let manifest;
  const canonMap = new Map();
  const buildReport = {
    version: 'N/A',
    status: 'pending',
    startTime: new Date().toISOString(),
    totalItemsProcessed: 0,
    totalItemsAdded: 0,
    filesProcessed: 0,
    categories: {},
    duplicatesFound: [],
    sanityWarnings: [],
    errors: [],
  };

  // 1. Read Manifest
  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(manifestContent);
    buildReport.version = manifest.version || 'N/A';
    console.log(`Building version: ${buildReport.version}`);
  } catch (err) {
    console.error('CRITICAL: Cannot read or parse manifest.json.', err);
    buildReport.errors.push('CRITICAL: Cannot read or parse manifest.json.');
    buildReport.status = 'failed';
    fs.writeFileSync(canonManifestPath, JSON.stringify(buildReport, null, 2));
    process.exit(1); // Hard fail
  }

  // 2. Process each file in manifest
  for (const fileName of manifest.files) {
    console.log(`Processing file: ${fileName}...`);
    const { items, error } = readAndParseFile(fileName);
    buildReport.filesProcessed++;

    if (error) {
      console.error(`  Error: ${error}`);
      buildReport.errors.push(error);
      continue;
    }

    // 3. Transform and add items
    for (const item of items) {
      buildReport.totalItemsProcessed++;
      const key = normalizeKey(item.name);
      
      // Transform to CanonRow schema (Plan A)
      const canonRow = {
        key: key,
        name: item.display_name || item.name,
        state: item.state || 'raw',
        category: item.category || 'misc',
        kcal_per_100g: item.energy_kcal,
        protein_g_per_100g: item.protein_g,
        fat_g_per_100g: item.fat_g,
        carb_g_per_100g: item.carbs_g,
        fiber_g_per_100g: item.fiber_g || 0,
        source: item.source || 'N/A',
        notes: item.notes || null,
        yield_factor: item.yield_factor || null,
        density_g_per_ml: item.density_g_per_ml || null,
      };

      // Validate core schema
      if (!canonRow.key) {
        buildReport.sanityWarnings.push(`Item in ${fileName} has missing 'name' field.`);
        continue;
      }
      if (typeof canonRow.kcal_per_100g !== 'number' || typeof canonRow.protein_g_per_100g !== 'number' || typeof canonRow.fat_g_per_100g !== 'number' || typeof canonRow.carb_g_per_100g !== 'number') {
        buildReport.sanityWarnings.push(`Item '${key}' in ${fileName} has missing or invalid macro values.`);
        continue;
      }
      
      // Check for duplicates
      if (canonMap.has(key)) {
        buildReport.duplicatesFound.push(`'${key}' in ${fileName} already exists (from previous file). Skipping.`);
        continue;
      }

      // Run sanity checks
      const warnings = sanityCheck(canonRow);
      if (warnings.length > 0) {
        buildReport.sanityWarnings.push(...warnings);
      }
      
      canonMap.set(key, canonRow);
      buildReport.totalItemsAdded++;
      buildReport.categories[canonRow.category] = (buildReport.categories[canonRow.category] || 0) + 1;
    }
  }

  // 4. Generate Module Content
  console.log(`Build complete. Added ${buildReport.totalItemsAdded} unique items.`);
  const sortedKeys = Array.from(canonMap.keys()).sort();
  const sortedCanonObject = {};
  for (const key of sortedKeys) {
    sortedCanonObject[key] = canonMap.get(key);
  }

  // --- [FIX] Output CommonJS module.exports syntax ---
  const moduleContent = `// Auto-generated by scripts/build-canon.js at ${new Date().toISOString()}
// Total Items: ${buildReport.totalItemsAdded}
// DO NOT EDIT THIS FILE MANUALLY.

const CANON_VERSION = "${buildReport.version}";

const CANON = ${JSON.stringify(sortedCanonObject, null, 2)};

/**
 * Retrieves a canonical nutrition item by its normalized key.
 * @param {string} key - The normalized key (e.g., "chicken_breast")
 * @returns {object | null} The canonical item or null if not found.
 */
const canonGet = (key) => CANON[key] || null;

module.exports = {
  CANON_VERSION,
  CANON,
  canonGet
};
`;
  // --- End FIX ---

  // 5. Write Files
  try {
    if (!fs.existsSync(apiDir)) {
      fs.mkdirSync(apiDir, { recursive: true });
    }
    fs.writeFileSync(canonModulePath, moduleContent, 'utf8');
    console.log(`Successfully generated: ${canonModulePath}`);

    buildReport.status = 'success';
    buildReport.endTime = new Date().toISOString();
    fs.writeFileSync(canonManifestPath, JSON.stringify(buildReport, null, 2), 'utf8');
    console.log(`Successfully generated build manifest: ${canonManifestPath}`);
  } catch (err) {
    console.error('CRITICAL: Failed to write output files.', err);
    buildReport.status = 'failed';
    buildReport.errors.push('CRITICAL: Failed to write output files.');
    fs.writeFileSync(canonManifestPath, JSON.stringify(buildReport, null, 2), 'utf8');
    process.exit(1);
  }
}

// Run the build
buildCanon().catch((err) => {
  console.error('Unhandled error during build:', err);
  process.exit(1);
});


