// api/plans/save.js
// Endpoint to save a named plan to the user's library

const { savePlan } = require("../lib/kv-storage");

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
        const { uid, planId, name, planData } = req.body;

        // Validate required fields
        if (!uid) {
            return res.status(400).json({ error: "Missing required field: uid" });
        }

        if (!name || typeof name !== "string" || name.trim().length === 0) {
            return res.status(400).json({ error: "Missing or invalid required field: name" });
        }

        if (!planData) {
            return res.status(400).json({ error: "Missing required field: planData" });
        }

        // Validate plan name length
        if (name.length > 100) {
            return res.status(400).json({ error: "Plan name too long (max 100 characters)" });
        }

        // Save the plan (planId is optional, will be generated if not provided)
        const metadata = await savePlan(uid, planId, name.trim(), planData);

        if (!metadata) {
            return res.status(500).json({ error: "Failed to save plan" });
        }

        return res.status(200).json({
            success: true,
            message: "Plan saved successfully",
            plan: metadata,
        });
    } catch (error) {
        console.error("[save] Error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
};