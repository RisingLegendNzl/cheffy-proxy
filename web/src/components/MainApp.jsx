// web/src/components/MainApp.jsx
import React, { useEffect } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Package, DollarSign, ExternalLink, Calendar, Users, Menu, X, ChevronsDown, ChevronsUp, ShoppingBag, BookOpen, ChefHat, Tag, Soup, Replace, Target, FileText, LayoutDashboard, Terminal, Loader, ChevronRight, GripVertical, Flame, Droplet, Wheat, ChevronDown, ChevronUp, Download, ListX, Save, FolderDown, User, Check, ListChecks, ListOrdered, Utensils } from 'lucide-react';

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
import AmbientOverlay from './ui/AmbientOverlay';

import useReducedMotion from '../hooks/useReducedMotion';
import { addSkipLink, announceToScreenReader } from '../utils/accessibility';
import { APP_CONFIG } from '../constants';

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

const MainApp = ({
    userId,
    isAuthReady,
    firebaseConfig,
    firebaseInitializationError,
    formData,
    handleChange,
    handleSliderChange,
    nutritionalTargets,
    results,
    uniqueIngredients,
    mealPlan,
    totalCost,
    categorizedResults,
    hasInvalidMeals,
    loading,
    error,
    eatenMeals,
    selectedDay,
    setSelectedDay,
    contentView,
    setContentView,
    isMenuOpen,
    setIsMenuOpen,
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
    generationStepKey,
    generationStatus,
    nutritionCache,
    loadingNutritionFor,
    selectedMeal,
    setSelectedMeal,
    showSuccessModal,
    setShowSuccessModal,
    planStats,
    isSettingsOpen,
    setIsSettingsOpen,
    useBatchedMode,
    setUseBatchedMode,
    toasts,
    removeToast,
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
    isMobile,
    isDesktop,
}) => {
    const prefersReducedMotion = useReducedMotion();

    useEffect(() => {
        addSkipLink('main-content');
    }, []);

    useEffect(() => {
        if (showSuccessModal) {
            announceToScreenReader('Your meal plan has been generated successfully', 'assertive');
        }
    }, [showSuccessModal]);

    useEffect(() => {
        if (error) {
            announceToScreenReader(`Error: ${error}`, 'assertive');
        }
    }, [error]);

    const mealPlanContent = (
        <div className="p-4 md:p-6">
            <DayNavigator
                selectedDay={selectedDay}
                totalDays={formData.days}
                onDayChange={setSelectedDay}
                eatenMeals={eatenMeals}
                mealPlan={mealPlan}
            />
            <div className="mt-6">
                <MealPlanDisplay
                    mealPlan={mealPlan}
                    selectedDay={selectedDay}
                    nutritionalTargets={nutritionalTargets}
                    eatenMeals={eatenMeals}
                    onToggleMealEaten={onToggleMealEaten}
                    onViewRecipe={setSelectedMeal}
                />
            </div>
        </div>
    );

    const priceComparisonContent = (
        <div className="p-4 md:p-6 space-y-4">
            {uniqueIngredients.map((ingredientKey) => (
                <IngredientResultBlock
                    key={ingredientKey}
                    ingredientKey={ingredientKey}
                    ingredientData={results[ingredientKey]}
                    onProductSelect={handleSubstituteSelection}
                    onQuantityChange={handleQuantityChange}
                />
            ))}
        </div>
    );

    const totalLogHeight = isLogOpen ? logHeight : 0;

    return (
        <div className="min-h-screen bg-gray-100 relative">
            <AmbientOverlay 
                enableGradient={APP_CONFIG.features.ambientParticles}
                enableParticles={APP_CONFIG.features.ambientParticles}
                particleCount={prefersReducedMotion ? 0 : 15}
            />

            <PullToRefresh onRefresh={handleRefresh}>
                <Header
                    userId={userId}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                    onNavigateToProfile={handleEditProfile}
                    onSignOut={handleSignOut}
                />

                <div className="relative">
                    <div 
                        className="container mx-auto px-4 py-6 transition-all duration-300"
                        style={{
                            paddingBottom: isMobile ? '6rem' : (Number.isFinite(totalLogHeight) ? totalLogHeight : 0) + 'px'
                        }}
                    >
                        <div className="max-w-7xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden">
                            <div className="flex flex-col md:flex-row">
                                <div className={`p-6 md:p-8 w-full md:w-1/2 border-b md:border-r ${isMenuOpen ? 'block' : 'hidden md:block'}`}>
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-2xl font-bold text-indigo-700">Plan Setup</h2>
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={() => handleLoadProfile(false)} 
                                                disabled={!isAuthReady || !userId || userId.startsWith('local_')} 
                                                className="flex items-center px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Load Saved Profile"
                                                aria-label="Load saved profile from cloud"
                                            >
                                                <FolderDown size={14} className="mr-1" /> Load
                                            </button>
                                            <button
                                                onClick={() => handleSaveProfile(false)}
                                                disabled={!isAuthReady || !userId || userId.startsWith('local_')} 
                                                className="flex items-center px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Save Profile"
                                                aria-label="Save profile to cloud"
                                            >
                                                <Save size={14} className="mr-1" /> Save
                                            </button>
                                        </div>
                                    </div>

                                    <form onSubmit={handleGeneratePlan}>
                                        <FormSection 
                                            title="Personal Details" 
                                            icon={User}
                                            description="Tell us about yourself"
                                        >
                                            <InputField label="Name" name="name" value={formData.name} onChange={handleChange} placeholder="Enter your name" required />
                                            <InputField label="Height (cm)" name="height" type="number" value={formData.height} onChange={handleChange} required />
                                            <InputField label="Weight (kg)" name="weight" type="number" value={formData.weight} onChange={handleChange} required />
                                            <InputField label="Age" name="age" type="number" value={formData.age} onChange={handleChange} required />
                                            <InputField label="Gender" name="gender" type="select" value={formData.gender} onChange={handleChange} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} required />
                                            <InputField label="Body Fat % (Optional)" name="bodyFat" type="number" value={formData.bodyFat} onChange={handleChange} placeholder="e.g., 15" />
                                        </FormSection>
        
                                        <FormSection 
                                            title="Goals & Activity" 
                                            icon={Target}
                                            description="Define your fitness objectives"
                                        >
                                            <InputField label="Activity Level" name="activityLevel" type="select" value={formData.activityLevel} onChange={handleChange} options={[{ value: 'sedentary', label: 'Sedentary' }, { value: 'light', label: 'Lightly Active' }, { value: 'moderate', label: 'Moderately Active' }, { value: 'active', label: 'Very Active' }, { value: 'veryActive', label: 'Extremely Active' }]} required />
                                            <InputField label="Goal" name="goal" type="select" value={formData.goal} onChange={handleChange} options={[{ value: 'maintain', label: 'Maintain Weight' }, { value: 'cut_moderate', label: 'Moderate Cut (-15%)' }, { value: 'cut_aggressive', label: 'Aggressive Cut (-25%)' }, { value: 'bulk_lean', label: 'Lean Bulk (+15%)' }, { value: 'bulk_aggressive', label: 'Aggressive Bulk (+25%)' }]} required />
                                            <InputField label="Dietary Restrictions" name="dietary" type="select" value={formData.dietary} onChange={handleChange} options={[{ value: 'None', label: 'None' }, { value: 'vegetarian', label: 'Vegetarian' }, { value: 'vegan', label: 'Vegan' }, { value: 'gluten-free', label: 'Gluten-Free' }, { value: 'dairy-free', label: 'Dairy-Free' }]} />
                                        </FormSection>
        
                                        <FormSection 
                                            title="Meal Plan Preferences" 
                                            icon={ShoppingBag}
                                            description="Customize your plan"
                                        >
                                            <DaySlider label="Plan Duration" name="days" value={formData.days} onChange={handleSliderChange} />
                                            <InputField label="Store" name="store" type="select" value={formData.store} onChange={handleChange} options={[{ value: 'Woolworths', label: 'Woolworths' }, { value: 'Coles', label: 'Coles' }]} />
                                            <InputField label="Eating Occasions per Day" name="eatingOccasions" type="select" value={formData.eatingOccasions} onChange={handleChange} options={[{ value: '2', label: '2 Meals' }, { value: '3', label: '3 Meals' }, { value: '4', label: '4 Meals' }, { value: '5', label: '5 Meals' }]} />
                                            <InputField label="Cost Priority" name="costPriority" type="select" value={formData.costPriority} onChange={handleChange} options={[{ value: 'Lowest Cost', label: 'Lowest Cost' }, { value: 'Best Value', label: 'Best Value' }, { value: 'Premium Quality', label: 'Premium Quality' }]} />
                                            <InputField label="Meal Variety" name="mealVariety" type="select" value={formData.mealVariety} onChange={handleChange} options={[{ value: 'Minimal Variety', label: 'Minimal Variety' }, { value: 'Balanced Variety', label: 'Balanced Variety' }, { value: 'Maximum Variety', label: 'Maximum Variety' }]} />
                                            <InputField label="Cuisine Preference (Optional)" name="cuisine" value={formData.cuisine} onChange={handleChange} placeholder="e.g., Italian, Asian" />
                                        </FormSection>
        
                                        <button type="submit" disabled={loading} className="w-full mt-6 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all" aria-label="Generate meal plan">
                                            {loading ? (
                                                <>
                                                    <Loader className="animate-spin mr-2" size={20} />
                                                    Generating...
                                                </>
                                            ) : (
                                                <>
                                                    <ChefHat className="mr-2" size={20} />
                                                    Generate My Plan
                                                </>
                                            )}
                                        </button>
                                    </form>
                                </div>

                                <div className={`w-full md:w-1/2 ${isMenuOpen ? 'hidden md:block' : 'block'}`}>
                                    <div className="border-b">
                                        <div className="p-6 md:p-8">
                                        </div>
                                    </div>
        
                                    {hasInvalidMeals ? (
                                        <div className="p-6 bg-red-50 border-l-4 border-red-500" role="alert">
                                            <div className="flex items-start">
                                                <AlertTriangle className="text-red-500 mr-3 flex-shrink-0" size={24} />
                                                <div>
                                                    <h3 className="text-lg font-bold text-red-900 mb-2">Plan Generation Error</h3>
                                                    <p className="text-sm text-red-700">Some meals could not be generated. Please try again with different parameters.</p>
                                                </div>
                                            </div>
                                        </div>
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
                                                <EmptyState
                                                    title="No Plan Yet"
                                                    description="Generate a meal plan to view your meals and ingredients"
                                                    showMascot={true}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </PullToRefresh>

            {isMobile && results && Object.keys(results).length > 0 && (
                <BottomNav
                    activeTab={contentView}
                    onTabChange={setContentView}
                    showPlanButton={!results || Object.keys(results).length === 0}
                />
            )}

            <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
            
            <SuccessModal
                isVisible={showSuccessModal}
                title="Your Plan is Ready!"
                message="Your personalized meal plan has been generated successfully."
                onClose={() => setShowSuccessModal(false)}
                stats={planStats}
            />

            <RecipeModal meal={selectedMeal} onClose={() => setSelectedMeal(null)} />
            
            <SettingsPanel
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentStore={formData.store}
                onStoreChange={(store) => handleChange({ target: { name: 'store', value: store } })}
                onClearData={() => {
                    if (window.confirm('Clear all data?')) {
                        window.location.reload();
                    }
                }}
                showOrchestratorLogs={showOrchestratorLogs}
                onToggleOrchestratorLogs={setShowOrchestratorLogs}
                showFailedIngredientsLogs={showFailedIngredientsLogs}
                onToggleFailedIngredientsLogs={setShowFailedIngredientsLogs}
            />
        </div>
    );
};

export default MainApp;