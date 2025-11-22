// web/src/services/planPersistence.js
// Service layer for meal plan persistence
// Handles API validation calls and Firestore operations

import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, orderBy } from 'firebase/firestore';

const API_BASE = import.meta.env.VITE_API_BASE || '';

/**
 * Validate request with backend before performing Firestore operation
 * @param {string} action - Action to validate
 * @param {string} userId - User ID
 * @param {object} payload - Additional data for validation
 * @returns {Promise<boolean>} - Whether validation succeeded
 */
const validateWithBackend = async (action, userId, payload = {}) => {
    try {
        const response = await fetch(`${API_BASE}/api/plans`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action,
                userId,
                ...payload
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[PLAN_SERVICE] Validation failed:', errorData);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[PLAN_SERVICE] Validation error:', error);
        return false;
    }
};

/**
 * Save a meal plan to Firestore
 * @param {object} params - Save parameters
 * @param {string} params.userId - User ID
 * @param {object} params.db - Firestore instance
 * @param {string} params.planName - Name for the plan
 * @param {array} params.mealPlan - Meal plan data
 * @param {object} params.results - Product results
 * @param {array} params.uniqueIngredients - Shopping list
 * @param {object} params.formData - Generation parameters
 * @param {object} params.nutritionalTargets - Nutritional targets
 * @returns {Promise<object>} - Saved plan with ID
 */
export const savePlan = async ({
    userId,
    db,
    planName,
    mealPlan,
    results,
    uniqueIngredients,
    formData,
    nutritionalTargets
}) => {
    if (!userId || !db) {
        throw new Error('Missing userId or database instance');
    }

    if (!mealPlan || mealPlan.length === 0) {
        throw new Error('Cannot save empty meal plan');
    }

    const planData = {
        mealPlan,
        results: results || {},
        uniqueIngredients: uniqueIngredients || [],
        formData: formData || {},
        nutritionalTargets: nutritionalTargets || {}
    };

    // Validate with backend
    const isValid = await validateWithBackend('save', userId, { planData, planName });
    if (!isValid) {
        throw new Error('Plan validation failed');
    }

    // Generate plan ID and save to Firestore
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const planDoc = {
        planId,
        name: planName || `Plan ${new Date().toLocaleDateString()}`,
        mealPlan,
        results: results || {},
        uniqueIngredients: uniqueIngredients || [],
        formData: formData || {},
        nutritionalTargets: nutritionalTargets || {},
        createdAt: new Date().toISOString(),
        isActive: false
    };

    const planRef = doc(db, 'plans', userId, 'saved_plans', planId);
    await setDoc(planRef, planDoc);

    console.log('[PLAN_SERVICE] Plan saved successfully:', planId);
    return planDoc;
};

/**
 * Load a meal plan from Firestore
 * @param {object} params - Load parameters
 * @param {string} params.userId - User ID
 * @param {object} params.db - Firestore instance
 * @param {string} params.planId - Plan ID to load
 * @returns {Promise<object>} - Loaded plan data
 */
export const loadPlan = async ({ userId, db, planId }) => {
    if (!userId || !db || !planId) {
        throw new Error('Missing required parameters');
    }

    // Validate with backend
    const isValid = await validateWithBackend('load', userId, { planId });
    if (!isValid) {
        throw new Error('Plan load validation failed');
    }

    // Load from Firestore
    const planRef = doc(db, 'plans', userId, 'saved_plans', planId);
    const planSnap = await getDoc(planRef);

    if (!planSnap.exists()) {
        throw new Error('Plan not found');
    }

    console.log('[PLAN_SERVICE] Plan loaded successfully:', planId);
    return planSnap.data();
};

/**
 * List all saved plans for a user
 * @param {object} params - List parameters
 * @param {string} params.userId - User ID
 * @param {object} params.db - Firestore instance
 * @returns {Promise<array>} - Array of saved plans
 */
export const listPlans = async ({ userId, db }) => {
    if (!userId || !db) {
        throw new Error('Missing userId or database instance');
    }

    // Validate with backend
    const isValid = await validateWithBackend('list', userId);
    if (!isValid) {
        throw new Error('Plan list validation failed');
    }

    // Query Firestore
    const plansRef = collection(db, 'plans', userId, 'saved_plans');
    const q = query(plansRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    const plans = [];
    querySnapshot.forEach((doc) => {
        plans.push(doc.data());
    });

    console.log('[PLAN_SERVICE] Plans listed:', plans.length);
    return plans;
};

/**
 * Delete a saved plan
 * @param {object} params - Delete parameters
 * @param {string} params.userId - User ID
 * @param {object} params.db - Firestore instance
 * @param {string} params.planId - Plan ID to delete
 * @returns {Promise<void>}
 */
export const deletePlan = async ({ userId, db, planId }) => {
    if (!userId || !db || !planId) {
        throw new Error('Missing required parameters');
    }

    // Validate with backend
    const isValid = await validateWithBackend('delete', userId, { planId });
    if (!isValid) {
        throw new Error('Plan deletion validation failed');
    }

    // Delete from Firestore
    const planRef = doc(db, 'plans', userId, 'saved_plans', planId);
    await deleteDoc(planRef);

    console.log('[PLAN_SERVICE] Plan deleted successfully:', planId);
};

/**
 * Set a plan as active
 * @param {object} params - Set active parameters
 * @param {string} params.userId - User ID
 * @param {object} params.db - Firestore instance
 * @param {string} params.planId - Plan ID to set as active
 * @returns {Promise<void>}
 */
export const setActivePlan = async ({ userId, db, planId }) => {
    if (!userId || !db) {
        throw new Error('Missing userId or database instance');
    }

    // Validate with backend
    const isValid = await validateWithBackend('set-active', userId, { planId });
    if (!isValid) {
        throw new Error('Set active plan validation failed');
    }

    // Get all plans and update isActive flag
    const plansRef = collection(db, 'plans', userId, 'saved_plans');
    const querySnapshot = await getDocs(plansRef);

    const updatePromises = [];
    querySnapshot.forEach((planDoc) => {
        const data = planDoc.data();
        const shouldBeActive = data.planId === planId;
        if (data.isActive !== shouldBeActive) {
            updatePromises.push(
                setDoc(doc(db, 'plans', userId, 'saved_plans', data.planId), {
                    ...data,
                    isActive: shouldBeActive
                })
            );
        }
    });

    await Promise.all(updatePromises);
    console.log('[PLAN_SERVICE] Active plan set:', planId);
};

/**
 * Get the currently active plan
 * @param {object} params - Get active parameters
 * @param {string} params.userId - User ID
 * @param {object} params.db - Firestore instance
 * @returns {Promise<object|null>} - Active plan or null
 */
export const getActivePlan = async ({ userId, db }) => {
    if (!userId || !db) {
        return null;
    }

    try {
        const plansRef = collection(db, 'plans', userId, 'saved_plans');
        const querySnapshot = await getDocs(plansRef);

        let activePlan = null;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.isActive) {
                activePlan = data;
            }
        });

        if (activePlan) {
            console.log('[PLAN_SERVICE] Active plan found:', activePlan.planId);
        }

        return activePlan;
    } catch (error) {
        console.error('[PLAN_SERVICE] Error getting active plan:', error);
        return null;
    }
};