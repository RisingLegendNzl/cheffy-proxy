// web/src/hooks/usePlanPersistence.js
// Fixed version with better error handling to prevent UI crashes

import { useState, useEffect, useCallback } from 'react';
import * as planService from '../services/planPersistence';

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
    const [savedPlans, setSavedPlans] = useState([]);
    const [activePlanId, setActivePlanId] = useState(null);
    const [savingPlan, setSavingPlan] = useState(false);
    const [loadingPlan, setLoadingPlan] = useState(false);
    const [loadingPlansList, setLoadingPlansList] = useState(false);

    const savePlan = useCallback(async (planName) => {
        if (!userId || !isAuthReady || !db) {
            showToast && showToast('Please sign in to save plans', 'warning');
            return null;
        }

        if (!mealPlan || mealPlan.length === 0) {
            showToast && showToast('No meal plan to save', 'warning');
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

            await listPlans();
            showToast && showToast('Plan saved successfully!', 'success');
            return savedPlan;
        } catch (error) {
            console.error('[PLAN_HOOK] Error saving plan:', error);
            showToast && showToast('Failed to save plan', 'error');
            return null;
        } finally {
            setSavingPlan(false);
        }
    }, [userId, isAuthReady, db, mealPlan, results, uniqueIngredients, formData, nutritionalTargets, showToast]);

    const loadPlan = useCallback(async (planId) => {
        if (!userId || !isAuthReady || !db) {
            showToast && showToast('Please sign in to load plans', 'warning');
            return false;
        }

        if (!planId) {
            showToast && showToast('Invalid plan ID', 'error');
            return false;
        }

        setLoadingPlan(true);
        try {
            const loadedPlan = await planService.loadPlan({
                userId,
                db,
                planId
            });

            if (setMealPlan && loadedPlan.mealPlan) {
                setMealPlan(loadedPlan.mealPlan);
            }
            if (setResults && loadedPlan.results) {
                setResults(loadedPlan.results);
            }
            if (setUniqueIngredients && loadedPlan.uniqueIngredients) {
                setUniqueIngredients(loadedPlan.uniqueIngredients);
            }

            showToast && showToast(`Loaded: ${loadedPlan.name}`, 'success');
            return true;
        } catch (error) {
            console.error('[PLAN_HOOK] Error loading plan:', error);
            showToast && showToast('Failed to load plan', 'error');
            return false;
        } finally {
            setLoadingPlan(false);
        }
    }, [userId, isAuthReady, db, showToast, setMealPlan, setResults, setUniqueIngredients]);

    const listPlans = useCallback(async () => {
        if (!userId || !isAuthReady || !db) {
            return [];
        }

        setLoadingPlansList(true);
        try {
            const plans = await planService.listPlans({ userId, db });
            setSavedPlans(plans);

            const active = plans.find(p => p.isActive);
            setActivePlanId(active ? active.planId : null);

            return plans;
        } catch (error) {
            console.error('[PLAN_HOOK] Error listing plans:', error);
            // Don't show toast on silent list failures
            return [];
        } finally {
            setLoadingPlansList(false);
        }
    }, [userId, isAuthReady, db]);

    const deletePlan = useCallback(async (planId) => {
        if (!userId || !isAuthReady || !db) {
            showToast && showToast('Please sign in to delete plans', 'warning');
            return false;
        }

        if (!planId) {
            showToast && showToast('Invalid plan ID', 'error');
            return false;
        }

        try {
            await planService.deletePlan({ userId, db, planId });
            await listPlans();
            showToast && showToast('Plan deleted', 'success');
            return true;
        } catch (error) {
            console.error('[PLAN_HOOK] Error deleting plan:', error);
            showToast && showToast('Failed to delete plan', 'error');
            return false;
        }
    }, [userId, isAuthReady, db, showToast, listPlans]);

    const setActivePlanHandler = useCallback(async (planId) => {
        if (!userId || !isAuthReady || !db) {
            return false;
        }

        try {
            if (planId) {
                await planService.setActivePlan({ userId, db, planId });
                setActivePlanId(planId);
            } else {
                setActivePlanId(null);
            }

            await listPlans();
            return true;
        } catch (error) {
            console.error('[PLAN_HOOK] Error setting active plan:', error);
            return false;
        }
    }, [userId, isAuthReady, db, listPlans]);

    // Load active plan on mount - with error handling
    useEffect(() => {
        const loadActivePlan = async () => {
            if (!userId || !isAuthReady || !db) {
                return;
            }

            try {
                const active = await planService.getActivePlan({ userId, db });
                if (active && active.planId) {
                    setActivePlanId(active.planId);
                    // Only auto-load if there's no current meal plan
                    if (!mealPlan || mealPlan.length === 0) {
                        await loadPlan(active.planId);
                    }
                }
            } catch (error) {
                console.error('[PLAN_HOOK] Error loading active plan on mount:', error);
                // Silent fail - don't crash the app
            }
        };

        loadActivePlan();
    // FIX: Added mealPlan and loadPlan to the dependency array.
    }, [userId, isAuthReady, db, mealPlan, loadPlan]); 

    // Load plans list on mount - with error handling
    useEffect(() => {
        if (userId && isAuthReady && db) {
            listPlans().catch(err => {
                console.error('[PLAN_HOOK] Silent error loading plans list:', err);
                // Silent fail - don't crash the app
            });
        }
    }, [userId, isAuthReady, db, listPlans]);

    return {
        savedPlans,
        activePlanId,
        savingPlan,
        loadingPlan,
        loadingPlansList,
        savePlan,
        loadPlan,
        listPlans,
        deletePlan,
        setActivePlan: setActivePlanHandler
    };
};

export default usePlanPersistence;

