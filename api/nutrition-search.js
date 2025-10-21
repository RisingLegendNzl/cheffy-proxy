// Use 'require' for node-fetch version 2.x, which Vercel supports
const fetch = require('node-fetch');

// Vercel's main handler for serverless functions
export default async function handler(request, response) {
  
  // --- START CORS FIX ---
  // Set permission headers to allow any domain to access this API
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle pre-flight requests for CORS
  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }
  // --- END CORS FIX ---

  // 1. Get 'barcode' or 'query' from your React app's request
  const { barcode, query } = request.query;

  let openFoodFactsURL = '';

  // 2. Decide which Open Food Facts API to use
  if (barcode) {
    openFoodFactsURL = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
  } else if (query) {
    openFoodFactsURL = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
  } else {
    return response.status(400).json({ status: 'error', message: 'Missing barcode or query parameter' });
  }

  try {
    // 3. Call the REAL Open Food Facts API
    const apiResponse = await fetch(openFoodFactsURL, {
      method: 'GET',
      headers: {
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
      product = data.product;
    } else if (query && data.products && data.products.length > 0) {
      product = data.products[0];
    }

    // 5. Check if we found a product AND it has nutrition info
    if (product && product.nutriments && product.nutriments['energy-kcal_100g']) {
      const nutriments = product.nutriments;
      const nutritionData = {
        status: 'found',
        calories: nutriments['energy-kcal_100g'] || 0,
        protein: nutriments.proteins_100g || 0,
        fat: nutriments.fat_100g || 0,
        carbs: nutriments.carbohydrates_100g || 0,
      };
      return response.status(200).json(nutritionData);
    } else {
      const mockData = { status: 'not_found', calories: 0, protein: 0, fat: 0, carbs: 0 };
      return response.status(200).json(mockData);
    }

  } catch (error) {
    return response.status(500).json({ status: 'error', message: error.message });
  }
}
