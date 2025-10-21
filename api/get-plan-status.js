// --- API ENDPOINT: GET PLAN STATUS (POLLING) ---
const { kv } = require('@vercel/kv');

// This is a lightweight endpoint that the frontend calls repeatedly
// to check if the background job has finished.

module.exports = async function handler(request, response) {
    const { jobId } = request.query;

    if (!jobId) {
        return response.status(400).json({ message: 'Missing jobId parameter.' });
    }

    try {
        const resultJson = await kv.get(jobId);

        if (resultJson) {
            // Data is ready, return the full payload
            const result = JSON.parse(resultJson);
            return response.status(200).json({
                jobId,
                status: result.status, // will be 'complete' or 'failed'
                ...result
            });
        } else {
            // Job is not yet complete
            return response.status(202).json({
                jobId,
                status: 'processing',
                message: 'Market run is still in progress.'
            });
        }
    } catch (error) {
        console.error(`[${jobId}] GET STATUS ERROR:`, error);
        return response.status(500).json({
            jobId,
            status: 'failed',
            message: 'An error occurred while checking job status.',
            error: error.message
        });
    }
};

