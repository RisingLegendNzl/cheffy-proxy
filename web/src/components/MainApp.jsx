// web/src/components/MainApp.jsx
import React, { useState, useCallback } from 'react'; // ADDED: useState, useCallback import
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Package, DollarSign, ExternalLink, Calendar, Users, Menu, X, ChevronsDown, ChevronsUp, ShoppingBag, BookOpen, ChefHat, Tag, Soup, Replace, Target, FileText, LayoutDashboard, Terminal, Loader, ChevronRight, GripVertical, Flame, Droplet, Wheat, ChevronDown, ChevronUp, Download, ListX, Save, FolderDown, User, Check, ListChecks, ListOrdered, Utensils } from 'lucide-react';

// --- New Component Imports ---
import SavePlanModal from './SavePlanModal'; // 2. ADDED: SavePlanModal
import SavedPlansList from './SavedPlansList'; // 2. ADDED: SavedPlansList

// --- Component Imports (Existing) ---
import MacroRing from './MacroRing';
import MacroBar from './MacroBar';
import InputField from './InputField';
import DaySlider from './DaySlider';
import DaySidebar from './DaySidebar';
import ProductCard from './ProductCard';
import CollapsibleSection from './CollapsibleSection';
import SubstituteMenu from './SubstituteMenu';
import GenerationProgressDisplay from './GenerationProgressDisplay';
import NutritionalInfo from './NutritionalInfo';
import IngredientResultBlock from './IngredientResultBlock';
import MealPlanDisplay from './MealPlanDisplay';
import LogEntry from './LogEntry';
import DiagnosticLogViewer from './DiagnosticLogViewer';
import FailedIngredientLogViewer from './FailedIngredientLogViewer';
import RecipeModal from './RecipeModal';
import EmojiIcon from './EmojiIcon';
import ProfileTab from './ProfileTab';

// Phase 2 imports
import Header from './Header';
import { ToastContainer } from './Toast';
import EmptyState from './EmptyState';
import LoadingOverlay from './LoadingOverlay';
import SuccessModal from './SuccessModal';
import MealCard from './MealCard';
import DayNavigator from './DayNavigator';
import ShoppingListEnhanced from './ShoppingListEnhanced';
import FormSection from './FormSection';
import SettingsPanel from './SettingsPanel';
import BottomNav from './BottomNav';
import { MealCardSkeleton, ProfileCardSkeleton, ShoppingListSkeleton } from './SkeletonLoader';
import PullToRefresh from './PullToRefresh';

// --- Category Icon Map ---
const categoryIconMap = {
    'produce': <EmojiIcon code="1f966" alt="produce" />,
    'fruit': <EmojiIcon code="1f353" alt="fruit" />,
    'veg': <EmojiIcon code="1f955" alt="veg" />,
    'grains': <EmojiIcon code="1f33e" alt="grains" />,
    'carb': <EmojiIcon code="1f33e" alt="grains" />,
    'meat': <EmojiIcon code="1f969" alt="meat" />,
    'protein': <EmojiIcon code="1f969" alt="meat" />,
    'seafood': <EmojiIcon code="1f41f" alt="seafood" />,
    'dairy': <EmojiIcon code="1f95b" alt="dairy" />,
    'fat': <EmojiIcon code="1f951" alt="fat" />,
    'drinks': <EmojiIcon code="1f9c3" alt="drinks" />,
    'pantry': <EmojiIcon code="1f968" alt="pantry" />,
    'canned': <EmojiIcon code="1f96b" alt="canned" />,
    'spreads': <EmojiIcon code="1f95c" alt="spreads" />,
    'condiments': <EmojiIcon code="1f9c2" alt="condiments" />,
    'bakery': <EmojiIcon code="1f370" alt="bakery" />,
    'frozen': <EmojiIcon code="2744" alt="frozen" />,
    'snacks': <EmojiIcon code="1f36b" alt="snacks" />, 
    'misc': <EmojiIcon code="1f36b" alt="snacks" />,
    'uncategorized': <EmojiIcon code="1f6cd" alt="shopping" />,
    'default': <EmojiIcon code="1f6cd" alt="shopping" />
};

/**
 * MainApp - Pure presentational component
 * Receives all data and handlers via props
 * Renders the main application UI
 */
const MainApp = (logic) => {
    
    // --- Local State (4. ADDED) ---
    const [isSavePlanOpen, setIsSavePlanOpen] = useState(false);
    const [isSavedPlansOpen, setIsSavedPlansOpen] = useState(false);
    
    // --- Destructuring Logic (3. ADDED: plans) ---
    const { 
        // User & Auth
        userId,
        isAuthReady,
        firebaseConfig,
        firebaseInitializationError,
        
        // Form Data
        formData,
        handleChange,
        handleSliderChange,
        
        // Nutritional Targets
        nutritionalTargets,
        
        // Results & Plan
        results,
        uniqueIngredients,
        mealPlan,
        totalCost,
        categorizedResults,
        hasInvalidMeals,
        
        // UI State
        loading,
        error,
        eatenMeals,
        selectedDay,
        setSelectedDay,
        contentView,
        setContentView,
        isMenuOpen,
        setIsMenuOpen,
        
        // Logs
        diagnosticLogs,
        showOrchestratorLogs,
        setShowOrchestratorLogs,
        showFailedIngredientsLogs,
        setShowFailedIngredientsLogs,
        failedIngredientsHistory,
        logHeight,
        setLogHeight,
        isLogOpen,
        setIsLogOpen,
        latestLog,
        
        // Generation State
        generationStepKey,
        generationStatus,
        
        // Nutrition Cache
        nutritionCache,
        loadingNutritionFor,
        
        // Modal State
        selectedMeal,
        setSelectedMeal,
        showSuccessModal,
        setShowSuccessModal,
        planStats,
        
        // Settings
        isSettingsOpen,
        setIsSettingsOpen,
        useBatchedMode,
        setUseBatchedMode,
        
        // Toasts
        toasts,
        removeToast,
        
        // Handlers
        handleGeneratePlan,
        handleLoadProfile,
        handleSaveProfile,
        handleFetchNutrition,
        handleSubstituteSelection,
        handleQuantityChange,
        handleDownloadFailedLogs,
        handleDownloadLogs,
        onToggleMealEaten,
        handleRefresh,
        handleEditProfile,
        handleSignOut,
        showToast,
        
        // Responsive
        isMobile,
        isDesktop,

        // 3. ADDED: Plans hook
        plans,
    } = logic || {};

    // --- Plans Handlers (5. ADDED) ---
    const handleOpenSavePlan = useCallback(() => {
        if (!plans) return;
        setIsSavePlanOpen(true);
    }, [plans]);

    const handleOpenSavedPlans = useCallback(() => {
        if (!plans) return;
        // Refresh list when opening
        plans.refreshPlans && plans.refreshPlans();
        setIsSavedPlansOpen(true);
    }, [plans]);

    const handleSavePlan = useCallback(async (name) => {
        if (!plans || !plans.savePlan) return;
        const result = await plans.savePlan(name);
        if (!result?.error) {
            setIsSavePlanOpen(false);
            showToast && showToast('Plan saved successfully!', 'success');
        }
    }, [plans, showToast]);

    const handleLoadPlan = useCallback(async (planId) => {
        if (!plans || !plans.loadPlan) return;
        const result = await plans.loadPlan(planId);
        if (!result?.error) {
            setIsSavedPlansOpen(false);
            showToast && showToast('Plan loaded', 'success');
        }
    }, [plans, showToast]);

    const handleDeletePlan = useCallback(async (planId) => {
        if (!plans || !plans.deletePlan) return;
        const result = await plans.deletePlan(planId);
        if (!result?.error) {
            showToast && showToast('Plan deleted', 'info');
        }
    }, [plans, showToast]);

    const handleSetActivePlan = useCallback(async (planId) => {
        if (!plans || !plans.setActive) return;
        const result = await plans.setActive(planId);
        if (!result?.error) {
            showToast && showToast('Active plan updated', 'success');
        }
    }, [plans, showToast]);
    
    const PlanCalculationErrorPanel = () => (
        <div className="p-6 text-center bg-red-100 text-red-800 rounded-lg shadow-lg m-4">
            <AlertTriangle className="inline mr-2 w-8 h-8" />
            <h3 className="text-xl font-bold">Plan Calculation Error</h3>
            <p className="mt-2">A critical error occurred while calculating meal nutrition. The generated plan is incomplete and cannot be displayed. Please check the logs for details.</p>
        </div>
    );

    const priceComparisonContent = (
        <div className="space-y-0 p-4">
            {error && !loading && (
                 <div className="p-4 bg-red-50 text-red-800 rounded-lg">
                    <AlertTriangle className="inline w-6 h-6 mr-2" />
                    <strong>Error(s) occurred during plan generation:</strong>
                    <pre className="mt-2 whitespace-pre-wrap text-sm">{error}</pre>
                 </div>
            )}

            {!loading && Object.keys(results).length > 0 && (
                <>
                    <div className="bg-white p-4 rounded-xl shadow-md border-t-4 border-indigo-600 mb-6">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xl font-bold flex items-center"><DollarSign className="w-5 h-5 mr-2"/> Total Estimated Cost</h3>
                            <p className="text-3xl font-extrabold text-green-700">${totalCost.toFixed(2)}</p>
                        </div>
                        <p className="text-sm text-gray-500">Cost reflects selected products multiplied by units purchased from {formData.store}.</p>
                    </div>

                    <div className="bg-white rounded-xl shadow-lg border overflow-hidden">
                        {Object.keys(categorizedResults).map((category, index) => (
                            <CollapsibleSection
                                key={category}
                                title={`${category} (${categorizedResults[category].length})`}
                                icon={categoryIconMap[category.toLowerCase()] || categoryIconMap['default']}
                                defaultOpen={false}
                            >
                                <div className="grid grid-cols-1 gap-6 pt-4">
                                    {categorizedResults[category].map(({ normalizedKey, ingredient, ...result }) => {
                                        if (!result) return null;
                                        const selection = result.allProducts?.find(p => p && p.url === result.currentSelectionURL);
                                        const nutriData = selection ? nutritionCache[selection.url] : null;
                                        const isLoading = selection ? loadingNutritionFor === selection.url : false;
                                        return (
                                            <IngredientResultBlock
                                                key={normalizedKey}
                                                ingredientKey={ingredient}
                                                normalizedKey={normalizedKey}
                                                result={result}
                                                onSelectSubstitute={handleSubstituteSelection}
                                                onQuantityChange={handleQuantityChange}
                                                onFetchNutrition={handleFetchNutrition}
                                                nutritionData={nutriData}
                                                isLoadingNutrition={isLoading}
                                            />
                                        );
                                    })}
                                </div>
                            </CollapsibleSection>
                        ))}
                    </div>
                </>
            )}
            {!loading && Object.keys(results).length === 0 && !error && (
                <div className="p-6 text-center text-gray-500">Generate a plan to see results.</div>
            )}
        </div>
    );
    
    const mealPlanContent = (
        <div className="flex flex-col md:flex-row p-4 gap-6">
            {mealPlan.length > 0 && (
                <div className="sticky top-4 z-20 self-start w-full md:w-auto mb-4 md:mb-0 bg-white/90 backdrop-blur-md rounded-2xl border border-gray-100/50 p-5 shadow-lg">
                    <DaySidebar days={Math.max(1, mealPlan.length)} selectedDay={selectedDay} onSelect={setSelectedDay} />
                </div>
            )}
            <div className="flex-1">
                {mealPlan.length > 0 && selectedDay >= 1 && selectedDay <= mealPlan.length ? (
                    <MealPlanDisplay
                        key={selectedDay}
                        mealPlan={mealPlan}
                        selectedDay={selectedDay}
                        nutritionalTargets={nutritionalTargets}
                        eatenMeals={eatenMeals}
                        onToggleMealEaten={onToggleMealEaten}
                        onViewRecipe={setSelectedMeal} 
                    />
                ) : (
                    <div className="flex-1 text-center p-8 text-gray-500">
                        {error && !loading ? (
                            <div className="p-4 bg-red-50 text-red-800 rounded-lg">
                                <AlertTriangle className="inline w-6 h-6 mr-2" />
                                <strong>Error generating plan. Check logs for details.</strong>
                                <pre className="mt-2 whitespace-pre-wrap text-sm">{error}</pre>
                            </div>
                        ) : mealPlan.length === 0 && !loading ? (
                            'Generate a plan to see your meals.'
                        ) : (
                            !loading && 'Select a valid day to view meals.'
                        )}
                    </div>
                )}

                {/* 6. ADDED: Save plan button */}
                {mealPlan && mealPlan.length > 0 && plans && (
                    <button
                        type="button"
                        onClick={handleOpenSavePlan}
                        className="mt-4 w-full py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition duration-150 ease-in-out"
                    >
                        <Save className="inline-block w-5 h-5 mr-2" /> Save this plan
                    </button>
                )}
            </div>
        </div>
    );

    const totalLogHeight = (failedIngredientsHistory.length > 0 ? 60 : 0) + (isLogOpen ? Math.max(50, logHeight) : 50);

    return (
        <>
            <Header 
                userId={userId}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onNavigateToProfile={() => {
                    setContentView('profile');
                    setIsMenuOpen(false);
                }}
                onOpenSavedPlans={handleOpenSavedPlans} // 6. ADDED: My Saved Plans entry point
                onSignOut={handleSignOut}
            />
    
            <PullToRefresh onRefresh={handleRefresh} refreshing={loading}>
                <div 
                    className="min-h-screen bg-gray-100 p-4 md:p-8 transition-all duration-200 relative" 
                    style={{ 
                        paddingTop: '80px',
                        paddingBottom: `${isMobile && results && Object.keys(results).length > 0 ? '6rem' : (Number.isFinite(totalLogHeight) ? totalLogHeight : 50) + 'px'}`
                    }}
                >
                    <div className="max-w-7xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden">
                        <div className="flex flex-col md:flex-row">
                            {/* --- SETUP FORM --- */}
                            <div className={`p-6 md:p-8 w-full md:w-1/2 border-b md:border-r ${isMenuOpen ? 'block' : 'hidden md:block'}`}>
                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-2xl font-bold text-indigo-700">Plan Setup</h2>
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={() => handleLoadProfile(false)} 
                                            disabled={!isAuthReady || !userId || userId.startsWith('local_')} 
                                            className="flex items-center px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="Load Saved Profile"
                                        >
                                            <FolderDown size={14} className="mr-1" /> Load
                                        </button>
                                         <button
                                            onClick={() => handleSaveProfile(false)}
                                            disabled={!isAuthReady || !userId || userId.startsWith('local_')} 
                                            className="flex items-center px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="Save Current Profile"
                                        >
                                            <Save size={14} className="mr-1" /> Save
                                        </button>
                                        <button className="md:hidden p-1.5" onClick={() => setIsMenuOpen(false)}><X /></button>
                                    </div>
                                </div>
                                
                                <form onSubmit={handleGeneratePlan}>
                                    <FormSection 
                                        title="Personal Information" 
                                        icon={User}
                                        description="Tell us about yourself"
                                    >
                                        <InputField label="Name" name="name" value={formData.name} onChange={handleChange} />
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <InputField label="Height (cm)" name="height" type="number" value={formData.height} onChange={handleChange} required />
                                            <InputField label="Weight (kg)" name="weight" type="number" value={formData.weight} onChange={handleChange} required />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <InputField label="Age" name="age" type="number" value={formData.age} onChange={handleChange} required />
                                            <InputField label="Body Fat % (Optional)" name="bodyFat" type="number" value={formData.bodyFat} onChange={handleChange} placeholder="e.g., 15" />
                                        </div>
                                        <InputField label="Gender" name="gender" type="select" value={formData.gender} onChange={handleChange} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} required />
                                    </FormSection>
    
                                    <FormSection 
                                        title="Fitness Goals" 
                                        icon={Target}
                                        description="What are you trying to achieve?"
                                    >
                                        <InputField label="Activity Level" name="activityLevel" type="select" value={formData.activityLevel} onChange={handleChange} options={[ { value: 'sedentary', label: 'Sedentary' }, { value: 'light', label: 'Light Activity' }, { value: 'moderate', label: 'Moderate Activity' }, { value: 'active', label: 'Active' }, { value: 'veryActive', label: 'Very Active' } ]} required />
                                        <InputField label="Fitness Goal" name="goal" type="select" value={formData.goal} onChange={handleChange} options={[ { value: 'maintain', label: 'Maintain' }, { value: 'cut_moderate', label: 'Moderate Cut (~15% Deficit)' }, { value: 'cut_aggressive', label: 'Aggressive Cut (~25% Deficit)' }, { value: 'bulk_lean', label: 'Lean Bulk (~15% Surplus)' }, { value: 'bulk_aggressive', label: 'Aggressive Bulk (~25% Surplus)' } ]} />
                                        <InputField label="Dietary Preference" name="dietary" type="select" value={formData.dietary} onChange={handleChange} options={[{ value: 'None', label: 'None' }, { value: 'Vegetarian', label: 'Vegetarian' }]} />
                                        <DaySlider label="Plan Days" name="days" value={formData.days} onChange={handleSliderChange} />
                                    </FormSection>
    
                                    <FormSection 
                                        title="Meal Preferences" 
                                        icon={Utensils}
                                        description="Customize your meal plan"
                                        collapsible={true}
                                        defaultOpen={false}
                                    >
                                        <InputField label="Store" name="store" type="select" value={formData.store} onChange={handleChange} options={[{ value: 'Coles', label: 'Coles' }, { value: 'Woolworths', label: 'Woolworths' }]} />
                                        <InputField label="Meals Per Day" name="eatingOccasions" type="select" value={formData.eatingOccasions} onChange={handleChange} options={[ { value: '3', label: '3 Meals' }, { value: '4', label: '4 Meals' }, { value: '5', label: '5 Meals' } ]} />
                                        <InputField label="Spending Priority" name="costPriority" type="select" value={formData.costPriority} onChange={handleChange} options={[ { value: 'Extreme Budget', label: 'Extreme Budget' }, { value: 'Best Value', label: 'Best Value' }, { value: 'Quality Focus', label: 'Quality Focus' } ]} />
                                        <InputField label="Meal Variety" name="mealVariety" type="select" value={formData.mealVariety} onChange={handleChange} options={[ { value: 'High Repetition', label: 'High' }, { value: 'Balanced Variety', label: 'Balanced' }, { value: 'Low Repetition', label: 'Low' } ]} />
                                        <InputField label="Cuisine Profile (Optional)" name="cuisine" value={formData.cuisine} onChange={handleChange} placeholder="e.g., Spicy Thai" />
                                    </FormSection>
    
                                    <div className="flex items-center justify-center mt-4 pt-4 border-t">
                                        <input
                                            type="checkbox"
                                            id="batchModeToggle"
                                            name="batchModeToggle"
                                            checked={useBatchedMode}
                                            onChange={(e) => setUseBatchedMode(e.target.checked)}
                                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                        />
                                        <label htmlFor="batchModeToggle" className="ml-2 block text-sm text-gray-900" title="Use the new batched endpoint (v2) instead of the per-day loop (v1)">
                                            Use Batched Generation (v2)
                                        </label>
                                    </div>
    
                                    <button type="submit" disabled={loading || !isAuthReady || !firebaseConfig} className={`w-full flex items-center justify-center py-3 mt-6 text-lg font-bold rounded-xl shadow-lg ${loading || !isAuthReady || !firebaseConfig ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}>
                                        {loading ? <><RefreshCw className="w-5 h-5 mr-3 animate-spin" /> Processing...</> : <><Zap className="w-5 h-5 mr-3" /> Generate Plan</>}
                                    </button>
                                    {(!isAuthReady || !firebaseConfig) && <p className="text-xs text-center text-red-600 mt-2">
                                        {firebaseInitializationError ? firebaseInitializationError : 'Initializing Firebase auth...'}
                                    </p>}
                                </form>
                            </div>
    
                            {/* --- RESULTS VIEW --- */}
                            <div className={`w-full md:w-1/2 ${isMenuOpen ? 'hidden md:block' : 'block'}`}>
                                <div className="border-b">
                                    <div className="p-6 md:p-8">
                                    </div>
                                </div>
    
                                {hasInvalidMeals ? (
                                    <PlanCalculationErrorPanel />
                                ) : (
                                    <div className="p-0">
                                        {loading && (
                                            <div className="p-4 md:p-6">
                                                <GenerationProgressDisplay
                                                    activeStepKey={generationStepKey}
                                                    errorMsg={error}
                                                    latestLog={latestLog} 
                                                />
                                            </div>
                                        )}
                                
                                        {contentView === 'profile' && (
                                            <ProfileTab 
                                                formData={formData} 
                                                nutritionalTargets={nutritionalTargets} 
                                            />
                                        )}
                                        
                                        {contentView === 'meals' && (results && Object.keys(results).length > 0) && mealPlanContent}
                                        {contentView === 'ingredients' && (results && Object.keys(results).length > 0) && priceComparisonContent}
                                        
                                        {(contentView === 'meals' || contentView === 'ingredients') && !(results && Object.keys(results).length > 0) && !loading && (
                                            <div className="p-6 text-center text-gray-500">
                                                Generate a plan to view {contentView}.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </PullToRefresh>
    
            {isMobile && results && Object.keys(results).length > 0 && (
                <BottomNav
                    activeTab={contentView}
                    onTabChange={setContentView}
                    showPlanButton={false}
                />
            )}
    
            <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
            
            <SuccessModal
                isVisible={showSuccessModal}
                title="Your Plan is Ready!"
                message={`We've created ${formData.days} days of meals optimized for your goals`}
                stats={planStats}
                onClose={() => setShowSuccessModal(false)}
                onViewPlan={() => {
                    setShowSuccessModal(false);
                    setContentView('meals');
                }}
            />
    
            <SettingsPanel
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentStore={formData.store}
                onStoreChange={(store) => {
                    handleChange({ target: { name: 'store', value: store } });
                    showToast(`Store changed to ${store}`, 'success');
                }}
                onClearData={() => {
                    showToast('All data cleared', 'success');
                }}
                onEditProfile={() => {
                    handleEditProfile();
                    setIsSettingsOpen(false);
                    setContentView('profile');
                    // ADDED: Explicitly close the main side menu just in case, ensuring the results panel is visible.
                    setIsMenuOpen(false); 
                }}
                showOrchestratorLogs={showOrchestratorLogs}
                onToggleOrchestratorLogs={setShowOrchestratorLogs}
                showFailedIngredientsLogs={showFailedIngredientsLogs}
                onToggleFailedIngredientsLogs={setShowFailedIngredientsLogs}
                settings={{
                    showOrchestratorLogs,
                    showFailedIngredientsLogs,
                }}
                onToggleSetting={(key) => {
                    if (key === 'showOrchestratorLogs') {
                        setShowOrchestratorLogs(!showOrchestratorLogs);
                    } else if (key === 'showFailedIngredientsLogs') {
                        setShowFailedIngredientsLogs(!showFailedIngredientsLogs);
                    }
                }}
            />
    
            <div className="fixed bottom-0 left-0 right-0 z-[100] flex flex-col-reverse">
                {showOrchestratorLogs && (
                    <DiagnosticLogViewer logs={diagnosticLogs} height={logHeight} setHeight={setLogHeight} isOpen={isLogOpen} setIsOpen={setIsLogOpen} onDownloadLogs={handleDownloadLogs} />
                )}
                {showFailedIngredientsLogs && (
                    <FailedIngredientLogViewer failedHistory={failedIngredientsHistory} onDownload={handleDownloadFailedLogs} />
                )}
                {!showOrchestratorLogs && !showFailedIngredientsLogs && (
                    <div className="bg-gray-800 text-white p-2 text-xs text-center cursor-pointer hover:bg-gray-700" onClick={() => { setShowOrchestratorLogs(true); setShowFailedIngredientsLogs(true); }}>
                        📋 Show Logs
                    </div>
                )}
            </div>
    
            {selectedMeal && (
                <RecipeModal 
                    meal={selectedMeal} 
                    onClose={() => setSelectedMeal(null)} 
                />
            )}

            {/* 7. NEW MODALS ADDED HERE */}
            {plans && (
                <SavePlanModal
                    isOpen={isSavePlanOpen}
                    onClose={() => setIsSavePlanOpen(false)}
                    onSave={handleSavePlan}
                    loading={plans.loading}
                    error={plans.error}
                />
            )}

            {plans && (
                <SavedPlansList
                    isOpen={isSavedPlansOpen}
                    onClose={() => setIsSavedPlansOpen(false)}
                    plans={plans.savedPlans}
                    activePlanId={plans.activePlanId}
                    loading={plans.loading}
                    error={plans.error}
                    onLoadPlan={handleLoadPlan}
                    onDeletePlan={handleDeletePlan}
                    onSetActivePlan={handleSetActivePlan}
                    onRefresh={plans.refreshPlans}
                />
            )}
        </>
    );
};

export default MainApp;

