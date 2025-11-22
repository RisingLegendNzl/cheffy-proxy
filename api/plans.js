// --- Cheffy API: /api/plans.js ---
// Unified Meal Plan Persistence Endpoint
// Handles all plan CRUD operations in a single serverless function

/// ===== IMPORTS-START ===== \\
const { createClient } = require('@vercel/kv');
const crypto = require('crypto');
/// ===== IMPORTS-END ===== ////

/// ===== CONFIG-START ===== \\
// --- Vercel KV Client ---
const kv = createClient({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// --- Cache TTLs ---
const TTL_CURRENT_PLAN_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const TTL_SAVED_PLAN_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TTL_INDEX_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TTL_ACTIVE_PLAN_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
/// ===== CONFIG-END ===== ////

/// ===== HELPERS-START ===== \\
// --- KV Helper Functions ---
async function kvGet(key) {
    if (!kvReady) return null;
    try {
        return await kv.get(key);
    } catch (e) {
        console.error(`[KV] GET Error for key ${key}:`, e.message);
        return null;
    }
}

async function kvSet(key, value, ttl) {
    if (!kvReady) return false;
    try {
        await kv.set(key, value, { px: ttl });
        return true;
    } catch (e) {
        console.error(`[KV] SET Error for key ${key}:`, e.message);
        return false;
    }
}

async function kvDelete(key) {
    if (!kvReady) return false;
    try {
        await kv.del(key);
        return true;
    } catch (e) {
        console.error(`[KV] DELETE Error for key ${key}:`, e.message);
        return false;
    }
}

// --- Key Generation Functions ---
function getCurrentPlanKey(userId) {
    return `user:${userId}:current-plan`;
}

function getSavedPlanKey(userId, planId) {
    return `user:${userId}:plans:${planId}`;
}

function getPlansIndexKey(userId) {
    return `user:${userId}:plans-index`;
}

function getActivePlanKey(userId) {
    return `user:${userId}:active-plan`;
}

// --- Utility Functions ---
function generatePlanId() {
    return crypto.randomUUID();
}

function createPlanMetadata(planId, name, planData) {
    return {
        planId: planId,
        name: name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        days: planData.mealPlan ? planData.mealPlan.length : 0,
        totalCost: planData.totalCost || 0,
        totalCalories: calculateTotalCalories(planData),
        formData: planData.formData ? {
            goal: planData.formData.goal,
            days: planData.formData.days,
            dietary: planData.formData.dietary,
            store: planData.formData.store
        } : {}
    };
}

function calculateTotalCalories(planData) {
    if (!planData.mealPlan) return 0;
    return planData.mealPlan.reduce((total, day) => {
        return total + (day.meals || []).reduce((dayTotal, meal) => {
            return dayTotal + (meal.subtotal_kcal || 0);
        }, 0);
    }, 0);
}

// --- CORS Headers ---
function setCorsHeaders(response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');
}
/// ===== HELPERS-END ===== ////

/// ===== OPERATIONS-START ===== \\
// --- Save Current Plan (Auto-save) ---
async function saveCurrentPlan(userId, planData) {
    const key = getCurrentPlanKey(userId);
    const success = await kvSet(key, {
        ...planData,
        savedAt: new Date().toISOString(),
        isAutoSave: true
    }, TTL_CURRENT_PLAN_MS);
    
    return {
        success,
        message: success ? 'Current plan auto-saved' : 'Failed to save current plan'
    };
}

// --- Get Current Plan ---
async function getCurrentPlan(userId) {
    const key = getCurrentPlanKey(userId);
    const plan = await kvGet(key);
    
    if (!plan) {
        return {
            success: false,
            message: 'No current plan found',
            plan: null
        };
    }
    
    return {
        success: true,
        plan
    };
}

// --- Save Named Plan ---
async function saveNamedPlan(userId, name, planData) {
    const planId = generatePlanId();
    const planKey = getSavedPlanKey(userId, planId);
    const indexKey = getPlansIndexKey(userId);
    
    // Save the full plan
    const planSaved = await kvSet(planKey, {
        ...planData,
        planId,
        name,
        savedAt: new Date().toISOString()
    }, TTL_SAVED_PLAN_MS);
    
    if (!planSaved) {
        return {
            success: false,
            message: 'Failed to save plan'
        };
    }
    
    // Update the index
    let index = await kvGet(indexKey) || [];
    const metadata = createPlanMetadata(planId, name, planData);
    index = [metadata, ...index.filter(p => p.planId !== planId)].slice(0, 20); // Keep max 20 plans
    
    await kvSet(indexKey, index, TTL_INDEX_MS);
    
    return {
        success: true,
        message: `Plan "${name}" saved successfully`,
        planId,
        metadata
    };
}

// --- List Saved Plans ---
async function listSavedPlans(userId) {
    const indexKey = getPlansIndexKey(userId);
    const index = await kvGet(indexKey) || [];
    
    // Get active plan ID
    const activeKey = getActivePlanKey(userId);
    const activePlanId = await kvGet(activeKey);
    
    // Mark active plan in the list
    const plansWithActive = index.map(plan => ({
        ...plan,
        isActive: plan.planId === activePlanId
    }));
    
    return {
        success: true,
        plans: plansWithActive,
        count: plansWithActive.length
    };
}

// --- Load Saved Plan ---
async function loadSavedPlan(userId, planId) {
    const planKey = getSavedPlanKey(userId, planId);
    const plan = await kvGet(planKey);
    
    if (!plan) {
        return {
            success: false,
            message: 'Plan not found',
            plan: null
        };
    }
    
    // Update last accessed time in index
    const indexKey = getPlansIndexKey(userId);
    let index = await kvGet(indexKey) || [];
    index = index.map(p => 
        p.planId === planId 
            ? { ...p, lastAccessed: new Date().toISOString() }
            : p
    );
    await kvSet(indexKey, index, TTL_INDEX_MS);
    
    return {
        success: true,
        plan
    };
}

// --- Delete Saved Plan ---
async function deleteSavedPlan(userId, planId) {
    const planKey = getSavedPlanKey(userId, planId);
    const indexKey = getPlansIndexKey(userId);
    
    // Delete the plan
    await kvDelete(planKey);
    
    // Update the index
    let index = await kvGet(indexKey) || [];
    index = index.filter(p => p.planId !== planId);
    await kvSet(indexKey, index, TTL_INDEX_MS);
    
    // If this was the active plan, clear it
    const activeKey = getActivePlanKey(userId);
    const activePlanId = await kvGet(activeKey);
    if (activePlanId === planId) {
        await kvDelete(activeKey);
    }
    
    return {
        success: true,
        message: 'Plan deleted successfully'
    };
}

// --- Set Active Plan ---
async function setActivePlan(userId, planId) {
    const activeKey = getActivePlanKey(userId);
    
    if (!planId) {
        // Clear active plan
        await kvDelete(activeKey);
        return {
            success: true,
            message: 'Active plan cleared'
        };
    }
    
    // Verify plan exists
    const planKey = getSavedPlanKey(userId, planId);
    const plan = await kvGet(planKey);
    
    if (!plan) {
        return {
            success: false,
            message: 'Plan not found'
        };
    }
    
    // Set as active
    await kvSet(activeKey, planId, TTL_ACTIVE_PLAN_MS);
    
    return {
        success: true,
        message: 'Active plan set',
        planId
    };
}

// --- Get Active Plan ---
async function getActivePlan(userId) {
    const activeKey = getActivePlanKey(userId);
    const activePlanId = await kvGet(activeKey);
    
    if (!activePlanId) {
        return {
            success: false,
            message: 'No active plan set',
            plan: null
        };
    }
    
    // Load the active plan
    return loadSavedPlan(userId, activePlanId);
}
/// ===== OPERATIONS-END ===== ////

/// ===== MAIN-HANDLER-START ===== \\
module.exports = async (request, response) => {
    setCorsHeaders(response);
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
        response.status(200).end();
        return;
    }
    
    // Check KV availability
    if (!kvReady) {
        response.status(503).json({
            success: false,
            message: 'Storage service unavailable'
        });
        return;
    }
    
    // Get user ID from header or body
    const userId = request.headers['x-user-id'] || request.body?.userId;
    
    if (!userId) {
        response.status(400).json({
            success: false,
            message: 'User ID required'
        });
        return;
    }
    
    // Route based on method and action
    const { method } = request;
    const { action, planId, name, planData } = request.body || {};
    
    try {
        let result;
        
        // GET requests
        if (method === 'GET') {
            const { action: queryAction, planId: queryPlanId } = request.query;
            
            switch (queryAction) {
                case 'current':
                    result = await getCurrentPlan(userId);
                    break;
                case 'list':
                    result = await listSavedPlans(userId);
                    break;
                case 'active':
                    result = await getActivePlan(userId);
                    break;
                case 'load':
                    if (!queryPlanId) {
                        response.status(400).json({
                            success: false,
                            message: 'Plan ID required'
                        });
                        return;
                    }
                    result = await loadSavedPlan(userId, queryPlanId);
                    break;
                default:
                    response.status(400).json({
                        success: false,
                        message: 'Invalid action'
                    });
                    return;
            }
        }
        
        // POST requests
        else if (method === 'POST') {
            switch (action) {
                case 'saveCurrent':
                    if (!planData) {
                        response.status(400).json({
                            success: false,
                            message: 'Plan data required'
                        });
                        return;
                    }
                    result = await saveCurrentPlan(userId, planData);
                    break;
                    
                case 'saveNamed':
                    if (!name || !planData) {
                        response.status(400).json({
                            success: false,
                            message: 'Name and plan data required'
                        });
                        return;
                    }
                    result = await saveNamedPlan(userId, name, planData);
                    break;
                    
                case 'setActive':
                    result = await setActivePlan(userId, planId);
                    break;
                    
                case 'delete':
                    if (!planId) {
                        response.status(400).json({
                            success: false,
                            message: 'Plan ID required'
                        });
                        return;
                    }
                    result = await deleteSavedPlan(userId, planId);
                    break;
                    
                default:
                    response.status(400).json({
                        success: false,
                        message: 'Invalid action'
                    });
                    return;
            }
        }
        
        // Unsupported method
        else {
            response.status(405).json({
                success: false,
                message: 'Method not allowed'
            });
            return;
        }
        
        // Send result
        response.status(result.success ? 200 : 404).json(result);
        
    } catch (error) {
        console.error('[Plans API] Error:', error);
        response.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};
/// ===== MAIN-HANDLER-END ===== ////