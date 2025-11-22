// api/plans/list.js
// Endpoint to list all saved plans for a user (metadata only)

const { listPlans } = require("../lib/kv-storage");

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

        // Get list of plans
        const plans = await listPlans(uid);

        // Sort by creation date (most recent first)
        const sortedPlans = plans.sort((a, b) => {
            const dateA = new Date(a.createdAt);
            const dateB = new Date(b.createdAt);
            return dateB - dateA;
        });

        return res.status(200).json({
            success: true,
            plans: sortedPlans,
            count: sortedPlans.length,
        });
    } catch (error) {
        console.error("[list] Error:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
};