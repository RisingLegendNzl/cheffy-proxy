// web/src/hooks/useProfileManagement.js
import { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, setLogLevel } from 'firebase/firestore';

/**
 * Custom hook for managing user profile, authentication, and settings
 * Handles Firebase initialization, auth flows, and Firestore CRUD operations
 */
export const useProfileManagement = () => {
    // Auth State
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('default-app-id');
    const [showLandingPage, setShowLandingPage] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);

    // Profile State
    const [formData, setFormData] = useState({ 
        name: '', 
        height: '180', 
        weight: '75', 
        age: '30', 
        gender: 'male', 
        activityLevel: 'moderate', 
        goal: 'cut_moderate', 
        dietary: 'None', 
        days: 7, 
        store: 'Woolworths', 
        eatingOccasions: '3', 
        costPriority: 'Best Value', 
        mealVariety: 'Balanced Variety', 
        cuisine: '', 
        bodyFat: '' 
    });

    const [nutritionalTargets, setNutritionalTargets] = useState({ 
        calories: 0, 
        protein: 0, 
        fat: 0, 
        carbs: 0 
    });

    // Settings State
    const [showOrchestratorLogs, setShowOrchestratorLogs] = useState(
        () => JSON.parse(localStorage.getItem('cheffy_show_orchestrator_logs') ?? 'true')
    );
    const [showFailedIngredientsLogs, setShowFailedIngredientsLogs] = useState(
        () => JSON.parse(localStorage.getItem('cheffy_show_failed_ingredients_logs') ?? 'true')
    );

    // Firebase Initialization
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
        
        try {
            let firebaseConfig = null;
            
            if (firebaseConfigStr && firebaseConfigStr.trim() !== '') {
                firebaseConfig = JSON.parse(firebaseConfigStr);
            } else {
                console.warn("[FIREBASE] Config is not defined or is empty.");
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
                    // Load profile will be called via useEffect in parent
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
            setIsAuthReady(true);
        }
    }, []);

    // Persist settings to localStorage
    useEffect(() => {
        localStorage.setItem('cheffy_show_orchestrator_logs', JSON.stringify(showOrchestratorLogs));
    }, [showOrchestratorLogs]);

    useEffect(() => {
        localStorage.setItem('cheffy_show_failed_ingredients_logs', JSON.stringify(showFailedIngredientsLogs));
    }, [showFailedIngredientsLogs]);

    // Load profile from Firestore
    const handleLoadProfile = useCallback(async (silent = false) => {
        if (!userId || !db || !isAuthReady) return;
        if (userId.startsWith('local_')) return;
        
        try {
            const docRef = doc(db, 'profiles', userId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.formData) {
                    setFormData(data.formData);
                }
                if (data.nutritionalTargets) {
                    setNutritionalTargets(data.nutritionalTargets);
                }
                if (!silent) {
                    console.log("[PROFILE] Profile loaded successfully");
                }
            } else {
                if (!silent) {
                    console.log("[PROFILE] No saved profile found");
                }
            }
        } catch (error) {
            console.error("[PROFILE] Error loading profile:", error);
        }
    }, [userId, db, isAuthReady]);

    // Save profile to Firestore
    const handleSaveProfile = useCallback(async (silent = false) => {
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
                console.log("[PROFILE] Profile saved successfully");
            }
            
            return true;
        } catch (error) {
            console.error("[PROFILE] Error saving profile:", error);
            return false;
        }
    }, [formData, nutritionalTargets, userId, db, isAuthReady, appId]);

    // Load settings from Firestore
    const handleLoadSettings = useCallback(async () => {
        if (!userId || !db || !isAuthReady) return;
        if (userId.startsWith('local_')) return;
        
        try {
            const docRef = doc(db, 'settings', userId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (typeof data.showOrchestratorLogs === 'boolean') {
                    setShowOrchestratorLogs(data.showOrchestratorLogs);
                }
                if (typeof data.showFailedIngredientsLogs === 'boolean') {
                    setShowFailedIngredientsLogs(data.showFailedIngredientsLogs);
                }
            }
        } catch (error) {
            console.error("[SETTINGS] Error loading settings:", error);
        }
    }, [userId, db, isAuthReady]);

    // Save settings to Firestore
    const handleSaveSettings = useCallback(async () => {
        if (!userId || !db || !isAuthReady) return;
        if (userId.startsWith('local_')) return;
        
        try {
            const docRef = doc(db, 'settings', userId);
            await setDoc(docRef, {
                showOrchestratorLogs,
                showFailedIngredientsLogs,
                updatedAt: new Date().toISOString(),
                appId: appId
            }, { merge: true });
        } catch (error) {
            console.error("[SETTINGS] Error saving settings:", error);
        }
    }, [showOrchestratorLogs, showFailedIngredientsLogs, userId, db, isAuthReady, appId]);

    // Auto-save profile after changes (debounced)
    useEffect(() => {
        if (!userId || userId.startsWith('local_') || !isAuthReady) return;
        
        const timeoutId = setTimeout(() => {
            handleSaveProfile(true); // Silent save
        }, 2000);
        
        return () => clearTimeout(timeoutId);
    }, [formData, nutritionalTargets, userId, isAuthReady, handleSaveProfile]);

    // Auto-save settings when they change
    useEffect(() => {
        if (userId && !userId.startsWith('local_') && isAuthReady) {
            handleSaveSettings();
        }
    }, [showOrchestratorLogs, showFailedIngredientsLogs, userId, isAuthReady, handleSaveSettings]);

    // Load profile and settings after sign-in
    useEffect(() => {
        if (userId && !userId.startsWith('local_') && isAuthReady && db) {
            handleLoadProfile(true); // Silent load
            handleLoadSettings();
        }
    }, [userId, isAuthReady, db, handleLoadProfile, handleLoadSettings]);

    // Auth handlers
    const handleSignUp = useCallback(async ({ email, password, name }) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            // Note: This is a placeholder. Implement actual sign-up with Firebase Auth
            // Example: createUserWithEmailAndPassword(auth, email, password)
            console.log("[AUTH] Sign up attempt:", { email, name });
            
            // For now, just show success
            setShowLandingPage(false);
            return { success: true };
        } catch (error) {
            console.error("[AUTH] Sign up error:", error);
            setAuthError(error.message);
            return { success: false, error: error.message };
        } finally {
            setAuthLoading(false);
        }
    }, []);

    const handleSignIn = useCallback(async ({ email, password }) => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            // Note: This is a placeholder. Implement actual sign-in with Firebase Auth
            // Example: signInWithEmailAndPassword(auth, email, password)
            console.log("[AUTH] Sign in attempt:", { email });
            
            // For now, just show success
            setShowLandingPage(false);
            return { success: true };
        } catch (error) {
            console.error("[AUTH] Sign in error:", error);
            setAuthError(error.message);
            return { success: false, error: error.message };
        } finally {
            setAuthLoading(false);
        }
    }, []);

    const handleSignOut = useCallback(async () => {
        if (!auth) return;
        
        try {
            await auth.signOut();
            setShowLandingPage(true);
            console.log("[AUTH] Signed out successfully");
            return { success: true };
        } catch (error) {
            console.error("[AUTH] Sign out error:", error);
            return { success: false, error: error.message };
        }
    }, [auth]);

    // Form input handler
    const handleInputChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    // Clear all data
    const handleClearData = useCallback(() => {
        // Reset to defaults
        setFormData({ 
            name: '', 
            height: '180', 
            weight: '75', 
            age: '30', 
            gender: 'male', 
            activityLevel: 'moderate', 
            goal: 'cut_moderate', 
            dietary: 'None', 
            days: 7, 
            store: 'Woolworths', 
            eatingOccasions: '3', 
            costPriority: 'Best Value', 
            mealVariety: 'Balanced Variety', 
            cuisine: '', 
            bodyFat: '' 
        });
        setNutritionalTargets({ calories: 0, protein: 0, fat: 0, carbs: 0 });
        
        console.log("[PROFILE] All data cleared");
    }, []);

    return {
        // Auth State
        auth,
        db,
        userId,
        isAuthReady,
        appId,
        showLandingPage,
        authLoading,
        authError,
        
        // Profile State
        formData,
        nutritionalTargets,
        
        // Settings State
        showOrchestratorLogs,
        showFailedIngredientsLogs,
        
        // Profile Actions
        setFormData,
        setNutritionalTargets,
        handleInputChange,
        handleLoadProfile,
        handleSaveProfile,
        handleClearData,
        
        // Settings Actions
        setShowOrchestratorLogs,
        setShowFailedIngredientsLogs,
        handleLoadSettings,
        handleSaveSettings,
        
        // Auth Actions
        handleSignUp,
        handleSignIn,
        handleSignOut,
        setShowLandingPage,
    };
};

export default useProfileManagement;