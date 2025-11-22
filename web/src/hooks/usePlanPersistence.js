// web/src/hooks/usePlanPersistence.js
// Fixed version with better error handling to prevent UI crashes and dependency issues

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
    console.log('[DEBUG-P1] usePlanPersistence: Hook started.', { userId: userId?.substring(0, 8), db: !!db, isAuthReady });
    const [savedPlans, setSavedPlans] = useState([]);
    const [activePlanId, setActivePlanId] = useState(null);
    const [savingPlan, setSavingPlan] = useState(false);
    const [loadingPlan, setLoadingPlan] = useState(false);
    const [loadingPlansList, setLoadingPlansList] = useState(false);

    // Hardened listPlans implementation
    const listPlans = useCallback(async () => {
        // HARDENED CHECK: Ensure both db and user context are available immediately
        if (!userId || !db) {
            console.warn('[PLAN_HOOK] listPlans: Pre-check failed. Skipping list load.', { userId: !!userId, db: !!db });
            return [];
        }
        console.log('[PLAN_HOOK] listPlans: Starting plan list fetch...');

        setLoadingPlansList(true);
        try {
            const plans = await planService.listPlans({ userId, db });
            setSavedPlans(plans);

            const active = plans.find(p => p.isActive);
            setActivePlanId(active ? active.planId : null);
            console.log(`[PLAN_HOOK] listPlans: Fetched ${plans.length} plans. Active ID: ${activePlanId}`);

            return plans;
        } catch (error) {
            console.error('[PLAN_HOOK] Error listing plans:', error);
            return [];
        } finally {
            setLoadingPlansList(false);
        }
    }, [userId, db, activePlanId]);

    const savePlan = useCallback(async (planName) => {
        if (!userId || !db) {
            showToast && showToast('Please sign in to save plans', 'warning');
            return null;
        }

        if (!mealPlan || mealPlan.length === 0) {
            showToast && showToast('No meal plan to save', 'warning');
            return null;
        }
        console.log('[PLAN_HOOK] savePlan: Attempting to save:', planName);

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
    }, [userId, db, mealPlan, results, uniqueIngredients, formData, nutritionalTargets, showToast, listPlans]);

    const loadPlan = useCallback(async (planId) => {
        if (!userId || !db) {
            showToast && showToast('Please sign in to load plans', 'warning');
            return false;
        }

        if (!planId) {
            showToast && showToast('Invalid plan ID', 'error');
            return false;
        }
        console.log('[PLAN_HOOK] loadPlan: Attempting to load plan ID:', planId);

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
    }, [userId, db, showToast, setMealPlan, setResults, setUniqueIngredients]);

    const deletePlan = useCallback(async (planId) => {
        if (!userId || !db) {
            showToast && showToast('Please sign in to delete plans', 'warning');
            return false;
        }

        if (!planId) {
            showToast && showToast('Invalid plan ID', 'error');
            return false;
        }
        console.log('[PLAN_HOOK] deletePlan: Deleting plan ID:', planId);

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
    }, [userId, db, showToast, listPlans]);

    const setActivePlanHandler = useCallback(async (planId) => {
        if (!userId || !db) {
            return false;
        }
        console.log('[PLAN_HOOK] setActivePlan: Setting active plan ID:', planId);

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
    }, [userId, db, listPlans]);

    // Load active plan on mount
    useEffect(() => {
        const loadActivePlan = async () => {
            console.log('[DEBUG-P2] Effect (loadActivePlan): Check running.', { userId: !!userId, db: !!db, mealPlanLength: mealPlan?.length });
            if (!userId || !db) {
                return;
            }

            try {
                const active = await planService.getActivePlan({ userId, db });
                if (active && active.planId) {
                    setActivePlanId(active.planId);
                    console.log('[PLAN_HOOK] Active plan found:', active.planId);
                    // Only auto-load if there's no current meal plan
                    if (!mealPlan || mealPlan.length === 0) {
                        console.log('[PLAN_HOOK] Auto-loading active plan...');
                        await loadPlan(active.planId);
                    }
                } else {
                    console.log('[PLAN_HOOK] No active plan found.');
                }
            } catch (error) {
                console.error('[PLAN_HOOK] Error loading active plan on mount:', error);
            }
        };

        loadActivePlan();
    }, [userId, db, mealPlan, loadPlan]); 

    // Load plans list on mount
    useEffect(() => {
        console.log('[DEBUG-P3] Effect (listPlans): Check running.', { userId: !!userId, db: !!db });
        if (userId && db) { 
            console.log('[PLAN_HOOK] Auth/DB ready. Fetching plan list.');
            listPlans().catch(err => {
                console.error('[PLAN_HOOK] Silent error loading plans list:', err);
            });
        }
    }, [userId, db, listPlans]);

    console.log('[DEBUG-P4] usePlanPersistence: Returning final object.');
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

