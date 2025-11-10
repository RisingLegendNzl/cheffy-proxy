// web/src/App.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Package, DollarSign, ExternalLink, Calendar, Users, Menu, X, ChevronsDown, ChevronsUp, ShoppingBag, BookOpen, ChefHat, Tag, Soup, Replace, Target, FileText, LayoutDashboard, Terminal, Loader, ChevronRight, GripVertical, Flame, Droplet, Wheat, ChevronDown, ChevronUp, Download, ListX, Save, FolderDown, User, Check, ListChecks, ListOrdered, Utensils } from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, setLogLevel } from 'firebase/firestore';

// --- Component Imports ---
import MacroRing from './components/MacroRing';
import MacroBar from './components/MacroBar';
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
import ProfileTab from './components/ProfileTab'; // <-- Import new component
import LandingPage from './pages/LandingPage'; // <<< STEP 1: (No change)

// ===== ADD AFTER EXISTING IMPORTS =====

// Phase 1: Foundation
import { COLORS, SPACING, SHADOWS, Z_INDEX } from './constants';
import { 
  formatGoalText, 
  formatPrice, 
  formatCalories, 
  formatGrams,
  copyToClipboard,
  getGoalData,
  formatActivityLevel
} from './helpers';

// Phase 2: Core UI
import Header from './components/Header';
import { ToastContainer } from './components/Toast';
import EmptyState from './components/EmptyState';
import LoadingOverlay from './components/LoadingOverlay';
import SuccessModal from './components/SuccessModal';

// Phase 3: Enhanced Components
import MealCard from './components/MealCard';
import DayNavigator from './components/DayNavigator';
import ShoppingListEnhanced from './components/ShoppingListEnhanced';
import FormSection from './components/FormSection';
import SettingsPanel from './components/SettingsPanel';

// Phase 4: Mobile
import BottomNav from './components/BottomNav';
import { MealCardSkeleton, ProfileCardSkeleton, ShoppingListSkeleton } from './components/SkeletonLoader';
import PullToRefresh from './components/PullToRefresh';
import { useResponsive } from './hooks/useResponsive';

// --- CONFIGURATION ---
const ORCHESTRATOR_TARGETS_API_URL = '/api/plan/targets';
const ORCHESTRATOR_DAY_API_URL = '/api/plan/day'; // Old per-day endpoint
const ORCHESTRATOR_FULL_PLAN_API_URL = '/api/plan/generate-full-plan'; // New batched endpoint

const NUTRITION_API_URL = '/api/nutrition-search';
const MAX_SUBSTITUTES = 5;
// --- REMOVED Firestore constants (Change 1) ---

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
    const [contentView, setContentView] = useState('profile'); // <-- Set default tab
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [diagnosticLogs, setDiagnosticLogs] = useState([]);
    const [nutritionCache, setNutritionCache] = useState({});
    const [loadingNutritionFor, setLoadingNutritionFor] = useState(null);
    const [logHeight, setLogHeight] = useState(250);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const minLogHeight = 50;
    const [failedIngredientsHistory, setFailedIngredientsHistory] = useState([]);
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });
    
    // --- State Variables for Log Visibility Toggles ---
    const [showOrchestratorLogs, setShowOrchestratorLogs] = useState(
      () => JSON.parse(localStorage.getItem('cheffy_show_orchestrator_logs') ?? 'true')
    );
    const [showFailedIngredientsLogs, setShowFailedIngredientsLogs] = useState(
      () => JSON.parse(localStorage.getItem('cheffy_show_failed_ingredients_logs') ?? 'true')
    );
    
    const [generationStepKey, setGenerationStepKey] = useState(null);
    const [generationStatus, setGenerationStatus] = useState("Ready to generate plan."); 

    const [selectedMeal, setSelectedMeal] = useState(null);

    const [useBatchedMode, setUseBatchedMode] = useState(true);

    // ===== NEW STATE VARIABLES =====

    // Toast notifications
    const [toasts, setToasts] = useState([]);

    // Success modal
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [planStats, setPlanStats] = useState([]);

    // Settings panel
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Responsive hook
    const { isMobile, isDesktop } = useResponsive();

    // --- Firebase State ---
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    const [appId, setAppId] = useState('default-app-id');

    // <<< STEP 2: ADDED STATE VARIABLE (from previous guide) >>>
    const [showLandingPage, setShowLandingPage] = useState(true);

    // <<< STEP 2: ADDED NEW STATE VARIABLES >>>
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);
    
    // --- Persist Log Visibility Preferences ---
    useEffect(() => {
      localStorage.setItem('cheffy_show_orchestrator_logs', JSON.stringify(showOrchestratorLogs));
    }, [showOrchestratorLogs]);

    useEffect(() => {
      localStorage.setItem('cheffy_show_failed_ingredients_logs', JSON.stringify(showFailedIngredientsLogs));
    }, [showFailedIngredientsLogs]);

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
                        console.log("[FIREBASE] User is signed out.");
                        setUserId(null);
                        // Don't auto-sign-in anonymously anymore, let the user choose
                        // We will show the landing page instead
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
    }, []); // Removed isAuthReady from dep array logic as it's set inside


    // --- Load Profile on Auth Ready ---
    // --- REPLACED per Change 3 ---
    const handleLoadProfile = useCallback(async (silent = false) => {
        // Check if user is authenticated (not anonymous)
        if (!isAuthReady || !userId || !db || userId.startsWith('local_')) {
            if (!silent) {
                showToast('Please sign in to load your profile', 'warning');
            }
            return false;
        }
    
        try {
            // Load from simplified path: profile/{userId}
            const profileRef = doc(db, 'profile', userId);
            const profileSnap = await getDoc(profileRef);
    
            if (profileSnap.exists()) {
                const data = profileSnap.data();
                
                // Load form data
                setFormData({
                    name: data.name || '',
                    height: data.height || '180',
                    weight: data.weight || '75',
                    age: data.age || '30',
                    gender: data.gender || 'male',
                    bodyFat: data.bodyFat || '',
                    activityLevel: data.activityLevel || 'moderate',
                    goal: data.goal || 'cut_moderate',
                    dietary: data.dietary || 'None',
                    cuisine: data.cuisine || '',
                    days: data.days || 7,
                    eatingOccasions: data.eatingOccasions || '3',
                    store: data.store || 'Woolworths',
                    costPriority: data.costPriority || 'Best Value',
                    mealVariety: data.mealVariety || 'Balanced Variety'
                });
                
                // Load nutritional targets if they exist
                if (data.nutritionalTargets) {
                    setNutritionalTargets(data.nutritionalTargets);
                }
                
                console.log("[PROFILE] Profile loaded successfully");
                if (!silent) {
                    showToast('Profile loaded successfully!', 'success');
                }
                
                return true; // Profile exists
                
            } else {
                console.log("[PROFILE] No saved profile found");
                if (!silent) {
                    showToast('No saved profile found', 'info');
                }
                return false; // No profile
            }
            
        } catch (error) {
            console.error("[PROFILE] Error loading profile:", error);
            if (!silent) {
                showToast('Failed to load profile', 'error');
            }
            return false;
        }
    }, [userId, db, isAuthReady, showToast]);

    // --- ADDED per Change 4 ---
    // Auto-save profile 2 seconds after user stops typing
    useEffect(() => {
        // Only auto-save if user is authenticated
        if (!userId || userId.startsWith('local_') || !isAuthReady) return;
        
        // Debounce: wait 2 seconds after last change
        const timeoutId = setTimeout(() => {
            handleSaveProfile(true); // Silent save (no toast)
        }, 2000);
        
        // Cleanup: cancel previous timer if user types again
        return () => clearTimeout(timeoutId);
    }, [formData, nutritionalTargets, userId, isAuthReady, handleSaveProfile]);


    // --- ADDED per Change 5 ---
    // Save settings to Firestore
    const handleSaveSettings = useCallback(async () => {
        if (!isAuthReady || !userId || !db || userId.startsWith('local_')) {
            return;
        }

        try {
            const settingsData = {
                showOrchestratorLogs: showOrchestratorLogs,
                showFailedIngredientsLogs: showFailedIngredientsLogs,
                lastUpdated: new Date().toISOString()
            };

            // Save to: settings/{userId}
            await setDoc(doc(db, 'settings', userId), settingsData);
            console.log("[SETTINGS] Settings saved successfully");
            
        } catch (error) {
            console.error("[SETTINGS] Error saving settings:", error);
        }
    }, [showOrchestratorLogs, showFailedIngredientsLogs, userId, db, isAuthReady]);

    // Load settings from Firestore
    const handleLoadSettings = useCallback(async () => {
        if (!isAuthReady || !userId || !db || userId.startsWith('local_')) {
            return;
        }

        try {
            const settingsRef = doc(db, 'settings', userId);
            const settingsSnap = await getDoc(settingsRef);

            if (settingsSnap.exists()) {
                const data = settingsSnap.data();
                setShowOrchestratorLogs(data.showOrchestratorLogs ?? true);
                setShowFailedIngredientsLogs(data.showFailedIngredientsLogs ?? true);
                console.log("[SETTINGS] Settings loaded successfully");
            }
            
        } catch (error) {
            console.error("[SETTINGS] Error loading settings:", error);
        }
    }, [userId, db, isAuthReady]);

    // --- ADDED per Change 6 ---
    // Auto-save settings when they change
    useEffect(() => {
        if (userId && !userId.startsWith('local_') && isAuthReady) {
            handleSaveSettings();
        }
    }, [showOrchestratorLogs, showFailedIngredientsLogs, userId, isAuthReady, handleSaveSettings]);

    // --- ADDED per Change 7 ---
    // Load profile and settings after user signs in
    useEffect(() => {
        if (userId && !userId.startsWith('local_') && isAuthReady && db) {
            // Load both profile and settings
            handleLoadProfile(true); // Silent load
            handleLoadSettings();
        }
    }, [userId, isAuthReady, db, handleLoadProfile, handleLoadSettings]);


    // --- DELETED old auto-load effect per Change 9 ---

    // <<< STEP 3: (from previous guide) Landing page visibility >>>
    useEffect(() => {
        // Show landing page only if:
        // 1. User is not authenticated (no userId)
        if (!userId) {
            setShowLandingPage(true);
        } else {
            setShowLandingPage(false);
        }
    }, [userId]);


    // --- Handlers ---
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

    // ===== TOAST HELPERS =====
    // <<< STEP 8: showToast function (already exists) >>>
    const showToast = useCallback((message, type = 'info', duration = 3000) => {
      const id = Date.now();
      setToasts(prev => [...prev, { id, message, type, duration }]);
    }, []);
    
    const removeToast = useCallback((id) => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);
    
    // ===== REFRESH HANDLER =====
    const handleRefresh = useCallback(async () => {
      if (mealPlan.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        showToast('Data refreshed!', 'success');
      }
    }, [mealPlan, showToast]);

    // --- handleGeneratePlan ---
    const handleGeneratePlan = useCallback(async (e) => {
        e.preventDefault();
        
        // --- 1. Reset All State ---
        setLoading(true);
        setError(null);
        setDiagnosticLogs([]);
        setNutritionCache({});
        // Don't reset targets if they are already loaded
        if (nutritionalTargets.calories === 0) {
            setNutritionalTargets({ calories: 0, protein: 0, fat: 0, carbs: 0 });
        }
        setResults({});
        setUniqueIngredients([]);
        setMealPlan([]);
        setTotalCost(0);
        setEatenMeals({});
        setFailedIngredientsHistory([]);
        setGenerationStepKey('targets'); // Set initial step
        if (!isLogOpen) { setLogHeight(250); setIsLogOpen(true); }

        let targets;

        // --- 2. Fetch Nutritional Targets (Required for both modes) ---
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
            setNutritionalTargets(targets); // This will trigger auto-save
            setDiagnosticLogs(prev => [...prev, ...(targetsData.logs || [])]);
            
        } catch (err) {
            console.error("Plan generation failed critically at Targets:", err);
            setError(`Critical failure: ${err.message}`);
            setGenerationStepKey('error');
            setLoading(false);
            setDiagnosticLogs(prev => [...prev, {
                timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: `Critical failure: ${err.message}`
            }]);
            return; // Stop execution
        }

        // --- 3. Execute based on Feature Flag ---
        if (!useBatchedMode) {
            // --- [LEGACY] Per-Day Loop Logic ---
            setGenerationStatus("Generating plan (per-day mode)...");
            let accumulatedResults = {}; 
            let accumulatedMealPlan = []; 
            let accumulatedUniqueIngredients = new Map(); 

            try {
                const numDays = parseInt(formData.days, 10);
                for (let day = 1; day <= numDays; day++) {
                    setGenerationStatus(`Generating plan for Day ${day}/${numDays}...`);
                    setGenerationStepKey('planning'); // Reset step for each day
                    
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
                        nutritionalTargets: targets // Pass the targets in
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
                                
                                // NEW: Prepare success modal stats
                                setPlanStats([
                                  { label: 'Days', value: formData.days, color: COLORS.primary[600] },
                                  { label: 'Meals', value: eventData.mealPlan?.length * (parseInt(formData.eatingOccasions) || 3), color: COLORS.success.main },
                                  { label: 'Items', value: eventData.uniqueIngredients?.length || 0, color: COLORS.warning.main },
                                ]);
                                
                                // NEW: Show success modal, then navigate to Meals
                                setTimeout(() => {
                                  setShowSuccessModal(true);
                                  setTimeout(() => {
                                    setShowSuccessModal(false);
                                    setContentView('meals');
                                    setSelectedDay(1);
                                  }, 2500);
                                }, 500);
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
    }, [formData, isLogOpen, recalculateTotalCost, useBatchedMode, showToast, nutritionalTargets.calories]); // Added nutritionalTargets.calories
    // --- END: handleGeneratePlan Modifications ---


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

    // --- REPLACED per Change 2 ---
    const handleSaveProfile = useCallback(async (silent = false) => {
        // Check if user is authenticated (not anonymous)
        if (!isAuthReady || !userId || !db || userId.startsWith('local_')) {
            if (!silent) {
                showToast('Please sign in to save your profile', 'warning');
            }
            return;
        }

        try {
            // Prepare profile data with all form fields
            const profileData = {
                // Personal info
                name: formData.name,
                height: formData.height,
                weight: formData.weight,
                age: formData.age,
                gender: formData.gender,
                bodyFat: formData.bodyFat,
                
                // Fitness goals
                activityLevel: formData.activityLevel,
                goal: formData.goal,
                
                // Diet preferences
                dietary: formData.dietary,
                cuisine: formData.cuisine,
                
                // Meal planning
                days: formData.days,
                eatingOccasions: formData.eatingOccasions,
                store: formData.store,
                costPriority: formData.costPriority,
                mealVariety: formData.mealVariety,
                
                // Calculated targets
                nutritionalTargets: {
                    calories: nutritionalTargets.calories,
                    protein: nutritionalTargets.protein,
                    fat: nutritionalTargets.fat,
                    carbs: nutritionalTargets.carbs
                },
                
                // Metadata
                lastUpdated: new Date().toISOString()
            };

            // Save to simplified Firestore path: profile/{userId}
            await setDoc(doc(db, 'profile', userId), profileData);
            
            console.log("[PROFILE] Profile saved successfully");
            if (!silent) {
                showToast('Profile saved successfully!', 'success');
            }
            
        } catch (error) {
            console.error("[PROFILE] Error saving profile:", error);
            if (!silent) {
                showToast('Failed to save profile', 'error');
            }
        }
    }, [formData, nutritionalTargets, userId, db, isAuthReady, showToast]);

    // <<< STEP 3: REMOVED old handleGetStarted function >>>

    // <<< STEP 4: ADDED handleSignUp function >>>
    // Handle user sign up with email/password
    const handleSignUp = useCallback(async ({ name, email, password }) => {
        setAuthLoading(true);
        setAuthError(null);
        
        try {
            console.log("[AUTH] Starting sign up process...");
            
            if (!auth) {
                throw new Error("Firebase not initialized");
            }

            // Create user with email and password
            const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth');
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            console.log("[AUTH] User created:", user.uid);

            // Update user profile with name
            if (name) {
                await updateProfile(user, { displayName: name });
            }

            // Calculate trial dates
            const trialStartDate = new Date();
            const trialEndDate = new Date();
            trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 days from now

            // Save user data to Firestore
            if (db) {
                const { doc, setDoc } = await import('firebase/firestore');
                // Use the 'users' collection as per the guide
                await setDoc(doc(db, 'users', user.uid), {
                    name: name || '',
                    email: email,
                    createdAt: trialStartDate.toISOString(),
                    trialStartDate: trialStartDate.toISOString(),
                    trialEndDate: trialEndDate.toISOString(),
                    accountStatus: 'trial',
                    appId: appId
                });
                console.log("[AUTH] User profile saved to Firestore");
            }

            // Update local state
            setUserId(user.uid); // This will trigger auto-load
            setShowLandingPage(false);
            setContentView('profile');
            
            showToast(`Welcome ${name}! Your 7-day trial has started.`, 'success');
            
        } catch (error) {
            console.error("[AUTH] Sign up error:", error);
            setAuthError(error.message);
            showToast(error.message || 'Failed to create account', 'error');
        } finally {
            setAuthLoading(false);
        }
    }, [auth, db, appId, showToast]);

    // <<< STEP 5: ADDED handleSignIn function >>>
    // Handle user sign in with email/password
    const handleSignIn = useCallback(async ({ email, password }) => {
        setAuthLoading(true);
        setAuthError(null);
        
        try {
            console.log("[AUTH] Starting sign in process...");
            
            if (!auth) {
                throw new Error("Firebase not initialized");
            }

            // Sign in with email and password
            const { signInWithEmailAndPassword } = await import('firebase/auth');
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            console.log("[AUTH] User signed in:", user.uid);

            // Update local state
            setUserId(user.uid); // This will trigger auto-load
            setShowLandingPage(false);
            setContentView('profile');
            
            showToast('Welcome back!', 'success');
            
        } catch (error) {
            console.error("[AUTH] Sign in error:", error);
            let errorMessage = 'Failed to sign in';
            
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                errorMessage = 'No account found with this email or password';
            } else if (error.code === 'auth/wrong-password') {
                errorMessage = 'Incorrect password';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email address';
            }
            
            setAuthError(errorMessage);
            showToast(errorMessage, 'error');
        } finally {
            setAuthLoading(false);
        }
    }, [auth, showToast]);

    // <<< STEP 7: UPDATED handleSignOut function >>>
    const handleSignOut = useCallback(async () => {
        try {
            if (auth) {
                await auth.signOut();
                console.log("[FIREBASE] User signed out");
            }
            setUserId(null);
            setShowLandingPage(true);
            setMealPlan([]);
            setContentView('profile');
            setAuthError(null); // Added this line
            
            // Reset form data to default
            setFormData({ name: '', height: '180', weight: '75', age: '30', gender: 'male', activityLevel: 'moderate', goal: 'cut_moderate', dietary: 'None', days: 7, store: 'Woolworths', eatingOccasions: '3', costPriority: 'Best Value', mealVariety: 'Balanced Variety', cuisine: '', bodyFat: '' });
            setNutritionalTargets({ calories: 0, protein: 0, fat: 0, carbs: 0 });
            
            showToast('Signed out successfully', 'success');
        } catch (error) {
            console.error("[FIREBASE] Sign out error:", error);
            showToast('Error signing out', 'error');
        }
    }, [auth, showToast]);

    // --- Handle Edit Profile Navigation from Settings ---
    // <<< THIS IS THE FIX >>>
    // Re-added setIsMenuOpen(true) as it's required by the *original* layout
    const handleEditProfile = useCallback(() => {
        setIsSettingsOpen(false); // Close settings panel
        setIsMenuOpen(true); // <-- *** THIS IS THE FIX: Open the setup form panel ***
        setContentView('profile'); // Set right panel to profile summary
        // Scroll to top of form
        setTimeout(() => {
            document.querySelector('[name="name"]')?.focus();
        }, 100);
    }, [setContentView, setIsSettingsOpen, setIsMenuOpen]); // <-- *** RE-ADDED setIsMenuOpen ***


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
    // NOTE: This is the *original* layout's content.
    // This is NOT the layout from the user's Guide 1.
    // This logic seems to be what the user is *actually* running.
    
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

    // <<< STEP 6: REPLACED LandingPage props in RETURN STATEMENT >>>
    // <<< THIS RETURN STATEMENT IS FROM THE *ORIGINAL* FILE, NOT GUIDE 1 >>>
    // <<< This is to match what the user is actually running. >>>
    return (
        <>
            {showLandingPage ? (
                <LandingPage 
                    onSignUp={handleSignUp}
                    onSignIn={handleSignIn}
                    authLoading={authLoading}
                    authError={authError} // Pass authError to landing page
                />
            ) : (
                <>
                    {/* NEW: Header Component */}
                    {/* --- THIS IS THE CHANGE (Fix 1) --- */}
                    <Header 
                        userId={userId}
                        onOpenSettings={() => setIsSettingsOpen(true)}
                        onNavigateToProfile={() => {
                            setContentView('profile');
                            setIsMenuOpen(true); // <-- *** RE-ADDED THIS LINE ***
                        }}
                        onSignOut={handleSignOut} // Use the updated handleSignOut
                    />
                    {/* --- END OF CHANGE --- */}
            
                    {/* NEW: Pull to Refresh Wrapper */}
                    <PullToRefresh onRefresh={handleRefresh} refreshing={loading}>
                        <div 
                            className="min-h-screen bg-gray-100 p-4 md:p-8 transition-all duration-200 relative" 
                            style={{ 
                                paddingTop: '80px', // Offset for fixed header
                                paddingBottom: `${isMobile && results && Object.keys(results).length > 0 ? '4rem' : (Number.isFinite(totalLogHeight) ? totalLogHeight : minLogHeight) + 'px'}`
                            }}
                        >
                            {/* ... (omitting status messages for brevity) ... */}
            
                            <div className="max-w-7xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden">
                                <div className="flex flex-col md:flex-row">
                                    {/* --- SETUP FORM (Original Layout) --- */}
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
                                                    onClick={() => handleSaveProfile(false)}
                                                    disabled={!isAuthReady || !userId || !db} 
                                                    className="flex items-center px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    title="Save Current Profile"
                                                >
                                                    <Save size={14} className="mr-1" /> Save
                                                </button>
                                                <button className="md:hidden p-1.5" onClick={() => setIsMenuOpen(false)}><X /></button>
                                            </div>
                                        </div>
                                        
                                        {/* --- UPDATED FORM WITH FORMSECTIONS --- */}
                                        <form onSubmit={handleGeneratePlan}>
                                            <FormSection 
                                                title="Personal Information" 
                                                icon={User}
                                                description="Tell us about yourself"
                                            >
                                                <InputField label="Name" name="name" value={formData.name} onChange={handleChange} />
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <InputField label="Height (cm)" name="height" type="number" value={formData.height} onChange={handleChange} required />
                                                    <InputField label="Weight (kg)" name="weight" type="number" value={formData.weight} onChange={handleChange} required />
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <InputField label="Age" name="age" type="number" value={formData.age} onChange={handleChange} required />
                                                    <InputField label="Body Fat % (Optional)" name="bodyFat" type="number" value={formData.bodyFat} onChange={handleChange} placeholder="e.g., 15" />
                                                </div>
                                                <InputField label="Gender" name="gender" type="select" value={formData.gender} onChange={handleChange} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} required />
                                            </FormSection>
            
                                            <FormSection 
                                                title="Fitness Goals" 
                                                icon={Target}
                                                description="What are you trying to achieve?"
                                            >
                                                <InputField label="Activity Level" name="activityLevel" type="select" value={formData.activityLevel} onChange={handleChange} options={[ { value: 'sedentary', label: 'Sedentary' }, { value: 'light', label: 'Light Activity' }, { value: 'moderate', label: 'Moderate Activity' }, { value: 'active', label: 'Active' }, { value: 'veryActive', label: 'Very Active' } ]} required />
                                                <InputField label="Fitness Goal" name="goal" type="select" value={formData.goal} onChange={handleChange} options={[ { value: 'maintain', label: 'Maintain' }, { value: 'cut_moderate', label: 'Moderate Cut (~15% Deficit)' }, { value: 'cut_aggressive', label: 'Aggressive Cut (~25% Deficit)' }, { value: 'bulk_lean', label: 'Lean Bulk (~15% Surplus)' }, { value: 'bulk_aggressive', label: 'Aggressive Bulk (~25% Surplus)' } ]} />
                                                <InputField label="Dietary Preference" name="dietary" type="select" value={formData.dietary} onChange={handleChange} options={[{ value: 'None', label: 'None' }, { value: 'Vegetarian', label: 'Vegetarian' }]} />
                                                <DaySlider label="Plan Days" name="days" value={formData.days} onChange={handleSliderChange} />
                                            </FormSection>
            
                                            <FormSection 
                                                title="Meal Preferences" 
                                                icon={Utensils}
                                                description="Customize your meal plan"
                                                collapsible={true}
                                                defaultOpen={false}
                                            >
                                                <InputField label="Store" name="store" type="select" value={formData.store} onChange={handleChange} options={[{ value: 'Coles', label: 'Coles' }, { value: 'Woolworths', label: 'Woolworths' }]} />
                                                <InputField label="Meals Per Day" name="eatingOccasions" type="select" value={formData.eatingOccasions} onChange={handleChange} options={[ { value: '3', label: '3 Meals' }, { value: '4', label: '4 Meals' }, { value: '5', label: '5 Meals' } ]} />
                                                <InputField label="Spending Priority" name="costPriority" type="select" value={formData.costPriority} onChange={handleChange} options={[ { value: 'Extreme Budget', label: 'Extreme Budget' }, { value: 'Best Value', label: 'Best Value' }, { value: 'Quality Focus', label: 'Quality Focus' } ]} />
                                                <InputField label="Meal Variety" name="mealVariety" type="select" value={formData.mealVariety} onChange={handleChange} options={[ { value: 'High Repetition', label: 'High' }, { value: 'Balanced Variety', label: 'Balanced' }, { value: 'Low Repetition', label: 'Low' } ]} />
                                                <InputField label="Cuisine Profile (Optional)" name="cuisine" value={formData.cuisine} onChange={handleChange} placeholder="e.g., Spicy Thai" />
                                            </FormSection>
            
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
            
                                    {/* --- RESULTS VIEW (Original Layout) --- */}
                                    <div className={`w-full md:w-1/2 ${isMenuOpen ? 'hidden md:block' : 'block'}`}>
                                        
                                        {/* --- PURPLE BURGER MENU REMOVED --- */}
                                        
                                        <div className="border-b">
                                            <div className="p-6 md:p-8">
                                                {/* ... (omitting summary card) ... */}
                                            </div>
                                        </div>
            
                                        {/* --- REPLACEMENT BLOCK FOR RENDERING LOGIC --- */}
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
                                        
                                                {/* --- INLINE TAB NAVIGATION REMOVED --- */}
                                                
                                                {/* --- CONTENT VIEW LOGIC RESTORED --- */}
                                                {/* Content rendering - Profile displays always */}
                                                {contentView === 'profile' && (
                                                    <ProfileTab 
                                                        formData={formData} 
                                                        nutritionalTargets={nutritionalTargets} 
                                                    />
                                                )}
                                                
                                                {/* Meals and Ingredients only show if results exist */}
                                                {contentView === 'meals' && (results && Object.keys(results).length > 0) && mealPlanContent}
                                                {contentView === 'ingredients' && (results && Object.keys(results).length > 0) && priceComparisonContent}
                                                
                                                {/* Placeholder when on Meals/Ingredients but no results yet */}
                                                {(contentView === 'meals' || contentView === 'ingredients') && !(results && Object.keys(results).length > 0) && !loading && (
                                                    <div className="p-6 text-center text-gray-500">
                                                        Generate a plan to view {contentView}.
                                                    </div>
                                                )}
                                                {/* --- END OF RESTORED LOGIC --- */}
                                        
                                            </div>
                                        )}
                                        {/* --- END OF REPLACEMENT BLOCK --- */}
        
                                    </div>
                                </div>
                            </div>
                            {/* --- END OF EXISTING CONTENT --- */}
                        </div>
                    </PullToRefresh>
            
                    {/* --- BOTTOM NAV RESTORED --- */}
                    {isMobile && results && Object.keys(results).length > 0 && (
                        <BottomNav
                            activeTab={contentView}
                            onTabChange={setContentView}
                            showPlanButton={false}
                        />
                    )}
                    {/* --- END OF RESTORED BLOCK --- */}
            
                    {/* NEW: Toast Container */}
                    <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
                    
                    {/* NEW: Success Modal */}
                    <SuccessModal
                        isVisible={showSuccessModal}
                        title="Your Plan is Ready!"
                        message={`We've created ${formData.days} days of meals optimized for your goals`}
                        stats={planStats}
                        onClose={() => setShowSuccessModal(false)}
                        onViewPlan={() => {
                            setShowSuccessModal(false);
                            setContentView('meals');
                        }}
                    />
            
                    {/* NEW: Settings Panel */}
                    <SettingsPanel
                        isOpen={isSettingsOpen}
                        onClose={() => setIsSettingsOpen(false)}
                        currentStore={formData.store}
                        onStoreChange={(store) => {
                            setFormData(prev => ({ ...prev, store }));
                            showToast(`Store changed to ${store}`, 'success');
                        }}
                        onClearData={() => {
                            setResults({});
                            setMealPlan([]);
                            setUniqueIngredients([]);
                            setEatenMeals({});
                            showToast('All data cleared', 'success');
                        }}
                        onEditProfile={handleEditProfile}
                        showOrchestratorLogs={showOrchestratorLogs}
                        onToggleOrchestratorLogs={setShowOrchestratorLogs} // This will trigger auto-save
                        showFailedIngredientsLogs={showFailedIngredientsLogs}
                        onToggleFailedIngredientsLogs={setShowFailedIngredientsLogs} // This will trigger auto-save
                        
                        // Merging settings props as they were duplicated
                        settings={{
                            showOrchestratorLogs,
                            showFailedIngredientsLogs,
                        }}
                        onToggleSetting={(key) => {
                            if (key === 'showOrchestratorLogs') {
                                setShowOrchestratorLogs(!showOrchestratorLogs);
                            } else if (key === 'showFailedIngredientsLogs') {
                                setShowFailedIngredientsLogs(!showFailedIngredientsLogs);
                            }
                        }}
                    />
            
                    {/* KEEP: Existing log viewers and recipe modal */}
                    <div className="fixed bottom-0 left-0 right-0 z-[100] flex flex-col-reverse">
                        {showOrchestratorLogs && (
                            <DiagnosticLogViewer logs={diagnosticLogs} height={logHeight} setHeight={setLogHeight} isOpen={isLogOpen} setIsOpen={setIsOpen} onDownloadLogs={handleDownloadLogs} />
                        )}
                        {showFailedIngredientsLogs && (
                            <FailedIngredientLogViewer failedHistory={failedIngredientsHistory} onDownload={handleDownloadFailedLogs} />
                        )}
                        {!showOrchestratorLogs && !showFailedIngredientsLogs && (
                            <div className="bg-gray-800 text-white p-2 text-xs text-center cursor-pointer hover:bg-gray-700" onClick={() => { setShowOrchestratorLogs(true); setShowFailedIngredientsLogs(true); }}>
                                📋 Show Logs
                            </div>
                        )}
                    </div>
            
                    {selectedMeal && (
                        <RecipeModal 
                            meal={selectedMeal} 
                            onClose={() => setSelectedMeal(null)} 
                        />
                    )}
                </>
            )}
        </>
    );
};

export default App;


