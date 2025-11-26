// web/src/App.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';

// --- Component Imports ---
import LandingPage from './pages/LandingPage';
import MainApp from './components/MainApp';

// --- Hook Imports ---
import useAppLogic from './hooks/useAppLogic';
import { useResponsive } from './hooks/useResponsive';

// --- Firebase Config variables ---
let firebaseConfig = null;
let firebaseInitializationError = null;
let globalAppId = 'default-app-id';

// --- MAIN APP COMPONENT ---
const App = () => {
    // --- Top-level UI State ---
    const [contentView, setContentView] = useState('profile');
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showLandingPage, setShowLandingPage] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);

    // --- Firebase State ---
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('default-app-id');

    // --- Form Data State (needed by hook and MainApp) ---
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

    // --- Responsive ---
    const { isMobile, isDesktop } = useResponsive();

    // --- Firebase Initialization and Auth Effect ---
    useEffect(() => {
        const firebaseConfigStr = typeof __firebase_config !== 'undefined' 
            ? __firebase_config 
            : import.meta.env.VITE_FIREBASE_CONFIG;
            
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
                    }
                    if (!isAuthReady) {
                        setIsAuthReady(true);
                        console.log("[FIREBASE] Auth state ready.");
                    }
                });
                return () => unsubscribe();
            } catch (initError) {
                console.error("[FIREBASE] Initialization failed:", initError);
                setIsAuthReady(true);
            }
        }
    }, []);

    // --- Landing page visibility ---
    useEffect(() => {
        if (!userId) {
            setShowLandingPage(true);
        } else {
            setShowLandingPage(false);
        }
    }, [userId]);

    // --- Business Logic Hook ---
    const logic = useAppLogic({
        auth,
        db,
        userId,
        isAuthReady,
        appId,
        formData,
        setFormData,
        nutritionalTargets,
        setNutritionalTargets
    });

    // --- Form Handlers ---
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (name === 'days') {
            const newDays = parseInt(value, 10);
            if (!isNaN(newDays) && newDays < logic.selectedDay) {
                logic.setSelectedDay(newDays);
            }
        }
    };

    const handleSliderChange = (e) => {
        const value = parseInt(e.target.value, 10);
        setFormData(prev => ({ ...prev, days: value }));
        if (value < logic.selectedDay) {
            logic.setSelectedDay(value);
        }
    };

    // --- Auth Handlers with Loading State ---
    const handleSignUp = useCallback(async (credentials) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            await logic.handleSignUp(credentials);
            setShowLandingPage(false);
            setContentView('profile');
        } catch (error) {
            setAuthError(error.message);
        } finally {
            setAuthLoading(false);
        }
    }, [logic]);

    const handleSignIn = useCallback(async (credentials) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            await logic.handleSignIn(credentials);
            setShowLandingPage(false);
            setContentView('profile');
        } catch (error) {
            setAuthError(error.message);
        } finally {
            setAuthLoading(false);
        }
    }, [logic]);

    const handleSignOut = useCallback(async () => {
        await logic.handleSignOut();
        setShowLandingPage(true);
        setContentView('profile');
        setAuthError(null);
    }, [logic]);

    // --- Edit Profile Handler (FIXED) ---
    const handleEditProfile = useCallback(() => {
        setIsSettingsOpen(false); // Close settings panel
        setContentView('profile'); // Navigate to profile view (right panel)
        setTimeout(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
    }, []);

    // --- Render ---
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
                <MainApp
                    // User & Auth
                    userId={userId}
                    isAuthReady={isAuthReady}
                    firebaseConfig={firebaseConfig}
                    firebaseInitializationError={firebaseInitializationError}
                    
                    // Form Data
                    formData={formData}
                    handleChange={handleChange}
                    handleSliderChange={handleSliderChange}
                    
                    // Nutritional Targets
                    nutritionalTargets={nutritionalTargets}
                    
                    // Results & Plan
                    results={logic.results}
                    uniqueIngredients={logic.uniqueIngredients}
                    mealPlan={logic.mealPlan}
                    totalCost={logic.totalCost}
                    categorizedResults={logic.categorizedResults}
                    hasInvalidMeals={logic.hasInvalidMeals}
                    
                    // UI State
                    loading={logic.loading}
                    error={logic.error}
                    eatenMeals={logic.eatenMeals}
                    selectedDay={logic.selectedDay}
                    setSelectedDay={logic.setSelectedDay}
                    contentView={contentView}
                    setContentView={setContentView}
                    isMenuOpen={isMenuOpen}
                    setIsMenuOpen={setIsMenuOpen}
                    
                    // Logs
                    diagnosticLogs={logic.diagnosticLogs}
                    showOrchestratorLogs={logic.showOrchestratorLogs}
                    setShowOrchestratorLogs={logic.setShowOrchestratorLogs}
                    showFailedIngredientsLogs={logic.showFailedIngredientsLogs}
                    setShowFailedIngredientsLogs={logic.setShowFailedIngredientsLogs}
                    failedIngredientsHistory={logic.failedIngredientsHistory}
                    logHeight={logic.logHeight}
                    setLogHeight={logic.setLogHeight}
                    isLogOpen={logic.isLogOpen}
                    setIsLogOpen={logic.isLogOpen} 
                    latestLog={logic.latestLog}
                    
                    // NEW: Macro Debug Log props (with defensive defaults)
                    macroDebug={logic.macroDebug || {}}
                    showMacroDebugLog={logic.showMacroDebugLog ?? false}
                    setShowMacroDebugLog={logic.setShowMacroDebugLog || (() => {})}
                    handleDownloadMacroDebugLogs={logic.handleDownloadMacroDebugLogs || (() => {})}
                    
                    // Generation State
                    generationStepKey={logic.generationStepKey}
                    generationStatus={logic.generationStatus}
                    
                    // Nutrition Cache
                    nutritionCache={logic.nutritionCache}
                    loadingNutritionFor={logic.loadingNutritionFor}
                    
                    // Modal State
                    selectedMeal={logic.selectedMeal}
                    setSelectedMeal={logic.setSelectedMeal}
                    showSuccessModal={logic.showSuccessModal}
                    setShowSuccessModal={logic.setShowSuccessModal}
                    planStats={logic.planStats}
                    
                    // Settings
                    isSettingsOpen={isSettingsOpen}
                    setIsSettingsOpen={setIsSettingsOpen}
                    useBatchedMode={logic.useBatchedMode}
                    setUseBatchedMode={logic.setUseBatchedMode}
                    
                    // Toasts
                    toasts={logic.toasts}
                    removeToast={logic.removeToast}
                    
                    // Handlers
                    handleGeneratePlan={logic.handleGeneratePlan}
                    handleLoadProfile={logic.handleLoadProfile}
                    handleSaveProfile={logic.handleSaveProfile}
                    handleFetchNutrition={logic.handleFetchNutrition}
                    handleSubstituteSelection={logic.handleSubstituteSelection}
                    handleQuantityChange={logic.handleQuantityChange}
                    handleDownloadFailedLogs={logic.handleDownloadFailedLogs}
                    handleDownloadLogs={logic.handleDownloadLogs}
                    onToggleMealEaten={logic.onToggleMealEaten}
                    handleRefresh={logic.handleRefresh}
                    handleEditProfile={handleEditProfile}
                    handleSignOut={handleSignOut}
                    showToast={logic.showToast}
                    
                    // Plan Persistence - NEW
                    savedPlans={logic.savedPlans}
                    activePlanId={logic.activePlanId}
                    handleSavePlan={logic.handleSavePlan}
                    handleLoadPlan={logic.handleLoadPlan}
                    handleDeletePlan={logic.handleDeletePlan}
                    savingPlan={logic.savingPlan}
                    loadingPlan={logic.loadingPlan}

                    // Responsive
                    isMobile={isMobile}
                    isDesktop={isDesktop}
                />
            )}
        </>
    );
};

export default App;

