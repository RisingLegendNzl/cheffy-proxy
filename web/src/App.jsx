// web/src/App.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Package, DollarSign, ExternalLink, Calendar, Users, Menu, X, ChevronsDown, ChevronsUp, ShoppingBag, BookOpen, ChefHat, Tag, Soup, Replace, Target, FileText, LayoutDashboard, Terminal, Loader, ChevronRight, GripVertical, Flame, Droplet, Wheat, ChevronDown, ChevronUp, Download, ListX, Save, FolderDown, User, Check, ListChecks, ListOrdered } from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, setLogLevel } from 'firebase/firestore';

// --- Component Imports ---
import InputField from './components/InputField';
import DaySlider from './components/DaySlider';
import DaySidebar from './components/DaySidebar';
import ProductCard from './components/ProductCard';
import CollapsibleSection from './components/CollapsibleSection';
import SubstituteMenu from './components/SubstituteMenu';
import GenerationProgressDisplay from './components/GenerationProgressDisplay';
import NutritionalInfo from './components/NutritionalInfo';
import IngredientResultBlock from './components/IngredientResultBlock';
import MealPlanDisplay from './components/MealPlanDisplay';
import LogEntry from './components/LogEntry';
import DiagnosticLogViewer from './components/DiagnosticLogViewer';
import FailedIngredientLogViewer from './components/FailedIngredientLogViewer';
import RecipeModal from './components/RecipeModal';
import EmojiIcon from './components/EmojiIcon';

// --- CONFIGURATION ---
const ORCHESTRATOR_TARGETS_API_URL = '/api/plan/targets'; // Use relative path for Vercel proxy
const ORCHESTRATOR_DAY_API_URL = '/api/plan/day';         // Use relative path for Vercel proxy
const NUTRITION_API_URL = '/api/nutrition-search'; // Use relative path for Vercel proxy
const MAX_SUBSTITUTES = 5;
const FIRESTORE_PROFILE_COLLECTION = 'profile'; // Collection name within user data
const FIRESTORE_PROFILE_DOC_ID = 'userProfile'; // Document ID for the profile

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = {
    name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 15.99, size: "1kg",
    url: "#api_down_mock_product", unit_price_per_100: 1.59,
};

// --- Firebase Config and App ID (Provided by Environment) ---
// Note: Vite uses import.meta.env for env vars
const firebaseConfigStr = import.meta.env.VITE_FIREBASE_CONFIG;
const appId = import.meta.env.VITE_APP_ID || 'default-app-id';

let firebaseConfig = null;
try {
    if (firebaseConfigStr) {
        firebaseConfig = JSON.parse(firebaseConfigStr);
    } else {
        console.warn("[FIREBASE] VITE_FIREBASE_CONFIG is not defined.");
    }
} catch (e) {
    console.error("CRITICAL: Failed to parse Firebase config:", e);
}


// --- [NEW] SSE Stream Parser ---
/**
 * Processes a chunk of SSE data from a Uint8Array.
 * @param {Uint8Array} value - The chunk read from the stream.
 * @param {string} buffer - The leftover buffer from the previous chunk.
 * @param {TextDecoder} decoder - The TextDecoder instance.
 * @returns {{events: Array<object>, newBuffer: string}} - Parsed events and the new buffer.
 */
function processSseChunk(value, buffer, decoder) {
    // Decode the new chunk and append it to the buffer
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    const events = [];
    let lines = buffer.split('\n\n'); // Split by the message boundary
    
    // All but the last part are complete messages
    for (let i = 0; i < lines.length - 1; i++) {
        const message = lines[i];
        if (message.trim().length === 0) continue; // Skip empty messages
        
        let eventType = 'message'; // default
        let eventData = '';

        message.split('\n').forEach(line => {
            if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
            } else if (line.startsWith('data: ')) {
                eventData += line.substring(6).trim(); // Accumulate data lines
            }
        });

        if (eventData) {
            try {
                const jsonData = JSON.parse(eventData);
                events.push({ eventType, data: jsonData });
            } catch (e) {
                console.error("SSE: Failed to parse JSON data:", eventData, e);
                // Push a special error log event
                events.push({
                    eventType: 'message',
                    data: {
                        timestamp: new Date().toISOString(),
                        level: 'CRITICAL',
                        tag: 'SSE_PARSE',
                        message: 'Failed to parse incoming SSE JSON data.',
                        data: { raw: eventData.substring(0, 100) + '...' }
                    }
                });
            }
        }
    }

    // The last part is the new buffer
    let newBuffer = lines[lines.length - 1];

    return { events, newBuffer };
}
// --- END: SSE Stream Parser ---


// --- [MODIFIED] Category Icon Map ---
// Now maps category strings to the new EmojiIcon component
const categoryIconMap = {
    // Greens
    'produce': <EmojiIcon code="1f966" alt="produce" />, // broccoli 🥦
    'fruit': <EmojiIcon code="1f353" alt="fruit" />, // strawberry 🍓
    'veg': <EmojiIcon code="1f955" alt="veg" />, // carrot 🥕

    // Grains
    'grains': <EmojiIcon code="1f33e" alt="grains" />, // rice 🌾
    'carb': <EmojiIcon code="1f33e" alt="grains" />, // rice 🌾

    // Reds
    'meat': <EmojiIcon code="1f969" alt="meat" />, // steak 🥩
    'protein': <EmojiIcon code="1f969" alt="meat" />, // steak 🥩
    'seafood': <EmojiIcon code="1f41f" alt="seafood" />, // fish 🐟

    // Blues
    'dairy': <EmojiIcon code="1f95b" alt="dairy" />, // milk 🥛
    'fat': <EmojiIcon code="1f951" alt="fat" />, // avocado 🥑
    'drinks': <EmojiIcon code="1f9c3" alt="drinks" />, // juice 🧃

    // Oranges/Browns
    'pantry': <EmojiIcon code="1f968" alt="pantry" />, // pretzel 🥨
    'canned': <EmojiIcon code="1f96b" alt="canned" />, // canned food 🥫
    'spreads': <EmojiIcon code="1f95c" alt="spreads" />, // peanuts 🥜
    'condiments': <EmojiIcon code="1f9c2" alt="condiments" />, // salt 🧂
    'bakery': <EmojiIcon code="1f370" alt="bakery" />, // cake 🍰

    // Cyan
    'frozen': <EmojiIcon code="2744" alt="frozen" />, // snowflake ❄️

    // Gray
    'snacks': <EmojiIcon code="1f36b" alt="snacks" />, // chocolate 🍫
    'misc': <EmojiIcon code="1f36b" alt="snacks" />, // chocolate 🍫
    'uncategorized': <EmojiIcon code="1f6cd" alt="shopping" />, // shopping bag 🛍️
    'default': <EmojiIcon code="1f6cd" alt="shopping" /> // shopping bag 🛍️
};
// --- END: Modified Map ---


// --- MAIN APP COMPONENT ---
const App = () => {
    // --- State ---
    const [formData, setFormData] = useState({ name: '', height: '180', weight: '75', age: '30', gender: 'male', activityLevel: 'moderate', goal: 'cut_moderate', dietary: 'None', days: 7, store: 'Woolworths', eatingOccasions: '3', costPriority: 'Best Value', mealVariety: 'Balanced Variety', cuisine: '', bodyFat: '' });
    const [nutritionalTargets, setNutritionalTargets] = useState({ calories: 0, protein: 0, fat: 0, carbs: 0 });
    const [results, setResults] = useState({});
    const [uniqueIngredients, setUniqueIngredients] = useState([]);
    const [mealPlan, setMealPlan] = useState([]);
    const [totalCost, setTotalCost] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [eatenMeals, setEatenMeals] = useState({});
    const [selectedDay, setSelectedDay] = useState(1);
    const [contentView, setContentView] = useState('priceComparison');
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [diagnosticLogs, setDiagnosticLogs] = useState([]);
    const [nutritionCache, setNutritionCache] = useState({});
    const [loadingNutritionFor, setLoadingNutritionFor] = useState(null);
    const [logHeight, setLogHeight] = useState(250);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const minLogHeight = 50;
    const [failedIngredientsHistory, setFailedIngredientsHistory] = useState([]);
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' }); // For save/load feedback
    const [generationStatus, setGenerationStatus] = useState('');
    // [REMOVED] generationProgress state

    // --- [NEW] State for selected meal modal ---
    const [selectedMeal, setSelectedMeal] = useState(null);

    // --- Firebase State ---
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false); // Track auth state readiness

    // --- Firebase Initialization and Auth Effect ---
    useEffect(() => {
        if (!firebaseConfig) {
            console.error("[FIREBASE] Firebase config is missing or invalid JSON."); // Updated error message
            setStatusMessage({ text: 'Firebase config missing or invalid. Cannot save/load profile.', type: 'error' });
            setIsAuthReady(true); // Set auth ready even if config fails, to avoid blocking UI
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            setDb(dbInstance);
            setAuth(authInstance);
            setLogLevel('debug'); // Enable Firestore logging

            console.log("[FIREBASE] Initialized.");

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    console.log("[FIREBASE] User is signed in:", user.uid);
                    setUserId(user.uid);
                } else {
                    console.log("[FIREBASE] User is signed out. Attempting sign-in...");
                    setUserId(null); // Clear userId while attempting sign-in
                    try {
                        const initialAuthToken = import.meta.env.VITE_INITIAL_AUTH_TOKEN;
                        if (initialAuthToken) {
                            console.log("[FIREBASE] Signing in with custom token...");
                            await signInWithCustomToken(authInstance, initialAuthToken);
                        } else {
                            console.log("[FIREBASE] Signing in anonymously...");
                            const anonUserCredential = await signInAnonymously(authInstance);
                            console.log("[FIREBASE] Signed in anonymously:", anonUserCredential.user.uid);
                            // User state will be updated by onAuthStateChanged firing again
                        }
                    } catch (signInError) {
                        console.error("[FIREBASE] Sign-in error:", signInError);
                        setStatusMessage({ text: `Firebase sign-in failed: ${signInError.message}`, type: 'error' });
                        const tempId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                        setUserId(tempId);
                        console.warn("[FIREBASE] Using temporary local ID:", tempId);
                    }
                }
                 // Set auth ready only *after* the first auth state check completes
                 if (!isAuthReady) {
                    setIsAuthReady(true);
                    console.log("[FIREBASE] Auth state ready.");
                }
            });

            return () => unsubscribe();

        } catch (initError) {
            console.error("[FIREBASE] Initialization failed:", initError);
            setStatusMessage({ text: `Firebase init failed: ${initError.message}`, type: 'error' });
            setIsAuthReady(true); // Ensure auth ready is set even on init failure
        }
    }, []); // Empty dependency array is correct here

    // --- Load Profile on Auth Ready ---
    // Moved function definition before useEffect
    // --- [START MODIFICATION] ---
    const handleLoadProfile = useCallback(async (isInitialLoad = false) => {
        // Guard moved inside function
        if (!isAuthReady || !userId || !db) {
            if (!isInitialLoad) {
                setStatusMessage({ text: 'Firebase not ready. Cannot load profile.', type: 'error' });
                console.error('[FIREBASE LOAD] Auth not ready or DB/userId missing.');
            } else {
                 console.log('[FIREBASE LOAD] Skipping initial load: Auth not ready or DB/userId missing.');
            }
            return;
        }
         if (!isInitialLoad) {
            setStatusMessage({ text: 'Loading profile...', type: 'info' });
         } else {
             console.log('[FIREBASE LOAD] Attempting initial profile load...');
         }
        try {
            const profileDocRef = doc(db, 'artifacts', appId, 'users', userId, FIRESTORE_PROFILE_COLLECTION, FIRESTORE_PROFILE_DOC_ID);
            console.log(`[FIREBASE LOAD] Loading from path: ${profileDocRef.path}`);
            const docSnap = await getDoc(profileDocRef);

            if (docSnap.exists()) {
                const loadedData = docSnap.data();
                console.log('[FIREBASE LOAD] Profile data found:', loadedData);
                
                // [MODIFIED] Simplified check. If we have data and it's an object with keys, load it.
                // We don't need to compare its keys to the *current* formData state.
                if (loadedData && typeof loadedData === 'object' && Object.keys(loadedData).length > 0) {
                     setFormData(loadedData); // Overwrite state with loaded data
                     if (!isInitialLoad) {
                         setStatusMessage({ text: 'Profile loaded successfully!', type: 'success' });
                     } else {
                          console.log('[FIREBASE LOAD] Initial profile loaded.');
                          setStatusMessage({ text: 'Profile loaded from previous session.', type: 'success'});
                     }
                } else {
                     console.warn('[FIREBASE LOAD] Loaded data is empty or not an object.');
                      if (!isInitialLoad) {
                        setStatusMessage({ text: 'Found profile document, but data is invalid.', type: 'warn' });
                      } else {
                           console.log('[FIREBASE LOAD] Initial profile data invalid.');
                      }
                }

            } else {
                console.log('[FIREBASE LOAD] No profile document found.');
                 if (!isInitialLoad) {
                    setStatusMessage({ text: 'No saved profile found.', type: 'info' });
                 } else {
                      console.log('[FIREBASE LOAD] No profile found on initial load.');
                 }
            }
        } catch (loadError) {
            console.error('[FIREBASE LOAD] Error loading profile:', loadError);
             if (!isInitialLoad) {
                setStatusMessage({ text: `Error loading profile: ${loadError.message}`, type: 'error' });
             } else {
                  console.error('[FIREBASE LOAD] Error during initial profile load.');
             }
        } finally {
            // Clear loading message after a delay if it wasn't replaced by success/error
            if (!isInitialLoad) {
                setTimeout(() => {
                    setStatusMessage(prev => prev.text === 'Loading profile...' ? { text: '', type: '' } : prev);
                }, 3000);
            }
        }
    // [MODIFIED] Removed `formData` from dependency array
    }, [isAuthReady, userId, db, appId]);
    // --- [END MODIFICATION] ---

    useEffect(() => {
        if (isAuthReady && userId && db) {
            handleLoadProfile(true); // Call initial load here
        }
    }, [isAuthReady, userId, db, handleLoadProfile]); // Added handleLoadProfile to dependency array


    // --- Handlers ---
    // Moved function definitions before useEffects that use them

    const recalculateTotalCost = useCallback((currentResults) => {
        let newTotal = 0;
        Object.values(currentResults).forEach(item => {
            const qty = item.userQuantity || 1;
            if (item.source === 'discovery' && item.allProducts && item.currentSelectionURL) {
                const selected = item.allProducts.find(p => p && p.url === item.currentSelectionURL);
                if (selected?.price) {
                    newTotal += selected.price * qty;
                }
            }
        });
        setTotalCost(newTotal);
    }, []); // Empty dependency array, as it only depends on its argument

    // --- [MODIFIED] handleGeneratePlan (SSE Version) ---
    const handleGeneratePlan = useCallback(async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setDiagnosticLogs([]);
        setNutritionCache({});
        setNutritionalTargets({ calories: 0, protein: 0, fat: 0, carbs: 0 });
        setResults({});
        setUniqueIngredients([]);
        setMealPlan([]);
        setTotalCost(0);
        setEatenMeals({});
        setFailedIngredientsHistory([]);
        setGenerationStatus('Initializing...');
        if (!isLogOpen) { setLogHeight(250); setIsLogOpen(true); }

        let targets;
        let accumulatedResults = {}; 
        let accumulatedMealPlan = []; 
        let accumulatedUniqueIngredients = new Map(); 

        try {
            // --- Step 1: Fetch Nutritional Targets (Still a normal JSON request) ---
            setGenerationStatus('Calculating nutritional targets...');
            const targetsResponse = await fetch(ORCHESTRATOR_TARGETS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (!targetsResponse.ok) {
                const errorData = await targetsResponse.json();
                throw new Error(`Failed to calculate targets: ${errorData.message || targetsResponse.statusText}`);
            }

            const targetsData = await targetsResponse.json();
            targets = targetsData.nutritionalTargets;
            setNutritionalTargets(targets); 
            setDiagnosticLogs(prev => [...prev, ...(targetsData.logs || [])]);
            
            // --- Step 2: Loop and fetch each day (Now using SSE) ---
            const numDays = parseInt(formData.days, 10);
            for (let day = 1; day <= numDays; day++) {
                setGenerationStatus(`Generating plan for Day ${day}/${numDays}...`);
                
                let dailyFailedIngredients = [];
                let dayFetchError = null; // Track error for this day

                try {
                    const dayResponse = await fetch(`${ORCHESTRATOR_DAY_API_URL}?day=${day}`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Accept': 'text/event-stream' // <-- [NEW] Tell the server we want a stream
                        },
                        body: JSON.stringify({
                            formData,
                            nutritionalTargets: targets
                        }),
                    });

                    if (!dayResponse.ok) {
                        // If the stream itself fails (e.g., 500 error), try to read JSON error
                        const errorData = await dayResponse.json();
                        throw new Error(`Day ${day} request failed: ${errorData.message || 'Unknown server error'}`);
                    }

                    // --- [NEW] Stream processing logic ---
                    const reader = dayResponse.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    let dayDataReceived = false;

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) {
                            if (!dayDataReceived && !dayFetchError) {
                                // Stream ended without finalData or an error event, which is a problem
                                throw new Error(`Day ${day} stream ended unexpectedly without data.`);
                            }
                            break; // Stream finished
                        }
                        
                        const { events, newBuffer } = processSseChunk(value, buffer, decoder);
                        buffer = newBuffer;

                        for (const event of events) {
                            switch (event.eventType) {
                                case 'message':
                                    // Add log to state
                                    setDiagnosticLogs(prev => [...prev, event.data]);
                                    break;
                                
                                case 'error':
                                    // A structured error from the backend stream
                                    console.error(`[SSE Error Day ${day}]`, event.data);
                                    dayFetchError = event.data.message || 'An error occurred during generation.';
                                    // Set the main error state
                                    setError(prevError => prevError ? `${prevError}\nDay ${day}: ${dayFetchError}` : `Day ${day}: ${dayFetchError}`);
                                    break;

                                case 'finalData':
                                    // This is the successful data payload for the day
                                    const dayData = event.data;
                                    dayDataReceived = true;

                                    // --- Accumulate successful day data ---
                                    if (dayData.mealPlanForDay) {
                                        accumulatedMealPlan.push(dayData.mealPlanForDay);
                                    }
                                    if (dayData.dayResults) {
                                        accumulatedResults = { ...accumulatedResults, ...dayData.dayResults };
                                        
                                        // Check for failed ingredients
                                        Object.values(dayData.dayResults).forEach(item => {
                                            if (item && (item.source === 'failed' || item.source === 'error')) {
                                                dailyFailedIngredients.push({
                                                    timestamp: new Date().toISOString(),
                                                    originalIngredient: item.originalIngredient || 'Unknown',
                                                    tightQuery: item.tightQuery || (item.searchAttempts?.find(a=>a.queryType==='tight')?.query),
                                                    normalQuery: item.normalQuery || (item.searchAttempts?.find(a=>a.queryType==='normal')?.query),
                                                    wideQuery: item.wideQuery || (item.searchAttempts?.find(a=>a.queryType==='wide')?.query),
                                                    error: item.error || 'Market run failed'
                                                });
                                            }
                                        });
                                    }
                                    if (dayData.dayUniqueIngredients) {
                                        dayData.dayUniqueIngredients.forEach(ing => {
                                            if (ing && ing.originalIngredient) {
                                                accumulatedUniqueIngredients.set(ing.originalIngredient, {
                                                    ...(accumulatedUniqueIngredients.get(ing.originalIngredient) || {}), 
                                                    ...ing 
                                                });
                                            }
                                        });
                                    }
                                    
                                    // --- Update state incrementally ---
                                    setMealPlan([...accumulatedMealPlan]);
                                    setResults({ ...accumulatedResults }); 
                                    setUniqueIngredients(Array.from(accumulatedUniqueIngredients.values()));
                                    recalculateTotalCost(accumulatedResults);
                                    break;
                            }
                        }
                        // If we got a stream error, stop processing this day
                        if (dayFetchError) break;
                    } // end while(true)
                    // --- [NEW] End stream processing ---

                } catch (dayError) {
                    // This catches errors in the fetch() call itself or in stream setup
                    console.error(`Error processing day ${day}:`, dayError);
                    setError(prevError => prevError ? `${prevError}\n${dayError.message}` : dayError.message); 
                    setDiagnosticLogs(prev => [...prev, {
                        timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: dayError.message
                    }]);
                    // Continue to the next day
                } finally {
                     // Update the failed history state regardless of day success/error
                     if (dailyFailedIngredients.length > 0) {
                         setFailedIngredientsHistory(prev => [...prev, ...dailyFailedIngredients]);
                     }
                }

            } // --- End of day loop ---

            setGenerationStatus(`Plan generation finished.`);
            setSelectedDay(1); 
            setContentView('priceComparison'); 

        } catch (err) { // --- Error handling for critical initial failures (e.g., Targets API) ---
            console.error("Plan generation failed critically:", err);
            setError(`Critical failure: ${err.message}`);
            setGenerationStatus('Failed'); // Update status for UI
            setDiagnosticLogs(prev => [...prev, {
                timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: `Critical failure: ${err.message}`
            }]);
        } finally {
            setLoading(false);
        }
    }, [formData, isLogOpen, recalculateTotalCost]); // [MODIFIED] Removed generationProgress
    // --- END: handleGeneratePlan Modifications ---


    const handleFetchNutrition = useCallback(async (product) => {
        if (!product || !product.url || nutritionCache[product.url]) { return; }
        // If nutrition data already exists on the product object (e.g., from initial plan load), use it
        if (product.nutrition && product.nutrition.status === 'found') {
             setNutritionCache(prev => ({...prev, [product.url]: product.nutrition}));
             return;
        }
        setLoadingNutritionFor(product.url);
        try {
            const params = product.barcode ? `barcode=${product.barcode}` : `query=${encodeURIComponent(product.name)}`;
            const response = await fetch(`${NUTRITION_API_URL}?${params}`);
            // Check if response is ok and content-type is application/json
            if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
                // Handle non-JSON or error responses
                const errorText = await response.text();
                throw new Error(`Nutrition API Error ${response.status}: ${errorText || 'Invalid response'}`);
            }
            const nutritionData = await response.json();
            setNutritionCache(prev => ({...prev, [product.url]: nutritionData}));
        } catch (err) {
            console.error("Failed to fetch nutrition for", product.name, ":", err);
            // Store a 'not_found' status in cache to prevent repeated failed fetches
            setNutritionCache(prev => ({...prev, [product.url]: { status: 'not_found', source: 'fetch_error', reason: err.message }}));
        } finally {
            setLoadingNutritionFor(null);
        }
    }, [nutritionCache]); // Dependency: nutritionCache

    // --- [FIXED] handleSubstituteSelection ---
    const handleSubstituteSelection = useCallback((key, newProduct) => {
        // key is now normalizedKey (e.g., "chicken breast")
        setResults(prev => {
            const updatedItem = { ...prev[key], currentSelectionURL: newProduct.url };
            const newResults = { ...prev, [key]: updatedItem };
            recalculateTotalCost(newResults); // Recalculate cost after substitution
            return newResults;
        });
    }, [recalculateTotalCost]); // Dependency: recalculateTotalCost

    // --- [FIXED] handleQuantityChange ---
    const handleQuantityChange = useCallback((key, delta) => {
        // key is now normalizedKey (e.g., "chicken breast")
        setResults(prev => {
            if (!prev[key]) {
                console.error(`[handleQuantityChange] Error: Ingredient key "${key}" not found.`);
                return prev;
            }
            const currentQty = prev[key].userQuantity || 1; // Default to 1 if undefined
            const newQty = Math.max(1, currentQty + delta); // Ensure quantity is at least 1
            const updatedItem = { ...prev[key], userQuantity: newQty };
            const newResults = { ...prev, [key]: updatedItem };
            recalculateTotalCost(newResults); // Recalculate cost after quantity change
            return newResults;
        });
    }, [recalculateTotalCost]); // Dependency: recalculateTotalCost

    const handleDownloadFailedLogs = useCallback(() => {
        if (failedIngredientsHistory.length === 0) return;
        let logContent = "Failed Ingredient History\n==========================\n\n";
        failedIngredientsHistory.forEach((item, index) => {
            logContent += `Failure ${index + 1}:\nTimestamp: ${new Date(item.timestamp).toLocaleString()}\nIngredient: ${item.originalIngredient}\nTight Query: ${item.tightQuery || 'N/A'}\nNormal Query: ${item.normalQuery || 'N/A'}\nWide Query: ${item.wideQuery || 'N/A'}\n${item.error ? `Error: ${item.error}\n` : ''}\n`;
        });
        const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.download = `cheffy_failed_ingredients_${timestamp}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [failedIngredientsHistory]); // Dependency: failedIngredientsHistory

    const handleDownloadLogs = useCallback(() => {
        if (!diagnosticLogs || diagnosticLogs.length === 0) return;
        let logContent = "Cheffy Orchestrator Logs\n=========================\n\n";
        diagnosticLogs.forEach(log => {
            // Ensure log is valid object before accessing properties
            if (log && typeof log === 'object' && log.timestamp) {
                const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
                logContent += `${time} [${log.level || 'N/A'}] [${log.tag || 'N/A'}] ${log.message || ''}\n`;
                if (log.data) {
                    try {
                        logContent += `  Data: ${JSON.stringify(log.data, null, 2)}\n`;
                    } catch (e) {
                        logContent += `  Data: [Could not serialize: ${e.message}]\n`;
                    }
                }
                logContent += "\n";
            } else {
                 logContent += `[Invalid Log Entry: ${JSON.stringify(log)}]\n\n`;
            }
        });
        const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.download = `cheffy_orchestrator_logs_${timestamp}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [diagnosticLogs]); // Dependency: diagnosticLogs

    const handleSaveProfile = useCallback(async () => {
        if (!isAuthReady || !userId || !db) {
            setStatusMessage({ text: 'Firebase not ready. Cannot save profile.', type: 'error' });
            console.error('[FIREBASE SAVE] Auth not ready or DB/userId missing.');
            return;
        }
        setStatusMessage({ text: 'Saving profile...', type: 'info' });
        try {
            // Construct the path correctly
            const profileDocRef = doc(db, 'artifacts', appId, 'users', userId, FIRESTORE_PROFILE_COLLECTION, FIRESTORE_PROFILE_DOC_ID);
            console.log(`[FIREBASE SAVE] Saving profile to: ${profileDocRef.path}`);
            await setDoc(profileDocRef, formData); // Save the current formData
            setStatusMessage({ text: 'Profile saved successfully!', type: 'success' });
            console.log('[FIREBASE SAVE] Profile saved.');
        } catch (saveError) {
            console.error('[FIREBASE SAVE] Error saving profile:', saveError);
            setStatusMessage({ text: `Error saving profile: ${saveError.message}`, type: 'error' });
        } finally {
             // Clear saving message after a delay
             setTimeout(() => {
                 setStatusMessage(prev => prev.text === 'Saving profile...' ? { text: '', type: '' } : prev);
             }, 3000);
        }
    }, [isAuthReady, userId, db, formData, appId]); // Dependencies for saving


    const handleChange = (e) => {
        const { name, value } = e.target;
        // --- START: FIX (Correct Spread Syntax) ---
        setFormData(prev => ({ ...prev, [name]: value }));
        // --- END: FIX ---
        // Adjust selectedDay if 'days' decreases below current selection
        if (name === 'days') {
             const newDays = parseInt(value, 10);
             if (!isNaN(newDays) && newDays < selectedDay) {
                 setSelectedDay(newDays);
             }
        }
    };
    const handleSliderChange = (e) => {
        const value = parseInt(e.target.value, 10);
         // --- START: FIX (Correct Spread Syntax) ---
        setFormData(prev => ({ ...prev, days: value }));
         // --- END: FIX ---
        if (value < selectedDay) {
            setSelectedDay(value);
        }
    };
    const onToggleMealEaten = useCallback((day, mealName) => {
        setEatenMeals(prev => {
            const dayKey = `day${day}`;
             // --- START: FIX (Correct Spread Syntax) ---
            const dayMeals = { ...(prev[dayKey] || {}) };
             // --- END: FIX ---
            dayMeals[mealName] = !dayMeals[mealName]; // Toggle the specific meal's status
             // --- START: FIX (Correct Spread Syntax) ---
            return { ...prev, [dayKey]: dayMeals };
             // --- END: FIX ---
        });
    }, []); // Empty dependency array as it only depends on previous state

    // --- [FIXED] categorizedResults useMemo ---
    const categorizedResults = useMemo(() => {
        const groups = {};
        // --- [FIX] Iterate over Object.entries to get the normalizedKey ---
        Object.entries(results || {}).forEach(([normalizedKey, item]) => {
            // Ensure item is valid before processing
            // --- [MODIFIED] Include 'failed' and 'error' sources here ---
            if (item && item.originalIngredient && (item.source === 'discovery' || item.source === 'failed' || item.source === 'error' || item.source === 'canonical_fallback')) {
                const category = item.category || 'Uncategorized';
                if (!groups[category]) groups[category] = [];
                 // Check if this ingredient (identified by originalIngredient) is already in the group
                 // This prevents duplicates if it appears in multiple days with the same source
                 if (!groups[category].some(existing => existing.originalIngredient === item.originalIngredient)) {
                       // --- [FIX] Push the normalizedKey along with the item data ---
                      groups[category].push({ normalizedKey: normalizedKey, ingredient: item.originalIngredient, ...item });
                 }
            }
        });
        // --- [NEW] Sort categories
        const sortedCategories = Object.keys(groups).sort();
        const sortedGroups = {};
        for (const category of sortedCategories) {
            sortedGroups[category] = groups[category];
        }
        return sortedGroups;
    }, [results]); // Dependency: results
    // --- END: categorizedResults Fix ---


    const PlanCalculationErrorPanel = () => (
        <div className="p-6 text-center bg-red-100 text-red-800 rounded-lg shadow-lg m-4">
            <AlertTriangle className="inline mr-2 w-8 h-8" />
            <h3 className="text-xl font-bold">Plan Calculation Error</h3>
            <p className="mt-2">A critical error occurred while calculating meal nutrition. The generated plan is incomplete and cannot be displayed. Please check the logs for details.</p>
        </div>
    );

    const hasInvalidMeals = useMemo(() => {
        if (!mealPlan || mealPlan.length === 0) return false;
        // Check if *any* day plan is invalid or contains invalid meals
        return mealPlan.some(dayPlan =>
            !dayPlan || !Array.isArray(dayPlan.meals) || dayPlan.meals.some(meal =>
                !meal || typeof meal.subtotal_kcal !== 'number' || meal.subtotal_kcal <= 0
            )
        );
    }, [mealPlan]); // Dependency: mealPlan

    // --- [START MODIFICATION] ---
    // --- Derive props for GenerationProgressDisplay ---
    const latestLog = diagnosticLogs.length > 0 ? diagnosticLogs[diagnosticLogs.length - 1] : null;
    const completedDays = mealPlan.length;
    const totalDays = parseInt(formData.days, 10) || 0;

    // --- Content Views ---
    const priceComparisonContent = (
        <div className="space-y-0 p-4">
            {/* [DELETED] Old GenerationProgressDisplay was here */}

            {/* Show final/critical error only when not loading */}
            {error && !loading && (
                 <div className="p-4 bg-red-50 text-red-800 rounded-lg">
                    <AlertTriangle className="inline w-6 h-6 mr-2" />
                    <strong>Error(s) occurred during plan generation:</strong>
                    <pre className="mt-2 whitespace-pre-wrap text-sm">{error}</pre>
                 </div>
            )}

            {/* [MODIFIED] Added !loading check. This content now renders progressively
                 but we hide the cost summary until generation is fully complete. */}
            {!loading && Object.keys(results).length > 0 && (
                <>
                    <div className="bg-white p-4 rounded-xl shadow-md border-t-4 border-indigo-600 mb-6">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xl font-bold flex items-center"><DollarSign className="w-5 h-5 mr-2"/> Total Estimated Cost</h3>
                            <p className="text-3xl font-extrabold text-green-700">${totalCost.toFixed(2)}</p>
                        </div>
                        <p className="text-sm text-gray-500">Cost reflects selected products multiplied by units purchased from {formData.store}.</p>
                    </div>

                    {/* This list will now populate as days are completed */}
                    <div className="bg-white rounded-xl shadow-lg border overflow-hidden">
                        {Object.keys(categorizedResults).map((category, index) => (
                            <CollapsibleSection
                                key={category}
                                title={`${category} (${categorizedResults[category].length})`}
                                icon={categoryIconMap[category.toLowerCase()] || categoryIconMap['default']}
                                defaultOpen={false}
                            >
                                <div className="grid grid-cols-1 gap-6 pt-4">
                                    {categorizedResults[category].map(({ normalizedKey, ingredient, ...result }) => {
                                        if (!result) return null;
                                        const selection = result.allProducts?.find(p => p && p.url === result.currentSelectionURL);
                                        const nutriData = selection ? nutritionCache[selection.url] : null;
                                        const isLoading = selection ? loadingNutritionFor === selection.url : false;
                                        return (
                                            <IngredientResultBlock
                                                key={normalizedKey}
                                                ingredientKey={ingredient}
                                                normalizedKey={normalizedKey}
                                                result={result}
                                                onSelectSubstitute={handleSubstituteSelection}
                                                onQuantityChange={handleQuantityChange}
                                                onFetchNutrition={handleFetchNutrition}
                                                nutritionData={nutriData}
                                                isLoadingNutrition={isLoading}
                                            />
                                        );
                                    })}
                                </div>
                            </CollapsibleSection>
                        ))}
                    </div>
                </>
            )}
            {/* Show 'Generate plan' message only if not loading, no results, and no critical error */}
            {!loading && Object.keys(results).length === 0 && !error && (
                <div className="p-6 text-center text-gray-500">Generate a plan to see results.</div>
            )}
        </div>
    );
    
    const mealPlanContent = (
        <div className="flex flex-col md:flex-row p-4 gap-6">
            {/* This sidebar will now appear as soon as Day 1 is done */}
            {mealPlan.length > 0 && (
                <div className="sticky top-4 z-20 self-start w-full md:w-auto mb-4 md:mb-0 bg-white rounded-lg shadow p-4">
                    <DaySidebar days={Math.max(1, mealPlan.length)} selectedDay={selectedDay} onSelect={setSelectedDay} />
                </div>
            )}
            {/* This display will now populate as soon as Day 1 is done */}
            {mealPlan.length > 0 && selectedDay >= 1 && selectedDay <= mealPlan.length ? (
                <MealPlanDisplay
                    key={selectedDay} // Re-render when selectedDay changes
                    mealPlan={mealPlan}
                    selectedDay={selectedDay}
                    nutritionalTargets={nutritionalTargets}
                    eatenMeals={eatenMeals}
                    onToggleMealEaten={onToggleMealEaten}
                    onViewRecipe={setSelectedMeal} // <-- [MODIFIED] Pass new prop
                />
            ) : (
                 // [MODIFIED] Removed the 'loading' ternary. This is the new fallback state.
                <div className="flex-1 text-center p-8 text-gray-500">
                    {/* [DELETED] Old GenerationProgressDisplay was here */}
                    {error && !loading ? (
                         // Show error message if loading finished with an error
                         <div className="p-4 bg-red-50 text-red-800 rounded-lg">
                             <AlertTriangle className="inline w-6 h-6 mr-2" />
                             <strong>Error generating plan. Check logs for details.</strong>
                             <pre className="mt-2 whitespace-pre-wrap text-sm">{error}</pre>
                         </div>
                    ) : mealPlan.length === 0 && !loading ? (
                         'Generate a plan to see your meals.'
                    ) : (
                         // This message will show while loading OR if selectedDay is invalid
                         !loading && 'Select a valid day to view meals.'
                    )}
                </div>
            )}
        </div>
    );
    // --- [END MODIFICATION] ---

    // Calculate total log height dynamically
    const failedLogViewerHeight = failedIngredientsHistory.length > 0 ? 60 : 0; // Estimate height when visible
    const diagnosticLogActualHeight = isLogOpen ? Math.max(minLogHeight, logHeight) : minLogHeight;
    // Ensure totalLogHeight is a number
    const totalLogHeight = (failedLogViewerHeight || 0) + (diagnosticLogActualHeight || 0);


    // --- Status Message Display ---
    const getStatusColor = (type) => {
        switch (type) {
            case 'success': return 'bg-green-100 text-green-800';
            case 'error': return 'bg-red-100 text-red-800';
            case 'warn': return 'bg-yellow-100 text-yellow-800';
            case 'info': return 'bg-blue-100 text-blue-800';
            default: return 'hidden'; // Hide if type is empty or invalid
        }
    };

    return (
        <>
            {/* Added style check to ensure totalLogHeight is a number */}
            <div className="min-h-screen bg-gray-100 p-4 md:p-8 transition-all duration-200 relative" style={{ paddingBottom: `${Number.isFinite(totalLogHeight) ? totalLogHeight : minLogHeight}px` }}>
                <h1 className="text-5xl font-extrabold text-center mb-8 font-['Poppins']"><span className="relative"><ChefHat className="inline w-12 h-12 text-indigo-600 absolute -top-5 -left-5 transform -rotate-12" /><span className="text-indigo-700">C</span>heffy</span></h1>

                {statusMessage.text && (
                    <div className={`p-3 mb-4 rounded-lg text-sm font-medium text-center max-w-xl mx-auto ${getStatusColor(statusMessage.type)}`}>
                        {statusMessage.text}
                    </div>
                )}

                 {userId && isAuthReady && (
                    <div className="text-center text-xs text-gray-500 mb-4 flex items-center justify-center">
                        <User size={12} className="mr-1" /> User ID: <span className="font-mono ml-1">{userId}</span>
                    </div>
                 )}


                <div className="max-w-7xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden">
                    <div className="flex flex-col md:flex-row">
                        {/* --- SETUP FORM --- */}
                        <div className={`p-6 md:p-8 w-full md:w-1/2 border-b md:border-r ${isMenuOpen ? 'block' : 'hidden md:block'}`}>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold text-indigo-700">Plan Setup</h2>
                                <div className="flex space-x-2">
                                    {/* Load Button */}
                                    <button
                                        onClick={() => handleLoadProfile(false)} // Explicitly pass false for manual load
                                        disabled={!isAuthReady || !userId || !db} // Ensure DB is also ready
                                        className="flex items-center px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Load Saved Profile"
                                    >
                                        <FolderDown size={14} className="mr-1" /> Load
                                    </button>
                                    {/* Save Button */}
                                     <button
                                        onClick={handleSaveProfile}
                                        disabled={!isAuthReady || !userId || !db} // Ensure DB is also ready
                                        className="flex items-center px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Save Current Profile"
                                    >
                                        <Save size={14} className="mr-1" /> Save
                                    </button>
                                    {/* Mobile Menu Toggle */}
                                    <button className="md:hidden p-1.5" onClick={() => setIsMenuOpen(false)}><X /></button>
                                </div>
                            </div>
                            <form onSubmit={handleGeneratePlan}>
                                {/* Form fields remain the same */}
                                <InputField label="Name" name="name" value={formData.name} onChange={handleChange} />
                                <div className="grid grid-cols-2 gap-4"><InputField label="Height (cm)" name="height" type="number" value={formData.height} onChange={handleChange} required /><InputField label="Weight (kg)" name="weight" type="number" value={formData.weight} onChange={handleChange} required /></div>
                                <div className="grid grid-cols-2 gap-4"><InputField label="Age" name="age" type="number" value={formData.age} onChange={handleChange} required /><InputField label="Body Fat % (Optional)" name="bodyFat" type="number" value={formData.bodyFat} onChange={handleChange} placeholder="e.g., 15" /></div>
                                <InputField label="Gender" name="gender" type="select" value={formData.gender} onChange={handleChange} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} required />
                                <InputField label="Activity Level" name="activityLevel" type="select" value={formData.activityLevel} onChange={handleChange} options={[ { value: 'sedentary', label: 'Sedentary' }, { value: 'light', label: 'Light Activity' }, { value: 'moderate', label: 'Moderate Activity' }, { value: 'active', label: 'Active' }, { value: 'veryActive', label: 'Very Active' } ]} required />
                                <InputField label="Fitness Goal" name="goal" type="select" value={formData.goal} onChange={handleChange} options={[ { value: 'maintain', label: 'Maintain' }, { value: 'cut_moderate', label: 'Moderate Cut (~15% Deficit)' }, { value: 'cut_aggressive', label: 'Aggressive Cut (~25% Deficit)' }, { value: 'bulk_lean', label: 'Lean Bulk (~15% Surplus)' }, { value: 'bulk_aggressive', label: 'Aggressive Bulk (~25% Surplus)' } ]} />
                                <InputField label="Dietary Preference" name="dietary" type="select" value={formData.dietary} onChange={handleChange} options={[{ value: 'None', label: 'None' }, { value: 'Vegetarian', label: 'Vegetarian' }]} />
                                <DaySlider label="Plan Days" name="days" value={formData.days} onChange={handleSliderChange} />
                                <InputField label="Store" name="store" type="select" value={formData.store} onChange={handleChange} options={[{ value: 'Coles', label: 'Coles' }, { value: 'Woolworths', label: 'Woolworths' }]} />
                                <h3 className="text-lg font-bold mt-6 mb-3 border-t pt-3">Customization</h3>
                                <InputField label="Meals Per Day" name="eatingOccasions" type="select" value={formData.eatingOccasions} onChange={handleChange} options={[ { value: '3', label: '3 Meals' }, { value: '4', label: '4 Meals' }, { value: '5', label: '5 Meals' } ]} />
                                <InputField label="Spending Priority" name="costPriority" type="select" value={formData.costPriority} onChange={handleChange} options={[ { value: 'Extreme Budget', label: 'Extreme Budget' }, { value: 'Best Value', label: 'Best Value' }, { value: 'Quality Focus', label: 'Quality Focus' } ]} />
                                {/* --- [FIX] Corrected 'Modular' to 'Low' --- */}
                                <InputField label="Meal Variety" name="mealVariety" type="select" value={formData.mealVariety} onChange={handleChange} options={[ { value: 'High Repetition', label: 'High' }, { value: 'Balanced Variety', label: 'Balanced' }, { value: 'Low Repetition', label: 'Low' } ]} />
                                <InputField label="Cuisine Profile (Optional)" name="cuisine" value={formData.cuisine} onChange={handleChange} placeholder="e.g., Spicy Thai" />

                                <button type="submit" disabled={loading || !isAuthReady} className={`w-full flex items-center justify-center py-3 mt-6 text-lg font-bold rounded-xl shadow-lg ${loading || !isAuthReady ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}>
                                    {loading ? <><RefreshCw className="w-5 h-5 mr-3 animate-spin" /> Processing...</> : <><Zap className="w-5 h-5 mr-3" /> Generate Plan</>}
                                </button>
                                {/* Auth Ready Check Message */}
                                {!isAuthReady && <p className="text-xs text-center text-red-600 mt-2">Initializing Firebase auth...</p>}
                            </form>
                        </div>

                        {/* --- RESULTS VIEW --- */}
                        <div className={`w-full md:w-1/2 ${isMenuOpen ? 'hidden md:block' : 'block'}`}>
                            {/* Mobile Menu Button */}
                            <div className="p-4 md:hidden flex justify-end">
                                <button className="bg-indigo-600 text-white p-2 rounded-full shadow" onClick={() => setIsMenuOpen(true)}><Menu /></button>
                            </div>
                            <div className="border-b">
                                <div className="p-6 md:p-8">
                                    <h2 className="text-xl font-bold mb-4 flex items-center"><Calendar className="w-5 h-5 mr-2" /> Plan Summary ({formData.days} Days)</h2>
                                    <div className="text-sm space-y-2 bg-indigo-50 p-4 rounded-lg border">
                                        <p className="flex items-center"><Users className="w-4 h-4 mr-2"/> Goal: <span className='font-semibold ml-1'>{formData.goal.toUpperCase()}</span> | Dietary: <span className='font-semibold ml-1'>{formData.dietary}</span></p>
                                        <p className="flex items-center"><Tag className="w-4 h-4 mr-2"/> Spending: <span className='font-semibold ml-1'>{formData.costPriority}</span></p>
                                        {nutritionalTargets.calories > 0 && (
                                            <div className="pt-2 mt-2 border-t">
                                                <h4 className="font-bold mb-2 text-center">Daily Nutritional Targets</h4>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                                                    <div className="p-2 bg-white rounded-lg shadow-sm"><p className="font-bold flex items-center justify-center"><Flame size={14} className="mr-1 text-red-500" /> Cals</p><p className="text-lg font-extrabold">{nutritionalTargets.calories}</p></div>
                                                    <div className="p-2 bg-white rounded-lg shadow-sm"><p className="font-bold flex items-center justify-center"><Soup size={14} className="mr-1 text-green-500" /> Protein</p><p className="text-lg font-extrabold">{nutritionalTargets.protein}g</p></div>
                                                    <div className="p-2 bg-white rounded-lg shadow-sm"><p className="font-bold flex items-center justify-center"><Droplet size={14} className="mr-1 text-yellow-500" /> Fat</p><p className="text-lg font-extrabold">{nutritionalTargets.fat}g</p></div>
                                                    {/* --- [FIX] Corrected the closing tag from </M> to </p> --- */}
                                                    <div className="p-2 bg-white rounded-lg shadow-sm"><p className="font-bold flex items-center justify-center"><Wheat size={14} className="mr-1 text-orange-500" /> Carbs</p><p className="text-lg font-extrabold">{nutritionalTargets.carbs}g</p></div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {/* Shopping List Section */}
                                    {uniqueIngredients.length > 0 && !hasInvalidMeals && (
                                        <CollapsibleSection title={`Shopping List (${uniqueIngredients.length} Items)`}>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {uniqueIngredients.map((item, index) => (
                                                     <div key={item.originalIngredient || index} className="flex justify-between items-center p-3 bg-white border rounded-lg shadow-sm">
                                                        <div className="flex-1 min-w-0">
                                                            {/* Added check for originalIngredient */}
                                                            <p className="font-bold truncate">{item.originalIngredient || 'Unknown Ingredient'}</p>
                                                            {/* Added check for results[item.originalIngredient] */}
                                                            {/* --- [FIX] Need to use normalizedKey here too eventually, but less critical --- */}
                                                            <p className="text-sm">Est. Qty: {results[item.originalIngredient]?.quantityUnits || 'N/A'}</p>
                                                        </div>
                                                         {/* Added check for category */}
                                                        <span className="px-3 py-1 ml-4 text-xs font-semibold text-indigo-800 bg-indigo-100 rounded-full whitespace-nowrap">{item.category || 'N/A'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </CollapsibleSection>
                                    )}
                                </div>
                            </div>

                            {/* --- [START MODIFICATION] --- */}
                            {/* --- Main Content Area (Ingredients / Meal Plan) --- */}
                            {hasInvalidMeals ? (
                                <PlanCalculationErrorPanel />
                            ) : (
                                <div className="p-0">
                                    {/* --- [NEW] Render Live Dashboard (only when loading) --- */}
                                    {loading && (
                                        <div className="p-4 md:p-6"> {/* Padding for the dashboard */}
                                            <GenerationProgressDisplay
                                                status={generationStatus}
                                                error={error}
                                                latestLog={latestLog}
                                                completedDays={completedDays}
                                                totalDays={totalDays}
                                            />
                                        </div>
                                    )}

                                    {/* View Toggles (only show if plan data exists AND not loading) */}
                                    {(results && Object.keys(results).length > 0 && !loading) && (
                                        <div className="flex space-x-2 p-4">
                                            <button className={`flex-1 py-3 px-5 text-center font-medium rounded-lg transition-all ${ contentView === 'priceComparison' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100' }`} onClick={() => setContentView('priceComparison')}>Ingredients</button>
                                            {/* Show Meal Plan button only if mealPlan array has data */}
                                            {mealPlan.length > 0 && (
                                                <button className={`flex-1 py-3 px-5 text-center font-medium rounded-lg transition-all ${ contentView === 'mealPlan' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100' }`} onClick={() => setContentView('mealPlan')}>Meal Plan</button>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Render selected content view */}
                                    {/* This content is now always rendered, allowing it to update progressively */}
                                    {contentView === 'priceComparison' ? priceComparisonContent : mealPlanContent}
                                </div>
                            )}
                            {/* --- [END MODIFICATION] --- */}
                        </div>
                    </div>
                </div>
            </div>

             {/* --- Log Viewers (Fixed at bottom) --- */}
             {/* [MODIFIED] Increased z-index to 100 to be above modal backdrop (z-50) */}
            <div className="fixed bottom-0 left-0 right-0 z-[100] flex flex-col-reverse">
                <DiagnosticLogViewer logs={diagnosticLogs} height={logHeight} setHeight={setHeight} isOpen={isLogOpen} setIsOpen={setIsOpen} onDownloadLogs={handleDownloadLogs} />
                {/* --- [MODIFIED] Now uses state correctly --- */}
                <FailedIngredientLogViewer failedHistory={failedIngredientsHistory} onDownload={handleDownloadFailedLogs} />
            </div>

            {/* --- [NEW] Render the modal conditionally --- */}
            {selectedMeal && (
                <RecipeModal 
                    meal={selectedMeal} 
                    onClose={() => setSelectedMeal(null)} 
                />
            )}
        </>
    );
};

export default App;


