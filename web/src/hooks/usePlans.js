// web/src/hooks/usePlans.js
import { useState, useCallback, useEffect } from 'react';
import {
    saveCurrentPlan as apiSaveCurrentPlan,
    getCurrentPlan as apiGetCurrentPlan,
    savePlan as apiSavePlan,
    listPlans as apiListPlans,
    loadPlan as apiLoadPlan,
    deletePlan as apiDeletePlan,
    setActivePlan as apiSetActivePlan
} from '../services/plansApi';

const usePlans = ({ userId, currentPlanData, onPlanLoaded }) => {
    const [savedPlans, setSavedPlans] = useState([]);
    const [activePlanId, setActivePlanId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastSavedAt, setLastSavedAt] = useState(null);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    const handleError = useCallback((err, operation) => {
        const errorMessage = err?.message || `Failed to ${operation}`;
        setError(errorMessage);
        console.error(`[usePlans] ${operation} error:`, err);
        return errorMessage;
    }, []);

    const saveCurrentPlanToBackend = useCallback(async () => {
        if (!userId) {
            return handleError(new Error('No user ID available'), 'save current plan');
        }

        if (!currentPlanData) {
            return handleError(new Error('No plan data to save'), 'save current plan');
        }

        setLoading(true);
        clearError();

        try {
            const result = await apiSaveCurrentPlan({
                userId,
                planData: currentPlanData
            });
            setLastSavedAt(new Date().toISOString());
            return result;
        } catch (err) {
            return handleError(err, 'save current plan');
        } finally {
            setLoading(false);
        }
    }, [userId, currentPlanData, handleError, clearError]);

    const loadCurrentPlan = useCallback(async () => {
        if (!userId) {
            return handleError(new Error('No user ID available'), 'load current plan');
        }

        setLoading(true);
        clearError();

        try {
            const result = await apiGetCurrentPlan({ userId });
            
            if (result.data && onPlanLoaded) {
                onPlanLoaded(result.data);
            }
            
            return result.data;
        } catch (err) {
            if (err.message?.includes('not found')) {
                return null;
            }
            return handleError(err, 'load current plan');
        } finally {
            setLoading(false);
        }
    }, [userId, onPlanLoaded, handleError, clearError]);

    const savePlan = useCallback(async (planName) => {
        if (!userId) {
            return handleError(new Error('No user ID available'), 'save plan');
        }

        if (!planName || typeof planName !== 'string' || planName.trim() === '') {
            return handleError(new Error('Plan name is required'), 'save plan');
        }

        if (!currentPlanData) {
            return handleError(new Error('No plan data to save'), 'save plan');
        }

        setLoading(true);
        clearError();

        try {
            const result = await apiSavePlan({
                userId,
                planName: planName.trim(),
                planData: currentPlanData
            });

            await refreshPlans();
            
            return result;
        } catch (err) {
            return handleError(err, 'save plan');
        } finally {
            setLoading(false);
        }
    }, [userId, currentPlanData, handleError, clearError]);

    const refreshPlans = useCallback(async () => {
        if (!userId) {
            setSavedPlans([]);
            return;
        }

        setLoading(true);
        clearError();

        try {
            const result = await apiListPlans({ userId });
            setSavedPlans(result.plans || []);
            return result.plans;
        } catch (err) {
            handleError(err, 'load plans list');
            setSavedPlans([]);
            return [];
        } finally {
            setLoading(false);
        }
    }, [userId, handleError, clearError]);

    const loadPlan = useCallback(async (planId) => {
        if (!userId) {
            return handleError(new Error('No user ID available'), 'load plan');
        }

        if (!planId) {
            return handleError(new Error('Plan ID is required'), 'load plan');
        }

        setLoading(true);
        clearError();

        try {
            const result = await apiLoadPlan({ userId, planId });
            
            if (result.data && onPlanLoaded) {
                onPlanLoaded(result.data);
            }
            
            return result.data;
        } catch (err) {
            return handleError(err, 'load plan');
        } finally {
            setLoading(false);
        }
    }, [userId, onPlanLoaded, handleError, clearError]);

    const deletePlan = useCallback(async (planId) => {
        if (!userId) {
            return handleError(new Error('No user ID available'), 'delete plan');
        }

        if (!planId) {
            return handleError(new Error('Plan ID is required'), 'delete plan');
        }

        setLoading(true);
        clearError();

        try {
            const result = await apiDeletePlan({ userId, planId });
            
            if (activePlanId === planId) {
                setActivePlanId(null);
            }
            
            await refreshPlans();
            
            return result;
        } catch (err) {
            return handleError(err, 'delete plan');
        } finally {
            setLoading(false);
        }
    }, [userId, activePlanId, refreshPlans, handleError, clearError]);

    const setActive = useCallback(async (planId) => {
        if (!userId) {
            return handleError(new Error('No user ID available'), 'set active plan');
        }

        if (!planId) {
            return handleError(new Error('Plan ID is required'), 'set active plan');
        }

        setLoading(true);
        clearError();

        try {
            const result = await apiSetActivePlan({ userId, planId });
            setActivePlanId(planId);
            return result;
        } catch (err) {
            return handleError(err, 'set active plan');
        } finally {
            setLoading(false);
        }
    }, [userId, handleError, clearError]);

    useEffect(() => {
        if (userId) {
            refreshPlans();
        } else {
            setSavedPlans([]);
            setActivePlanId(null);
        }
    }, [userId, refreshPlans]);

    return {
        savedPlans,
        activePlanId,
        loading,
        error,
        lastSavedAt,
        clearError,
        saveCurrentPlan: saveCurrentPlanToBackend,
        loadCurrentPlan,
        savePlan,
        loadPlan,
        deletePlan,
        setActive,
        refreshPlans
    };
};

export default usePlans;