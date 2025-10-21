// Use 'require' for node-fetch version 2.x, which Vercel supports
const fetch = require('node-fetch');

// Vercel's main handler for serverless functions
export default async function handler(request, response) {

  // 1. Get 'barcode' or 'query' from your React app's request
  const { barcode, query } = request.query;

  let openFoodFactsURL = '';

  // 2. Decide which Open Food Facts API to use
  if (barcode) {
    // API for getting a specific product by its barcode
    openFoodFactsURL = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
  } else if (query) {
    // API for searching for a product by its name
    openFoodFactsURL = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
  } else {
    // If no barcode or query, send an error
    return response.status(400).json({ status: 'error', message: 'Missing barcode or query parameter' });
  }

  try {
    // 3. Call the REAL Open Food Facts API
    const apiResponse = await fetch(openFoodFactsURL, {
      method: 'GET',
      headers: {
        // This User-Agent is REQUIRED by Open Food Facts.
        // Change the email to your own.
        'User-Agent': 'CheffyApp/1.0 (youremail@example.com)'
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`Open Food Facts API returned: ${apiResponse.status}`);
    }

    const data = await apiResponse.json();

    // 4. Find the product in the response data
    let product;
    if (barcode) {
      // Barcode lookup response structure
      product = data.product;
    } else if (query && data.products && data.products.length > 0) {
      // Search lookup response structure
      product = data.products[0];
    }

    // 5. Check if we found a product AND it has nutrition info
    if (product && product.nutriments && product.nutriments['energy-kcal_100g']) {

      const nutriments = product.nutriments;

      // 6. Format the data to EXACTLY match what your React app expects
      const nutritionData = {
        status: 'found',
        calories: nutriments['energy-kcal_100g'] || 0,
        protein: nutriments.proteins_100g || 0,
        fat: nutriments.fat_100g || 0,
        carbs: nutriments.carbohydrates_100g || 0,
      };

      // 7. Send the successful response back to your React app
      // Vercel handles CORS (Access-Control-Allow-Origin) automatically
      return response.status(200).json(nutritionData);

    } else {
      // 7b. Send the "not_found" response (matches your app's MOCK_NUTRITION_DATA)
      const mockData = { status: 'not_found', calories: 0, protein: 0, fat: 0, carbs: 0 };
      return response.status(200).json(mockData);
    }

  } catch (error) {
    // 7c. Send a server error
    return response.status(500).json({ status: 'error', message: error.message });
  }
}
