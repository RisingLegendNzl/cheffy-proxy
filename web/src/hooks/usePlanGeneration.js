// web/src/hooks/usePlanGeneration.js
import { useState, useCallback, useMemo } from 'react';

// Configuration
const ORCHESTRATOR_TARGETS_API_URL = '/api/plan/targets';
const ORCHESTRATOR_DAY_API_URL = '/api/plan/day';
const ORCHESTRATOR_FULL_PLAN_API_URL = '/api/plan/generate-full-plan';
const MOCK_PRODUCT_TEMPLATE = {
    name: "Placeholder (API DOWN)", 
    brand: "MOCK DATA", 
    price: 15.99, 
    size: "1kg",
    url: "#api_down_mock_product", 
    unit_price_per_100: 1.59,
};

// SSE Stream Parser
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
        
        const messageLines = message.split('\n');
        for (const line of messageLines) {
            if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
                eventData += line.slice(6);
            }
        }
        
        if (eventData) {
            try {
                const parsed = JSON.parse(eventData);
                events.push({ type: eventType, data: parsed });
            } catch (e) {
                console.error('Failed to parse SSE data:', eventData, e);
            }
        }
    }
    
    return { events, newBuffer: lines[lines.length - 1] };
}

/**
 * Custom hook for managing meal plan generation
 * Handles both batched and per-day generation modes
 */
export const usePlanGeneration = (formData, nutritionalTargets, appId) => {
    // State
    const [results, setResults] = useState({});
    const [uniqueIngredients, setUniqueIngredients] = useState([]);
    const [mealPlan, setMealPlan] = useState([]);
    const [totalCost, setTotalCost] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [diagnosticLogs, setDiagnosticLogs] = useState([]);
    const [failedIngredientsHistory, setFailedIngredientsHistory] = useState([]);
    const [generationStepKey, setGenerationStepKey] = useState(null);
    const [useBatchedMode, setUseBatchedMode] = useState(true);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const [logHeight, setLogHeight] = useState(250);
    const minLogHeight = 50;

    // Recalculate total cost from results
    const recalculateTotalCost = useCallback(() => {
        const allProducts = Object.values(results).flatMap(dayData => {
            if (!dayData) return [];
            if (dayData.products) return dayData.products;
            if (dayData.allProducts) {
                const selected = dayData.allProducts.find(p => p && p.url === dayData.currentSelectionURL);
                return selected ? [selected] : [];
            }
            return [];
        });
        const cost = allProducts.reduce((sum, product) => sum + (product.price || 0), 0);
        setTotalCost(cost);
    }, [results]);

    // Latest log memo
    const latestLog = useMemo(() => {
        if (diagnosticLogs.length === 0) return null;
        return diagnosticLogs[diagnosticLogs.length - 1];
    }, [diagnosticLogs]);

    // Categorized results memo
    const categorizedResults = useMemo(() => {
        const groups = {};
        Object.entries(results || {}).forEach(([normalizedKey, item]) => {
            if (item && item.originalIngredient && 
                (item.source === 'discovery' || item.source === 'failed' || 
                 item.source === 'error' || item.source === 'canonical_fallback')) {
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

    // Invalid meals check
    const hasInvalidMeals = useMemo(() => {
        if (!mealPlan || mealPlan.length === 0) return false;
        return mealPlan.some(dayPlan =>
            !dayPlan || !Array.isArray(dayPlan.meals) || dayPlan.meals.some(meal =>
                !meal || typeof meal.subtotal_kcal !== 'number' || meal.subtotal_kcal <= 0
            )
        );
    }, [mealPlan]);

    // Day calories map
    const dayCaloriesMap = useMemo(() => {
        const map = {};
        if (mealPlan && mealPlan.length > 0) {
            mealPlan.forEach((dayPlan, idx) => {
                const dayNum = idx + 1;
                if (dayPlan && Array.isArray(dayPlan.meals)) {
                    map[dayNum] = dayPlan.meals.reduce((sum, meal) => 
                        sum + (meal.subtotal_kcal || 0), 0
                    );
                }
            });
        }
        return map;
    }, [mealPlan]);

    // Main generation handler - BATCHED MODE
    const handleGeneratePlan = useCallback(async (onSuccess, onError) => {
        setLoading(true);
        setError(null);
        setDiagnosticLogs([]);
        setResults({});
        setUniqueIngredients([]);
        setMealPlan([]);
        setTotalCost(0);
        setFailedIngredientsHistory([]);
        setGenerationStepKey('targets');
        if (!isLogOpen) { 
            setLogHeight(250); 
            setIsLogOpen(true); 
        }

        let targets = nutritionalTargets;

        // Fetch targets if not already set
        if (!targets || targets.calories === 0) {
            try {
                const targetsResponse = await fetch(ORCHESTRATOR_TARGETS_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData),
                });

                if (!targetsResponse.ok) {
                    const errorData = await targetsResponse.json();
                    throw new Error(`Failed to calculate targets: ${errorData.message || targetsResponse.statusText}`);
                }

                const targetsData = await targetsResponse.json();
                targets = targetsData.nutritionalTargets;
                setDiagnosticLogs(prev => [...prev, ...(targetsData.logs || [])]);
                
                // Notify parent to update targets
                if (onSuccess && targetsData.nutritionalTargets) {
                    onSuccess({ type: 'targets', data: targetsData.nutritionalTargets });
                }
                
            } catch (err) {
                console.error("Plan generation failed at Targets:", err);
                setError(`Critical failure: ${err.message}`);
                setGenerationStepKey('error');
                setLoading(false);
                setDiagnosticLogs(prev => [...prev, {
                    timestamp: new Date().toISOString(), 
                    level: 'CRITICAL', 
                    tag: 'FRONTEND', 
                    message: `Critical failure: ${err.message}`
                }]);
                if (onError) onError(err);
                return;
            }
        }

        // Batched Mode
        if (useBatchedMode) {
            try {
                setGenerationStepKey('planning');
                
                const response = await fetch(ORCHESTRATOR_FULL_PLAN_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...formData,
                        nutritionalTargets: targets,
                        app_id: appId
                    }),
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const { events, newBuffer } = processSseChunk(value, buffer, decoder);
                    buffer = newBuffer;

                    for (const event of events) {
                        const eventData = event.data;

                        switch (event.type) {
                            case 'log':
                                setDiagnosticLogs(prev => [...prev, eventData]);
                                
                                // Update step based on log tags
                                if (eventData.tag === 'PHASE' && eventData.message.includes('targets calculated')) {
                                    setGenerationStepKey('targets');
                                } else if (eventData.tag === 'LLM' || eventData.tag === 'LLM_PROMPT' || eventData.tag === 'LLM_CHEF') {
                                    setGenerationStepKey('planning');
                                } else if (eventData.tag === 'MARKET_RUN' || eventData.tag === 'CHECKLIST') {
                                    setGenerationStepKey('market');
                                } else if (eventData.tag === 'CALC' || eventData.tag === 'CANON' || eventData.tag === 'DATA') {
                                    setGenerationStepKey('finalizing');
                                }
                                break;

                            case 'day_complete':
                                const completedDay = eventData.day;
                                const completedData = eventData.data;
                                
                                setResults(prev => ({
                                    ...prev,
                                    [completedDay]: completedData
                                }));
                                
                                if (completedData.products) {
                                    recalculateTotalCost();
                                }
                                break;

                            case 'complete':
                                setResults(eventData.fullResults || {});
                                setUniqueIngredients(eventData.uniqueIngredients || []);
                                setMealPlan(eventData.mealPlan || []);
                                if (eventData.totalCost) setTotalCost(eventData.totalCost);
                                if (eventData.failedIngredients && eventData.failedIngredients.length > 0) {
                                    setFailedIngredientsHistory(eventData.failedIngredients);
                                }
                                setGenerationStepKey('complete');
                                
                                // Notify parent of completion
                                if (onSuccess) {
                                    onSuccess({ 
                                        type: 'complete', 
                                        data: {
                                            mealPlan: eventData.mealPlan,
                                            uniqueIngredients: eventData.uniqueIngredients,
                                            totalCost: eventData.totalCost
                                        }
                                    });
                                }
                                break;

                            case 'error':
                                throw new Error(eventData.message || 'Unknown backend error');
                        }
                    }
                }
                
            } catch (err) {
                console.error("Batched plan generation failed:", err);
                setError(`Critical failure: ${err.message}`);
                setGenerationStepKey('error');
                setDiagnosticLogs(prev => [...prev, {
                    timestamp: new Date().toISOString(), 
                    level: 'CRITICAL', 
                    tag: 'FRONTEND', 
                    message: `Critical failure: ${err.message}`
                }]);
                if (onError) onError(err);
            } finally {
                setTimeout(() => setLoading(false), 2000);
            }
        } else {
            // Per-day mode (legacy)
            try {
                setGenerationStepKey('planning');
                const allResults = {};
                const allMealsFlat = [];

                for (let day = 1; day <= parseInt(formData.days); day++) {
                    const response = await fetch(ORCHESTRATOR_DAY_API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...formData,
                            day,
                            nutritionalTargets: targets,
                            app_id: appId
                        }),
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    let dayResults = {};

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const { events, newBuffer } = processSseChunk(value, buffer, decoder);
                        buffer = newBuffer;

                        for (const event of events) {
                            const eventData = event.data;

                            switch (event.type) {
                                case 'log':
                                    setDiagnosticLogs(prev => [...prev, eventData]);
                                    
                                    if (eventData.tag === 'LLM' || eventData.tag === 'LLM_PROMPT') {
                                        setGenerationStepKey('planning');
                                    } else if (eventData.tag === 'MARKET_RUN' || eventData.tag === 'CHECKLIST') {
                                        setGenerationStepKey('market');
                                    } else if (eventData.tag === 'CALC' || eventData.tag === 'CANON') {
                                        setGenerationStepKey('finalizing');
                                    }
                                    break;

                                case 'ingredient':
                                    const ingredientKey = eventData.normalized_name || eventData.original || `ingredient_${Object.keys(dayResults).length}`;
                                    dayResults[ingredientKey] = eventData;
                                    break;

                                case 'mealplan':
                                    if (eventData.meals && Array.isArray(eventData.meals)) {
                                        allMealsFlat.push({
                                            day,
                                            meals: eventData.meals,
                                            subtotal_kcal: eventData.subtotal_kcal,
                                            subtotal_protein: eventData.subtotal_protein,
                                            subtotal_carbs: eventData.subtotal_carbs,
                                            subtotal_fat: eventData.subtotal_fat,
                                        });
                                    }
                                    break;

                                case 'failed':
                                    if (eventData.failed && Array.isArray(eventData.failed)) {
                                        setFailedIngredientsHistory(prev => [...prev, ...eventData.failed]);
                                    }
                                    break;

                                case 'complete':
                                    // Day complete
                                    break;

                                case 'error':
                                    throw new Error(eventData.message || 'Unknown error');
                            }
                        }
                    }

                    Object.assign(allResults, dayResults);
                    setResults({ ...allResults });
                }

                setMealPlan(allMealsFlat);
                setGenerationStepKey('complete');
                recalculateTotalCost();

                if (onSuccess) {
                    onSuccess({ 
                        type: 'complete', 
                        data: { mealPlan: allMealsFlat }
                    });
                }

            } catch (err) {
                console.error("Per-day plan generation failed:", err);
                setError(`Critical failure: ${err.message}`);
                setGenerationStepKey('error');
                setDiagnosticLogs(prev => [...prev, {
                    timestamp: new Date().toISOString(), 
                    level: 'CRITICAL', 
                    tag: 'FRONTEND', 
                    message: `Critical failure: ${err.message}`
                }]);
                if (onError) onError(err);
            } finally {
                setTimeout(() => setLoading(false), 2000);
            }
        }
    }, [formData, nutritionalTargets, appId, useBatchedMode, isLogOpen, recalculateTotalCost]);

    // Handle substitute selection
    const handleSubstituteSelection = useCallback((ingredientKey, newProductUrl) => {
        setResults(prev => {
            const updated = { ...prev };
            if (updated[ingredientKey]) {
                updated[ingredientKey] = {
                    ...updated[ingredientKey],
                    currentSelectionURL: newProductUrl,
                };
            }
            return updated;
        });
        recalculateTotalCost();
    }, [recalculateTotalCost]);

    // Handle quantity change
    const handleQuantityChange = useCallback((ingredientKey, newQuantity) => {
        setResults(prev => {
            const updated = { ...prev };
            if (updated[ingredientKey]) {
                updated[ingredientKey] = {
                    ...updated[ingredientKey],
                    quantity: newQuantity,
                };
            }
            return updated;
        });
        recalculateTotalCost();
    }, [recalculateTotalCost]);

    // Download logs
    const handleDownloadLogs = useCallback(() => {
        const logsText = diagnosticLogs.map(log => 
            `[${log.timestamp}] [${log.level}] [${log.tag}] ${log.message}`
        ).join('\n');
        
        const blob = new Blob([logsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cheffy-logs-${new Date().toISOString()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }, [diagnosticLogs]);

    // Download failed logs
    const handleDownloadFailedLogs = useCallback(() => {
        const logsText = JSON.stringify(failedIngredientsHistory, null, 2);
        const blob = new Blob([logsText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cheffy-failed-ingredients-${new Date().toISOString()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [failedIngredientsHistory]);

    return {
        // State
        results,
        uniqueIngredients,
        mealPlan,
        totalCost,
        loading,
        error,
        diagnosticLogs,
        failedIngredientsHistory,
        generationStepKey,
        useBatchedMode,
        isLogOpen,
        logHeight,
        minLogHeight,
        
        // Computed
        latestLog,
        categorizedResults,
        hasInvalidMeals,
        dayCaloriesMap,
        
        // Actions
        generatePlan: handleGeneratePlan,
        handleSubstituteSelection,
        handleQuantityChange,
        handleDownloadLogs,
        handleDownloadFailedLogs,
        setUseBatchedMode,
        setIsLogOpen,
        setLogHeight,
        setResults,
        setTotalCost,
    };
};

export default usePlanGeneration;