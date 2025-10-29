// --- Cheffy API: /api/plan/targets.js ---
// Calculates nutritional targets based on user profile.
// [MODIFIED] Now uses LBM-based protein calculation.

const crypto = require('crypto'); // For run_id

// --- START: Helper Functions ---

// Basic logging function
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
                // Simple data serialization
                data: data ? JSON.parse(JSON.stringify(data, (key, value) =>
                    (typeof value === 'string' && value.length > 200) ? value.substring(0, 200) + '...' : value
                )) : null
            };
            logs.push(logEntry);
            const time = new Date(logEntry.timestamp).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Brisbane' });
            console.log(`${time} [${logEntry.level}] [${logEntry.tag}] ${logEntry.message}`);
            if (data && level !== 'DEBUG') { 
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


// Calculates the target daily calorie intake (Unchanged)
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

// --- [REFACTORED] calculateMacroTargets ---
// This function now implements the LBM-based protein calculation.
function calculateMacroTargets(calorieTarget, formData, log) {
    const { weight, bodyFat, goal, activityLevel } = formData;
    
    if (isNaN(calorieTarget) || calorieTarget <= 0) {
        log("Invalid calorieTarget for macro calculation.", 'WARN', 'CALC');
        return { protein: 0, fat: 0, carbs: 0 }; // Default
    }

    const weightKg = parseFloat(weight);
    if (isNaN(weightKg) || weightKg <= 0) {
         log("Invalid weightKg for macro calculation.", 'WARN', 'CALC');
         return { protein: 0, fat: 0, carbs: 0 };
    }

    // --- 1. Estimate Lean Mass (LBM) ---
    const bodyFatDecimal = parseFloat(bodyFat) / 100;
    let lbmKg;
    if (bodyFatDecimal > 0 && bodyFatDecimal < 1) {
        lbmKg = weightKg * (1 - bodyFatDecimal);
        log(`Using provided BF% (${bodyFat}%) to estimate LBM: ${lbmKg.toFixed(1)}kg`, 'INFO', 'CALC');
    } else {
        lbmKg = weightKg * 0.85; // Fallback estimation
        log(`No valid BF% provided. Using fallback estimation (85%) for LBM: ${lbmKg.toFixed(1)}kg`, 'INFO', 'CALC');
    }

    // --- 2. Assign Protein Multiplier ---
    const proteinMultipliers = {
        maintain:         { sedentary: 1.4, light: 1.6, moderate: 1.8, active: 2.0, veryActive: 2.1 },
        cut_moderate:     { sedentary: 1.7, light: 1.9, moderate: 2.1, active: 2.2, veryActive: 2.3 },
        cut_aggressive:   { sedentary: 1.9, light: 2.1, moderate: 2.2, active: 2.3, veryActive: 2.4 },
        bulk_lean:        { sedentary: 1.8, light: 2.0, moderate: 2.2, active: 2.3, veryActive: 2.4 },
        bulk_aggressive:  { sedentary: 2.0, light: 2.2, moderate: 2.4, active: 2.5, veryActive: 2.5 }
    };

    const goalRow = proteinMultipliers[goal] || proteinMultipliers['maintain'];
    const multiplier = goalRow[activityLevel] || goalRow['moderate'];

    if (!proteinMultipliers[goal]) log(`Invalid goal "${goal}" for protein, using 'maintain'.`, 'WARN', 'CALC');
    if (!goalRow[activityLevel]) log(`Invalid activity "${activityLevel}" for protein, using 'moderate'.`, 'WARN', 'CALC');
    
    log(`LBM Protein Calc: Goal=${goal}, Activity=${activityLevel}, Multiplier=${multiplier}`, 'INFO', 'CALC');

    // --- 3. Compute Protein ---
    let proteinGrams = lbmKg * multiplier;

    // --- 4. Hard Cap ---
    const hardCap = 2.5 * weightKg;
    if (proteinGrams > hardCap) {
        log(`Protein RECAP: Initial protein ${proteinGrams.toFixed(0)}g exceeded cap (${hardCap.toFixed(0)}g). Capping.`, 'WARN', 'CALC');
        proteinGrams = hardCap;
    }

    // --- 5. Round to nearest 5g ---
    const finalProteinGrams = Math.round(proteinGrams / 5) * 5;
    const proteinCalories = finalProteinGrams * 4;
    log(`Protein Target: ${finalProteinGrams}g (${(finalProteinGrams / weightKg).toFixed(1)}g/kg)`, 'INFO', 'CALC');


    // --- 6. Calculate Fat (Using percentage of total calories) ---
    // This logic is retained from the previous version for simplicity, as only protein was specified.
    const fatSplits = {
        'cut_aggressive': 0.25,
        'cut_moderate':   0.25,
        'maintain':       0.30,
        'bulk_lean':      0.25,
        'bulk_aggressive':0.25
    };
    const fatPct = fatSplits[goal] || 0.30;
    let fatGrams = (calorieTarget * fatPct) / 9;
    let fatCalories = fatGrams * 9;
    
    // Fat Cap (from original logic, good to keep)
    const FAT_MAX_PERCENT = 0.35;
    if (fatCalories / calorieTarget > FAT_MAX_PERCENT) {
        log(`ADJUSTMENT: Initial fat ${(fatCalories / calorieTarget * 100).toFixed(1)}% > 35%. Capping fat.`, 'WARN', 'CALC');
        fatCalories = calorieTarget * FAT_MAX_PERCENT;
        fatGrams = fatCalories / 9;
    }

    // --- 7. Calculate Carbs (As Remainder) ---
    const carbCalories = Math.max(0, calorieTarget - proteinCalories - fatCalories);
    const carbGrams = carbCalories / 4;

    // --- 8. Final Rounding & Return ---
    const finalFatGrams = Math.round(fatGrams);
    const finalCarbGrams = Math.round(carbGrams);

    log(`Calculated Macro Targets: P ${finalProteinGrams}g, F ${finalFatGrams}g, C ${finalCarbGrams}g`, 'INFO', 'CALC');

    return {
        calories: Math.round(calorieTarget), // Return rounded calorie target as well
        protein: finalProteinGrams,
        fat: finalFatGrams,
        carbs: finalCarbGrams
     };
}

// --- END: Refactored Functions ---


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
        
        // --- [MODIFIED] Updated function call ---
        // Pass the entire formData object to the new macro calculator
        const macroTargets = calculateMacroTargets(calorieTarget, formData, log);
        // --- End Modification ---

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

