// api/plans/get-current.js
// Endpoint to retrieve the current active plan for a user

const { getCurrentPlan } = require("../lib/kv-storage");

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
        const { uid } = req.query;

        // Validate required fields
        if (!uid) {
            return res.status(400).json({ error: "Missing required parameter: uid" });
        }

        // Get the current plan
        const planData = await getCurrentPlan(uid);

        if (!planData) {
            return res.status(404).json({
                error: "No current plan found",
                message: "User has no active plan",
            });
        }

        return res.status(200).json({
            success: true,
            data: planData,
        });
    } catch (error) {
        console.error("[get-current] Error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
};