// api/plans/load.js
// Endpoint to load a specific saved plan by ID

const { getPlan } = require("../lib/kv-storage");

module.exports = async function handler(req, res) {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Only allow GET
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { uid, planId } = req.query;

        // Validate required fields
        if (!uid) {
            return res.status(400).json({ error: "Missing required parameter: uid" });
        }

        if (!planId) {
            return res.status(400).json({ error: "Missing required parameter: planId" });
        }

        // Get the plan
        const planData = await getPlan(uid, planId);

        if (!planData) {
            return res.status(404).json({
                error: "Plan not found",
                message: `No plan found with ID: ${planId}`,
            });
        }

        return res.status(200).json({
            success: true,
            data: planData,
        });
    } catch (error) {
        console.error("[load] Error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
};