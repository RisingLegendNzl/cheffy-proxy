// web/src/components/MainApp.jsx
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

// Plan persistence imports
import SavePlanModal from './SavePlanModal';
import SavedPlansList from './SavedPlansList';

// Import constants and helpers
import { COLORS, SPACING, TYPOGRAPHY, SHADOWS, RADIUS, TRANSITIONS } from '../constants';

/**
 * MainApp - Pure presentational component
 * Receives all data and handlers via props
 * Renders the main application UI
 */
const MainApp = (props) => {
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
        diagnosticLogs,
        nutritionCache,
        loadingNutritionFor,
        logHeight,
        setLogHeight,
        isLogOpen,
        setIsLogOpen,
        failedIngredientsHistory,
        statusMessage,
        showOrchestratorLogs,
        setShowOrchestratorLogs,
        showFailedIngredientsLogs,
        setShowFailedIngredientsLogs,
        generationStepKey,
        generationStatus,
        selectedMeal,
        setSelectedMeal,
        useBatchedMode,
        setUseBatchedMode,
        toasts,
        showSuccessModal,
        setShowSuccessModal,
        planStats,
        
        // Settings
        isSettingsOpen,
        setIsSettingsOpen,
        
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
        removeToast,
        
        // Responsive
        isMobile,
        isDesktop,
        
        // Plans hook (passed from useAppLogic)
        plans,
    } = props;

    // --- LOCAL STATE FOR PLAN MODALS ---
    const [showSavePlanModal, setShowSavePlanModal] = useState(false);
    const [showSavedPlansPanel, setShowSavedPlansPanel] = useState(false);

    // --- PLAN HANDLERS ---
    const handleSavePlan = async (planName) => {
        const result = await plans.savePlan(planName);
        if (result && !result.error) {
            setShowSavePlanModal(false);
            showToast('Plan saved successfully!', 'success');
        }
    };

    const handleLoadPlan = async (planId) => {
        await plans.loadPlan(planId);
        setShowSavedPlansPanel(false);
        setContentView('meals');
    };

    const handleDeletePlan = async (planId) => {
        const result = await plans.deletePlan(planId);
        if (result && !result.error) {
            showToast('Plan deleted', 'info');
        }
    };

    const handleSetActivePlan = async (planId) => {
        const result = await plans.setActive(planId);
        if (result && !result.error) {
            showToast('Active plan updated', 'success');
        }
    };

    const handleOpenSavedPlans = () => {
        setShowSavedPlansPanel(true);
        setIsSettingsOpen(false);
    };

    return (
        <>
            {/* Header */}
            <Header
                userId={userId}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onNavigateToProfile={handleEditProfile}
                onSignOut={handleSignOut}
                onOpenSavedPlans={handleOpenSavedPlans}
            />

            {/* Main Container */}
            <div className="min-h-screen bg-gray-50 pb-20 md:pb-0">
                {/* Desktop Tab Navigation - FIXED: Changed 'plan' to 'meals' */}
                <div className="hidden md:block border-b bg-white sticky top-20 z-10">
                    <div className="max-w-7xl mx-auto px-4 md:px-8">
                        <div className="flex space-x-8">
                            <button
                                onClick={() => setContentView('profile')}
                                className={`py-4 px-2 border-b-2 font-semibold transition-colors ${
                                    contentView === 'profile'
                                        ? 'border-indigo-600 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <User className="inline w-5 h-5 mr-2" />
                                Profile
                            </button>
                            <button
                                onClick={() => setContentView('meals')}
                                className={`py-4 px-2 border-b-2 font-semibold transition-colors ${
                                    contentView === 'meals'
                                        ? 'border-indigo-600 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <Utensils className="inline w-5 h-5 mr-2" />
                                Meals
                            </button>
                            <button
                                onClick={() => setContentView('ingredients')}
                                className={`py-4 px-2 border-b-2 font-semibold transition-colors ${
                                    contentView === 'ingredients'
                                        ? 'border-indigo-600 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <ShoppingBag className="inline w-5 h-5 mr-2" />
                                Shopping List
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
                    {/* Profile Tab */}
                    {contentView === 'profile' && (
                        <div className="space-y-6">
                            {/* IMPROVEMENT: Added visual separation */}
                            <ProfileTab 
                                formData={formData}
                                nutritionalTargets={nutritionalTargets}
                            />
                            
                            {/* Generate Plan Form - IMPROVEMENT: Better visual separation */}
                            <div className="bg-white rounded-xl shadow-lg p-6 border-t-4 border-indigo-500">
                                <h2 className="text-2xl font-bold mb-6 text-gray-900">
                                    Generate Your Meal Plan
                                </h2>
                                
                                <form onSubmit={handleGeneratePlan} className="space-y-6">
                                    <FormSection title="Personal Details" icon={User}>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <InputField label="Height (cm)" name="height" type="number" value={formData.height} onChange={handleChange} required />
                                            <InputField label="Weight (kg)" name="weight" type="number" value={formData.weight} onChange={handleChange} required />
                                            <InputField label="Age" name="age" type="number" value={formData.age} onChange={handleChange} required />
                                            <InputField 
                                                label="Gender" 
                                                name="gender" 
                                                type="select" 
                                                value={formData.gender} 
                                                onChange={handleChange}
                                                options={[
                                                    { value: 'male', label: 'Male' },
                                                    { value: 'female', label: 'Female' }
                                                ]}
                                                required 
                                            />
                                        </div>
                                    </FormSection>

                                    <FormSection title="Goals & Activity" icon={Target}>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <InputField 
                                                label="Activity Level" 
                                                name="activityLevel" 
                                                type="select" 
                                                value={formData.activityLevel} 
                                                onChange={handleChange}
                                                options={[
                                                    { value: 'sedentary', label: 'Sedentary' },
                                                    { value: 'light', label: 'Lightly Active' },
                                                    { value: 'moderate', label: 'Moderately Active' },
                                                    { value: 'active', label: 'Very Active' }
                                                ]}
                                                required 
                                            />
                                            <InputField 
                                                label="Goal" 
                                                name="goal" 
                                                type="select" 
                                                value={formData.goal} 
                                                onChange={handleChange}
                                                options={[
                                                    { value: 'maintain', label: 'Maintain Weight' },
                                                    { value: 'cut_moderate', label: 'Moderate Cut' },
                                                    { value: 'cut_aggressive', label: 'Aggressive Cut' },
                                                    { value: 'bulk_lean', label: 'Lean Bulk' },
                                                    { value: 'bulk_aggressive', label: 'Aggressive Bulk' }
                                                ]}
                                                required 
                                            />
                                        </div>
                                    </FormSection>

                                    <FormSection title="Plan Settings" icon={Calendar}>
                                        <DaySlider 
                                            label="Plan Duration" 
                                            name="days" 
                                            value={formData.days} 
                                            onChange={handleSliderChange} 
                                        />
                                        <InputField 
                                            label="Meals per Day" 
                                            name="eatingOccasions" 
                                            type="select" 
                                            value={formData.eatingOccasions} 
                                            onChange={handleChange}
                                            options={[
                                                { value: '2', label: '2 Meals' },
                                                { value: '3', label: '3 Meals' },
                                                { value: '4', label: '4 Meals' }
                                            ]}
                                            required 
                                        />
                                    </FormSection>

                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="w-full py-4 px-6 rounded-lg font-bold text-white text-lg transition-all hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                                        style={{ backgroundColor: COLORS.primary[600] }}
                                    >
                                        {loading ? (
                                            <>
                                                <Loader className="animate-spin" size={24} />
                                                <span>Generating...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Zap size={24} />
                                                <span>Generate Meal Plan</span>
                                            </>
                                        )}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* Meals Tab - FIXED: Changed contentView check from 'plan' to 'meals' */}
                    {contentView === 'meals' && (
                        <div className="space-y-6">
                            {mealPlan.length > 0 ? (
                                <>
                                    <DayNavigator
                                        currentDay={selectedDay}
                                        totalDays={formData.days}
                                        onSelectDay={setSelectedDay}
                                        completedDays={[]}
                                    />
                                    
                                    {/* FIXED Issue #3: Removed duplicate "Save This Plan" button - keeping only one */}
                                    <button
                                        onClick={() => setShowSavePlanModal(true)}
                                        className="w-full py-3 px-4 rounded-lg font-semibold text-white flex items-center justify-center space-x-2 hover-lift transition-spring"
                                        style={{ backgroundColor: COLORS.primary[500] }}
                                    >
                                        <Save size={18} />
                                        <span>Save This Plan</span>
                                    </button>

                                    <MealPlanDisplay
                                        mealPlan={mealPlan}
                                        selectedDay={selectedDay}
                                        nutritionalTargets={nutritionalTargets}
                                        eatenMeals={eatenMeals}
                                        onToggleMealEaten={onToggleMealEaten}
                                        onViewRecipe={setSelectedMeal}
                                    />
                                </>
                            ) : (
                                <EmptyState
                                    icon={ChefHat}
                                    title="No Meal Plan Yet"
                                    description="Generate your first meal plan to see it here"
                                    actionLabel="Go to Profile"
                                    onAction={() => setContentView('profile')}
                                />
                            )}
                        </div>
                    )}

                    {/* Shopping List Tab */}
                    {contentView === 'ingredients' && (
                        <div className="space-y-6">
                            {uniqueIngredients.length > 0 ? (
                                <ShoppingListEnhanced
                                    ingredients={uniqueIngredients}
                                    totalCost={totalCost}
                                    storeName={formData.store}
                                    onShowToast={showToast}
                                />
                            ) : (
                                <EmptyState
                                    icon={ShoppingBag}
                                    title="No Shopping List Yet"
                                    description="Generate a meal plan to see your shopping list"
                                    actionLabel="Go to Profile"
                                    onAction={() => setContentView('profile')}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile Bottom Navigation - FIXED Issue #2: Disabled FAB button */}
            <BottomNav
                activeTab={contentView}
                onTabChange={setContentView}
                showPlanButton={false}
                onNewPlan={() => setContentView('profile')}
            />

            {/* Generation Progress */}
            {loading && (
                <div className="fixed bottom-0 left-0 right-0 md:bottom-auto md:top-24 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl z-50 p-4">
                    <GenerationProgressDisplay
                        activeStepKey={generationStepKey}
                        errorMsg={error}
                        latestLog={diagnosticLogs[diagnosticLogs.length - 1]}
                    />
                </div>
            )}

            {/* Diagnostic Logs */}
            {showOrchestratorLogs && (
                <DiagnosticLogViewer
                    logs={diagnosticLogs}
                    height={logHeight}
                    setHeight={setLogHeight}
                    isOpen={isLogOpen}
                    setIsOpen={setIsLogOpen}
                    onDownloadLogs={handleDownloadLogs}
                />
            )}

            {/* Failed Ingredients Log */}
            {showFailedIngredientsLogs && failedIngredientsHistory.length > 0 && (
                <FailedIngredientLogViewer
                    failedHistory={failedIngredientsHistory}
                    onDownload={handleDownloadFailedLogs}
                />
            )}

            {/* Recipe Modal */}
            <RecipeModal
                meal={selectedMeal}
                onClose={() => setSelectedMeal(null)}
            />

            {/* Settings Panel */}
            <SettingsPanel
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentStore={formData.store}
                onStoreChange={(newStore) => handleChange({ target: { name: 'store', value: newStore } })}
                onClearData={() => {
                    window.location.reload();
                }}
                showOrchestratorLogs={showOrchestratorLogs}
                onToggleOrchestratorLogs={setShowOrchestratorLogs}
                showFailedIngredientsLogs={showFailedIngredientsLogs}
                onToggleFailedIngredientsLogs={setShowFailedIngredientsLogs}
            />

            {/* Toast Container */}
            <ToastContainer toasts={toasts} onRemoveToast={removeToast} />

            {/* Success Modal - FIXED: Auto-navigate to 'meals' tab instead of 'plan' */}
            <SuccessModal
                isVisible={showSuccessModal}
                title="Plan Generated!"
                message="Your personalized meal plan is ready."
                stats={planStats}
                onClose={() => setShowSuccessModal(false)}
                onViewPlan={() => {
                    setShowSuccessModal(false);
                    setContentView('meals');
                }}
            />

            {/* Save Plan Modal */}
            <SavePlanModal
                isOpen={showSavePlanModal}
                onClose={() => setShowSavePlanModal(false)}
                onSave={handleSavePlan}
                loading={plans?.loading || false}
                error={plans?.error || null}
            />

            {/* Saved Plans List Panel */}
            <SavedPlansList
                isOpen={showSavedPlansPanel}
                onClose={() => setShowSavedPlansPanel(false)}
                plans={plans?.savedPlans || []}
                activePlanId={plans?.activePlanId || null}
                loading={plans?.loading || false}
                error={plans?.error || null}
                onLoadPlan={handleLoadPlan}
                onDeletePlan={handleDeletePlan}
                onSetActivePlan={handleSetActivePlan}
                onRefresh={plans?.refreshPlans}
            />
        </>
    );
};

export default MainApp;