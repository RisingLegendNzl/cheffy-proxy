// api/lib/kv-storage.js
// KV Storage utilities for meal plan persistence
// Uses Vercel KV (Upstash Redis) for data storage

const { createClient } = require("@vercel/kv");
const crypto = require("crypto");

// Initialize KV client
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// TTL constants (in seconds for KV)
const TTL_CURRENT_PLAN = 60 * 60 * 24 * 30; // 30 days
const TTL_SAVED_PLAN = 60 * 60 * 24 * 90; // 90 days
const TTL_PLANS_INDEX = 60 * 60 * 24 * 30; // 30 days

/**
 * Generate a unique plan ID
 */
function generatePlanId() {
    return crypto.randomUUID();
}

/**
 * Get key for current plan
 */
function getCurrentPlanKey(uid) {
    return `user:${uid}:current-plan`;
}

/**
 * Get key for a specific saved plan
 */
function getPlanKey(uid, planId) {
    return `user:${uid}:plans:${planId}`;
}

/**
 * Get key for plans index (list of all plan IDs for a user)
 */
function getPlansIndexKey(uid) {
    return `user:${uid}:plans-index`;
}

/**
 * Save the current active plan for a user
 * @param {string} uid - Firebase user ID
 * @param {object} planData - Complete plan data
 * @returns {Promise<boolean>} Success status
 */
async function saveCurrentPlan(uid, planData) {
    if (!kvReady) {
        console.warn("[KV] KV not configured, skipping saveCurrentPlan");
        return false;
    }

    try {
        const key = getCurrentPlanKey(uid);
        const dataToStore = {
            ...planData,
            lastUpdated: new Date().toISOString(),
        };
        
        await kv.setex(key, TTL_CURRENT_PLAN, JSON.stringify(dataToStore));
        console.log(`[KV] Saved current plan for user ${uid}`);
        return true;
    } catch (error) {
        console.error("[KV] Error saving current plan:", error);
        return false;
    }
}

/**
 * Get the current active plan for a user
 * @param {string} uid - Firebase user ID
 * @returns {Promise<object|null>} Plan data or null
 */
async function getCurrentPlan(uid) {
    if (!kvReady) {
        console.warn("[KV] KV not configured, skipping getCurrentPlan");
        return null;
    }

    try {
        const key = getCurrentPlanKey(uid);
        const data = await kv.get(key);
        
        if (!data) {
            console.log(`[KV] No current plan found for user ${uid}`);
            return null;
        }

        // Data is already parsed by KV client
        return typeof data === "string" ? JSON.parse(data) : data;
    } catch (error) {
        console.error("[KV] Error getting current plan:", error);
        return null;
    }
}

/**
 * Save a named plan to user's library
 * @param {string} uid - Firebase user ID
 * @param {string} planId - Unique plan ID (generated if not provided)
 * @param {string} name - User-provided plan name
 * @param {object} planData - Complete plan data
 * @returns {Promise<object|null>} Saved plan metadata or null
 */
async function savePlan(uid, planId, name, planData) {
    if (!kvReady) {
        console.warn("[KV] KV not configured, skipping savePlan");
        return null;
    }

    try {
        const id = planId || generatePlanId();
        const planKey = getPlanKey(uid, id);
        const indexKey = getPlansIndexKey(uid);
        
        // Create plan metadata
        const metadata = {
            id: id,
            name: name || "Untitled Plan",
            createdAt: new Date().toISOString(),
            daysCount: planData.mealPlan ? planData.mealPlan.length : 0,
            totalCalories: calculateTotalCalories(planData),
        };

        // Store complete plan data with metadata
        const dataToStore = {
            ...metadata,
            planData: planData,
        };

        await kv.setex(planKey, TTL_SAVED_PLAN, JSON.stringify(dataToStore));

        // Update plans index
        const existingIndex = await kv.get(indexKey);
        let plansIndex = [];
        
        if (existingIndex) {
            plansIndex = typeof existingIndex === "string" ? JSON.parse(existingIndex) : existingIndex;
        }

        // Check if plan already exists in index
        const existingPlanIndex = plansIndex.findIndex((p) => p.id === id);
        if (existingPlanIndex >= 0) {
            // Update existing entry
            plansIndex[existingPlanIndex] = metadata;
        } else {
            // Add new entry
            plansIndex.push(metadata);
        }

        await kv.setex(indexKey, TTL_PLANS_INDEX, JSON.stringify(plansIndex));

        console.log(`[KV] Saved plan ${id} for user ${uid}`);
        return metadata;
    } catch (error) {
        console.error("[KV] Error saving plan:", error);
        return null;
    }
}

/**
 * Get a specific saved plan by ID
 * @param {string} uid - Firebase user ID
 * @param {string} planId - Plan ID
 * @returns {Promise<object|null>} Complete plan data or null
 */
async function getPlan(uid, planId) {
    if (!kvReady) {
        console.warn("[KV] KV not configured, skipping getPlan");
        return null;
    }

    try {
        const key = getPlanKey(uid, planId);
        const data = await kv.get(key);
        
        if (!data) {
            console.log(`[KV] Plan ${planId} not found for user ${uid}`);
            return null;
        }

        return typeof data === "string" ? JSON.parse(data) : data;
    } catch (error) {
        console.error("[KV] Error getting plan:", error);
        return null;
    }
}

/**
 * List all saved plans for a user (metadata only)
 * @param {string} uid - Firebase user ID
 * @returns {Promise<array>} Array of plan metadata
 */
async function listPlans(uid) {
    if (!kvReady) {
        console.warn("[KV] KV not configured, skipping listPlans");
        return [];
    }

    try {
        const indexKey = getPlansIndexKey(uid);
        const data = await kv.get(indexKey);
        
        if (!data) {
            console.log(`[KV] No plans index found for user ${uid}`);
            return [];
        }

        const plansIndex = typeof data === "string" ? JSON.parse(data) : data;
        return Array.isArray(plansIndex) ? plansIndex : [];
    } catch (error) {
        console.error("[KV] Error listing plans:", error);
        return [];
    }
}

/**
 * Delete a saved plan
 * @param {string} uid - Firebase user ID
 * @param {string} planId - Plan ID to delete
 * @returns {Promise<boolean>} Success status
 */
async function deletePlan(uid, planId) {
    if (!kvReady) {
        console.warn("[KV] KV not configured, skipping deletePlan");
        return false;
    }

    try {
        const planKey = getPlanKey(uid, planId);
        const indexKey = getPlansIndexKey(uid);

        // Delete the plan data
        await kv.del(planKey);

        // Update the index
        const existingIndex = await kv.get(indexKey);
        if (existingIndex) {
            let plansIndex = typeof existingIndex === "string" ? JSON.parse(existingIndex) : existingIndex;
            plansIndex = plansIndex.filter((p) => p.id !== planId);
            await kv.setex(indexKey, TTL_PLANS_INDEX, JSON.stringify(plansIndex));
        }

        console.log(`[KV] Deleted plan ${planId} for user ${uid}`);
        return true;
    } catch (error) {
        console.error("[KV] Error deleting plan:", error);
        return false;
    }
}

/**
 * Set a saved plan as the active current plan
 * @param {string} uid - Firebase user ID
 * @param {string} planId - Plan ID to set as active
 * @returns {Promise<boolean>} Success status
 */
async function setActivePlan(uid, planId) {
    if (!kvReady) {
        console.warn("[KV] KV not configured, skipping setActivePlan");
        return false;
    }

    try {
        // Get the saved plan
        const savedPlan = await getPlan(uid, planId);
        if (!savedPlan || !savedPlan.planData) {
            console.warn(`[KV] Cannot set active plan: plan ${planId} not found`);
            return false;
        }

        // Set it as current plan
        return await saveCurrentPlan(uid, savedPlan.planData);
    } catch (error) {
        console.error("[KV] Error setting active plan:", error);
        return false;
    }
}

/**
 * Helper function to calculate total calories from plan data
 * @param {object} planData - Plan data with mealPlan array
 * @returns {number} Total calories
 */
function calculateTotalCalories(planData) {
    if (!planData || !planData.mealPlan || !Array.isArray(planData.mealPlan)) {
        return 0;
    }

    let total = 0;
    for (const day of planData.mealPlan) {
        if (day && day.totals && typeof day.totals.calories === "number") {
            total += day.totals.calories;
        }
    }

    return Math.round(total);
}

module.exports = {
    saveCurrentPlan,
    getCurrentPlan,
    savePlan,
    getPlan,
    listPlans,
    deletePlan,
    setActivePlan,
    generatePlanId,
};