// api/plans/set-active.js
// Endpoint to set a saved plan as the current active plan

const { setActivePlan } = require("../lib/kv-storage");

module.exports = async function handler(req, res) {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { uid, planId } = req.body;

        // Validate required fields
        if (!uid) {
            return res.status(400).json({ error: "Missing required field: uid" });
        }

        if (!planId) {
            return res.status(400).json({ error: "Missing required field: planId" });
        }

        // Set the plan as active
        const success = await setActivePlan(uid, planId);

        if (!success) {
            return res.status(500).json({
                error: "Failed to set active plan",
                message: "Plan may not exist or could not be saved as current",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Plan set as active successfully",
            planId: planId,
        });
    } catch (error) {
        console.error("[set-active] Error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
};