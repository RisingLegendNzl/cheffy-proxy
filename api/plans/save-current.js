// api/plans/save-current.js
// Endpoint to save the current active plan for a user

const { saveCurrentPlan } = require("../lib/kv-storage");

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
        const { uid, planData } = req.body;

        // Validate required fields
        if (!uid) {
            return res.status(400).json({ error: "Missing required field: uid" });
        }

        if (!planData) {
            return res.status(400).json({ error: "Missing required field: planData" });
        }

        // Save the current plan
        const success = await saveCurrentPlan(uid, planData);

        if (!success) {
            return res.status(500).json({ error: "Failed to save current plan" });
        }

        return res.status(200).json({
            success: true,
            message: "Current plan saved successfully",
        });
    } catch (error) {
        console.error("[save-current] Error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
};