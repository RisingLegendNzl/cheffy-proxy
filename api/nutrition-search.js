// --- OPEN FOOD FACTS NUTRITION PROXY ---
const fetch = require('node-fetch');

// --- MAIN HANDLER ---
module.exports = async (request, response) => {
  // Set CORS headers
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const { barcode, query } = request.query;
  let openFoodFactsURL = '';

  if (barcode) {
    openFoodFactsURL = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
  } else if (query) {
    openFoodFactsURL = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
  } else {
    return response.status(400).json({ status: 'error', message: 'Missing barcode or query parameter' });
  }

  try {
    const apiResponse = await fetch(openFoodFactsURL, {
      method: 'GET',
      headers: { 'User-Agent': 'CheffyApp/1.0 (contact@yourapp.com)' }
    });

    if (!apiResponse.ok) {
      throw new Error(`Open Food Facts API returned: ${apiResponse.status}`);
    }

    const data = await apiResponse.json();
    const product = barcode ? data.product : (data.products && data.products[0]);

    if (product && product.nutriments && product.nutriments['energy-kcal_100g']) {
      const nutriments = product.nutriments;
      const detailedNutritionData = {
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
      return response.status(200).json(detailedNutritionData);
    } else {
      return response.status(200).json({ status: 'not_found' });
    }

  } catch (error) {
    return response.status(500).json({ status: 'error', message: error.message });
  }
};


