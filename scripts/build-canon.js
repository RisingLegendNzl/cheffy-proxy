/**
 * Cheffy Canonical DB Build Script
 * V2.0 - Tightened Ingestion Gate for Reliability Layer
 *
 * This script runs at build time (via `npm run prebuild`).
 * It reads all raw data files from /Data/CanonicalNutrition/,
 * cleans and parses them, transforms them to the final schema,
 * runs strict validation, and generates a single, fast CommonJS module
 * at /api/_canon.js for in-memory lookups.
 * 
 * V2.0 CHANGES (Minimum Viable Reliability):
 * - Tightened calorie tolerance from 12% to 5%
 * - Added mass balance check (protein + fat + carbs ≤ 105g per 100g)
 * - Records failing validation are REJECTED (not inserted)
 * - Rejected records are logged to api/_canon.rejections.json
 * - Validation function returns { valid, errors } instead of pushing warnings
 */

const fs = require('fs');
const path = require('path');
const { normalizeKey } = require('./normalize.js');

// --- Path Configuration ---
const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.join(SCRIPT_DIR, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'Data', 'CanonicalNutrition');
const API_DIR = path.join(PROJECT_ROOT, 'api');

const MANIFEST_FILE = 'manifest.json';
const OUTPUT_MODULE_FILE = '_canon.js';
const OUTPUT_MANIFEST_FILE = '_canon.manifest.json';
const OUTPUT_REJECTIONS_FILE = '_canon.rejections.json';

// --- V2.0: Validation Configuration ---
const VALIDATION_CONFIG = {
  // Macro-calorie consistency tolerance (5% per reliability strategy)
  calorieTolerancePct: 5,
  
  // Mass balance: macros cannot exceed 105g per 100g serving (5% tolerance for measurement variance)
  maxMassBalanceGrams: 105,
  
  // Calorie calculation constants
  caloriesPerGramProtein: 4,
  caloriesPerGramCarbs: 4,
  caloriesPerGramFat: 9,
  
  // Range bounds (per 100g)
  maxKcalPer100g: 900,  // Pure fat is ~900 kcal/100g
  minKcalPer100g: 0
};

/**
 * Cleans header/footer text and parses *all* JSON arrays from a file.
 * @param {string} content - Raw file content.
 * @returns {Array} - A single, merged array of all items found.
 */
function cleanAndParseJson(content) {
  // Clean headers/footers and JS comments
  const cleanedContent = content.replace(/———-.*?———-|\(.*\)/g, '').replace(/\/\/.*/g, '');

  // Find all occurrences of JSON arrays
  const jsonMatches = cleanedContent.match(/\[.*?\]/gs);

  if (!jsonMatches || jsonMatches.length === 0) {
    console.warn('  -> No JSON arrays found in file.');
    return [];
  }

  let allEntries = [];
  for (const match of jsonMatches) {
    try {
      const parsedArray = JSON.parse(match);
      if (Array.isArray(parsedArray)) {
        allEntries = allEntries.concat(parsedArray);
      }
    } catch (e) {
      console.warn(`  -> Found a JSON-like block but failed to parse: ${e.message}`);
      console.warn(`  -> Block (first 100 chars): ${match.substring(0, 100)}...`);
    }
  }

  return allEntries;
}

/**
 * V2.0: Validates a single nutrition record with strict checks.
 * Returns { valid, errors } instead of mutating a warnings array.
 * 
 * @param {object} item - The transformed item (CanonRow schema).
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateNutritionRecord(item) {
  const errors = [];
  const {
    key,
    kcal_per_100g: kcal,
    protein_g_per_100g: protein,
    fat_g_per_100g: fat,
    carb_g_per_100g: carbs,
    fiber_g_per_100g: fiber,
  } = item;

  // 1. Range checks
  if (kcal < VALIDATION_CONFIG.minKcalPer100g) {
    errors.push(`Negative calories: ${kcal} kcal`);
  }
  if (kcal > VALIDATION_CONFIG.maxKcalPer100g) {
    errors.push(`Calories exceed maximum (${VALIDATION_CONFIG.maxKcalPer100g}): ${kcal} kcal`);
  }
  if (protein < 0 || fat < 0 || carbs < 0) {
    errors.push(`Negative macro value: p=${protein}, f=${fat}, c=${carbs}`);
  }

  // 2. Macro-calorie consistency check (5% tolerance)
  const estimatedKcal = 
    (protein * VALIDATION_CONFIG.caloriesPerGramProtein) +
    (carbs * VALIDATION_CONFIG.caloriesPerGramCarbs) +
    (fat * VALIDATION_CONFIG.caloriesPerGramFat);
  
  if (kcal > 0.1 && estimatedKcal > 0) {
    const deviation = Math.abs(kcal - estimatedKcal) / estimatedKcal;
    if (deviation > VALIDATION_CONFIG.calorieTolerancePct / 100) {
      errors.push(
        `Macro-kcal mismatch: stated ${kcal} kcal, macros suggest ${estimatedKcal.toFixed(0)} kcal (${(deviation * 100).toFixed(1)}% deviation, max ${VALIDATION_CONFIG.calorieTolerancePct}%)`
      );
    }
  }

  // 3. Mass balance check (protein + fat + carbs ≤ 105g per 100g)
  const totalMacroMass = protein + fat + carbs;
  if (totalMacroMass > VALIDATION_CONFIG.maxMassBalanceGrams) {
    errors.push(
      `Mass balance violation: p+f+c = ${totalMacroMass.toFixed(1)}g exceeds ${VALIDATION_CONFIG.maxMassBalanceGrams}g per 100g`
    );
  }

  // 4. Fiber check (warning only, doesn't cause rejection)
  // Fiber > carbs is unusual but can occur for some high-fiber foods
  // We log it but don't reject
  const fiberWarning = fiber > carbs 
    ? `Fiber > Carbs: ${fiber}g > ${carbs}g (unusual but not invalid)`
    : null;

  return {
    valid: errors.length === 0,
    errors,
    warnings: fiberWarning ? [fiberWarning] : []
  };
}

/**
 * Main build function.
 */
async function run() {
  console.log('=======================================');
  console.log('[build-canon] SCRIPT EXECUTION STARTED (V2.0 - Strict Validation)');
  console.log('=======================================');
  console.log(`[build-canon] Node.js CWD: ${process.cwd()}`);
  console.log(`[build-canon] Resolved PROJECT_ROOT: ${PROJECT_ROOT}`);
  console.log(`[build-canon] Resolved DATA_DIR: ${DATA_DIR}`);
  console.log(`[build-canon] Resolved API_DIR: ${API_DIR}`);

  // Declare all variables in outer scope
  let manifestData = {
    version: '0.0.0-error',
    builtAt: new Date().toISOString(),
    totalItems: 0,
    categories: {},
    warnings: ['Build script failed during initialization'],
    rejectedCount: 0,
    duplicateKeysFound: 0,
  };
  let canonVersion = '0.0.0-dev';
  let filesToProcess = [];
  const allEntries = [];
  const warnings = [];
  const rejections = [];  // V2.0: Track rejected records
  const categoryCounts = {};
  let totalItems = 0;
  let duplicates = [];

  try {
    // 1. Read Manifest
    const manifestPath = path.join(DATA_DIR, MANIFEST_FILE);
    console.log(`[build-canon] Reading manifest from: ${manifestPath}`);
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    canonVersion = manifest.canon_version || canonVersion;
    filesToProcess = manifest.source_files || [];

    console.log(`[build-canon] Manifest OK. Version ${canonVersion}. Found ${filesToProcess.length} files.`);
    console.log(`[build-canon] Validation tolerance: ${VALIDATION_CONFIG.calorieTolerancePct}% (strict mode)`);
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

    // 3. Transform, Normalize, Validate, and De-duplicate
    console.log('[build-canon] Normalizing, validating, and transforming entries...');
    const CANON = {};
    duplicates = [];

    for (const item of allEntries) {
      if (!item.name) {
        warnings.push(`Skipping item with no 'name' field: ${JSON.stringify(item)}`);
        continue;
      }

      const key = normalizeKey(item.name);
      
      // Check for duplicates
      if (CANON[key]) {
        duplicates.push(`Duplicate key '${key}' (from '${item.name}'). '${CANON[key].name}' won.`);
        continue;
      }

      // Transform to canonical schema
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

      // V2.0: Strict validation - REJECT on failure
      const validation = validateNutritionRecord(canonItem);
      
      if (!validation.valid) {
        // REJECT: Do not insert into canonical store
        rejections.push({
          key: key,
          originalName: item.name,
          errors: validation.errors,
          record: canonItem
        });
        console.warn(`  -> REJECTED [${key}]: ${validation.errors.join('; ')}`);
        continue;  // Skip insertion
      }
      
      // Add warnings (non-blocking)
      if (validation.warnings && validation.warnings.length > 0) {
        warnings.push(...validation.warnings.map(w => `[${key}] ${w}`));
      }

      // Insert into canonical store
      CANON[key] = canonItem;
      categoryCounts[canonItem.category] = (categoryCounts[canonItem.category] || 0) + 1;
    }

    totalItems = Object.keys(CANON).length;
    console.log(`[build-canon] Processed ${totalItems} valid items.`);
    console.log(`[build-canon] REJECTED ${rejections.length} items (validation failures).`);

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
 * Rejected Items: ${rejections.length}
 * Validation Tolerance: ${VALIDATION_CONFIG.calorieTolerancePct}%
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
    manifestData = {
      version: canonVersion,
      builtAt: new Date().toISOString(),
      totalItems: totalItems,
      categories: categoryCounts,
      warnings: warnings,
      rejectedCount: rejections.length,
      duplicateKeysFound: duplicates.length,
      validationConfig: {
        calorieTolerancePct: VALIDATION_CONFIG.calorieTolerancePct,
        maxMassBalanceGrams: VALIDATION_CONFIG.maxMassBalanceGrams
      }
    };

    // 6. Write Files
    // Create api directory if it doesn't exist
    if (!fs.existsSync(API_DIR)) {
      console.log(`[build-canon] API directory not found. Creating: ${API_DIR}`);
      fs.mkdirSync(API_DIR, { recursive: true });
    }

    // Write main module
    const modulePath = path.join(API_DIR, OUTPUT_MODULE_FILE);
    fs.writeFileSync(modulePath, outputContent);
    console.log(`[build-canon] Successfully wrote module to ${modulePath}`);

    // Write manifest
    const outputManifestPath = path.join(API_DIR, OUTPUT_MANIFEST_FILE);
    fs.writeFileSync(outputManifestPath, JSON.stringify(manifestData, null, 2));
    console.log(`[build-canon] Successfully wrote manifest to ${outputManifestPath}`);

    // V2.0: Write rejections file
    const rejectionsPath = path.join(API_DIR, OUTPUT_REJECTIONS_FILE);
    const rejectionsData = {
      generatedAt: new Date().toISOString(),
      version: canonVersion,
      validationConfig: VALIDATION_CONFIG,
      totalRejected: rejections.length,
      rejections: rejections
    };
    fs.writeFileSync(rejectionsPath, JSON.stringify(rejectionsData, null, 2));
    console.log(`[build-canon] Successfully wrote rejections to ${rejectionsPath}`);

    // 7. Summary
    console.log('=========================================');
    console.log('[build-canon] BUILD SUMMARY');
    console.log('=========================================');
    console.log(`  Version:         ${canonVersion}`);
    console.log(`  Total Valid:     ${totalItems}`);
    console.log(`  Total Rejected:  ${rejections.length}`);
    console.log(`  Duplicates:      ${duplicates.length}`);
    console.log(`  Warnings:        ${warnings.length}`);
    console.log(`  Tolerance:       ${VALIDATION_CONFIG.calorieTolerancePct}%`);
    console.log('=========================================');
    console.log('[build-canon] SCRIPT EXECUTION SUCCEEDED');
    console.log('=========================================');

  } catch (e) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[build-canon] SCRIPT EXECUTION FAILED');
    console.error(e);

    // Write a failure manifest
    warnings.push(`FATAL BUILD ERROR: ${e.message}`);
    manifestData = {
      ...manifestData,
      warnings: warnings,
      builtAt: new Date().toISOString(),
      error: e.message
    };
    
    try {
      const outputManifestPath = path.join(API_DIR, OUTPUT_MANIFEST_FILE);
      fs.writeFileSync(outputManifestPath, JSON.stringify(manifestData, null, 2));
      console.log('[build-canon] Wrote failure manifest.');
    } catch (writeError) {
      console.error('[build-canon] Could not even write failure manifest.', writeError);
    }

    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    process.exit(1);
  }
}

// Run the script
run();