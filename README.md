Cheffy V3 - AI Meal Planner

Cheffy is an intelligent meal planning application. It generates personalized, multi-day meal plans based on user biometrics and goals, then performs real-time price analysis to build a cost-effective shopping list from Australian supermarkets.

Core Architecture

The application is split into a React frontend and a Vercel serverless backend.

Data Flow:

Frontend (React) gathers user data and sends a single POST request to /api/generate-full-plan.

api/generate-full-plan (Orchestrator) receives the request and:
a.  (Gemini Call 1): Generates a "blueprint" (meal plan, ingredient list, nutritional targets).
b.  Market Run: Calls price-search.js (RapidAPI) for all ingredients concurrently.
c.  (Gemini Call 2): Sends all product names from the Market Run to Gemini for AI-powered classification to filter irrelevant items.
d.  Returns a single, large JSON object to the frontend, including the meal plan, filtered price data, and diagnostic logs.

Frontend (React) dynamically renders the dashboard.

Frontend (React) makes on-demand GET requests to /api/nutrition-search as the user explores items.

Technology Stack

Frontend

React: Single-file dashboard application (App.jsx).

lucide-react: For icons.

Backend (Vercel)

Node.js: Serverless function environment.

axios / node-fetch: For making external API calls.

External Services

Google Gemini: Used for both meal plan generation and product analysis/filtering.

RapidAPI (Coles/Woolworths): Used for real-time price scraping.

Open Food Facts: Used for on-demand nutritional data.

Project Setup

This project is deployed on Vercel, connected to a GitHub repository.

Environment Variables

The Vercel deployment requires the following environment variables:

GEMINI_API_KEY=sk-...
RAPIDAPI_KEY=...


Vercel Configuration (vercel.json)

The function timeout is set to 300 seconds to accommodate the long-running orchestrator.

{
  "functions": {
    "api/**/*.js": {
      "maxDuration": 300
    }
  }
}


API Endpoints

POST /api/generate-full-plan

Description: The main orchestrator endpoint. Takes the user's form data as a JSON body.

Returns: A complete JSON payload with mealPlan, uniqueIngredients, results (price data), nutritionalTargets, and logs.

GET /api/nutrition-search

Description: A public endpoint called by the frontend to get nutritional data for a specific product.

Params: ?barcode=... or ?query=...

Returns: A JSON object from Open Food Facts (e.g., { status: 'found', calories: 120, ... }).

To-Do List / Future Development

[ ] Firebase Integration:

[ ] Add Firebase SDK to the React frontend.

[ ] Implement user authentication.

[ ] Configure Firestore security rules.

[ ] User Features:

[ ] Save generated meal plans to a user's Firestore account.

[ ] Load existing meal plans from Firestore.

[ ] Create a "Profile" page to save biometric defaults.