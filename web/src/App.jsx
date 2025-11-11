// web/src/App.jsx
import React, { useState, useCallback } from 'react';
import { AlertTriangle, Utensils, ShoppingBag, ChefHat, DollarSign } from 'lucide-react';

// Custom Hooks
import { useProfileManagement } from './hooks/useProfileManagement';
import { usePlanGeneration } from './hooks/usePlanGeneration';
import { useResponsive } from './hooks/useResponsive';

// Constants & Helpers
import { COLORS, SHADOWS, Z_INDEX } from './constants';

// Original Components
import CollapsibleSection from './components/CollapsibleSection';
import GenerationProgressDisplay from './components/GenerationProgressDisplay';
import IngredientResultBlock from './components/IngredientResultBlock';
import MealPlanDisplay from './components/MealPlanDisplay';
import DiagnosticLogViewer from './components/DiagnosticLogViewer';
import FailedIngredientLogViewer from './components/FailedIngredientLogViewer';
import RecipeModal from './components/RecipeModal';
import EmojiIcon from './components/EmojiIcon';
import ProfileTab from './components/ProfileTab';
import LandingPage from './pages/LandingPage';

// Visual Revamp Components
import Header from './components/Header';
import { ToastContainer } from './components/Toast';
import EmptyState from './components/EmptyState';
import SuccessModal from './components/SuccessModal';
import DayNavigator from './components/DayNavigator';
import SettingsPanel from './components/SettingsPanel';
import BottomNav from './components/BottomNav';
import PullToRefresh from './components/PullToRefresh';
import MacroInsightPanel from './components/MacroInsightPanel';

// Configuration
const NUTRITION_API_URL = '/api/nutrition-search';

// Category Icon Map
const categoryIconMap = {
    'produce': <EmojiIcon code="1f96C" alt="produce" />,
    'meat': <EmojiIcon code="1f969" alt="meat" />,
    'dairy': <EmojiIcon code="1f9c0" alt="dairy" />,
    'grains': <EmojiIcon code="1f33e" alt="grains" />,
    'pantry': <EmojiIcon code="1f96b" alt="pantry" />,
    'beverages': <EmojiIcon code="1f964" alt="beverages" />,
    'fruit': <EmojiIcon code="1f34e" alt="fruit" />,
    'condiments': <EmojiIcon code="1f9c2" alt="condiments" />,
    'bakery': <EmojiIcon code="1f370" alt="bakery" />,
    'frozen': <EmojiIcon code="2744" alt="frozen" />,
    'snacks': <EmojiIcon code="1f36b" alt="snacks" />,
    'misc': <EmojiIcon code="1f36b" alt="snacks" />,
    'uncategorized': <EmojiIcon code="1f6cd" alt="shopping" />,
    'default': <EmojiIcon code="1f6cd" alt="shopping" />
};

// Main App Component
const App = () => {
    // Custom Hooks
    const {
        // Auth & Profile State
        userId,
        showLandingPage,
        authLoading,
        authError,
        formData,
        nutritionalTargets,
        showOrchestratorLogs,
        showFailedIngredientsLogs,
        
        // Profile Actions
        setFormData,
        setNutritionalTargets,
        handleInputChange,
        handleClearData,
        
        // Settings Actions
        setShowOrchestratorLogs,
        setShowFailedIngredientsLogs,
        
        // Auth Actions
        handleSignUp,
        handleSignIn,
        handleSignOut,
    } = useProfileManagement();

    const {
        // Plan State
        results,
        mealPlan,
        totalCost,
        loading,
        error,
        diagnosticLogs,
        failedIngredientsHistory,
        generationStepKey,
        isLogOpen,
        logHeight,
        minLogHeight,
        
        // Computed
        latestLog,
        categorizedResults,
        hasInvalidMeals,
        dayCaloriesMap,
        
        // Actions
        generatePlan,
        handleSubstituteSelection,
        handleQuantityChange,
        handleDownloadLogs,
        handleDownloadFailedLogs,
        setIsLogOpen,
        setLogHeight,
    } = usePlanGeneration(formData, nutritionalTargets, userId);

    const { isMobile } = useResponsive();

    // Local UI State
    const [selectedDay, setSelectedDay] = useState(1);
    const [contentView, setContentView] = useState('profile');
    const [selectedMeal, setSelectedMeal] = useState(null);
    const [eatenMeals, setEatenMeals] = useState({});
    const [nutritionCache, setNutritionCache] = useState({});
    const [loadingNutritionFor, setLoadingNutritionFor] = useState(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    
    // Toast State
    const [toasts, setToasts] = useState([]);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [planStats, setPlanStats] = useState([]);

    // Toast Helpers
    const showToast = useCallback((message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Refresh Handler
    const handleRefresh = useCallback(async () => {
        if (mealPlan.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            showToast('Data refreshed!', 'success');
        }
    }, [mealPlan, showToast]);

    // Form Submit Handler
    const handleFormSubmit = useCallback(async (e) => {
        e.preventDefault();
        
        await generatePlan(
            // onSuccess callback
            (event) => {
                if (event.type === 'targets') {
                    setNutritionalTargets(event.data);
                } else if (event.type === 'complete') {
                    // Prepare success modal stats
                    setPlanStats([
                        { label: 'Days', value: formData.days, color: COLORS.primary[600] },
                        { label: 'Meals', value: event.data.mealPlan?.length || 0, color: COLORS.success.main },
                        { label: 'Items', value: event.data.uniqueIngredients?.length || 0, color: COLORS.warning.main },
                    ]);
                    
                    // Show success modal
                    setTimeout(() => {
                        setShowSuccessModal(true);
                        setTimeout(() => {
                            setShowSuccessModal(false);
                            setContentView('meals');
                            setSelectedDay(1);
                        }, 2500);
                    }, 500);
                }
            },
            // onError callback
            (err) => {
                showToast(`Error: ${err.message}`, 'error');
            }
        );
    }, [generatePlan, formData.days, setNutritionalTargets, showToast]);

    // Nutrition Fetch Handler
    const handleFetchNutrition = useCallback(async (product) => {
        if (!product || !product.url || nutritionCache[product.url]) return;
        if (product.nutrition && product.nutrition.status === 'found') {
            setNutritionCache(prev => ({...prev, [product.url]: product.nutrition}));
            return;
        }
        
        setLoadingNutritionFor(product.url);
        try {
            const params = product.barcode 
                ? { barcode: product.barcode } 
                : { url: product.url };
            
            const response = await fetch(`${NUTRITION_API_URL}?${new URLSearchParams(params)}`);
            const data = await response.json();
            setNutritionCache(prev => ({ ...prev, [product.url]: data }));
        } catch (error) {
            console.error('Error fetching nutrition:', error);
        } finally {
            setLoadingNutritionFor(null);
        }
    }, [nutritionCache]);

    // Toggle Meal Eaten
    const onToggleMealEaten = useCallback((day, mealName) => {
        setEatenMeals(prev => {
            const dayKey = `day${day}`;
            const dayMeals = { ...(prev[dayKey] || {}) };
            dayMeals[mealName] = !dayMeals[mealName];
            return { ...prev, [dayKey]: dayMeals };
        });
    }, []);

    // Error Panel Component
    const PlanCalculationErrorPanel = () => (
        <div className="p-6 text-center bg-red-100 text-red-800 rounded-lg shadow-lg m-4">
            <AlertTriangle className="inline mr-2 w-8 h-8" />
            <h3 className="text-xl font-bold">Plan Calculation Error</h3>
            <p className="mt-2">A critical error occurred while calculating meal nutrition. The generated plan is incomplete and cannot be displayed. Please check the logs for details.</p>
        </div>
    );

    // Meal Plan Content
    const mealPlanContent = (
        <div className="space-y-6">
            {/* Day Navigator */}
            <DayNavigator
                currentDay={selectedDay}
                totalDays={Math.max(1, mealPlan.length)}
                onSelectDay={setSelectedDay}
                completedDays={[]}
                dayCalories={dayCaloriesMap}
            />

            {/* Macro Insight Panel */}
            {mealPlan.length > 0 && selectedDay >= 1 && selectedDay <= mealPlan.length && mealPlan[selectedDay - 1] && (
                <MacroInsightPanel
                    calories={{ 
                        current: mealPlan[selectedDay - 1].meals?.reduce((sum, m) => sum + (m.subtotal_kcal || 0), 0) || 0,
                        target: nutritionalTargets.calories 
                    }}
                    protein={{ 
                        current: mealPlan[selectedDay - 1].meals?.reduce((sum, m) => sum + (m.subtotal_protein || 0), 0) || 0,
                        target: nutritionalTargets.protein 
                    }}
                    carbs={{ 
                        current: mealPlan[selectedDay - 1].meals?.reduce((sum, m) => sum + (m.subtotal_carbs || 0), 0) || 0,
                        target: nutritionalTargets.carbs 
                    }}
                    fats={{ 
                        current: mealPlan[selectedDay - 1].meals?.reduce((sum, m) => sum + (m.subtotal_fat || 0), 0) || 0,
                        target: nutritionalTargets.fat 
                    }}
                    fiber={{ current: 0, target: 30 }}
                    sugar={{ current: 0, target: 50 }}
                    sodium={{ current: 0, target: 2300 }}
                    showMicroTargets={false}
                    showInsights={true}
                />
            )}

            {/* Meals Display */}
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
                <EmptyState message="Select a day to view meals" icon={Utensils} />
            )}
        </div>
    );

    // Shopping List Content
    const priceComparisonContent = (
        <div className="space-y-6">
            {error && !loading && (
                <div className="p-4 bg-red-50 text-red-800 rounded-lg">
                    <AlertTriangle className="inline w-6 h-6 mr-2" />
                    <strong>Error(s) occurred during plan generation:</strong>
                    <pre className="mt-2 whitespace-pre-wrap text-sm">{error}</pre>
                </div>
            )}

            {!loading && Object.keys(results).length > 0 && (
                <>
                    <div className="bg-white p-4 rounded-xl shadow-md border-t-4 border-indigo-600">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xl font-bold flex items-center">
                                <DollarSign className="w-5 h-5 mr-2"/>
                                Total Estimated Cost
                            </h3>
                            <p className="text-3xl font-extrabold text-green-700">${totalCost.toFixed(2)}</p>
                        </div>
                        <p className="text-sm text-gray-500">
                            Cost reflects selected products multiplied by units purchased from {formData.store}.
                        </p>
                    </div>

                    <div className="bg-white rounded-xl shadow-lg border overflow-hidden">
                        {Object.keys(categorizedResults).map((category) => (
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
                <EmptyState message="Generate a plan to see results" icon={ShoppingBag} />
            )}
        </div>
    );

    const totalLogHeight = (failedIngredientsHistory.length > 0 ? 60 : 0) + 
                          (isLogOpen ? Math.max(minLogHeight, logHeight) : minLogHeight);

    // Main Render
    return (
        <>
            {/* Toast Container - Always render */}
            <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
            
            {/* Success Modal */}
            <SuccessModal
                isVisible={showSuccessModal}
                title="Your Plan is Ready!"
                message="Your personalized meal plan has been generated successfully."
                stats={planStats}
                onViewPlan={() => {
                    setShowSuccessModal(false);
                    setContentView('meals');
                }}
            />

            {showLandingPage ? (
                <LandingPage 
                    onSignUp={handleSignUp}
                    onSignIn={handleSignIn}
                    authLoading={authLoading}
                    authError={authError}
                />
            ) : (
                <>
                    {/* Header */}
                    <Header 
                        userId={userId}
                        onOpenSettings={() => setIsSettingsOpen(true)}
                        onNavigateToProfile={() => {
                            setContentView('profile');
                        }}
                        onSignOut={handleSignOut}
                    />
            
                    {/* Pull to Refresh Wrapper */}
                    <PullToRefresh onRefresh={handleRefresh} refreshing={loading}>
                        <div 
                            className="min-h-screen p-6 md:p-8 transition-all duration-200 pb-24 md:pb-8" 
                            style={{ 
                                paddingTop: '100px',
                                backgroundColor: COLORS.background.secondary,
                                paddingBottom: isMobile ? '6rem' : `${totalLogHeight + 32}px`,
                            }}
                        >
                            <div className="max-w-7xl mx-auto">
                                {/* Profile Form */}
                                <div 
                                    className="bg-white rounded-2xl p-6 mb-6"
                                    style={{ boxShadow: SHADOWS.md }}
                                >
                                    <form onSubmit={handleFormSubmit}>
                                        <div className="mb-6">
                                            <h2 className="text-2xl font-bold mb-2" style={{ color: COLORS.gray[900] }}>
                                                Your Profile
                                            </h2>
                                            <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                                                Tell us about yourself to generate your personalized meal plan
                                            </p>
                                        </div>

                                        <ProfileTab 
                                            formData={formData} 
                                            nutritionalTargets={nutritionalTargets}
                                            onInputChange={handleInputChange}
                                        />

                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full mt-6 py-4 rounded-xl font-semibold text-white hover-lift transition-spring disabled:opacity-50 disabled:cursor-not-allowed"
                                            style={{
                                                background: loading ? COLORS.gray[400] : COLORS.gradients.primary,
                                                boxShadow: loading ? 'none' : SHADOWS.lg,
                                            }}
                                        >
                                            {loading ? (
                                                <span className="flex items-center justify-center">
                                                    Generating Plan...
                                                </span>
                                            ) : (
                                                <span className="flex items-center justify-center">
                                                    <ChefHat size={20} className="mr-2" />
                                                    Generate My Meal Plan
                                                </span>
                                            )}
                                        </button>
                                    </form>
                                </div>

                                {/* Generation Progress */}
                                {loading && (
                                    <div className="mb-6">
                                        <GenerationProgressDisplay
                                            activeStepKey={generationStepKey}
                                            errorMsg={error}
                                            latestLog={latestLog} 
                                        />
                                    </div>
                                )}

                                {/* Error Panel */}
                                {hasInvalidMeals && !loading && (
                                    <PlanCalculationErrorPanel />
                                )}

                                {/* Content Tabs (Desktop) */}
                                {!isMobile && results && Object.keys(results).length > 0 && !hasInvalidMeals && (
                                    <div className="mb-6">
                                        <div 
                                            className="flex space-x-2 bg-white p-2 rounded-xl"
                                            style={{ boxShadow: SHADOWS.sm }}
                                        >
                                            <button
                                                onClick={() => setContentView('meals')}
                                                className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all ${
                                                    contentView === 'meals' ? '' : 'hover:bg-gray-50'
                                                }`}
                                                style={{
                                                    backgroundColor: contentView === 'meals' 
                                                        ? COLORS.primary[600] 
                                                        : 'transparent',
                                                    color: contentView === 'meals' 
                                                        ? '#ffffff' 
                                                        : COLORS.gray[600],
                                                }}
                                            >
                                                <Utensils size={20} className="inline mr-2" />
                                                Meals
                                            </button>
                                            <button
                                                onClick={() => setContentView('ingredients')}
                                                className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all ${
                                                    contentView === 'ingredients' ? '' : 'hover:bg-gray-50'
                                                }`}
                                                style={{
                                                    backgroundColor: contentView === 'ingredients' 
                                                        ? COLORS.primary[600] 
                                                        : 'transparent',
                                                    color: contentView === 'ingredients' 
                                                        ? '#ffffff' 
                                                        : COLORS.gray[600],
                                                }}
                                            >
                                                <ShoppingBag size={20} className="inline mr-2" />
                                                Shopping List
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Main Content Area */}
                                {!hasInvalidMeals && (
                                    <div>
                                        {contentView === 'meals' && results && Object.keys(results).length > 0 && mealPlanContent}
                                        {contentView === 'ingredients' && results && Object.keys(results).length > 0 && priceComparisonContent}
                                        
                                        {(contentView === 'meals' || contentView === 'ingredients') && 
                                         !(results && Object.keys(results).length > 0) && 
                                         !loading && (
                                            <EmptyState 
                                                message="Generate a plan to view your content"
                                                icon={ChefHat}
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </PullToRefresh>
            
                    {/* Bottom Navigation (Mobile) */}
                    {isMobile && results && Object.keys(results).length > 0 && !hasInvalidMeals && (
                        <BottomNav
                            activeTab={contentView}
                            onTabChange={setContentView}
                            showPlanButton={false}
                        />
                    )}

                    {/* Settings Panel */}
                    <SettingsPanel
                        isOpen={isSettingsOpen}
                        onClose={() => setIsSettingsOpen(false)}
                        currentStore={formData.store}
                        onStoreChange={(store) => setFormData(prev => ({ ...prev, store }))}
                        onClearData={handleClearData}
                        showOrchestratorLogs={showOrchestratorLogs}
                        onToggleOrchestratorLogs={setShowOrchestratorLogs}
                        showFailedIngredientsLogs={showFailedIngredientsLogs}
                        onToggleFailedIngredientsLogs={setShowFailedIngredientsLogs}
                    />

                    {/* Recipe Modal */}
                    {selectedMeal && (
                        <RecipeModal 
                            meal={selectedMeal} 
                            onClose={() => setSelectedMeal(null)} 
                        />
                    )}

                    {/* Diagnostic Logs (Bottom) */}
                    {showOrchestratorLogs && (
                        <div 
                            className="fixed bottom-0 left-0 right-0"
                            style={{ zIndex: Z_INDEX.fixed - 1 }}
                        >
                            <DiagnosticLogViewer 
                                logs={diagnosticLogs} 
                                height={logHeight} 
                                setHeight={setLogHeight} 
                                isOpen={isLogOpen} 
                                setIsOpen={setIsLogOpen} 
                                onDownloadLogs={handleDownloadLogs} 
                            />
                        </div>
                    )}

                    {showFailedIngredientsLogs && failedIngredientsHistory.length > 0 && (
                        <FailedIngredientLogViewer 
                            failedHistory={failedIngredientsHistory} 
                            onDownload={handleDownloadFailedLogs} 
                        />
                    )}
                </>
            )}
        </>
    );
};

export default App;