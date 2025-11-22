// web/src/App.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';

// --- Component Imports ---
import LandingPage from './pages/LandingPage';
import MainApp from './components/MainApp';
import MyPlansModal from './components/MyPlansModal'; [span_0](start_span)// Added for plan persistence[span_0](end_span)
import PlanControlBar from './components/PlanControlBar'; [span_1](start_span)// Added for plan persistence[span_1](end_span)

// --- Hook Imports ---
import useAppLogic from './hooks/useAppLogic';
import { useResponsive } from './hooks/useResponsive';
import usePlanPersistence from './hooks/usePlanPersistence'; [span_2](start_span)// Added for plan persistence[span_2](end_span)

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
    const [showMyPlansModal, setShowMyPlansModal] = useState(false); [span_3](start_span)// Added for plan persistence[span_3](end_span)
    const [showSaveDialog, setShowSaveDialog] = useState(false); [span_4](start_span)// Added for plan persistence[span_4](end_span)

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

    [span_5](start_span)// --- Plan Persistence Hook (Added) ---[span_5](end_span)
    const {
      savedPlans,
      activePlanId,
      isLoading: isPlansLoading,
      isSaving,
      lastSaveTime,
      hasUnsavedChanges,
      saveNamedPlan,
      loadPlan,
      deletePlan,
      setAsActivePlan,
      loadCurrentPlan,
      loadActivePlan,
      autoSave,
      getLastSaveDisplay
    } = usePlanPersistence({
      userId,
      currentPlanData: {
        mealPlan: logic.mealPlan,
        results: logic.results,
        uniqueIngredients: logic.uniqueIngredients,
        totalCost: logic.totalCost,
        formData: formData,
        nutritionalTargets: nutritionalTargets
      },
      onPlanLoaded: (planData) => {
        // Load the plan data into the app state
        logic.setMealPlan(planData.mealPlan || []);
        logic.setResults(planData.results || {});
        logic.setUniqueIngredients(planData.uniqueIngredients || []);
        logic.setTotalCost(planData.totalCost || 0);
        
        if (planData.formData) {
          setFormData(planData.formData);
        }
        if (planData.nutritionalTargets) {
          setNutritionalTargets(planData.nutritionalTargets);
        }
      },
      onShowToast: logic.showToast,
      autoSaveEnabled: true,
      autoSaveDelay: 5000
    });
    // --- END Plan Persistence Hook ---

    [span_6](start_span)// --- Auto-load active plan on mount (Added) ---[span_6](end_span)
    useEffect(() => {
        if (userId && !logic.mealPlan.length) {
            loadActivePlan().then(success => {
                if (!success) {
                    // If no active plan, try loading the auto-saved current plan
                    loadCurrentPlan();
                }
            });
        }
    }, [userId, loadActivePlan, loadCurrentPlan, logic.mealPlan.length]);

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
        } 
        finally {
            setAuthLoading(false);
        }
    }, [logic]);
    const handleSignOut = useCallback(async () => {
        await logic.handleSignOut();
        setShowLandingPage(true);
        setContentView('profile');
        setAuthError(null);
    }, [logic]);

    [span_7](start_span)// --- Handle save plan with name (Added) ---[span_7](end_span)
    const handleSavePlan = async () => {
      const name = prompt('Enter a name for this meal plan:');
      if (name) {
        await saveNamedPlan(name);
      }
    };

    // --- Edit Profile Handler (FIXED) ---
    const handleEditProfile = useCallback(() => {
        setIsSettingsOpen(false); // Close settings panel
        setContentView('profile'); // Navigate to profile view (right panel)
        // On mobile, we may want to show the form, but the form is on the LEFT
        // The user likely wants to see the profile summary on the RIGHT
        // So we do NOT open 
        // isMenuOpen here
        
        // Optional: scroll to top
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
                <>
                    [span_8](start_span){/* PlanControlBar (Added) */} {/*[span_8](end_span) */}
                    {userId && !showLandingPage && (
                      <PlanControlBar
                        hasCurrentPlan={logic.mealPlan.length > 0}
                        isSaving={isSaving}
                        lastSaveDisplay={getLastSaveDisplay()}
                        hasUnsavedChanges={hasUnsavedChanges}
                        savedPlansCount={savedPlans.length}
                        activePlanName={savedPlans.find(p => p.planId === activePlanId)?.name}
                        onSaveClick={handleSavePlan}
                        onOpenMyPlans={() => setShowMyPlansModal(true)}
                        onLoadCurrent={loadCurrentPlan}
                        isConnected={navigator.onLine}
                      />
                    )}
                    {/* End PlanControlBar */}

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
                        setIsLogOpen={logic.setIsLogOpen}
                        latestLog={logic.latestLog}
                  
                        
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
         
                        [span_9](start_span)// Plan Persistence Props (Added)[span_9](end_span)
                        savedPlansCount={savedPlans.length} 
                        onOpenMyPlans={() => setShowMyPlansModal(true)} 
                        
                        // Responsive
                        isMobile={isMobile}
                        isDesktop={isDesktop}
                    />

                    [span_10](start_span){/* My Plans Modal (Added) */} {/*[span_10](end_span) */}
                    <MyPlansModal
                      isOpen={showMyPlansModal}
                      onClose={() => setShowMyPlansModal(false)}
                      savedPlans={savedPlans}
                      activePlanId={activePlanId}
                      onLoadPlan={loadPlan}
                      onDeletePlan={deletePlan}
                      onSetActivePlan={setAsActivePlan}
                      isLoading={isPlansLoading}
                      currentPlanData={logic.mealPlan.length > 0 ? {
                        mealPlan: logic.mealPlan,
                        results: logic.results,
                        uniqueIngredients: logic.uniqueIngredients,
                        totalCost: logic.totalCost,
                        formData: formData,
                        nutritionalTargets: nutritionalTargets
                      } : null}
                      onSaveCurrentPlan={saveNamedPlan}
                    />
                    {/* End My Plans Modal */}
                </>
        
            )}
        </>
    );
};
export default App;
