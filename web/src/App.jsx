// web/src/App.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Package, DollarSign, ExternalLink, Calendar, Users, Menu, X, ChevronsDown, ChevronsUp, ShoppingBag, BookOpen, ChefHat, Tag, Soup, Replace, Target, FileText, LayoutDashboard, Terminal, Loader, ChevronRight, GripVertical, Flame, Droplet, Wheat, ChevronDown, ChevronUp, Download, ListX, Save, FolderDown, User, Check, ListChecks, ListOrdered, Utensils, Plus } from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, setLogLevel } from 'firebase/firestore';

// --- Phase 1: Foundation ---
import { COLORS, SPACING, SHADOWS, Z_INDEX, TRANSITIONS, RADIUS, TYPOGRAPHY, CATEGORY_ICONS, GLASS } from './constants';
import {
formatGoalText,
formatPrice,
formatCalories,
formatGrams,
copyToClipboard,
getGoalData,
formatActivityLevel,
groupBy
} from './helpers';

// --- Phase 1: Hooks ---
import useReducedMotion from './hooks/useReducedMotion';
import useSpringAnimation from './hooks/useSpringAnimation';

// --- Original Component Imports ---
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
import ProfileTab from './components/ProfileTab';
import LandingPage from './pages/LandingPage';

// --- Phase 2: Core UI Components ---
import Header from './components/Header';
import { ToastContainer } from './components/Toast';
import EmptyState from './components/EmptyState';
import LoadingOverlay from './components/LoadingOverlay';
import SuccessModal from './components/SuccessModal';
import ProgressRing from './components/ProgressRing';
import ShimmerLoader, { SkeletonCard, SkeletonCircle } from './components/ShimmerLoader';
import GlassmorphismBar from './components/GlassmorphismBar';
import FloatingActionButton from './components/FloatingActionButton';

// --- Phase 3: Enhanced Components (Updated versions) ---
import MacroRing from './components/MacroRing';
import MacroBar from './components/MacroBar';
import MealCard from './components/MealCard';
import DayNavigator from './components/DayNavigator';
import ShoppingListEnhanced from './components/ShoppingListEnhanced';
import FormSection from './components/FormSection';
import SettingsPanel from './components/SettingsPanel';
import CategoryCard from './components/CategoryCard';
import DayCard from './components/DayCard';
import MacroInsightPanel from './components/MacroInsightPanel';

// --- Phase 4: Mobile Components ---
import BottomNav from './components/BottomNav';
import { MealCardSkeleton, ProfileCardSkeleton, ShoppingListSkeleton } from './components/SkeletonLoader';
import PullToRefresh from './components/PullToRefresh';
import { useResponsive } from './hooks/useResponsive';

// --- Configuration ---
const ORCHESTRATOR_TARGETS_API_URL = '/api/plan/targets';
const ORCHESTRATOR_DAY_API_URL = '/api/plan/day';
const ORCHESTRATOR_FULL_PLAN_API_URL = '/api/plan/generate-full-plan';
const NUTRITION_API_URL = '/api/nutrition-search';
const MAX_SUBSTITUTES = 5;

// --- Global Variables ---
let globalAppId = 'default-app-id';
let firebaseConfig = null;
let firebaseInitializationError = null;

// --- Category Icon Map ---
const categoryIconMap = {
    'produce': <EmojiIcon code="1f96C" alt="produce" />,
    'meat': <EmojiIcon code="1f969" alt="meat" />,
    'dairy': <EmojiIcon code="1f9c0" alt="dairy" />,
    'grains': <EmojiIcon code="1f33e" alt="grains" />,
    'pantry': <EmojiIcon code="1f96b" alt="pantry" />,
    'beverages': <EmojiIcon code="1f964" alt="beverages" />,
    'fruit': <EmojiIcon code="1f34e" alt="fruit" />,
    'condiments': <EmojiIcon code="1f9c2" alt="condiments" />,
    'bakery': <EmojiIcon code="1f370" alt="bakery" />,
    'frozen': <EmojiIcon code="2744" alt="frozen" />,
    'snacks': <EmojiIcon code="1f36b" alt="snacks" />,
    'misc': <EmojiIcon code="1f36b" alt="snacks" />,
    'uncategorized': <EmojiIcon code="1f6cd" alt="shopping" />,
    'default': <EmojiIcon code="1f6cd" alt="shopping" />
};

// --- Main App Component ---
const App = () => {
    // --- Original State Variables ---
    const [formData, setFormData] = useState({
        name: '', height: '180', weight: '75', age: '30', gender: 'male',
        activityLevel: 'moderate', goal: 'cut_moderate', dietary: 'None',
        days: 7, store: 'Woolworths', eatingOccasions: '3',
        costPriority: 'Best Value', mealVariety: 'Balanced Variety',
        cuisine: '', bodyFat: ''
    });

    const [nutritionalTargets, setNutritionalTargets] = useState({ 
        calories: 0, protein: 0, fat: 0, carbs: 0 
    });

    const [results, setResults] = useState({});
    const [uniqueIngredients, setUniqueIngredients] = useState([]);
    const [mealPlan, setMealPlan] = useState([]);
    const [totalCost, setTotalCost] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [eatenMeals, setEatenMeals] = useState({});
    const [selectedDay, setSelectedDay] = useState(1);
    const [contentView, setContentView] = useState('profile');
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [diagnosticLogs, setDiagnosticLogs] = useState([]);
    const [nutritionCache, setNutritionCache] = useState({});
    const [loadingNutritionFor, setLoadingNutritionFor] = useState(null);
    const [logHeight, setLogHeight] = useState(250);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const minLogHeight = 50;
    const [failedIngredientsHistory, setFailedIngredientsHistory] = useState([]);
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

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

    // --- New State Variables (Phase 2-4) ---
    const [toasts, setToasts] = useState([]);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [planStats, setPlanStats] = useState([]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const { isMobile, isDesktop } = useResponsive();

    // --- Firebase State ---
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('default-app-id');
    const [showLandingPage, setShowLandingPage] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);

    // --- New: Checked items count for GlassmorphismBar ---
    const [checkedItemsCount, setCheckedItemsCount] = useState(0);

    // --- Persist Log Visibility Preferences ---
    useEffect(() => {
      localStorage.setItem('cheffy_show_orchestrator_logs', JSON.stringify(showOrchestratorLogs));
    }, [showOrchestratorLogs]);

    useEffect(() => {
      localStorage.setItem('cheffy_show_failed_ingredients_logs', JSON.stringify(showFailedIngredientsLogs));
    }, [showFailedIngredientsLogs]);

    // --- New: Derived state for day calories map ---
    const dayCaloriesMap = useMemo(() => {
        const map = {};
        if (results && Object.keys(results).length > 0) {
            Object.keys(results).forEach(day => {
                const dayNum = parseInt(day);
                if (!isNaN(dayNum) && results[day]?.mealPlan) {
                    map[dayNum] = results[day].mealPlan.reduce((sum, meal) => 
                        sum + (meal.subtotal_kcal || 0), 0
                    );
                }
            });
        }
        return map;
    }, [results]);

    // --- Toast Helpers ---
    const showToast = useCallback((message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // --- Firebase Initialization ---
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
                console.warn("[FIREBASE] Config is not defined or is empty.");
                firebaseInitializationError = 'Firebase config environment variable is missing.';
                setIsAuthReady(true);
                return;
            }

            const firebaseApp = initializeApp(firebaseConfig);
            const firebaseAuth = getAuth(firebaseApp);
            const firebaseDb = getFirestore(firebaseApp);
            
            setLogLevel('silent');
            
            setAuth(firebaseAuth);
            setDb(firebaseDb);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setShowLandingPage(false);
                    await loadProfileFromFirestore(user.uid, firebaseDb);
                } else {
                    setUserId(null);
                    setShowLandingPage(true);
                }
                setIsAuthReady(true);
            });

            if (initialAuthToken && initialAuthToken.trim() !== '') {
                signInWithCustomToken(firebaseAuth, initialAuthToken)
                    .then(() => console.log("[FIREBASE] Signed in with custom token"))
                    .catch(err => {
                        console.error("[FIREBASE] Custom token sign-in failed:", err);
                        return signInAnonymously(firebaseAuth);
                    });
            } else {
                signInAnonymously(firebaseAuth)
                    .then(() => console.log("[FIREBASE] Signed in anonymously"))
                    .catch(err => console.error("[FIREBASE] Anonymous sign-in failed:", err));
            }

            return () => unsubscribe();
            
        } catch (err) {
            console.error("[FIREBASE] Initialization error:", err);
            firebaseInitializationError = err.message;
            setIsAuthReady(true);
        }
    }, []);

    // --- Load Profile from Firestore ---
    const loadProfileFromFirestore = useCallback(async (uid, database) => {
        if (!uid || !database) return;
        
        try {
            const docRef = doc(database, 'profiles', uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.formData) setFormData(data.formData);
                if (data.nutritionalTargets) setNutritionalTargets(data.nutritionalTargets);
            }
        } catch (error) {
            console.error("[PROFILE] Error loading profile:", error);
        }
    }, []);

    // --- Save Profile to Firestore ---
    const saveProfileToFirestore = useCallback(async (silent = true) => {
        if (!userId || !db || !isAuthReady) return;
        if (userId.startsWith('local_')) return;
        
        try {
            const docRef = doc(db, 'profiles', userId);
            await setDoc(docRef, {
                formData,
                nutritionalTargets,
                updatedAt: new Date().toISOString(),
                appId: appId
            }, { merge: true });
            
            if (!silent) {
                showToast('Profile saved successfully!', 'success');
            }
            
        } catch (error) {
            console.error("[PROFILE] Error saving profile:", error);
            if (!silent) {
                showToast('Failed to save profile', 'error');
            }
        }
    }, [formData, nutritionalTargets, userId, db, isAuthReady, appId, showToast]);

    // --- Auto-save on nutritionalTargets change ---
    useEffect(() => {
        if (nutritionalTargets.calories > 0) {
            saveProfileToFirestore(true);
        }
    }, [nutritionalTargets, saveProfileToFirestore]);

    // --- Auth Handlers ---
    const handleSignUp = useCallback(async ({ email, password, name }) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            // Implement actual sign-up logic here
            showToast('Sign up successful!', 'success');
            setShowLandingPage(false);
        } catch (error) {
            setAuthError(error.message);
            showToast('Sign up failed', 'error');
        } finally {
            setAuthLoading(false);
        }
    }, [showToast]);

    const handleSignIn = useCallback(async ({ email, password }) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            // Implement actual sign-in logic here
            showToast('Sign in successful!', 'success');
            setShowLandingPage(false);
        } catch (error) {
            setAuthError(error.message);
            showToast('Sign in failed', 'error');
        } finally {
            setAuthLoading(false);
        }
    }, [showToast]);

    const handleSignOut = useCallback(async () => {
        if (auth) {
            try {
                await auth.signOut();
                setShowLandingPage(true);
                showToast('Signed out successfully', 'success');
            } catch (error) {
                console.error("[AUTH] Sign out error:", error);
                showToast('Sign out failed', 'error');
            }
        }
    }, [auth, showToast]);

    // --- App Feature Handlers ---
    const handleRefresh = useCallback(async () => {
      if (mealPlan.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        showToast('Data refreshed!', 'success');
      }
    }, [mealPlan, showToast]);

    const handleInputChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    const recalculateTotalCost = useCallback(() => {
        const allProducts = Object.values(results).flatMap(dayData => dayData?.products || []);
        const totalCost = allProducts.reduce((sum, product) => sum + (product.price || 0), 0);
        setTotalCost(totalCost);
    }, [results]);

    const latestLog = useMemo(() => {
        if (diagnosticLogs.length === 0) return null;
        return diagnosticLogs[diagnosticLogs.length - 1];
    }, [diagnosticLogs]);

    // --- Generate Plan Handler (Batched Mode) ---
    const handleGeneratePlan = useCallback(async (e) => {
        e.preventDefault();
        
        setLoading(true);
        setError(null);
        setDiagnosticLogs([]);
        setNutritionCache({});
        if (nutritionalTargets.calories === 0) {
            setNutritionalTargets({ calories: 0, protein: 0, fat: 0, carbs: 0 });
        }
        setResults({});
        setUniqueIngredients([]);
        setMealPlan([]);
        setTotalCost(0);
        setEatenMeals({});
        setFailedIngredientsHistory([]);
        setGenerationStepKey('targets');
        if (!isLogOpen) { setLogHeight(250); setIsLogOpen(true); }

        let targets;

        try {
            // Fetch Nutritional Targets
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
            console.error("Plan generation failed at Targets:", err);
            setError(`Critical failure: ${err.message}`);
            setGenerationStepKey('error');
            setLoading(false);
            setDiagnosticLogs(prev => [...prev, {
                timestamp: new Date().toISOString(), 
                level: 'CRITICAL', 
                tag: 'FRONTEND', 
                message: `Critical failure: ${err.message}`
            }]);
            return;
        }

        // Batched Mode
        if (useBatchedMode) {
            try {
                setGenerationStepKey('planning');
                
                const eventSource = await fetch(ORCHESTRATOR_FULL_PLAN_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...formData,
                        nutritionalTargets: targets,
                        app_id: appId
                    }),
                });

                if (!eventSource.ok) {
                    throw new Error(`HTTP ${eventSource.status}: ${eventSource.statusText}`);
                }

                const reader = eventSource.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        if (!line.startsWith('data: ')) continue;

                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') {
                            setGenerationStepKey('complete');
                            break;
                        }

                        let eventData;
                        try {
                            eventData = JSON.parse(dataStr);
                        } catch (parseErr) {
                            console.error("Failed to parse SSE data:", dataStr, parseErr);
                            continue;
                        }

                        switch (eventData.type) {
                            case 'log':
                                setDiagnosticLogs(prev => [...prev, eventData.log]);
                                
                                if (eventData.log.tag === 'PHASE' && eventData.log.message.includes('targets calculated')) {
                                    setGenerationStepKey('targets');
                                } else if (eventData.log.tag === 'LLM' || eventData.log.tag === 'LLM_PROMPT' || eventData.log.tag === 'LLM_CHEF') {
                                    setGenerationStepKey('planning');
                                } else if (eventData.log.tag === 'MARKET_RUN' || eventData.log.tag === 'CHECKLIST') {
                                    setGenerationStepKey('market');
                                } else if (eventData.log.tag === 'CALC' || eventData.log.tag === 'CANON' || eventData.log.tag === 'DATA') {
                                    setGenerationStepKey('finalizing');
                                }
                                break;

                            case 'day_complete':
                                const completedDay = eventData.day;
                                const completedData = eventData.data;
                                
                                setResults(prev => ({
                                    ...prev,
                                    [completedDay]: completedData
                                }));
                                
                                if (completedData.products) {
                                    recalculateTotalCost();
                                }
                                break;

                            case 'complete':
                                setResults(eventData.fullResults);
                                setUniqueIngredients(eventData.uniqueIngredients || []);
                                setMealPlan(eventData.mealPlan || []);
                                if (eventData.totalCost) setTotalCost(eventData.totalCost);
                                if (eventData.failedIngredients && eventData.failedIngredients.length > 0) {
                                    setFailedIngredientsHistory(eventData.failedIngredients);
                                }
                                setGenerationStepKey('complete');
                                
                                setPlanStats([
                                  { label: 'Days', value: formData.days, color: COLORS.primary[600] },
                                  { label: 'Meals', value: eventData.mealPlan?.length || 0, color: COLORS.success.main },
                                  { label: 'Items', value: eventData.uniqueIngredients?.length || 0, color: COLORS.warning.main },
                                ]);
                                
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
                }
                
            } catch (err) {
                console.error("Batched plan generation failed:", err);
                setError(`Critical failure: ${err.message}`);
                setGenerationStepKey('error');
                setDiagnosticLogs(prev => [...prev, {
                    timestamp: new Date().toISOString(), 
                    level: 'CRITICAL', 
                    tag: 'FRONTEND', 
                    message: `Critical failure: ${err.message}`
                }]);
            } finally {
                 setTimeout(() => setLoading(false), 2000);
            }
        }
    }, [formData, isLogOpen, recalculateTotalCost, useBatchedMode, showToast, nutritionalTargets.calories, appId, useBatchedMode]);

    // --- Other Handlers (Simplified) ---
    const handleFetchNutrition = useCallback(async (product) => {
        // Nutrition fetching logic (keeping original implementation)
        if (!product || !product.url || nutritionCache[product.url]) { return; }
        if (product.nutrition && product.nutrition.status === 'found') {
             setNutritionCache(prev => ({...prev, [product.url]: product.nutrition}));
             return;
        }
        setLoadingNutritionFor(product.url);
        try {
            const params = product.barcode 
                ? { barcode: product.barcode } 
                : { url: product.url };
            
            const response = await fetch(`${NUTRITION_API_URL}?${new URLSearchParams(params)}`);
            const data = await response.json();
            setNutritionCache(prev => ({ ...prev, [product.url]: data }));
        } catch (error) {
            console.error('Error fetching nutrition:', error);
        } finally {
            setLoadingNutritionFor(null);
        }
    }, [nutritionCache]);

    const handleDownloadLogs = useCallback(() => {
        const logsText = diagnosticLogs.map(log => 
            `[${log.timestamp}] [${log.level}] [${log.tag}] ${log.message}`
        ).join('\n');
        
        const blob = new Blob([logsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cheffy-logs-${new Date().toISOString()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }, [diagnosticLogs]);

    const handleDownloadFailedLogs = useCallback(() => {
        const logsText = JSON.stringify(failedIngredientsHistory, null, 2);
        const blob = new Blob([logsText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cheffy-failed-ingredients-${new Date().toISOString()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [failedIngredientsHistory]);

    const toggleMealEaten = useCallback((mealName) => {
        setEatenMeals(prev => ({
            ...prev,
            [mealName]: !prev[mealName]
        }));
    }, []);

    const handleClearData = useCallback(() => {
        setResults({});
        setUniqueIngredients([]);
        setMealPlan([]);
        setTotalCost(0);
        setEatenMeals({});
        setNutritionCache({});
        setDiagnosticLogs([]);
        setFailedIngredientsHistory([]);
        showToast('All data cleared', 'success');
    }, [showToast]);

    // --- Render Logic ---
    const currentDayData = results[selectedDay];
    const currentMealPlan = currentDayData?.mealPlan || [];
    const currentProducts = currentDayData?.products || [];

    // Meal Plan Content
    const mealPlanContent = (
        <div className="space-y-6">
            {/* Day Navigator */}
            <DayNavigator
                currentDay={selectedDay}
                totalDays={parseInt(formData.days)}
                onSelectDay={setSelectedDay}
                completedDays={[]}
                dayCalories={dayCaloriesMap}
            />

            {/* Macro Insight Panel (Optional - can replace or supplement existing rings) */}
            {currentDayData && (
                <MacroInsightPanel
                    calories={{ 
                        current: currentDayData.subtotal_kcal || 0, 
                        target: nutritionalTargets.calories 
                    }}
                    protein={{ 
                        current: currentDayData.subtotal_protein || 0, 
                        target: nutritionalTargets.protein 
                    }}
                    carbs={{ 
                        current: currentDayData.subtotal_carbs || 0, 
                        target: nutritionalTargets.carbs 
                    }}
                    fats={{ 
                        current: currentDayData.subtotal_fat || 0, 
                        target: nutritionalTargets.fat 
                    }}
                    fiber={{ current: 0, target: 30 }}
                    sugar={{ current: 0, target: 50 }}
                    sodium={{ current: 0, target: 2300 }}
                    showMicroTargets={true}
                    showInsights={true}
                />
            )}

            {/* Meals Grid */}
            {currentMealPlan.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {currentMealPlan.map((meal, idx) => (
                        <MealCard
                            key={`${meal.name}-${idx}`}
                            meal={meal}
                            isEaten={eatenMeals[meal.name]}
                            onToggleEaten={() => toggleMealEaten(meal.name)}
                            onViewRecipe={() => setSelectedMeal(meal)}
                            showNutrition={true}
                            nutritionalTargets={nutritionalTargets}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState 
                    message="No meals for this day"
                    icon={Utensils}
                />
            )}
        </div>
    );

    // Shopping List Content
    const priceComparisonContent = (
        <div className="space-y-6">
            <ShoppingListEnhanced
                ingredients={uniqueIngredients}
                totalCost={totalCost}
                storeName={formData.store}
                onShowToast={showToast}
            />
        </div>
    );

    const totalLogHeight = (failedIngredientsHistory.length > 0 ? 60 : 0) + 
                          (isLogOpen ? Math.max(minLogHeight, logHeight) : minLogHeight);

    // --- Main Render ---
    return (
        <>
            {showLandingPage ? (
                <LandingPage 
                    onSignUp={handleSignUp}
                    onSignIn={handleSignIn}
                    authLoading={authLoading}
                    authError={authError}
                />
            ) : (
                <>
                    {/* Header */}
                    <Header 
                        userId={userId}
                        onOpenSettings={() => setIsSettingsOpen(true)}
                        onNavigateToProfile={() => {
                            setContentView('profile');
                            setIsMenuOpen(false);
                        }}
                        onSignOut={handleSignOut}
                    />
            
                    {/* Pull to Refresh Wrapper */}
                    <PullToRefresh onRefresh={handleRefresh} refreshing={loading}>
                        <div 
                            className="min-h-screen p-6 md:p-8 transition-all duration-200 pb-24 md:pb-8" 
                            style={{ 
                                paddingTop: '100px',
                                backgroundColor: COLORS.background.secondary,
                            }}
                        >
                            <div className="max-w-7xl mx-auto">
                                {/* Profile Form */}
                                <div 
                                    className="bg-white rounded-2xl p-6 mb-6"
                                    style={{ boxShadow: SHADOWS.md }}
                                >
                                    <form onSubmit={handleGeneratePlan}>
                                        <div className="mb-6">
                                            <h2 
                                                className="text-2xl font-bold mb-2"
                                                style={{ 
                                                    color: COLORS.gray[900],
                                                    fontFamily: TYPOGRAPHY.fontFamily.display,
                                                }}
                                            >
                                                Your Profile
                                            </h2>
                                            <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                                                Tell us about yourself to generate your personalized meal plan
                                            </p>
                                        </div>

                                        <ProfileTab 
                                            formData={formData} 
                                            nutritionalTargets={nutritionalTargets}
                                            onInputChange={handleInputChange}
                                        />

                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full mt-6 py-4 rounded-xl font-semibold text-white hover-lift transition-spring disabled:opacity-50 disabled:cursor-not-allowed"
                                            style={{
                                                background: loading ? COLORS.gray[400] : COLORS.gradients.primary,
                                                boxShadow: loading ? 'none' : SHADOWS.lg,
                                            }}
                                        >
                                            {loading ? (
                                                <span className="flex items-center justify-center">
                                                    <Loader size={20} className="mr-2 animate-spin" />
                                                    Generating Plan...
                                                </span>
                                            ) : (
                                                <span className="flex items-center justify-center">
                                                    <ChefHat size={20} className="mr-2" />
                                                    Generate My Meal Plan
                                                </span>
                                            )}
                                        </button>
                                    </form>
                                </div>

                                {/* Generation Progress */}
                                {loading && (
                                    <div className="mb-6">
                                        <GenerationProgressDisplay
                                            activeStepKey={generationStepKey}
                                            errorMsg={error}
                                            latestLog={latestLog} 
                                        />
                                    </div>
                                )}

                                {/* Content Tabs (Desktop) */}
                                {!isMobile && results && Object.keys(results).length > 0 && (
                                    <div className="mb-6">
                                        <div 
                                            className="flex space-x-2 bg-white p-2 rounded-xl"
                                            style={{ boxShadow: SHADOWS.sm }}
                                        >
                                            <button
                                                onClick={() => setContentView('meals')}
                                                className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all ${
                                                    contentView === 'meals' ? '' : 'hover:bg-gray-50'
                                                }`}
                                                style={{
                                                    backgroundColor: contentView === 'meals' 
                                                        ? COLORS.primary[600] 
                                                        : 'transparent',
                                                    color: contentView === 'meals' 
                                                        ? '#ffffff' 
                                                        : COLORS.gray[600],
                                                }}
                                            >
                                                <Utensils size={20} className="inline mr-2" />
                                                Meals
                                            </button>
                                            <button
                                                onClick={() => setContentView('ingredients')}
                                                className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all ${
                                                    contentView === 'ingredients' ? '' : 'hover:bg-gray-50'
                                                }`}
                                                style={{
                                                    backgroundColor: contentView === 'ingredients' 
                                                        ? COLORS.primary[600] 
                                                        : 'transparent',
                                                    color: contentView === 'ingredients' 
                                                        ? '#ffffff' 
                                                        : COLORS.gray[600],
                                                }}
                                            >
                                                <ShoppingBag size={20} className="inline mr-2" />
                                                Shopping List
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Main Content Area */}
                                <div>
                                    {contentView === 'meals' && results && Object.keys(results).length > 0 && mealPlanContent}
                                    {contentView === 'ingredients' && results && Object.keys(results).length > 0 && priceComparisonContent}
                                    
                                    {(contentView === 'meals' || contentView === 'ingredients') && 
                                     !(results && Object.keys(results).length > 0) && 
                                     !loading && (
                                        <EmptyState 
                                            message="Generate a plan to view your content"
                                            icon={ChefHat}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </PullToRefresh>
            
                    {/* Bottom Navigation (Mobile) */}
                    {isMobile && results && Object.keys(results).length > 0 && (
                        <BottomNav
                            activeTab={contentView}
                            onTabChange={setContentView}
                            showPlanButton={false}
                        />
                    )}
            
                    {/* Toast Container */}
                    <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
                    
                    {/* Success Modal */}
                    <SuccessModal
                        isVisible={showSuccessModal}
                        title="Your Plan is Ready!"
                        message="Your personalized meal plan has been generated successfully."
                        stats={planStats}
                        onViewPlan={() => {
                            setShowSuccessModal(false);
                            setContentView('meals');
                        }}
                    />

                    {/* Settings Panel */}
                    <SettingsPanel
                        isOpen={isSettingsOpen}
                        onClose={() => setIsSettingsOpen(false)}
                        currentStore={formData.store}
                        onStoreChange={(store) => setFormData(prev => ({ ...prev, store }))}
                        onClearData={handleClearData}
                        showOrchestratorLogs={showOrchestratorLogs}
                        onToggleOrchestratorLogs={setShowOrchestratorLogs}
                        showFailedIngredientsLogs={showFailedIngredientsLogs}
                        onToggleFailedIngredientsLogs={setShowFailedIngredientsLogs}
                    />

                    {/* Recipe Modal */}
                    {selectedMeal && (
                        <RecipeModal 
                            meal={selectedMeal} 
                            onClose={() => setSelectedMeal(null)} 
                        />
                    )}

                    {/* Diagnostic Logs (Bottom) */}
                    {showOrchestratorLogs && (
                        <div 
                            className="fixed bottom-0 left-0 right-0"
                            style={{ zIndex: Z_INDEX.fixed - 1 }}
                        >
                            <DiagnosticLogViewer 
                                logs={diagnosticLogs} 
                                height={logHeight} 
                                setHeight={setLogHeight} 
                                isOpen={isLogOpen} 
                                setIsOpen={setIsLogOpen} 
                                onDownloadLogs={handleDownloadLogs} 
                            />
                        </div>
                    )}

                    {showFailedIngredientsLogs && failedIngredientsHistory.length > 0 && (
                        <FailedIngredientLogViewer 
                            failedHistory={failedIngredientsHistory} 
                            onDownload={handleDownloadFailedLogs} 
                        />
                    )}
                </>
            )}
        </>
    );
};

export default App;

