// api/plans/delete.js
// Endpoint to delete a saved plan from the user's library

const { deletePlan } = require("../lib/kv-storage");

module.exports = async function handler(req, res) {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "DELETE, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Allow both DELETE and POST methods
    if (req.method !== "DELETE" && req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        // Support both query params (DELETE) and body (POST)
        const uid = req.method === "DELETE" ? req.query.uid : req.body.uid;
        const planId = req.method === "DELETE" ? req.query.planId : req.body.planId;

        // Validate required fields
        if (!uid) {
            return res.status(400).json({ error: "Missing required parameter: uid" });
        }

        if (!planId) {
            return res.status(400).json({ error: "Missing required parameter: planId" });
        }

        // Delete the plan
        const success = await deletePlan(uid, planId);

        if (!success) {
            return res.status(500).json({ error: "Failed to delete plan" });
        }

        return res.status(200).json({
            success: true,
            message: "Plan deleted successfully",
            planId: planId,
        });
    } catch (error) {
        console.error("[delete] Error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
};