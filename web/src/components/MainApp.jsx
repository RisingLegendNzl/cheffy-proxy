// web/src/components/MainApp.jsx
// Modified to include plan persistence features

import React, { useState } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Package, DollarSign, ExternalLink, Calendar, Users, Menu, X, ChevronsDown, ChevronsUp, ShoppingBag, BookOpen, ChefHat, Tag, Soup, Replace, Target, FileText, LayoutDashboard, Terminal, Loader, ChevronRight, GripVertical, Flame, Droplet, Wheat, ChevronDown, ChevronUp, Download, ListX, Save, FolderDown, User, Check, ListChecks, ListOrdered, Utensils } from 'lucide-react';

// --- Component Imports ---
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
import SavedPlansModal from './SavedPlansModal';

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

// --- Import Constants and Helpers ---
import { COLORS, SPACING, SHADOWS, Z_INDEX } from '../constants';

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
const MainApp = ({
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
    
    // Plan Persistence - NEW
    savedPlans,
    activePlanId,
    handleSavePlan,
    handleLoadPlan,
    handleDeletePlan,
    savingPlan,
    loadingPlan,
    
    // Responsive
    isMobile,
    isDesktop,
}) => {
    
    // Local state for SavedPlansModal
    const [showSavedPlansModal, setShowSavedPlansModal] = useState(false);
    const [savePlanName, setSavePlanName] = useState('');
    const [showSavePlanPrompt, setShowSavePlanPrompt] = useState(false);
    
    const PlanCalculationErrorPanel = () => (
        <div className="p-6 text-center bg-red-100 text-red-800 rounded-lg shadow-lg m-4">
            <AlertTriangle className="inline mr-2 w-8 h-8" />
            <h3 className="text-xl font-bold">Plan Calculation Error</h3>
            <p className="mt-2">A critical error occurred while calculating meal nutrition. The generated plan is incomplete and cannot be displayed.</p>
            <p className="mt-2 text-sm">Check the diagnostic logs for details, or try generating again.</p>
        </div>
    );

    // Handler for opening saved plans modal
    const handleOpenSavedPlans = () => {
        setShowSavedPlansModal(true);
    };

    // Handler for save plan button click
    const handleSavePlanClick = () => {
        if (mealPlan.length === 0) {
            showToast('No meal plan to save', 'warning');
            return;
        }
        setShowSavePlanPrompt(true);
    };

    // Handler for confirming save with name
    const handleConfirmSave = async () => {
        const name = savePlanName.trim() || `Plan ${new Date().toLocaleDateString()}`;
        await handleSavePlan(name);
        setShowSavePlanPrompt(false);
        setSavePlanName('');
    };

    const priceComparisonContent = (
        <div className="p-4 space-y-6">
            {loading ? (
                <>
                    <ShoppingListSkeleton />
                    <ShoppingListSkeleton />
                    <ShoppingListSkeleton />
                </>
            ) : (
                <>
                    {!error && Object.keys(results).length > 0 && (
                        <>
                            <div className="sticky top-0 z-10 bg-white border border-gray-200 rounded-xl p-6 shadow-lg mb-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center space-x-3">
                                        <Package className="w-6 h-6 text-indigo-600" />
                                        <h3 className="text-xl font-bold text-gray-900">Shopping List</h3>
                                    </div>
                                    {totalCost > 0 && (
                                        <div className="flex items-center space-x-2 text-green-600 font-bold text-2xl">
                                            <DollarSign className="w-6 h-6" />
                                            <span>{totalCost.toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                                {uniqueIngredients.length > 0 && (
                                    <p className="text-gray-600 text-sm">
                                        {uniqueIngredients.length} items total
                                    </p>
                                )}
                            </div>

                            {categorizedResults && Object.keys(categorizedResults).length > 0 && Object.keys(categorizedResults).map((category) => (
                                <CollapsibleSection
                                    key={category}
                                    title={category.charAt(0).toUpperCase() + category.slice(1)}
                                    icon={categoryIconMap[category.toLowerCase()] || categoryIconMap['default']}
                                    defaultOpen={true}
                                >
                                    <div className="space-y-4">
                                        {categorizedResults[category].map(({ ingredient, result, normalizedKey }) => {
                                            const selection = result && result.products && result.products.length > 0 && result.selectedIndex !== undefined 
                                                ? result.products[result.selectedIndex] 
                                                : null;
                                            const nutriData = selection && nutritionCache[selection.url] ? nutritionCache[selection.url] : null;
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
                        </>
                    )}
                    {!loading && Object.keys(results).length === 0 && !error && (
                        <div className="p-6 text-center text-gray-500">Generate a plan to see results.</div>
                    )}
                </>
            )}
        </div>
    );
    
    const mealPlanContent = (
        <div className="flex flex-col md:flex-row p-4 gap-6">
            {mealPlan.length > 0 && (
                <div className="sticky top-4 z-20 self-start w-full md:w-auto mb-4 md:mb-0 bg-white/90 backdrop-blur-md rounded-2xl border border-gray-100/50 p-5 shadow-lg">
                    <DaySidebar days={Math.max(1, mealPlan.length)} selectedDay={selectedDay} onSelect={setSelectedDay} />
                    
                    {/* Save Plan Button - NEW */}
                    {mealPlan.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <button
                                onClick={handleSavePlanClick}
                                disabled={savingPlan || loading}
                                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-md"
                                style={{
                                    backgroundColor: COLORS.primary[600],
                                    color: 'white'
                                }}
                            >
                                <Save size={18} />
                                <span>{savingPlan ? 'Saving...' : 'Save Plan'}</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
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
                        <div className="text-center">
                            <Utensils className="inline w-12 h-12 mb-4 text-gray-400" />
                            <p>Generate a plan to view meals.</p>
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-indigo-50">
            <Header 
                userId={userId}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onNavigateToProfile={() => setContentView('profile')}
                onSignOut={handleSignOut}
                onOpenSavedPlans={handleOpenSavedPlans}
            />
            
            <PullToRefresh onRefresh={handleRefresh}>
                <div className="max-w-7xl mx-auto pt-24 pb-24 px-4 md:px-8">
                    <div className="relative">
                        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                            <div className={`${isMobile ? 'hidden md:block' : 'block'}`}>
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
                stats={planStats}
                onClose={() => setShowSuccessModal(false)}
            />
            
            <RecipeModal meal={selectedMeal} onClose={() => setSelectedMeal(null)} />
            
            <SettingsPanel
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentStore={formData.store}
                onStoreChange={(store) => handleChange({ target: { name: 'store', value: store } })}
                onClearData={() => {}}
                showOrchestratorLogs={showOrchestratorLogs}
                onToggleOrchestratorLogs={() => setShowOrchestratorLogs(!showOrchestratorLogs)}
                showFailedIngredientsLogs={showFailedIngredientsLogs}
                onToggleFailedIngredientsLogs={() => setShowFailedIngredientsLogs(!showFailedIngredientsLogs)}
            />
            
            {/* Save Plan Name Prompt - NEW */}
            {showSavePlanPrompt && (
                <>
                    <div
                        className="fixed inset-0 bg-black bg-opacity-50 z-50"
                        onClick={() => setShowSavePlanPrompt(false)}
                    />
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
                            <h3 className="text-xl font-bold mb-4" style={{ color: COLORS.gray[900] }}>
                                Save Meal Plan
                            </h3>
                            <input
                                type="text"
                                value={savePlanName}
                                onChange={(e) => setSavePlanName(e.target.value)}
                                placeholder={`Plan ${new Date().toLocaleDateString()}`}
                                className="w-full px-4 py-2 border rounded-lg mb-4"
                                style={{ borderColor: COLORS.gray[300] }}
                            />
                            <div className="flex space-x-3">
                                <button
                                    onClick={() => setShowSavePlanPrompt(false)}
                                    className="flex-1 py-2 px-4 rounded-lg font-semibold"
                                    style={{
                                        backgroundColor: COLORS.gray[200],
                                        color: COLORS.gray[700]
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmSave}
                                    disabled={savingPlan}
                                    className="flex-1 py-2 px-4 rounded-lg font-semibold text-white disabled:opacity-50"
                                    style={{ backgroundColor: COLORS.primary[600] }}
                                >
                                    {savingPlan ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
            
            {/* Saved Plans Modal - NEW */}
            <SavedPlansModal
                isOpen={showSavedPlansModal}
                onClose={() => setShowSavedPlansModal(false)}
                savedPlans={savedPlans || []}
                activePlanId={activePlanId}
                onLoadPlan={handleLoadPlan}
                onDeletePlan={handleDeletePlan}
                loadingPlan={loadingPlan}
            />
        </div>
    );
};

export default MainApp;