// --- API ENDPOINT: GET PLAN STATUS (POLLING) - FIXED ---
const { kv } = require('@vercel/kv');

module.exports = async function handler(request, response) {
    const { jobId } = request.query;
    if (!jobId) {
        return response.status(400).json({ message: 'Missing jobId parameter.' });
    }

    try {
        const resultJson = await kv.get(jobId);

        if (resultJson) {
            // Data is ready, return the full payload which now includes logs
            const result = JSON.parse(resultJson);
            return response.status(200).json({
                jobId,
                status: result.status,
                ...result // This will contain 'results' and 'logs'
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
        return response.status(500).json({
            jobId,
            status: 'failed',
            message: 'An error occurred while checking job status.',
            error: error.message
        });
    }
};


