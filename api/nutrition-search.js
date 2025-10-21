// --- OPEN FOOD FACTS NUTRITION PROXY ---
const fetch = require('node-fetch');

/**
 * Core reusable logic for fetching nutrition data. This function is "pure"
 * and does not depend on Vercel's request/response objects.
 * @param {string} barcode - The product barcode.
 * @param {string} query - The product search query.
 * @returns {Promise<Object>} A promise that resolves to the nutrition data object.
 */
async function fetchNutritionData(barcode, query) {
  let openFoodFactsURL = '';

  if (barcode) {
    openFoodFactsURL = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
  } else if (query) {
    openFoodFactsURL = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
  } else {
    throw new Error('Missing barcode or query parameter');
  }

  try {
    const apiResponse = await fetch(openFoodFactsURL, {
      method: 'GET',
      headers: { 'User-Agent': 'CheffyApp/1.0 (contact@yourapp.com)' }
    });

    if (!apiResponse.ok) {
      // Don't throw an error, just return a "not_found" status so the orchestrator can continue.
      console.warn(`Open Food Facts API returned: ${apiResponse.status} for query: ${query || barcode}`);
      return { status: 'not_found' };
    }

    const data = await apiResponse.json();
    const product = barcode ? data.product : (data.products && data.products[0]);

    if (product && product.nutriments && product.nutriments['energy-kcal_100g']) {
      const nutriments = product.nutriments;
      return {
        status: 'found',
        servingUnit: product.nutrition_data_per || '100g',
        calories: parseFloat(nutriments['energy-kcal_100g'] || 0),
        protein: parseFloat(nutriments.proteins_100g || 0),
        fat: parseFloat(nutriments.fat_100g || 0),
        saturatedFat: parseFloat(nutriments['saturated-fat_100g'] || 0),
        carbs: parseFloat(nutriments.carbohydrates_100g || 0),
        sugars: parseFloat(nutriments.sugars_100g || 0),
        fiber: parseFloat(nutriments.fiber_100g || 0),
        sodium: parseFloat(nutriments.sodium_100g || 0)
      };
    } else {
      return { status: 'not_found' };
    }

  } catch (error) {
    console.error(`Nutrition Fetch Error for "${query || barcode}":`, error.message);
    // Return a "not_found" status on catastrophic failure.
    return { status: 'not_found' };
  }
}

/**
 * Vercel serverless function handler. This is kept for direct testing but is no longer
 * the primary way the orchestrator calls this logic.
 */
module.exports = async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  try {
    const { barcode, query } = request.query;
    const nutritionData = await fetchNutritionData(barcode, query);
    return response.status(200).json(nutritionData);
  } catch (error) {
    return response.status(400).json({ status: 'error', message: error.message });
  }
};

// Export the pure function for internal use by other scripts
module.exports.fetchNutritionData = fetchNutritionData;

