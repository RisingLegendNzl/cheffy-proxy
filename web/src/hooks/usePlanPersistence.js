// web/src/hooks/usePlanPersistence.js
// Custom hook for meal plan persistence functionality
// Provides save, load, list, delete, and set-active operations

import { useState, useEffect, useCallback } from 'react';
import * as planService from '../services/planPersistence';

/**
 * Hook for managing meal plan persistence
 * @param {object} params - Hook parameters
 * @param {string} params.userId - Current user ID
 * @param {boolean} params.isAuthReady - Whether auth is ready
 * @param {object} params.db - Firestore database instance
 * @param {array} params.mealPlan - Current meal plan
 * @param {object} params.results - Current product results
 * @param {array} params.uniqueIngredients - Current shopping list
 * @param {object} params.formData - Current form data
 * @param {object} params.nutritionalTargets - Current nutritional targets
 * @param {function} params.showToast - Toast notification function
 * @param {function} params.setMealPlan - Setter for meal plan state
 * @param {function} params.setResults - Setter for results state
 * @param {function} params.setUniqueIngredients - Setter for ingredients state
 * @returns {object} - Persistence state and functions
 */
const usePlanPersistence = ({
    userId,
    isAuthReady,
    db,
    mealPlan,
    results,
    uniqueIngredients,
    formData,
    nutritionalTargets,
    showToast,
    setMealPlan,
    setResults,
    setUniqueIngredients
}) => {
    // State
    const [savedPlans, setSavedPlans] = useState([]);
    const [activePlanId, setActivePlanId] = useState(null);
    const [savingPlan, setSavingPlan] = useState(false);
    const [loadingPlan, setLoadingPlan] = useState(false);
    const [loadingPlansList, setLoadingPlansList] = useState(false);

    /**
     * Save current meal plan
     * @param {string} planName - Optional name for the plan
     * @returns {Promise<object>} - Saved plan data
     */
    const savePlan = useCallback(async (planName) => {
        if (!userId || !isAuthReady || !db) {
            showToast('Please sign in to save plans', 'warning');
            return null;
        }

        if (!mealPlan || mealPlan.length === 0) {
            showToast('No meal plan to save', 'warning');
            return null;
        }

        setSavingPlan(true);
        try {
            const savedPlan = await planService.savePlan({
                userId,
                db,
                planName: planName || `Plan ${new Date().toLocaleDateString()}`,
                mealPlan,
                results,
                uniqueIngredients,
                formData,
                nutritionalTargets
            });

            // Refresh the plans list
            await listPlans();

            showToast('Plan saved successfully!', 'success');
            return savedPlan;
        } catch (error) {
            console.error('[PLAN_HOOK] Error saving plan:', error);
            showToast('Failed to save plan', 'error');
            return null;
        } finally {
            setSavingPlan(false);
        }
    }, [userId, isAuthReady, db, mealPlan, results, uniqueIngredients, formData, nutritionalTargets, showToast]);

    /**
     * Load a saved meal plan
     * @param {string} planId - ID of plan to load
     * @returns {Promise<boolean>} - Whether load succeeded
     */
    const loadPlan = useCallback(async (planId) => {
        if (!userId || !isAuthReady || !db) {
            showToast('Please sign in to load plans', 'warning');
            return false;
        }

        if (!planId) {
            showToast('Invalid plan ID', 'error');
            return false;
        }

        setLoadingPlan(true);
        try {
            const loadedPlan = await planService.loadPlan({
                userId,
                db,
                planId
            });

            // Update app state with loaded plan
            if (setMealPlan && loadedPlan.mealPlan) {
                setMealPlan(loadedPlan.mealPlan);
            }
            if (setResults && loadedPlan.results) {
                setResults(loadedPlan.results);
            }
            if (setUniqueIngredients && loadedPlan.uniqueIngredients) {
                setUniqueIngredients(loadedPlan.uniqueIngredients);
            }

            showToast(`Loaded: ${loadedPlan.name}`, 'success');
            return true;
        } catch (error) {
            console.error('[PLAN_HOOK] Error loading plan:', error);
            showToast('Failed to load plan', 'error');
            return false;
        } finally {
            setLoadingPlan(false);
        }
    }, [userId, isAuthReady, db, showToast, setMealPlan, setResults, setUniqueIngredients]);

    /**
     * List all saved plans for current user
     * @returns {Promise<array>} - Array of saved plans
     */
    const listPlans = useCallback(async () => {
        if (!userId || !isAuthReady || !db) {
            return [];
        }

        setLoadingPlansList(true);
        try {
            const plans = await planService.listPlans({ userId, db });
            setSavedPlans(plans);

            // Update active plan ID
            const active = plans.find(p => p.isActive);
            setActivePlanId(active ? active.planId : null);

            return plans;
        } catch (error) {
            console.error('[PLAN_HOOK] Error listing plans:', error);
            return [];
        } finally {
            setLoadingPlansList(false);
        }
    }, [userId, isAuthReady, db]);

    /**
     * Delete a saved plan
     * @param {string} planId - ID of plan to delete
     * @returns {Promise<boolean>} - Whether deletion succeeded
     */
    const deletePlan = useCallback(async (planId) => {
        if (!userId || !isAuthReady || !db) {
            showToast('Please sign in to delete plans', 'warning');
            return false;
        }

        if (!planId) {
            showToast('Invalid plan ID', 'error');
            return false;
        }

        try {
            await planService.deletePlan({ userId, db, planId });

            // Refresh the plans list
            await listPlans();

            showToast('Plan deleted', 'success');
            return true;
        } catch (error) {
            console.error('[PLAN_HOOK] Error deleting plan:', error);
            showToast('Failed to delete plan', 'error');
            return false;
        }
    }, [userId, isAuthReady, db, showToast, listPlans]);

    /**
     * Set a plan as the active plan
     * @param {string} planId - ID of plan to set as active (null to clear)
     * @returns {Promise<boolean>} - Whether operation succeeded
     */
    const setActivePlanHandler = useCallback(async (planId) => {
        if (!userId || !isAuthReady || !db) {
            return false;
        }

        try {
            if (planId) {
                await planService.setActivePlan({ userId, db, planId });
                setActivePlanId(planId);
            } else {
                // Clear active plan
                setActivePlanId(null);
            }

            // Refresh the plans list to update isActive flags
            await listPlans();

            return true;
        } catch (error) {
            console.error('[PLAN_HOOK] Error setting active plan:', error);
            return false;
        }
    }, [userId, isAuthReady, db, listPlans]);

    /**
     * Load the active plan on mount
     */
    useEffect(() => {
        const loadActivePlan = async () => {
            if (!userId || !isAuthReady || !db) {
                return;
            }

            try {
                const active = await planService.getActivePlan({ userId, db });
                if (active && active.planId) {
                    setActivePlanId(active.planId);
                    // Auto-load the active plan
                    await loadPlan(active.planId);
                }
            } catch (error) {
                console.error('[PLAN_HOOK] Error loading active plan on mount:', error);
            }
        };

        loadActivePlan();
    }, [userId, isAuthReady, db]); // Intentionally excluding loadPlan to avoid infinite loop

    /**
     * Load plans list on mount
     */
    useEffect(() => {
        if (userId && isAuthReady && db) {
            listPlans();
        }
    }, [userId, isAuthReady, db, listPlans]);

    return {
        // State
        savedPlans,
        activePlanId,
        savingPlan,
        loadingPlan,
        loadingPlansList,

        // Functions
        savePlan,
        loadPlan,
        listPlans,
        deletePlan,
        setActivePlan: setActivePlanHandler
    };
};

export default usePlanPersistence;