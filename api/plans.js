// api/plans.js
// Backend validation endpoint for meal plan persistence
// Validates requests and provides API contract
// Actual Firestore operations handled by frontend (matching existing pattern)

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Method not allowed',
            message: 'Only POST requests are supported'
        });
    }

    try {
        const { action, userId, planId, planData, planName } = req.body;

        // Validate required fields
        if (!action) {
            return res.status(400).json({
                error: 'Missing action',
                message: 'Request must include an action field'
            });
        }

        if (!userId) {
            return res.status(400).json({
                error: 'Missing userId',
                message: 'Request must include a userId field'
            });
        }

        // Validate action type
        const validActions = ['save', 'load', 'list', 'delete', 'set-active'];
        if (!validActions.includes(action)) {
            return res.status(400).json({
                error: 'Invalid action',
                message: `Action must be one of: ${validActions.join(', ')}`
            });
        }

        // Action-specific validation
        switch (action) {
            case 'save':
                if (!planData) {
                    return res.status(400).json({
                        error: 'Missing planData',
                        message: 'Save action requires planData field'
                    });
                }
                if (!planData.mealPlan || !Array.isArray(planData.mealPlan)) {
                    return res.status(400).json({
                        error: 'Invalid planData',
                        message: 'planData.mealPlan must be an array'
                    });
                }
                break;

            case 'load':
            case 'delete':
            case 'set-active':
                if (!planId) {
                    return res.status(400).json({
                        error: 'Missing planId',
                        message: `${action} action requires planId field`
                    });
                }
                break;

            case 'list':
                // No additional validation needed
                break;
        }

        // All validation passed - return success
        // Frontend will handle actual Firestore operations
        return res.status(200).json({
            success: true,
            action: action,
            userId: userId,
            message: 'Request validated successfully'
        });

    } catch (error) {
        console.error('[PLANS_API] Error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message || 'An unexpected error occurred'
        });
    }
};