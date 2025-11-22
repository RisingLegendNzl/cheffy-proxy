// --- Cheffy API: /api/plans.js ---
// Unified Meal Plan Persistence Endpoint
// Handles all plan CRUD operations in a single serverless function

/// ===== IMPORTS-START ===== \\\\
const { createClient } = require('@vercel/kv');
const crypto = require('crypto');
/// ===== IMPORTS-END ===== ////

/// ===== CONFIG-START ===== \\\\
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

/// ===== HELPERS-START ===== \\\\
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
        totalCost: planData.totalCost || 0
    };
}
/// ===== HELPERS-END ===== ////

/// ===== ACTION-HANDLERS-START ===== \\\\
// --- Save Current Plan ---
async function handleSaveCurrent(userId, planData, res) {
    if (!planData) {
        return res.status(400).json({ 
            message: 'Missing plan data',
            code: 'MISSING_PLAN_DATA'
        });
    }

    const key = getCurrentPlanKey(userId);
    const success = await kvSet(key, planData, TTL_CURRENT_PLAN_MS);

    if (success) {
        return res.status(200).json({
            message: 'Current plan saved successfully',
            key: key
        });
    } else {
        return res.status(500).json({
            message: 'Failed to save current plan',
            code: 'KV_SET_FAILED'
        });
    }
}

// --- Get Current Plan ---
async function handleGetCurrent(userId, res) {
    const key = getCurrentPlanKey(userId);
    const planData = await kvGet(key);

    if (planData) {
        return res.status(200).json({
            message: 'Current plan retrieved successfully',
            data: planData
        });
    } else {
        return res.status(404).json({
            message: 'No current plan found',
            code: 'PLAN_NOT_FOUND'
        });
    }
}

// --- Save Named Plan ---
async function handleSave(userId, planData, planName, res) {
    if (!planData) {
        return res.status(400).json({ 
            message: 'Missing plan data',
            code: 'MISSING_PLAN_DATA'
        });
    }

    if (!planName || typeof planName !== 'string' || planName.trim() === '') {
        return res.status(400).json({ 
            message: 'Missing or invalid plan name',
            code: 'INVALID_PLAN_NAME'
        });
    }

    const planId = generatePlanId();
    const planKey = getSavedPlanKey(userId, planId);
    const indexKey = getPlansIndexKey(userId);

    // Create plan metadata
    const metadata = createPlanMetadata(planId, planName.trim(), planData);

    // Save the plan data
    const planSaved = await kvSet(planKey, planData, TTL_SAVED_PLAN_MS);
    if (!planSaved) {
        return res.status(500).json({
            message: 'Failed to save plan',
            code: 'KV_SET_FAILED'
        });
    }

    // Update the index
    let index = await kvGet(indexKey);
    if (!index || !Array.isArray(index)) {
        index = [];
    }

    index.push(metadata);
    const indexSaved = await kvSet(indexKey, index, TTL_INDEX_MS);

    if (!indexSaved) {
        // Try to clean up the plan we just saved
        await kvDelete(planKey);
        return res.status(500).json({
            message: 'Failed to update plans index',
            code: 'INDEX_UPDATE_FAILED'
        });
    }

    return res.status(200).json({
        message: 'Plan saved successfully',
        planId: planId,
        metadata: metadata
    });
}

// --- List Saved Plans ---
async function handleList(userId, res) {
    const indexKey = getPlansIndexKey(userId);
    const index = await kvGet(indexKey);

    if (!index || !Array.isArray(index)) {
        return res.status(200).json({
            message: 'No saved plans found',
            plans: []
        });
    }

    // Sort by updatedAt descending (newest first)
    const sortedPlans = index.sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    return res.status(200).json({
        message: 'Plans retrieved successfully',
        plans: sortedPlans
    });
}

// --- Load Specific Plan ---
async function handleLoad(userId, planId, res) {
    if (!planId || typeof planId !== 'string') {
        return res.status(400).json({
            message: 'Missing or invalid plan ID',
            code: 'INVALID_PLAN_ID'
        });
    }

    const planKey = getSavedPlanKey(userId, planId);
    const planData = await kvGet(planKey);

    if (!planData) {
        return res.status(404).json({
            message: 'Plan not found',
            code: 'PLAN_NOT_FOUND'
        });
    }

    // Also get metadata from index
    const indexKey = getPlansIndexKey(userId);
    const index = await kvGet(indexKey);
    let metadata = null;

    if (index && Array.isArray(index)) {
        metadata = index.find(p => p.planId === planId);
    }

    return res.status(200).json({
        message: 'Plan loaded successfully',
        data: planData,
        metadata: metadata
    });
}

// --- Delete Plan ---
async function handleDelete(userId, planId, res) {
    if (!planId || typeof planId !== 'string') {
        return res.status(400).json({
            message: 'Missing or invalid plan ID',
            code: 'INVALID_PLAN_ID'
        });
    }

    const planKey = getSavedPlanKey(userId, planId);
    const indexKey = getPlansIndexKey(userId);

    // Delete the plan data
    const planDeleted = await kvDelete(planKey);

    // Update the index
    let index = await kvGet(indexKey);
    if (index && Array.isArray(index)) {
        const originalLength = index.length;
        index = index.filter(p => p.planId !== planId);
        
        if (index.length < originalLength) {
            await kvSet(indexKey, index, TTL_INDEX_MS);
        }
    }

    // Check if this was the active plan and clear it if so
    const activePlanKey = getActivePlanKey(userId);
    const activePlanId = await kvGet(activePlanKey);
    if (activePlanId === planId) {
        await kvDelete(activePlanKey);
    }

    if (planDeleted) {
        return res.status(200).json({
            message: 'Plan deleted successfully',
            planId: planId
        });
    } else {
        return res.status(404).json({
            message: 'Plan not found or already deleted',
            code: 'PLAN_NOT_FOUND'
        });
    }
}

// --- Set Active Plan ---
async function handleSetActive(userId, planId, res) {
    if (!planId || typeof planId !== 'string') {
        return res.status(400).json({
            message: 'Missing or invalid plan ID',
            code: 'INVALID_PLAN_ID'
        });
    }

    // Verify the plan exists
    const planKey = getSavedPlanKey(userId, planId);
    const planExists = await kvGet(planKey);

    if (!planExists) {
        return res.status(404).json({
            message: 'Plan not found',
            code: 'PLAN_NOT_FOUND'
        });
    }

    // Set as active
    const activePlanKey = getActivePlanKey(userId);
    const success = await kvSet(activePlanKey, planId, TTL_ACTIVE_PLAN_MS);

    if (success) {
        return res.status(200).json({
            message: 'Active plan set successfully',
            planId: planId
        });
    } else {
        return res.status(500).json({
            message: 'Failed to set active plan',
            code: 'KV_SET_FAILED'
        });
    }
}
/// ===== ACTION-HANDLERS-END ===== ////

/// ===== MAIN-HANDLER-START ===== \\\\
module.exports = async function handler(req, res) {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // --- Handle OPTIONS Pre-flight ---
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // --- Check KV Availability ---
    if (!kvReady) {
        console.error('[PLANS] KV not configured');
        return res.status(500).json({
            message: 'Server configuration error: Storage not available',
            code: 'KV_NOT_CONFIGURED'
        });
    }

    // --- Extract Action and UserId ---
    const action = req.query.action || req.body?.action;
    const userId = req.body?.userId || req.query?.userId;

    // --- Validate UserId ---
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
        return res.status(401).json({
            message: 'Unauthorized: Missing or invalid userId',
            code: 'MISSING_USER_ID'
        });
    }

    // --- Validate Action ---
    if (!action) {
        return res.status(400).json({
            message: 'Missing action parameter',
            code: 'MISSING_ACTION'
        });
    }

    // --- Route to Action Handler ---
    try {
        switch(action) {
            case 'save-current':
                if (req.method !== 'POST') {
                    return res.status(405).json({ message: 'Method Not Allowed. Use POST.' });
                }
                return await handleSaveCurrent(userId, req.body.planData, res);

            case 'get-current':
                if (req.method !== 'GET' && req.method !== 'POST') {
                    return res.status(405).json({ message: 'Method Not Allowed. Use GET or POST.' });
                }
                return await handleGetCurrent(userId, res);

            case 'save':
                if (req.method !== 'POST') {
                    return res.status(405).json({ message: 'Method Not Allowed. Use POST.' });
                }
                return await handleSave(userId, req.body.planData, req.body.planName, res);

            case 'list':
                if (req.method !== 'GET' && req.method !== 'POST') {
                    return res.status(405).json({ message: 'Method Not Allowed. Use GET or POST.' });
                }
                return await handleList(userId, res);

            case 'load':
                if (req.method !== 'GET' && req.method !== 'POST') {
                    return res.status(405).json({ message: 'Method Not Allowed. Use GET or POST.' });
                }
                const loadPlanId = req.body?.planId || req.query?.planId;
                return await handleLoad(userId, loadPlanId, res);

            case 'delete':
                if (req.method !== 'POST' && req.method !== 'DELETE') {
                    return res.status(405).json({ message: 'Method Not Allowed. Use POST or DELETE.' });
                }
                const deletePlanId = req.body?.planId || req.query?.planId;
                return await handleDelete(userId, deletePlanId, res);

            case 'set-active':
                if (req.method !== 'POST') {
                    return res.status(405).json({ message: 'Method Not Allowed. Use POST.' });
                }
                const activePlanId = req.body?.planId || req.query?.planId;
                return await handleSetActive(userId, activePlanId, res);

            default:
                return res.status(400).json({
                    message: `Invalid action: ${action}`,
                    code: 'INVALID_ACTION',
                    validActions: ['save-current', 'get-current', 'save', 'list', 'load', 'delete', 'set-active']
                });
        }
    } catch (error) {
        console.error('[PLANS] Handler error:', error);
        return res.status(500).json({
            message: 'Internal server error',
            code: 'INTERNAL_ERROR',
            details: error.message
        });
    }
};
/// ===== MAIN-HANDLER-END ===== ////