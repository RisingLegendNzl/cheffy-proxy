// --- Cheffy API: /api/plan/targets.js ---
// Calculates nutritional targets based on user profile.

const crypto = require('crypto'); // For run_id

// --- START: Copied Helper Functions from generate-full-plan.js ---

// Basic logging function similar to the original orchestrator
function createLogger(run_id) {
    const logs = [];
    const log = (message, level = 'INFO', tag = 'CALC', data = null) => {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                run_id: run_id,
                level: level.toUpperCase(),
                tag: tag.toUpperCase(),
                message,
                // Simple data serialization, avoid large objects
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    (typeof value === 'string' && value.length > 200) ? value.substring(0, 200) + '...' : value
                )) : null
            };
            logs.push(logEntry);
            const time = new Date(logEntry.timestamp).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Brisbane' });
            console.log(`${time} [${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
            if (data && level !== 'DEBUG') { // Log data for non-debug
                 console.log("  Data:", JSON.stringify(data, null, 2).substring(0, 500) + '...');
            }
            return logEntry;
        } catch (error) {
             const fallbackEntry = { timestamp: new Date().toISOString(), run_id: run_id, level: 'ERROR', tag: 'LOGGING', message: `Log serialization failed: ${message}`, data: { error: error.message }}
             logs.push(fallbackEntry);
             console.error(JSON.stringify(fallbackEntry));
             return fallbackEntry;
        }
    };
    return { log, getLogs: () => logs };
}

// Sanitizes form data for logging
function getSanitizedFormData(formData) {
    try {
        if (!formData || typeof formData !== 'object') return { error: "Invalid form data received." };
        const { name, height, weight, age, bodyFat, ...rest } = formData;
        return {
            ...rest,
            user_profile: "[REDACTED]" // Basic redaction
        };
    } catch (e) {
        return { error: "Failed to sanitize form data." };
    }
}


// Calculates the target daily calorie intake
function calculateCalorieTarget(formData, log) {
    if (!formData) {
        log("Missing formData for calorie calculation.", 'WARN', 'CALC');
        return 2000; // Default
    }
    const { weight, height, age, gender, activityLevel, goal } = formData;
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    const ageYears = parseInt(age, 10);

    if (isNaN(weightKg) || isNaN(heightCm) || isNaN(ageYears) || !gender || !activityLevel || !goal) {
        log("Missing or invalid profile data for calorie calculation, using default 2000.", 'WARN', 'CALC', getSanitizedFormData({ weight, height, age, gender, activityLevel, goal}));
        return 2000;
    }

    let bmr = (gender === 'male')
        ? (10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5)
        : (10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161);

    const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };
    let multiplier = activityMultipliers[activityLevel] || 1.55;
     if (!activityMultipliers[activityLevel]) {
         log(`Invalid activityLevel "${activityLevel}", using default 1.55.`, 'WARN', 'CALC');
     }
    const tdee = bmr * multiplier;

    const goalAdjustments = { maintain: 0, cut_moderate: -0.15, cut_aggressive: -0.25, bulk_lean: +0.15, bulk_aggressive: +0.25 };
    let adjustmentFactor = goalAdjustments[goal];
     if (adjustmentFactor === undefined) {
         log(`Invalid goal "${goal}", using default 'maintain' (0 adjustment).`, 'WARN', 'CALC');
         adjustmentFactor = 0;
    }
    const adjustment = tdee * adjustmentFactor;

    log(`Calorie Calc: BMR=${bmr.toFixed(0)}, TDEE=${tdee.toFixed(0)}, Goal=${goal}, Adjustment=${adjustment.toFixed(0)}`, 'INFO', 'CALC');

    // Ensure target is reasonable
    return Math.max(1200, Math.round(tdee + adjustment));
}

// Calculates macronutrient targets based on calories and goal
function calculateMacroTargets(calorieTarget, goal, weightKg, log) {
     if (isNaN(calorieTarget) || calorieTarget <= 0) {
        log("Invalid calorieTarget for macro calculation.", 'WARN', 'CALC');
        return { proteinGrams: 0, fatGrams: 0, carbGrams: 0 }; // Default
    }
    const macroSplits = {
        'cut_aggressive': { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'cut_moderate':   { pPct: 0.35, fPct: 0.25, cPct: 0.40 },
        'maintain':       { pPct: 0.30, fPct: 0.30, cPct: 0.40 },
        'bulk_lean':      { pPct: 0.25, fPct: 0.25, cPct: 0.50 },
        'bulk_aggressive':{ pPct: 0.20, fPct: 0.25, cPct: 0.55 }
    };
    const split = macroSplits[goal] || macroSplits['maintain'];
    if (!macroSplits[goal]) {
        log(`Invalid goal "${goal}" for macro split, using 'maintain' defaults.`, 'WARN', 'CALC');
    }

    let proteinGrams = (calorieTarget * split.pPct) / 4;
    let fatGrams = (calorieTarget * split.fPct) / 9;
    let carbGrams = (calorieTarget * split.cPct) / 4;

    // Use a default weight if invalid
    const validWeightKg = (typeof weightKg === 'number' && weightKg > 0) ? weightKg : 75;
    let proteinPerKg = proteinGrams / validWeightKg;
    let fatPercent = (fatGrams * 9) / calorieTarget;
    let carbsNeedRecalc = false;

    // Protein Cap
    const PROTEIN_MAX_G_PER_KG = 3.0;
    if (proteinPerKg > PROTEIN_MAX_G_PER_KG) {
        log(`ADJUSTMENT: Initial protein ${proteinPerKg.toFixed(1)}g/kg > ${PROTEIN_MAX_G_PER_KG}g/kg. Capping protein and recalculating carbs.`, 'WARN', 'CALC');
        proteinGrams = PROTEIN_MAX_G_PER_KG * validWeightKg;
        carbsNeedRecalc = true;
    }

    // Fat Cap (Optional, but kept from original logic)
    const FAT_MAX_PERCENT = 0.35;
    if (fatPercent > FAT_MAX_PERCENT) {
        log(`ADJUSTMENT: Initial fat ${(fatPercent * 100).toFixed(1)}% > ${FAT_MAX_PERCENT*100}%. Capping fat and recalculating carbs.`, 'WARN', 'CALC');
        fatGrams = (calorieTarget * FAT_MAX_PERCENT) / 9;
        carbsNeedRecalc = true;
    }

    // Recalculate Carbs if necessary
    if (carbsNeedRecalc) {
        const proteinCalories = proteinGrams * 4;
        const fatCalories = fatGrams * 9;
        const carbCalories = Math.max(0, calorieTarget - proteinCalories - fatCalories);
        carbGrams = carbCalories / 4;
        log(`RECALC: New Carb Target: ${carbGrams.toFixed(0)}g`, 'INFO', 'CALC');
    }

    // Add info logs for guidelines (optional, kept from original)
    const PROTEIN_MIN_G_PER_KG = 1.6;
    proteinPerKg = proteinGrams / validWeightKg; // Recalculate proteinPerKg after potential capping
    if (proteinPerKg < PROTEIN_MIN_G_PER_KG) {
        log(`GUIDELINE: Protein target ${proteinPerKg.toFixed(1)}g/kg is below the optimal ${PROTEIN_MIN_G_PER_KG}g/kg range.`, 'INFO', 'CALC');
    }
    // ... other guideline logs if needed ...

    // Round final values
    const finalProteinGrams = Math.round(proteinGrams);
    const finalFatGrams = Math.round(fatGrams);
    const finalCarbGrams = Math.round(carbGrams);

    log(`Calculated Macro Targets (Goal: ${goal}, Cals: ${calorieTarget}, Weight: ${validWeightKg}kg): P ${finalProteinGrams}g, F ${finalFatGrams}g, C ${finalCarbGrams}g`, 'INFO', 'CALC');

    return {
        calories: Math.round(calorieTarget), // Return rounded calorie target as well
        protein: finalProteinGrams,
        fat: finalFatGrams,
        carbs: finalCarbGrams
     };
}

// --- END: Copied Helper Functions ---


// --- Main API Handler ---
module.exports = async (request, response) => {
    const run_id = crypto.randomUUID();
    const { log, getLogs } = createLogger(run_id);

    // Set CORS headers for all responses
    response.setHeader('Access-Control-Allow-Origin', '*'); // Allow requests from any origin
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Allow POST and OPTIONS methods
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allow specific headers


    // Handle OPTIONS pre-flight request for CORS
    if (request.method === 'OPTIONS') {
        log("Handling OPTIONS pre-flight request.", 'INFO', 'HTTP');
        return response.status(200).end();
    }

    // Ensure the request method is POST
    if (request.method !== 'POST') {
        log(`Method Not Allowed: ${request.method}`, 'WARN', 'HTTP');
        response.setHeader('Allow', 'POST, OPTIONS');
        // Return structured error
        return response.status(405).json({
            message: `Method ${request.method} Not Allowed. Please use POST.`,
            code: "METHOD_NOT_ALLOWED",
            logs: getLogs() // Include logs in the error response
        });
    }

    try {
        log("Calculating nutritional targets...", 'INFO', 'SYSTEM');
        const formData = request.body;

        // Basic validation of incoming formData
        if (!formData || typeof formData !== 'object' || Object.keys(formData).length === 0) {
            log("Received empty or invalid request body.", 'CRITICAL', 'INPUT');
            // Use specific error for missing input
            throw new Error("Request body is missing or invalid.");
        }
        if (!formData.weight || !formData.height || !formData.age || !formData.gender || !formData.activityLevel || !formData.goal) {
             log("CRITICAL: Missing core form data fields for calculation.", 'CRITICAL', 'INPUT', getSanitizedFormData(formData));
             // Use specific error for missing input
             throw new Error("Missing critical profile data for target calculation.");
        }


        // --- Calculate Targets ---
        const calorieTarget = calculateCalorieTarget(formData, log);
        const macroTargets = calculateMacroTargets(calorieTarget, formData.goal, parseFloat(formData.weight), log);

        log("Nutritional targets calculation complete.", 'SUCCESS', 'SYSTEM');

        // --- Return Success Response ---
        return response.status(200).json({
            message: "Targets calculated successfully.",
            nutritionalTargets: macroTargets,
            logs: getLogs() // Include logs in the success response
        });

    } catch (error) {
        // --- Handle Errors ---
        log(`CRITICAL Error during target calculation: ${error.message}`, 'CRITICAL', 'SYSTEM', { stack: error.stack?.substring(0, 300) });
        console.error("TARGETS API UNHANDLED ERROR:", error);

        // Return a generic server error response
        return response.status(500).json({
            message: "An internal server error occurred while calculating targets.",
            error: error.message,
            code: "TARGET_CALC_FAILED",
            logs: getLogs() // Include logs in the error response
        });
    }
};

