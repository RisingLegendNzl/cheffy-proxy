// web/src/hooks/useAppLogic.js
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import usePlanPersistence from './usePlanPersistence';

// --- CONFIGURATION ---
const ORCHESTRATOR_TARGETS_API_URL = '/api/plan/targets';
const ORCHESTRATOR_DAY_API_URL = '/api/plan/day';
const ORCHESTRATOR_FULL_PLAN_API_URL = '/api/plan/generate-full-plan';
const NUTRITION_API_URL = '/api/nutrition-search';
const MAX_SUBSTITUTES = 5;

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = {
    name: "Placeholder (API DOWN)", 
    brand: "MOCK DATA", 
    price: 15.99, 
    size: "1kg",
    url: "#api_down_mock_product", 
    unit_price_per_100: 1.59,
};

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

/**
 * Custom hook that encapsulates all business logic from App.jsx
 * Handles plan generation, profile management, auth, and UI interactions
 */
const useAppLogic = ({ 
    auth, 
    db, 
    userId, 
    isAuthReady, 
    appId,
    formData,
    setFormData,
    nutritionalTargets,
    setNutritionalTargets
}) => {
    // --- Refs ---
    const abortControllerRef = useRef(null);
    
    // --- State ---
    const [results, setResults] = useState({});
    const [uniqueIngredients, setUniqueIngredients] = useState([]);
    const [mealPlan, setMealPlan] = useState([]);
    const [totalCost, setTotalCost] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [eatenMeals, setEatenMeals] = useState({});
    const [selectedDay, setSelectedDay] = useState(1);
    const [diagnosticLogs, setDiagnosticLogs] = useState([]);
    const [nutritionCache, setNutritionCache] = useState({});
    const [loadingNutritionFor, setLoadingNutritionFor] = useState(null);
    const [logHeight, setLogHeight] = useState(250);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const [failedIngredientsHistory, setFailedIngredientsHistory] = useState([]);
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });
    
    // Macro Debug State
    const [macroDebug, setMacroDebug] = useState(null);

    const [showMacroDebugLog, setShowMacroDebugLog] = useState(
      () => JSON.parse(localStorage.getItem('cheffy_show_macro_debug_log') ?? 'false')
    );
    
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

    const [toasts, setToasts] = useState([]);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [planStats, setPlanStats] = useState([]);

    // --- Cleanup Effect (Aborts pending requests on unmount) ---
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                console.log("[CLEANUP] Aborting pending request on unmount.");
                abortControllerRef.current.abort();
            }
        };
    }, []);

    // --- Persist Log Visibility Preferences ---
    useEffect(() => {
      localStorage.setItem('cheffy_show_orchestrator_logs', JSON.stringify(showOrchestratorLogs));
    }, [showOrchestratorLogs]);

    useEffect(() => {
      localStorage.setItem('cheffy_show_failed_ingredients_logs', JSON.stringify(showFailedIngredientsLogs));
    }, [showFailedIngredientsLogs]);
    
    // Macro Debug Log Persistence
    useEffect(() => {
      localStorage.setItem('cheffy_show_macro_debug_log', JSON.stringify(showMacroDebugLog));
    }, [showMacroDebugLog]);

    // --- Base Helpers ---
    const showToast = useCallback((message, type = 'info', duration = 3000) => {
      const id = Date.now();
      setToasts(prev => [...prev, { id, message, type, duration }]);
    }, []);
    
    const removeToast = useCallback((id) => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
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

    // --- Plan Persistence Hook Call ---
    const planPersistence = usePlanPersistence({
        userId: userId || null,
        isAuthReady: isAuthReady || false,
        db: db || null,
        mealPlan: mealPlan || [],
        results: results || {},
        uniqueIngredients: uniqueIngredients || [],
        formData: formData || {},
        nutritionalTargets: nutritionalTargets || {},
        showToast: showToast || (() => {}),
        setMealPlan: setMealPlan || (() => {}),
        setResults: setResults || (() => {}),
        setUniqueIngredients: setUniqueIngredients || (() => {})
    });
    // --- End Plan Persistence Hook Call ---

    // --- Profile & Settings Handlers ---
    const handleLoadProfile = useCallback(async (silent = false) => {
        if (!isAuthReady || !userId || !db || userId.startsWith('local_')) {
            if (!silent) {
                showToast('Please sign in to load your profile', 'warning');
            }
            return false;
        }
    
        try {
            const profileRef = doc(db, 'profile', userId);
            const profileSnap = await getDoc(profileRef);
    
            if (profileSnap.exists()) {
                const data = profileSnap.data();
                
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
                
                if (data.nutritionalTargets) {
                    setNutritionalTargets(data.nutritionalTargets);
                }
                
                console.log("[PROFILE] Profile loaded successfully");
                if (!silent) {
                    showToast('Profile loaded successfully!', 'success');
                }
                
                return true;
                
            } else {
                console.log("[PROFILE] No saved profile found");
                if (!silent) {
                    showToast('No saved profile found', 'info');
                }
                return false;
            }
            
        } catch (error) {
            console.error("[PROFILE] Error loading profile:", error);
            if (!silent) {
                showToast('Failed to load profile', 'error');
            }
            return false;
        }
    }, [userId, db, isAuthReady, showToast, setFormData, setNutritionalTargets]);

    const handleSaveSettings = useCallback(async () => {
        if (!isAuthReady || !userId || !db || userId.startsWith('local_')) {
            return;
        }

        try {
            const settingsData = {
                showOrchestratorLogs: showOrchestratorLogs,
                showFailedIngredientsLogs: showFailedIngredientsLogs,
                showMacroDebugLog: showMacroDebugLog,
                lastUpdated: new Date().toISOString()
            };

            await setDoc(doc(db, 'settings', userId), settingsData);
            console.log("[SETTINGS] Settings saved successfully");
            
        } catch (error) {
            console.error("[SETTINGS] Error saving settings:", error);
        }
    }, [showOrchestratorLogs, showFailedIngredientsLogs, showMacroDebugLog, userId, db, isAuthReady]);

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
                setShowMacroDebugLog(data.showMacroDebugLog ?? false);
                console.log("[SETTINGS] Settings loaded successfully");
            }
            
        } catch (error) {
            console.error("[SETTINGS] Error loading settings:", error);
        }
    }, [userId, db, isAuthReady]);

    const handleSaveProfile = useCallback(async (silent = false) => {
        if (!isAuthReady || !userId || !db || userId.startsWith('local_')) {
            if (!silent) {
                showToast('Please sign in to save your profile', 'warning');
            }
            return;
        }

        try {
            const profileData = {
                name: formData.name,
                height: formData.height,
                weight: formData.weight,
                age: formData.age,
                gender: formData.gender,
                bodyFat: formData.bodyFat,
                activityLevel: formData.activityLevel,
                goal: formData.goal,
                dietary: formData.dietary,
                cuisine: formData.cuisine,
                days: formData.days,
                eatingOccasions: formData.eatingOccasions,
                store: formData.store,
                costPriority: formData.costPriority,
                mealVariety: formData.mealVariety,
                nutritionalTargets: {
                    calories: nutritionalTargets.calories,
                    protein: nutritionalTargets.protein,
                    fat: nutritionalTargets.fat,
                    carbs: nutritionalTargets.carbs
                },
                lastUpdated: new Date().toISOString()
            };

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
            return;
        }
    }, [formData, nutritionalTargets, userId, db, isAuthReady, showToast]);

    // --- Auto-Save/Load Effects ---
    useEffect(() => {
        if (!userId || userId.startsWith('local_') || !isAuthReady) return;
        
        const timeoutId = setTimeout(() => {
            handleSaveProfile(true);
        }, 2000);
        
        return () => clearTimeout(timeoutId);
    }, [formData, nutritionalTargets, userId, isAuthReady, handleSaveProfile]);

    useEffect(() => {
        if (userId && !userId.startsWith('local_') && isAuthReady) {
            handleSaveSettings();
        }
    }, [showOrchestratorLogs, showFailedIngredientsLogs, showMacroDebugLog, userId, isAuthReady, handleSaveSettings]);

    useEffect(() => {
        if (userId && !userId.startsWith('local_') && isAuthReady && db) {
            handleLoadProfile(true);
            handleLoadSettings();
        }
    }, [userId, isAuthReady, db, handleLoadProfile, handleLoadSettings]);

    // --- App Feature Handlers ---
    const handleRefresh = useCallback(async () => {
      if (mealPlan.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        showToast('Data refreshed!', 'success');
      }
    }, [mealPlan, showToast]);

    const handleGeneratePlan = useCallback(async (e) => {
        e.preventDefault();
        
        // --- RECOMMENDED FIX: Abort any pending request ---
        if (abortControllerRef.current) {
            console.log('[GENERATE] Aborting previous request.');
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;
        // --- End Abort Fix ---

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
        setMacroDebug(null); // Macro Debug Reset

        let targets;

        try {
            const targetsResponse = await fetch(ORCHESTRATOR_TARGETS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
                signal: signal,
            });

            if (!targetsResponse.ok) {
                const errorMsg = await getResponseErrorDetails(targetsResponse);
                throw new Error(`Failed to calculate targets: ${errorMsg}`);
            }

            const targetsData = await targetsResponse.json();
            targets = targetsData.nutritionalTargets;
            setNutritionalTargets(targets);
            setDiagnosticLogs(prev => [...prev, ...(targetsData.logs || [])]);
            
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[GENERATE] Targets request aborted.');
                setLoading(false);
                return; // Exit gracefully
            }
            console.error("Plan generation failed critically at Targets:", err);
            setError(`Critical failure: ${err.message}`);
            setGenerationStepKey('error');
            setLoading(false);
            setDiagnosticLogs(prev => [...prev, {
                timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: `Critical failure: ${err.message}`
            }]);
            return;
        }

        if (!useBatchedMode) {
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
                            signal: signal,
                        });

                        if (!dayResponse.ok) {
                            const errorMsg = await getResponseErrorDetails(dayResponse);
                            throw new Error(`Day ${day} request failed: ${errorMsg}`);
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
                        }
                    } catch (dayError) {
                        if (dayError.name === 'AbortError') {
                            console.log(`[GENERATE] Day ${day} request aborted.`);
                            return; // Exit gracefully
                        }
                        console.error(`Error processing day ${day}:`, dayError);
                        setError(prevError => prevError ? `${prevError}\n${dayError.message}` : dayError.message); 
                        setGenerationStepKey('error');
                        setDiagnosticLogs(prev => [...prev, { timestamp: new Date().toISOString(), level: 'CRITICAL', tag: 'FRONTEND', message: dayError.message }]);
                    } finally {
                        if (dailyFailedIngredients.length > 0) setFailedIngredientsHistory(prev => [...prev, ...dailyFailedIngredients]);
                    }
                }

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
            setGenerationStatus("Generating full plan (batched mode)...");
            
            try {
                // console.log('[DEBUG] Starting batched plan generation...'); // Diagnostic log removed for cleanup
                
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
                    signal: signal,
                });

                // console.log('[DEBUG] Fetch completed, status:', planResponse.status, 'ok:', planResponse.ok); // Diagnostic log removed for cleanup

                if (!planResponse.ok) {
                    // --- FIXED ERROR HANDLING (Alternative Fix: Clone/Text/JSON) ---
                    const errorMsg = await getResponseErrorDetails(planResponse);
                    throw new Error(`Full plan request failed (${planResponse.status}): ${errorMsg}`);
                    // --- END FIXED ERROR HANDLING ---
                }

                // console.log('[DEBUG] About to get reader from body...'); // Diagnostic log removed for cleanup
                // console.log('[DEBUG] planResponse.body exists:', !!planResponse.body); // Diagnostic log removed for cleanup
                
                const reader = planResponse.body.getReader();
                // console.log('[DEBUG] Reader obtained successfully'); // Diagnostic log removed for cleanup
                
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
                                
                                // Capture Macro Debug Data
                                if (eventData.macroDebug) {
                                    setMacroDebug(eventData.macroDebug);
                                }
                                
                                setGenerationStepKey('complete');
                                setGenerationStatus('Plan generation complete!');
                                
                                setPlanStats([
                                  { label: 'Days', value: formData.days, color: '#4f46e5' },
                                  { label: 'Meals', value: eventData.mealPlan?.length * (parseInt(formData.eatingOccasions) || 3), color: '#10b981' },
                                  { label: 'Items', value: eventData.uniqueIngredients?.length || 0, color: '#f59e0b' },
                                ]);
                                
                                setTimeout(() => {
                                  setShowSuccessModal(true);
                                  setTimeout(() => {
                                    setShowSuccessModal(false);
                                  }, 2500);
                                }, 500);
                                break;

                            case 'error':
                                throw new Error(eventData.message || 'Unknown backend error');
                        }
                    }
                }
                
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.log('[GENERATE] Batched request aborted.');
                    return; // Exit gracefully
                }
                
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
    }, [formData, isLogOpen, recalculateTotalCost, useBatchedMode, showToast, nutritionalTargets.calories, error]);

    // --- NEW HELPER FUNCTION for robust error parsing ---
    const getResponseErrorDetails = useCallback(async (response) => {
        let errorMsg = `HTTP ${response.status}`;
        try {
            // Clone the response so we can safely read the body without disturbing the stream
            const clonedResponse = response.clone();
            try {
                // Attempt to read as JSON first
                const errorData = await clonedResponse.json();
                errorMsg = errorData.message || JSON.stringify(errorData);
            } catch (jsonErr) {
                // If JSON parsing fails, read the raw text
                errorMsg = await response.text() || `HTTP ${response.status} - Could not read body`;
            }
        } catch (e) {
            console.error('[ERROR] Could not read error response body:', e);
            errorMsg = `HTTP ${response.status} - Could not read response body`;
        }
        return errorMsg;
    }, []);

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

    const handleDownloadMacroDebugLogs = useCallback(() => {
      if (!macroDebug || Object.keys(macroDebug).length === 0) return;
      const logContent = JSON.stringify(macroDebug, null, 2);
      const blob = new Blob([logContent], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `cheffy_macro_debug_${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, [macroDebug]);

    const handleSignUp = useCallback(async ({ name, email, password }) => {
        try {
            console.log("[AUTH] Starting sign up process...");
            
            if (!auth) {
                throw new Error("Firebase not initialized");
            }

            const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth');
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            console.log("[AUTH] User created:", user.uid);

            if (name) {
                await updateProfile(user, { displayName: name });
            }

            const trialStartDate = new Date();
            const trialEndDate = new Date();
            trialEndDate.setDate(trialEndDate.getDate() + 7);

            if (db) {
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
            
            showToast(`Welcome ${name}! Your 7-day trial has started.`, 'success');
            
        } catch (error) {
            console.error("[AUTH] Sign up error:", error);
            showToast(error.message || 'Failed to create account', 'error');
            throw error;
        }
    }, [auth, db, appId, showToast]);

    const handleSignIn = useCallback(async ({ email, password }) => {
        try {
            console.log("[AUTH] Starting sign in process...");
            
            if (!auth) {
                throw new Error("Firebase not initialized");
            }

            const { signInWithEmailAndPassword } = await import('firebase/auth');
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            console.log("[AUTH] User signed in:", user.uid);
            
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
            
            showToast(errorMessage, 'error');
            throw new Error(errorMessage);
        }
    }, [auth, showToast]);

    const handleSignOut = useCallback(async () => {
        try {
            if (auth) {
                await auth.signOut();
                console.log("[FIREBASE] User signed out");
            }
            
            setMealPlan([]);
            
            setFormData({ 
                name: '', height: '180', weight: '75', age: '30', gender: 'male', 
                activityLevel: 'moderate', goal: 'cut_moderate', dietary: 'None', 
                days: 7, store: 'Woolworths', eatingOccasions: '3', 
                costPriority: 'Best Value', mealVariety: 'Balanced Variety', 
                cuisine: '', bodyFat: '' 
            });
            setNutritionalTargets({ calories: 0, protein: 0, fat: 0, carbs: 0 });
            
            showToast('Signed out successfully', 'success');
        } catch (error) {
            console.error("[FIREBASE] Sign out error:", error);
            showToast('Error signing out', 'error');
        }
    }, [auth, showToast, setFormData, setNutritionalTargets]);

    const onToggleMealEaten = useCallback((day, mealName) => {
        setEatenMeals(prev => {
            const dayKey = `day${day}`;
            const dayMeals = { ...(prev[dayKey] || {}) };
            dayMeals[mealName] = !dayMeals[mealName];
            return { ...prev, [dayKey]: dayMeals };
        });
    }, []); 

    // --- Computed Values ---
    const categorizedResults = useMemo(() => {
        const groups = {};
        Object.entries(results || {}).forEach(([normalizedKey, item]) => {
            // FIX: Remove overly restrictive 'source' filter to display all ingredients.
            if (item && item.originalIngredient) {
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

    const hasInvalidMeals = useMemo(() => {
        if (!mealPlan || mealPlan.length === 0) return false;
        return mealPlan.some(dayPlan =>
            !dayPlan || !Array.isArray(dayPlan.meals) || dayPlan.meals.some(meal =>
                !meal || typeof meal.subtotal_kcal !== 'number' || meal.subtotal_kcal <= 0
            )
        );
    }, [mealPlan]); 

    const latestLog = diagnosticLogs.length > 0 ? diagnosticLogs[diagnosticLogs.length - 1] : null;

    // --- Return all handlers and computed values ---
    return {
        // State
        results,
        uniqueIngredients,
        mealPlan,
        totalCost,
        loading,
        error,
        eatenMeals,
        selectedDay,
        diagnosticLogs,
        nutritionCache,
        loadingNutritionFor,
        logHeight,
        isLogOpen,
        failedIngredientsHistory,
        statusMessage,
        showOrchestratorLogs,
        showFailedIngredientsLogs,
        generationStepKey,
        generationStatus,
        selectedMeal,
        useBatchedMode,
        toasts,
        showSuccessModal,
        planStats,
        macroDebug, 
        showMacroDebugLog,
        categorizedResults,
        hasInvalidMeals,
        latestLog,
        
        // Setters
        setSelectedDay,
        setLogHeight,
        setIsLogOpen,
        setShowOrchestratorLogs,
        setShowFailedIngredientsLogs,
        setShowMacroDebugLog,
        setSelectedMeal,
        setUseBatchedMode,
        setShowSuccessModal,
        
        // Handlers
        showToast,
        removeToast,
        handleLoadProfile,
        handleSaveProfile,
        handleLoadSettings,
        handleSaveSettings,
        handleRefresh,
        handleGeneratePlan,
        handleFetchNutrition,
        handleSubstituteSelection,
        handleQuantityChange,
        handleDownloadFailedLogs,
        handleDownloadLogs,
        handleDownloadMacroDebugLogs,
        handleSignUp,
        handleSignIn,
        handleSignOut,
        onToggleMealEaten,
        
        // Plan persistence additions
        savedPlans: planPersistence.savedPlans,
        activePlanId: planPersistence.activePlanId,
        handleSavePlan: planPersistence.savePlan,
        handleLoadPlan: planPersistence.loadPlan,
        handleDeletePlan: planPersistence.deletePlan,
        savingPlan: planPersistence.savingPlan,
        loadingPlan: planPersistence.loadingPlan,
        handleListPlans: planPersistence.listPlans,
        handleSetActivePlan: planPersistence.setActivePlan,
    };
};

export default useAppLogic;

