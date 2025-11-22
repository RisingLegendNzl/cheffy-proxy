// web/src/hooks/usePlanPersistence.js
// Custom hook for meal plan persistence
// Provides state management and operations for saving/loading plans

import { useState, useEffect, useCallback, useRef } from 'react';
import planPersistenceService from '../services/planPersistenceService';

/**
 * usePlanPersistence Hook
 * Manages plan persistence state and operations
 */
export const usePlanPersistence = ({
  userId,
  currentPlanData,
  onPlanLoaded,
  onShowToast,
  autoSaveEnabled = true,
  autoSaveDelay = 5000 // 5 seconds
}) => {
  // --- State ---
  const [savedPlans, setSavedPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Auto-save timer ref
  const autoSaveTimerRef = useRef(null);
  const lastSavedDataRef = useRef(null);

  // --- Auto-save Logic ---
  const autoSave = useCallback(async () => {
    if (!userId || !currentPlanData || !autoSaveEnabled) return;
    
    // Check if data has changed
    const dataString = JSON.stringify(currentPlanData);
    if (dataString === lastSavedDataRef.current) {
      return; // No changes to save
    }

    try {
      setIsSaving(true);
      const result = await planPersistenceService.saveCurrentPlan(userId, currentPlanData);
      
      if (result.success) {
        lastSavedDataRef.current = dataString;
        setLastSaveTime(new Date());
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      console.error('[usePlanPersistence] Auto-save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [userId, currentPlanData, autoSaveEnabled]);

  // --- Setup Auto-save Timer ---
  useEffect(() => {
    if (!currentPlanData || !autoSaveEnabled) return;

    // Mark as having unsaved changes
    setHasUnsavedChanges(true);

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer
    autoSaveTimerRef.current = setTimeout(() => {
      autoSave();
    }, autoSaveDelay);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [currentPlanData, autoSave, autoSaveDelay, autoSaveEnabled]);

  // --- Load Saved Plans ---
  const loadSavedPlans = useCallback(async () => {
    if (!userId) return;

    try {
      setIsLoading(true);
      const result = await planPersistenceService.listSavedPlans(userId);
      
      if (result.success) {
        setSavedPlans(result.plans || []);
        
        // Find active plan
        const activePlan = result.plans?.find(p => p.isActive);
        if (activePlan) {
          setActivePlanId(activePlan.planId);
        }
      }
    } catch (error) {
      console.error('[usePlanPersistence] Failed to load saved plans:', error);
      onShowToast?.('Failed to load saved plans', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [userId, onShowToast]);

  // --- Save Named Plan ---
  const saveNamedPlan = useCallback(async (name) => {
    if (!userId || !currentPlanData || !name) {
      onShowToast?.('Please provide a name for the plan', 'error');
      return false;
    }

    try {
      setIsSaving(true);
      const result = await planPersistenceService.saveNamedPlan(userId, name, currentPlanData);
      
      if (result.success) {
        onShowToast?.(result.message, 'success');
        
        // Refresh the saved plans list
        await loadSavedPlans();
        
        return result.planId;
      }
    } catch (error) {
      console.error('[usePlanPersistence] Failed to save named plan:', error);
      onShowToast?.('Failed to save plan', 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [userId, currentPlanData, onShowToast, loadSavedPlans]);

  // --- Load Plan ---
  const loadPlan = useCallback(async (planId) => {
    if (!userId || !planId) return false;

    try {
      setIsLoading(true);
      const result = await planPersistenceService.loadSavedPlan(userId, planId);
      
      if (result.success && result.plan) {
        // Call the parent's onPlanLoaded callback
        onPlanLoaded?.(result.plan);
        
        // Mark as active
        await setAsActivePlan(planId);
        
        onShowToast?.('Plan loaded successfully', 'success');
        return true;
      }
    } catch (error) {
      console.error('[usePlanPersistence] Failed to load plan:', error);
      onShowToast?.('Failed to load plan', 'error');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [userId, onPlanLoaded, onShowToast]);

  // --- Delete Plan ---
  const deletePlan = useCallback(async (planId) => {
    if (!userId || !planId) return false;

    try {
      setIsLoading(true);
      const result = await planPersistenceService.deleteSavedPlan(userId, planId);
      
      if (result.success) {
        onShowToast?.(result.message, 'success');
        
        // Refresh the saved plans list
        await loadSavedPlans();
        
        // Clear active plan if it was deleted
        if (planId === activePlanId) {
          setActivePlanId(null);
        }
        
        return true;
      }
    } catch (error) {
      console.error('[usePlanPersistence] Failed to delete plan:', error);
      onShowToast?.('Failed to delete plan', 'error');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [userId, activePlanId, onShowToast, loadSavedPlans]);

  // --- Set Active Plan ---
  const setAsActivePlan = useCallback(async (planId) => {
    if (!userId) return false;

    try {
      const result = await planPersistenceService.setActivePlan(userId, planId);
      
      if (result.success) {
        setActivePlanId(planId);
        
        // Update the saved plans list
        setSavedPlans(prev => prev.map(plan => ({
          ...plan,
          isActive: plan.planId === planId
        })));
        
        return true;
      }
    } catch (error) {
      console.error('[usePlanPersistence] Failed to set active plan:', error);
      return false;
    }
  }, [userId]);

  // --- Load Current Plan on Mount ---
  const loadCurrentPlan = useCallback(async () => {
    if (!userId) return;

    try {
      setIsLoading(true);
      const result = await planPersistenceService.getCurrentPlan(userId);
      
      if (result.success && result.plan) {
        onPlanLoaded?.(result.plan);
        setLastSaveTime(new Date(result.plan.savedAt));
        lastSavedDataRef.current = JSON.stringify(result.plan);
        onShowToast?.('Previous plan restored', 'info');
      }
    } catch (error) {
      console.error('[usePlanPersistence] Failed to load current plan:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, onPlanLoaded, onShowToast]);

  // --- Load Active Plan ---
  const loadActivePlan = useCallback(async () => {
    if (!userId) return;

    try {
      setIsLoading(true);
      const result = await planPersistenceService.getActivePlan(userId);
      
      if (result.success && result.plan) {
        onPlanLoaded?.(result.plan);
        onShowToast?.('Active plan loaded', 'success');
        return true;
      }
    } catch (error) {
      console.error('[usePlanPersistence] Failed to load active plan:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [userId, onPlanLoaded, onShowToast]);

  // --- Initialize on userId change ---
  useEffect(() => {
    if (userId) {
      loadSavedPlans();
    }
  }, [userId, loadSavedPlans]);

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // --- Format Last Save Time ---
  const getLastSaveDisplay = useCallback(() => {
    if (isSaving) return 'Saving...';
    if (!lastSaveTime) return '';
    
    const now = new Date();
    const diff = Math.floor((now - lastSaveTime) / 1000);
    
    if (diff < 60) return 'Saved just now';
    if (diff < 3600) return `Saved ${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `Saved ${Math.floor(diff / 3600)} hours ago`;
    return `Saved on ${lastSaveTime.toLocaleDateString()}`;
  }, [lastSaveTime, isSaving]);

  return {
    // State
    savedPlans,
    activePlanId,
    isLoading,
    isSaving,
    lastSaveTime,
    hasUnsavedChanges,
    
    // Operations
    saveNamedPlan,
    loadPlan,
    deletePlan,
    setAsActivePlan,
    loadCurrentPlan,
    loadActivePlan,
    loadSavedPlans,
    autoSave,
    
    // Utilities
    getLastSaveDisplay
  };
};

export default usePlanPersistence;