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
        setContentView('plan');
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

    // --- RENDER FUNCTION CONTINUES WITH EXISTING MAINAPP JSX ---
    // Note: The complete render logic from the original MainApp.jsx continues here
    // I'm showing the key additions - you'll need to merge this with your existing MainApp return statement

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

            {/* Your existing MainApp JSX structure continues here... */}
            {/* This is where all your existing panels, forms, and content rendering goes */}

            {/* Add "Save Plan" Button - Place this after successful plan generation */}
            {/* Option 1: In your right panel when plan is ready */}
            {mealPlan.length > 0 && contentView === 'plan' && (
                <div className="p-4">
                    <button
                        onClick={() => setShowSavePlanModal(true)}
                        className="w-full py-3 px-4 rounded-lg font-semibold text-white flex items-center justify-center space-x-2 hover-lift transition-spring"
                        style={{ backgroundColor: COLORS.primary[500] }}
                    >
                        <Save size={18} />
                        <span>Save This Plan</span>
                    </button>
                </div>
            )}

            {/* Settings Panel */}
            <SettingsPanel
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentStore={formData.store}
                onStoreChange={(newStore) => handleChange({ target: { name: 'store', value: newStore } })}
                onClearData={() => {
                    if (window.confirm('Clear all data?')) {
                        window.location.reload();
                    }
                }}
                showOrchestratorLogs={showOrchestratorLogs}
                onToggleOrchestratorLogs={() => setShowOrchestratorLogs(!showOrchestratorLogs)}
                showFailedIngredientsLogs={showFailedIngredientsLogs}
                onToggleFailedIngredientsLogs={() => setShowFailedIngredientsLogs(!showFailedIngredientsLogs)}
            />

            {/* Toast Container */}
            <ToastContainer toasts={toasts} onRemoveToast={removeToast} />

            {/* Success Modal */}
            <SuccessModal
                isVisible={showSuccessModal}
                title="Plan Generated!"
                message="Your personalized meal plan is ready."
                stats={planStats}
                onClose={() => setShowSuccessModal(false)}
                onViewPlan={() => {
                    setShowSuccessModal(false);
                    setContentView('plan');
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