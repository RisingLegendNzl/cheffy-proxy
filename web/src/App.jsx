// web/src/App.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';

import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';

import LandingPage from './pages/LandingPage';
import MainApp from './components/MainApp';

import useAppLogic from './hooks/useAppLogic';
import { useResponsive } from './hooks/useResponsive';
import useReducedMotion from './hooks/useReducedMotion';

let firebaseConfig = null;
let firebaseInitializationError = null;
let globalAppId = 'default-app-id';

const App = () => {
    const [contentView, setContentView] = useState('profile');
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showLandingPage, setShowLandingPage] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);

    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('default-app-id');

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

    const { isMobile, isDesktop } = useResponsive();
    const prefersReducedMotion = useReducedMotion();

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
            } catch (e) {
                console.error("[FIREBASE] Failed to initialize:", e);
                firebaseInitializationError = `Firebase initialization error: ${e.message}`;
                setIsAuthReady(true);
            }
        }
    }, []);

    const logic = useAppLogic({
        userId,
        isAuthReady,
        db,
        formData,
        setFormData,
        nutritionalTargets,
        setNutritionalTargets,
    });

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    const handleSliderChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    const handleSignUp = async (credentials) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            console.log('Attempting sign up...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            setShowLandingPage(false);
        } catch (error) {
            console.error('Sign up error:', error);
            setAuthError(error.message);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleSignIn = async (credentials) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            console.log('Attempting sign in...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            setShowLandingPage(false);
        } catch (error) {
            console.error('Sign in error:', error);
            setAuthError(error.message);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleSignOut = useCallback(() => {
        if (auth) {
            auth.signOut();
        }
        setShowLandingPage(true);
    }, [auth]);

    const handleEditProfile = useCallback(() => {
        setContentView('profile');
    }, []);

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
                    userId={userId}
                    isAuthReady={isAuthReady}
                    firebaseConfig={firebaseConfig}
                    firebaseInitializationError={firebaseInitializationError}
                    
                    formData={formData}
                    handleChange={handleChange}
                    handleSliderChange={handleSliderChange}
                    
                    nutritionalTargets={nutritionalTargets}
                    
                    results={logic.results}
                    uniqueIngredients={logic.uniqueIngredients}
                    mealPlan={logic.mealPlan}
                    totalCost={logic.totalCost}
                    categorizedResults={logic.categorizedResults}
                    hasInvalidMeals={logic.hasInvalidMeals}
                    
                    loading={logic.loading}
                    error={logic.error}
                    eatenMeals={logic.eatenMeals}
                    selectedDay={logic.selectedDay}
                    setSelectedDay={logic.setSelectedDay}
                    contentView={contentView}
                    setContentView={setContentView}
                    isMenuOpen={isMenuOpen}
                    setIsMenuOpen={setIsMenuOpen}
                    
                    diagnosticLogs={logic.diagnosticLogs}
                    showOrchestratorLogs={logic.showOrchestratorLogs}
                    setShowOrchestratorLogs={logic.setShowOrchestratorLogs}
                    showFailedIngredientsLogs={logic.showFailedIngredientsLogs}
                    setShowFailedIngredientsLogs={logic.setShowFailedIngredientsLogs}
                    failedIngredientsHistory={logic.failedIngredientsHistory}
                    logHeight={logic.logHeight}
                    setLogHeight={logic.setLogHeight}
                    isLogOpen={logic.isLogOpen}
                    setIsLogOpen={logic.setIsLogOpen}
                    latestLog={logic.latestLog}
                    
                    generationStepKey={logic.generationStepKey}
                    generationStatus={logic.generationStatus}
                    
                    nutritionCache={logic.nutritionCache}
                    loadingNutritionFor={logic.loadingNutritionFor}
                    
                    selectedMeal={logic.selectedMeal}
                    setSelectedMeal={logic.setSelectedMeal}
                    showSuccessModal={logic.showSuccessModal}
                    setShowSuccessModal={logic.setShowSuccessModal}
                    planStats={logic.planStats}
                    
                    isSettingsOpen={isSettingsOpen}
                    setIsSettingsOpen={setIsSettingsOpen}
                    useBatchedMode={logic.useBatchedMode}
                    setUseBatchedMode={logic.setUseBatchedMode}
                    
                    toasts={logic.toasts}
                    removeToast={logic.removeToast}
                    
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
                    
                    isMobile={isMobile}
                    isDesktop={isDesktop}
                />
            )}
        </>
    );
};

export default App;