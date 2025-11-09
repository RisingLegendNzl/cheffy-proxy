// web/src/App.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Package, DollarSign, ExternalLink, Calendar, Users, Menu, X, ChevronsDown, ChevronsUp, ShoppingBag, BookOpen, ChefHat, Tag, Soup, Replace, Target, FileText, LayoutDashboard, Terminal, Loader, ChevronRight, GripVertical, Flame, Droplet, Wheat, ChevronDown, ChevronUp, Download, ListX, Save, FolderDown, User, Check, ListChecks, ListOrdered } from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, setLogLevel } from 'firebase/firestore';

// --- [NEW] Theme Context Import ---
import { ThemeProvider } from './context/ThemeContext';

// --- Component Imports ---
import InputField from './components/InputField';
import DaySlider from './components/DaySlider';
import DaySidebar from './components/DaySidebar';
import ProductCard from './components/ProductCard';
import CollapsibleSection from './components/CollapsibleSection';
import SubstituteMenu from './components/SubstituteMenu';
import GenerationProgressDisplay from './components/GenerationProgressDisplay';
// import NutritionalInfo from './components/NutritionalInfo'; // [REMOVED] Replaced by CalorieTracker
import IngredientResultBlock from './components/IngredientResultBlock';
import MealPlanDisplay from './components/MealPlanDisplay';
import LogEntry from './components/LogEntry';
import DiagnosticLogViewer from './components/DiagnosticLogViewer';
import FailedIngredientLogViewer from './components/FailedIngredientLogViewer';
import RecipeModal from './components/RecipeModal';
import EmojiIcon from './components/EmojiIcon';

// --- [NEW] Theme Component Imports ---
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { CalorieTracker } from './components/CalorieTracker';


// --- CONFIGURATION ---
const ORCHESTRATOR_TARGETS_API_URL = '/api/plan/targets';
const ORCHESTRATOR_DAY_API_URL = '/api/plan/day'; // Old per-day endpoint
const ORCHESTRATOR_FULL_PLAN_API_URL = '/api/plan/generate-full-plan'; // New batched endpoint

const NUTRITION_API_URL = '/api/nutrition-search';
const MAX_SUBSTITUTES = 5;
const FIRESTORE_PROFILE_COLLECTION = 'profile';
const FIRESTORE_PROFILE_DOC_ID = 'userProfile';

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = {
    name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 15.99, size: "1kg",
    url: "#api_down_mock_product", unit_price_per_100: 1.59,
};


// --- Firebase Config variables moved inside useEffect ---
let firebaseConfig = null;
let firebaseInitializationError = null;
let globalAppId = 'default-app-id'; // Provide a default


// --- SSE Stream Parser ---
function processSseChunk(value, buffer, decoder) {
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    
    const events = [];
    let lines = buffer.split('\n\n');
    
    for (let i = 0; i < lines.length - 1; i++) {
        const message = lines[i];
        if (message.trim().length === 0) continue;
        
        let eventType = 'message';
        let eventData = '';
        
        message.split('\n').forEach(line => {
            if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
            } else if (line.startsWith('data: ')) {
                eventData += line.substring(6).trim();
            }
        });

        if (eventData) {
            try {
                const jsonData = JSON.parse(eventData);
                events.push({ eventType, data: jsonData });
            } catch (e) {
                console.error("SSE: Failed to parse JSON data:", eventData, e);
                events.push({
                    eventType: 'log_message', 
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
    
    let newBuffer = lines[lines.length - 1];
    return { events, newBuffer };
}
// --- END: SSE Stream Parser ---


// --- Category Icon Map ---
const categoryIconMap = {
    'produce': <EmojiIcon code="1f966" alt="produce" />,
    'fruit': <EmojiIcon code="1f353" alt="fruit" />,
    'veg': <EmojiIcon code="1f955" alt="veg" />,
    'grains': <EmojiIcon code="1f33e" alt="grains" />,
    'carb': <EmojiIcon code="1f33e" alt="grains" />,
    'meat': <EmojiIcon code="1f969" alt="meat" />,
    'protein': <EmojiIcon code="1f969" alt="meat" />,
    'seafood': <EmojiIcon code="1f41f" alt="seafood" />,
    'dairy': <EmojiIcon code="1f95b" alt="dairy" />,
    'fat': <EmojiIcon code="1f951" alt="fat" />,
    'drinks': <EmojiIcon code="1f9c3" alt="drinks" />,
    'pantry': <EmojiIcon code="1f968" alt="pantry" />,
    'canned': <EmojiIcon code="1f96b" alt="canned" />,
    'spreads': <EmojiIcon code="1f95c" alt="spreads" />,
    'condiments': <EmojiIcon code="1f9c2" alt="condiments" />,
    'bakery': <EmojiIcon code="1f370" alt="bakery" />,
    'frozen': <EmojiIcon code="2744" alt="frozen" />,
    'snacks': <EmojiIcon code="1f36b" alt="snacks" />,
    'misc': <EmojiIcon code="1f36b" alt="snacks" />,
    'uncategorized': <EmojiIcon code="1f6cd" alt="shopping" />,
    'default': <EmojiIcon code="1f6cd" alt="shopping" />
};
// --- END: Category Icon Map ---

// --- [NEW] Empty macro template ---
const emptyMacros = { calories: 0, protein: 0, fat: 0, carbs: 0 };

// --- MAIN APP COMPONENT ---
const App = () => {
    // --- State ---
    const [formData, setFormData] = useState({ name: '', height: '180', weight: '75', age: '30', gender: 'male', activityLevel: 'moderate', goal: 'cut_moderate', dietary: 'None', days: 7, store: 'Woolworths', eatingOccasions: '3', costPriority: 'Best Value', mealVariety: 'Balanced Variety', cuisine: '', bodyFat: '' });
    const [nutritionalTargets, setNutritionalTargets] = useState({ calories: 0, protein: 0, fat: 0, carbs: 0 });
    
    // --- [NEW] State for "Actual" logged macros ---
    const [actual, setActual] = useState(emptyMacros);

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
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });
    
    const [generationStepKey, setGenerationStepKey] = useState(null);
    const [generationStatus, setGenerationStatus] = useState("Ready to generate plan."); 

    const [selectedMeal, setSelectedMeal] = useState(null);

    const [useBatchedMode, setUseBatchedMode] = useState(true);

    // --- Firebase State ---
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('default-app-id');

    // --- Firebase Initialization and Auth Effect ---
    useEffect(() => {
        const firebaseConfigStr = typeof __firebase_config !== 'undefined' 
            ? __firebase_config 
            : import.meta.env.VITE_FIREBASE_CONFIG;
            
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' 
            ? __initial_auth_token 
            : import.meta.env.VITE_INITIAL_AUTH_TOKEN;

        const currentAppId = typeof __app_id !== 'undefined' 
            ? __app_id 
            : (import.meta.env.VITE_APP_ID || 'default-app-id');
        
        setAppId(currentAppId);
        globalAppId = currentAppId;
        
        try {
            if (firebaseConfigStr && firebaseConfigStr.trim() !== '') {
                firebaseConfig = JSON.parse(firebaseConfigStr);
            } else {
                console.warn("[FIREBASE] __firebase_config is not defined or is empty.");
                firebaseInitializationError = 'Firebase config environment variable is missing.';
            }
        } catch (e) {
            console.error("CRITICAL: Failed to parse Firebase config:", e);
            firebaseInitializationError = `Failed to parse Firebase config: ${e.message}`;
        }
        
        if (firebaseInitializationError) {
            console.error("[FIREBASE] Firebase init failed:", firebaseInitializationError);
            setStatusMessage({ text: firebaseInitializationError, type: 'error' });
            setIsAuthReady(true);
            return;
        }

        if (firebaseConfig) {
            try {
                const app = initializeApp(firebaseConfig);
                const authInstance = getAuth(app);
                const dbInstance = getFirestore(app);
                setDb(dbInstance);
                setAuth(authInstance);
                setLogLevel('debug');
                console.log("[FIREBASE] Initialized.");

                const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                    if (user) {
                        console.log("[FIREBASE] User is signed in:", user.uid);
                        setUserId(user.uid);
                    } else {
                        console.log("[FIREBASE] User is signed out. Attempting sign-in...");
                        setUserId(null);
                        try {
                            if (initialAuthToken) {
                                console.log("[FIREBASE] Signing in with custom token...");
                                await signInWithCustomToken(authInstance, initialAuthToken);
                            } else {
                                console.log("[FIREBASE] Signing in anonymously...");
                                await signInAnonymously(authInstance);
                            }
                        } catch (signInError) {
                            console.error("[FIREBASE] Sign-in error:", signInError);
                            setStatusMessage({ text: `Firebase sign-in failed: ${signInError.message}`, type: 'error' });
                            const tempId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                            setUserId(tempId);
                            console.warn("[FIREBASE] Using temporary local ID:", tempId);
                        }
                    }
                    if (!isAuthReady) {
                        setIsAuthReady(true);
                        console.log("[FIREBASE] Auth state ready.");
                    }
                });
                return () => unsubscribe();
            } catch (initError) {
                console.error("[FIREBASE] Initialization failed:", initError);
                setStatusMessage({ text: `Firebase init failed: ${initError.message}`, type: 'error' });
                setIsAuthReady(true);
            }
        }
    }, [isAuthReady]);


    // --- Load Profile on Auth Ready ---
    const handleLoadProfile = useCallback(async (isInitialLoad = false) => {
        if (!isAuthReady || !userId || !db || !appId || appId === 'default-app-id') {
            const msg = 'Firebase not ready or App ID is missing. Cannot load profile.';
            if (!isInitialLoad) setStatusMessage({ text: msg, type: 'error' });
            console.error(`[FIREBASE LOAD] ${msg}`, { isAuthReady, userId: !!userId, db: !!db, appId });
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
                
                if (loadedData && typeof loadedData === 'object' && Object.keys(loadedData).length > 0) {
                     setFormData(prev => ({ ...prev, ...loadedData }));
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
                      }
                }
            } else {
                console.log('[FIREBASE LOAD] No profile document found.');
                 if (!isInitialLoad) {
                    setStatusMessage({ text: 'No saved profile found.', type: 'info' });
                 }
            }
        } catch (loadError) {
            console.error('[FIREBASE LOAD] Error loading profile:', loadError);
             if (!isInitialLoad) {
                setStatusMessage({ text: `Error loading profile: ${loadError.message}`, type: 'error' });
             }
        } finally {
            if (!isInitialLoad) {
                setTimeout(() => {
                    setStatusMessage(prev => prev.text === 'Loading profile...' ? { text: '', type: '' } : prev);
                }, 3000);
            }
        }
    }, [isAuthReady, userId, db, appId]);

    useEffect(() => {
        if (isAuthReady && userId && db && appId) {
            handleLoadProfile(true);
        }
    }, [isAuthReady, userId, db, appId, handleLoadProfile]);

    
    // --- [NEW] Calculate "Planned" Macros for the selected day ---
    const plannedMacros = useMemo(() => {
        const dayPlan = mealPlan.find(day => day.dayNumber === selectedDay);
        if (!dayPlan || !dayPlan.meals) {
            return emptyMacros;
        }

        return dayPlan.meals.reduce((totals, meal) => {
            return {
                calories: totals.calories + (meal.subtotal_kcal || 0),
                protein: totals.protein + (meal.subtotal_protein || 0),
                fat: totals.fat + (meal.subtotal_fat || 0),
                carbs: totals.carbs + (meal.subtotal_carbs || 0),
            };
        }, { ...emptyMacros });

    }, [mealPlan, selectedDay]);

    // --- [NEW] Reset "Actual" macros when the day changes ---
    useEffect(() => {
        setActual(emptyMacros);
        // We could also load saved 'actual' data for the day from Firestore here
    }, [selectedDay]);


    // --- Handlers ---

    // --- [NEW] Handler for logging a meal ---
    const handleLogMeal = useCallback((mealMacros) => {
        if (!mealMacros) return;
        setActual((prevActual) => ({
            calories: prevActual.calories + (mealMacros.subtotal_kcal || 0),
            protein: prevActual.protein + (mealMacros.subtotal_protein || 0),
            fat: prevActual.fat + (mealMacros.subtotal_fat || 0),
            carbs: prevActual.carbs + (mealMacros.subtotal_carbs || 0),
        }));
        // We could also save the 'actual' state to Firestore here
    }, []);

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
    }, []);

    const handleGeneratePlan = useCallback(async (e) => {
        e.preventDefault();
        
        // 1. Reset All State
        setLoading(true);
        setError(null);
        setDiagnosticLogs([]);
        setNutritionCache({});
        setNutritionalTargets({ calories: 0, protein: 0, fat: 0, carbs: 0 });
        setActual(emptyMacros); // [NEW] Reset actual tracker
        setResults({});
        setUniqueIngredients([]);
        setMealPlan([]);
        setTotalCost(0);
        setEatenMeals({});
        setFailedIngredientsHistory([]);
        setGenerationStepKey('targets'); 
        if (!isLogOpen) { setLogHeight(250); setIsLogOpen(true); }

        let targets;

        // 2. Fetch Nutritional Targets
        try {
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
            
        } catch (err) {
            console.error("Plan generation failed critically at Targets:", err);
            setError(`Critical failure: ${err.message}`);
            setGenerationStepKey('error');
            setLoading(false);
            setDiagnosticLogs(prev => [...prev, {
                timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: `Critical failure: ${err.message}`
            }]);
            return; 
        }

        // 3. Execute based on Feature Flag
        if (!useBatchedMode) {
            // [LEGACY] Per-Day Loop Logic
            setGenerationStatus("Generating plan (per-day mode)...");
            let accumulatedResults = {}; 
            let accumulatedMealPlan = []; 
            let accumulatedUniqueIngredients = new Map(); 

            try {
                const numDays = parseInt(formData.days, 10);
                for (let day = 1; day <= numDays; day++) {
                    setGenerationStatus(`Generating plan for Day ${day}/${numDays}...`);
                    setGenerationStepKey('planning'); 
                    
                    let dailyFailedIngredients = [];
                    let dayFetchError = null;

                    try {
                        const dayResponse = await fetch(`${ORCHESTRATOR_DAY_API_URL}?day=${day}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                            body: JSON.stringify({ formData, nutritionalTargets: targets }),
                        });

                        if (!dayResponse.ok) {
                            const errorData = await dayResponse.json();
                            throw new Error(`Day ${day} request failed: ${errorData.message || 'Unknown server error'}`);
                        }

                        const reader = dayResponse.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';
                        let dayDataReceived = false;

                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) {
                                if (!dayDataReceived && !dayFetchError) {
                                    throw new Error(`Day ${day} stream ended unexpectedly without data.`);
                                }
                                break;
                            }
                            
                            const { events, newBuffer } = processSseChunk(value, buffer, decoder);
                            buffer = newBuffer;

                            for (const event of events) {
                                const eventData = event.data;
                                switch (event.eventType) {
                                    case 'message':
                                    case 'log_message':
                                        setDiagnosticLogs(prev => [...prev, eventData]);
                                        if (eventData?.tag === 'MARKET_RUN' || eventData?.tag === 'CHECKLIST' || eventData?.tag === 'HTTP') {
                                            setGenerationStepKey('market');
                                        } else if (eventData?.tag === 'LLM' || eventData?.tag === 'LLM_PROMPT') {
                                            setGenerationStepKey('planning');
                                        }
                                        break;
                                    case 'error':
                                        dayFetchError = eventData.message || 'An error occurred during generation.';
                                        setError(prevError => prevError ? `${prevError}\nDay ${day}: ${dayFetchError}` : `Day ${day}: ${dayFetchError}`);
                                        setGenerationStepKey('error');
                                        break;
                                    case 'finalData':
                                        dayDataReceived = true;
                                        if (eventData.mealPlanForDay) accumulatedMealPlan.push(eventData.mealPlanForDay);
                                        if (eventData.dayResults) accumulatedResults = { ...accumulatedResults, ...eventData.dayResults };
                                        if (eventData.dayUniqueIngredients) {
                                            eventData.dayUniqueIngredients.forEach(ing => {
                                                if (ing && ing.originalIngredient) accumulatedUniqueIngredients.set(ing.originalIngredient, { ...(accumulatedUniqueIngredients.get(ing.originalIngredient) || {}), ...ing });
                                            });
                                        }
                                        setMealPlan([...accumulatedMealPlan]);
                                        setResults({ ...accumulatedResults }); 
                                        setUniqueIngredients(Array.from(accumulatedUniqueIngredients.values()));
                                        recalculateTotalCost(accumulatedResults);
                                        break;
                                    case 'phase:start':
                                    case 'ingredient:found':
                                    case 'ingredient:failed':
                                        setDiagnosticLogs(prev => [...prev, { timestamp: new Date().toISOString(), level: 'DEBUG', tag: 'SSE_UNHANDLED', message: `Received unhandled v2 event '${event.eventType}' in v1 loop.`}]);
                                        break;
                                }
                            }
                            if (dayFetchError) break;
                        } // end while(true)
                    } catch (dayError) {
                        console.error(`Error processing day ${day}:`, dayError);
                        setError(prevError => prevError ? `${prevError}\n${dayError.message}` : dayError.message); 
                        setGenerationStepKey('error');
                        setDiagnosticLogs(prev => [...prev, { timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: dayError.message }]);
                    } finally {
                        if (dailyFailedIngredients.length > 0) setFailedIngredientsHistory(prev => [...prev, ...dailyFailedIngredients]);
                    }
                } // --- End of day loop ---

                if (!error) {
                    setGenerationStatus(`Plan generation finished.`);
                    setGenerationStepKey('finalizing');
                    setTimeout(() => setGenerationStepKey('complete'), 1500);
                } else {
                    setGenerationStepKey('error');
                }
            } catch (err) {
                 console.error("Per-day plan generation failed critically:", err);
                 setError(`Critical failure: ${err.message}`);
                 setGenerationStepKey('error');
            } finally {
                 setTimeout(() => setLoading(false), 2000);
            }

        } else {
            // --- [NEW] Batched Plan Logic ---
            setGenerationStatus("Generating full plan (batched mode)...");
            
            try {
                const planResponse = await fetch(ORCHESTRATOR_FULL_PLAN_API_URL, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream' 
                    },
                    body: JSON.stringify({
                        formData,
                        nutritionalTargets: targets 
                    }),
                });

                if (!planResponse.ok) {
                    let errorMsg = 'Unknown server error';
                    try {
                        const errorData = await planResponse.json();
                        errorMsg = errorData.message || JSON.stringify(errorData);
                    } catch (e) {
                        errorMsg = await planResponse.text();
                    }
                    throw new Error(`Full plan request failed (${planResponse.status}): ${errorMsg}`);
                }

                const reader = planResponse.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let planComplete = false;

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        if (!planComplete && !error) {
                            console.error("Stream ended unexpectedly before 'plan:complete' event.");
                            throw new Error("Stream ended unexpectedly. The plan may be incomplete.");
                        }
                        break;
                    }
                    
                    const { events, newBuffer } = processSseChunk(value, buffer, decoder);
                    buffer = newBuffer;

                    for (const event of events) {
                        const eventData = event.data;
                        
                        switch (event.eventType) {
                            case 'log_message':
                                setDiagnosticLogs(prev => [...prev, eventData]);
                                break;
                            
                            case 'phase:start':
                                const phaseMap = {
                                    'meals': 'planning',
                                    'aggregate': 'planning',
                                    'market': 'market',
                                    'nutrition': 'market',
                                    'solver': 'finalizing',
                                    'writer': 'finalizing',
                                    'finalize': 'finalizing'
                                };
                                const stepKey = phaseMap[eventData.name];
                                if (stepKey) {
                                    setGenerationStepKey(stepKey);
                                    if(eventData.description) setGenerationStatus(eventData.description);
                                }
                                break;
                            
                            case 'ingredient:found':
                                setResults(prev => ({
                                    ...prev,
                                    [eventData.key]: eventData.data
                                }));
                                break;

                            case 'ingredient:failed':
                                const failedItem = {
                                    timestamp: new Date().toISOString(),
                                    originalIngredient: eventData.key,
                                    error: eventData.reason,
                                };
                                setFailedIngredientsHistory(prev => [...prev, failedItem]);
                                setResults(prev => ({
                                    ...prev,
                                    [eventData.key]: {
                                        originalIngredient: eventData.key,
                                        normalizedKey: eventData.key,
                                        source: 'failed',
                                        error: eventData.reason,
                                        allProducts: [],
                                        currentSelectionURL: MOCK_PRODUCT_TEMPLATE.url
                                    }
                                }));
                                break;

                            case 'plan:complete':
                                planComplete = true; 
                                setMealPlan(eventData.mealPlan || []);
                                setResults(eventData.results || {});
                                setUniqueIngredients(eventData.uniqueIngredients || []);
                                recalculateTotalCost(eventData.results || {});
                                
                                setGenerationStepKey('complete');
                                setGenerationStatus('Plan generation complete!');
                                break;

                            case 'error':
                                throw new Error(eventData.message || 'Unknown backend error');
                        }
                    }
                } // end while(true)
                
            } catch (err) {
                console.error("Batched plan generation failed critically:", err);
                setError(`Critical failure: ${err.message}`);
                setGenerationStepKey('error');
                setDiagnosticLogs(prev => [...prev, {
                    timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: `Critical failure: ${err.message}`
                }]);
            } finally {
                 setTimeout(() => setLoading(false), 2000);
            }
        }
    }, [formData, isLogOpen, recalculateTotalCost, useBatchedMode]); 


    const handleFetchNutrition = useCallback(async (product) => {
        if (!product || !product.url || nutritionCache[product.url]) { return; }
        if (product.nutrition && product.nutrition.status === 'found') {
             setNutritionCache(prev => ({...prev, [product.url]: product.nutrition}));
             return;
        }
        setLoadingNutritionFor(product.url);
        try {
            const params = product.barcode ? `barcode=${product.barcode}` : `query=${encodeURIComponent(product.name)}`;
            const response = await fetch(`${NUTRITION_API_URL}?${params}`);
            if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
                const errorText = await response.text();
                throw new Error(`Nutrition API Error ${response.status}: ${errorText || 'Invalid response'}`);
            }
            const nutritionData = await response.json();
            setNutritionCache(prev => ({...prev, [product.url]: nutritionData}));
        } catch (err) {
            console.error("Failed to fetch nutrition for", product.name, ":", err);
            setNutritionCache(prev => ({...prev, [product.url]: { status: 'not_found', source: 'fetch_error', reason: err.message }}));
        } finally {
            setLoadingNutritionFor(null);
        }
    }, [nutritionCache]); 

    const handleSubstituteSelection = useCallback((key, newProduct) => {
        setResults(prev => {
            const updatedItem = { ...prev[key], currentSelectionURL: newProduct.url };
            const newResults = { ...prev, [key]: updatedItem };
            recalculateTotalCost(newResults); 
            return newResults;
        });
    }, [recalculateTotalCost]); 

    const handleQuantityChange = useCallback((key, delta) => {
        setResults(prev => {
            if (!prev[key]) {
                console.error(`[handleQuantityChange] Error: Ingredient key "${key}" not found.`);
                return prev;
            }
            const currentQty = prev[key].userQuantity || 1; 
            const newQty = Math.max(1, currentQty + delta); 
            const updatedItem = { ...prev[key], userQuantity: newQty };
            const newResults = { ...prev, [key]: updatedItem };
            recalculateTotalCost(newResults); 
            return newResults;
        });
    }, [recalculateTotalCost]); 

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
    }, [failedIngredientsHistory]); 

    const handleDownloadLogs = useCallback(() => {
        if (!diagnosticLogs || diagnosticLogs.length === 0) return;
        let logContent = "Cheffy Orchestrator Logs\n=========================\n\n";
        diagnosticLogs.forEach(log => {
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
    }, [diagnosticLogs]); 

    const handleSaveProfile = useCallback(async () => {
        if (!isAuthReady || !userId || !db || !appId || appId === 'default-app-id') {
            setStatusMessage({ text: 'Firebase not ready or App ID missing. Cannot save profile.', type: 'error' });
            console.error('[FIREBASE SAVE] Auth not ready or DB/userId/appId missing.');
            return;
        }
        setStatusMessage({ text: 'Saving profile...', type: 'info' });
        try {
            const profileDocRef = doc(db, 'artifacts', appId, 'users', userId, FIRESTORE_PROFILE_COLLECTION, FIRESTORE_PROFILE_DOC_ID);
            console.log(`[FIREBASE SAVE] Saving profile to: ${profileDocRef.path}`);
            await setDoc(profileDocRef, formData); 
            setStatusMessage({ text: 'Profile saved successfully!', type: 'success' });
            console.log('[FIREBASE SAVE] Profile saved.');
        } catch (saveError) {
            console.error('[FIREBASE SAVE] Error saving profile:', saveError);
            setStatusMessage({ text: `Error saving profile: ${saveError.message}`, type: 'error' });
        } finally {
             setTimeout(() => {
                 setStatusMessage(prev => prev.text === 'Saving profile...' ? { text: '', type: '' } : prev);
             }, 3000);
        }
    }, [isAuthReady, userId, db, formData, appId]);


    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (name === 'days') {
             const newDays = parseInt(value, 10);
             if (!isNaN(newDays) && newDays < selectedDay) {
                 setSelectedDay(newDays);
             }
        }
    };
    const handleSliderChange = (e) => {
        const value = parseInt(e.target.value, 10);
        setFormData(prev => ({ ...prev, days: value }));
        if (value < selectedDay) {
            setSelectedDay(value);
        }
    };
    const onToggleMealEaten = useCallback((day, mealName) => {
        setEatenMeals(prev => {
            const dayKey = `day${day}`;
            const dayMeals = { ...(prev[dayKey] || {}) };
            dayMeals[mealName] = !dayMeals[mealName];
            return { ...prev, [dayKey]: dayMeals };
        });
    }, []); 

    const categorizedResults = useMemo(() => {
        const groups = {};
        Object.entries(results || {}).forEach(([normalizedKey, item]) => {
            if (item && item.originalIngredient && (item.source === 'discovery' || item.source === 'failed' || item.source === 'error' || item.source === 'canonical_fallback')) {
                const category = item.category || 'Uncategorized';
                if (!groups[category]) groups[category] = [];
                 if (!groups[category].some(existing => existing.originalIngredient === item.originalIngredient)) {
                      groups[category].push({ normalizedKey: normalizedKey, ingredient: item.originalIngredient, ...item });
                 }
            }
        });
        const sortedCategories = Object.keys(groups).sort();
        const sortedGroups = {};
        for (const category of sortedCategories) {
            sortedGroups[category] = groups[category];
        }
        return sortedGroups;
    }, [results]); 


    const PlanCalculationErrorPanel = () => (
        <div className="p-6 text-center bg-red-100 text-red-800 rounded-lg shadow-lg m-4">
            <AlertTriangle className="inline mr-2 w-8 h-8" />
            <h3 className="text-xl font-bold">Plan Calculation Error</h3>
            <p className="mt-2">A critical error occurred while calculating meal nutrition. The generated plan is incomplete and cannot be displayed. Please check the logs for details.</p>
        </div>
    );

    const hasInvalidMeals = useMemo(() => {
        if (!mealPlan || mealPlan.length === 0) return false;
        return mealPlan.some(dayPlan =>
            !dayPlan || !Array.isArray(dayPlan.meals) || dayPlan.meals.some(meal =>
                !meal || typeof meal.subtotal_kcal !== 'number' || meal.subtotal_kcal <= 0
            )
        );
    }, [mealPlan]); 

    const latestLog = diagnosticLogs.length > 0 ? diagnosticLogs[diagnosticLogs.length - 1] : null;

    // --- Content Views (Progressive Rendering) ---
    const priceComparisonContent = (
        <div className="space-y-0 p-4">
            {error && !loading && (
                 <div className="p-4 bg-red-50 text-red-800 rounded-lg">
                    <AlertTriangle className="inline w-6 h-6 mr-2" />
                    <strong>Error(s) occurred during plan generation:</strong>
                    <pre className="mt-2 whitespace-pre-wrap text-sm">{error}</pre>
                 </div>
            )}

            {!loading && Object.keys(results).length > 0 && (
                <>
                    <div className="bg-white p-4 rounded-xl shadow-md border-t-4 border-indigo-600 mb-6">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xl font-bold flex items-center"><DollarSign className="w-5 h-5 mr-2"/> Total Estimated Cost</h3>
                            <p className="text-3xl font-extrabold text-green-700">${totalCost.toFixed(2)}</p>
                        </div>
                        <p className="text-sm text-gray-500">Cost reflects selected products multiplied by units purchased from {formData.store}.</p>
                    </div>

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
            {!loading && Object.keys(results).length === 0 && !error && (
                <div className="p-6 text-center text-gray-500">Generate a plan to see results.</div>
            )}
        </div>
    );
    
    const mealPlanContent = (
        <div className="flex flex-col md:flex-row p-4 gap-6">
            {mealPlan.length > 0 && (
                <div className="sticky top-4 z-20 self-start w-full md:w-auto mb-4 md:mb-0 bg-white rounded-lg shadow p-4">
                    <DaySidebar days={Math.max(1, mealPlan.length)} selectedDay={selectedDay} onSelect={setSelectedDay} />
                </div>
            )}
            {mealPlan.length > 0 && selectedDay >= 1 && selectedDay <= mealPlan.length ? (
                <MealPlanDisplay
                    key={selectedDay}
                    mealPlan={mealPlan}
                    selectedDay={selectedDay}
                    nutritionalTargets={nutritionalTargets}
                    eatenMeals={eatenMeals}
                    onToggleMealEaten={onToggleMealEaten}
                    onViewRecipe={setSelectedMeal} 
                    onLogMeal={handleLogMeal} // [NEW] Pass the logging handler
                />
            ) : (
                <div className="flex-1 text-center p-8 text-gray-500">
                    {error && !loading ? (
                         <div className="p-4 bg-red-50 text-red-800 rounded-lg">
                             <AlertTriangle className="inline w-6 h-6 mr-2" />
                             <strong>Error generating plan. Check logs for details.</strong>
                             <pre className="mt-2 whitespace-pre-wrap text-sm">{error}</pre>
                         </div>
                    ) : mealPlan.length === 0 && !loading ? (
                         'Generate a plan to see your meals.'
                    ) : (
                         !loading && 'Select a valid day to view meals.'
                    )}
                </div>
            )}
        </div>
    );

    const totalLogHeight = (failedIngredientsHistory.length > 0 ? 60 : 0) + (isLogOpen ? Math.max(minLogHeight, logHeight) : minLogHeight);

    const getStatusColor = (type) => {
        switch (type) {
            case 'success': return 'bg-green-100 text-green-800';
            case 'error': return 'bg-red-100 text-red-800';
            case 'warn': return 'bg-yellow-100 text-yellow-800';
            case 'info': return 'bg-blue-100 text-blue-800';
            default: return 'hidden'; 
        }
    };

    return (
        // [NEW] 1. Wrap entire app in ThemeProvider
        <ThemeProvider>
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
                                    <button
                                        onClick={() => handleLoadProfile(false)} 
                                        disabled={!isAuthReady || !userId || !db} 
                                        className="flex items-center px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Load Saved Profile"
                                    >
                                        <FolderDown size={14} className="mr-1" /> Load
                                    </button>
                                     <button
                                        onClick={handleSaveProfile}
                                        disabled={!isAuthReady || !userId || !db} 
                                        className="flex items-center px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Save Current Profile"
                                    >
                                        <Save size={14} className="mr-1" /> Save
                                    </button>
                                    <button className="md:hidden p-1.5" onClick={() => setIsMenuOpen(false)}><X /></button>
                                </div>
                            </div>
                            <form onSubmit={handleGeneratePlan}>
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
                                
                                {/* [NEW] 2. Add the ThemeSwitcher component */}
                                <div className="mb-4">
                                    <ThemeSwitcher />
                                </div>

                                <InputField label="Meals Per Day" name="eatingOccasions" type="select" value={formData.eatingOccasions} onChange={handleChange} options={[ { value: '3', label: '3 Meals' }, { value: '4', label: '4 Meals' }, { value: '5', label: '5 Meals' } ]} />
                                <InputField label="Spending Priority" name="costPriority" type="select" value={formData.costPriority} onChange={handleChange} options={[ { value: 'Extreme Budget', label: 'Extreme Budget' }, { value: 'Best Value', label: 'Best Value' }, { value: 'Quality Focus', label: 'Quality Focus' } ]} />
                                <InputField label="Meal Variety" name="mealVariety" type="select" value={formData.mealVariety} onChange={handleChange} options={[ { value: 'High Repetition', label: 'High' }, { value: 'Balanced Variety', label: 'Balanced' }, { value: 'Low Repetition', label: 'Low' } ]} />
                                <InputField label="Cuisine Profile (Optional)" name="cuisine" value={formData.cuisine} onChange={handleChange} placeholder="e.g., Spicy Thai" />

                                <div className="flex items-center justify-center mt-4 pt-4 border-t">
                                    <input
                                        type="checkbox"
                                        id="batchModeToggle"
                                        name="batchModeToggle"
                                        checked={useBatchedMode}
                                        onChange={(e) => setUseBatchedMode(e.target.checked)}
                                        className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                    />
                                    <label htmlFor="batchModeToggle" className="ml-2 block text-sm text-gray-900" title="Use the new batched endpoint (v2) instead of the per-day loop (v1)">
                                        Use Batched Generation (v2)
                                    </label>
                                </div>


                                <button type="submit" disabled={loading || !isAuthReady || !firebaseConfig} className={`w-full flex items-center justify-center py-3 mt-6 text-lg font-bold rounded-xl shadow-lg ${loading || !isAuthReady || !firebaseConfig ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}>
                                    {loading ? <><RefreshCw className="w-5 h-5 mr-3 animate-spin" /> Processing...</> : <><Zap className="w-5 h-5 mr-3" /> Generate Plan</>}
                                </button>
                                {(!isAuthReady || !firebaseConfig) && <p className="text-xs text-center text-red-600 mt-2">
                                    {firebaseInitializationError ? firebaseInitializationError : 'Initializing Firebase auth...'}
                                </p>}
                            </form>
                        </div>

                        {/* --- RESULTS VIEW --- */}
                        <div className={`w-full md:w-1/2 ${isMenuOpen ? 'hidden md:block' : 'block'}`}>
                            <div className="p-4 md:hidden flex justify-end">
                                <button className="bg-indigo-600 text-white p-2 rounded-full shadow" onClick={() => setIsMenuOpen(true)}><Menu /></button>
                            </div>
                            <div className="border-b">
                                <div className="p-6 md:p-8">
                                    <h2 className="text-xl font-bold mb-4 flex items-center"><Calendar className="w-5 h-5 mr-2" /> Plan Summary ({formData.days} Days)</h2>
                                    <div className="text-sm space-y-2 bg-indigo-50 p-4 rounded-lg border">
                                        <p className="flex items-center"><Users className="w-4 h-4 mr-2"/> Goal: <span className='font-semibold ml-1'>{formData.goal.toUpperCase()}</span> | Dietary: <span className='font-semibold ml-1'>{formData.dietary}</span></p>
                                        <p className="flex items-center"><Tag className="w-4 h-4 mr-2"/> Spending: <span className='font-semibold ml-1'>{formData.costPriority}</span></p>
                                        
                                        {/* [NEW] 3. Replace the nutrition grid with the CalorieTracker wrapper */}
                                        <div className="pt-2 mt-2 border-t">
                                            <h4 className="font-bold mb-2 text-center">Daily Nutritional Targets</h4>
                                            {/* This component will now render one of the 3 themes */}
                                            <CalorieTracker
                                                isLoading={loading && generationStepKey === 'targets'}
                                                targets={nutritionalTargets}
                                                planned={plannedMacros}
                                                actual={actual}
                                            />
                                        </div>
                                        {/* [END OF REPLACEMENT] */}

                                    </div>
                                    {uniqueIngredients.length > 0 && !hasInvalidMeals && (
                                        <CollapsibleSection title={`Shopping List (${uniqueIngredients.length} Items)`}>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {uniqueIngredients.map((item, index) => (
                                                     <div key={item.originalIngredient || index} className="flex justify-between items-center p-3 bg-white border rounded-lg shadow-sm">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-bold truncate">{item.originalIngredient || 'Unknown Ingredient'}</p>
                                                            <p className="text-sm">Est. Qty: {item.totalGramsRequired ? `${Math.round(item.totalGramsRequired)}g` : 'N/A'} ({item.quantityUnits || 'N/A'})</p>
                                                        </div>
                                                        <span className="px-3 py-1 ml-4 text-xs font-semibold text-indigo-800 bg-indigo-100 rounded-full whitespace-nowrap">{item.category || 'N/A'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </CollapsibleSection>
                                    )}
                                </div>
                            </div>

                            {hasInvalidMeals ? (
                                <PlanCalculationErrorPanel />
                            ) : (
                                <div className="p-0">
                                    {loading && (
                                        <div className="p-4 md:p-6">
                                            <GenerationProgressDisplay
                                                activeStepKey={generationStepKey}
                                                errorMsg={error}
                                                latestLog={latestLog} 
                                            />
                                        </div>
                                    )}

                                    {(results && Object.keys(results).length > 0 && !loading) && (
                                        <div className="flex space-x-2 p-4">
                                            <button className={`flex-1 py-3 px-5 text-center font-medium rounded-lg transition-all ${ contentView === 'priceComparison' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100' }`} onClick={() => setContentView('priceComparison')}>Ingredients</button>
                                            {mealPlan.length > 0 && (
                                                <button className={`flex-1 py-3 px-5 text-center font-medium rounded-lg transition-all ${ contentView === 'mealPlan' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100' }`} onClick={() => setContentView('mealPlan')}>Meal Plan</button>
                                            )}
                                        </div>
                                    )}
                                    
                                    {contentView === 'priceComparison' ? priceComparisonContent : mealPlanContent}

                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

             {/* --- Log Viewers (Fixed at bottom) --- */}
            <div className="fixed bottom-0 left-0 right-0 z-[100] flex flex-col-reverse">
                <DiagnosticLogViewer logs={diagnosticLogs} height={logHeight} setHeight={setLogHeight} isOpen={isLogOpen} setIsOpen={setIsOpen} onDownloadLogs={handleDownloadLogs} />
                <FailedIngredientLogViewer failedHistory={failedIngredientsHistory} onDownload={handleDownloadFailedLogs} />
            </div>

            {/* --- Render the modal conditionally --- */}
            {selectedMeal && (
                <RecipeModal 
                    meal={selectedMeal} 
                    onClose={() => setSelectedMeal(null)} 
                />
            )}
        </div>
    </ThemeProvider>
    );
};

export default App;


