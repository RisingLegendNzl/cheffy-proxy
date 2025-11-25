// web/src/components/MealPlanDisplay.jsx
import React, { useMemo, useState } from 'react';
import { BookOpen, Target, CheckCircle, AlertTriangle, Soup, Droplet, Wheat, Copy } from 'lucide-react';
import MacroBar from './MacroBar';
import { exportMealPlanToClipboard } from '../utils/mealPlanExporter';

const MealPlanDisplay = ({ mealPlan, selectedDay, nutritionalTargets, eatenMeals, onToggleMealEaten, onViewRecipe, showToast }) => {
    const dayData = mealPlan[selectedDay - 1];
    const [copying, setCopying] = useState(false);

    // Calculate eaten macros for the day
    const dailyMacrosEaten = useMemo(() => {
        if (!dayData || !Array.isArray(dayData.meals)) {
            return { calories: 0, protein: 0, fat: 0, carbs: 0 };
        }
        
        const dayMealsEatenState = eatenMeals[`day${selectedDay}`] || {};
        let totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        
        dayData.meals.forEach(meal => {
            if (meal && meal.name && dayMealsEatenState[meal.name]) {
                totals.calories += meal.subtotal_kcal || 0;
                totals.protein += meal.subtotal_protein || 0;
                totals.fat += meal.subtotal_fat || 0;
                totals.carbs += meal.subtotal_carbs || 0;
            }
        });
        
        return {
            calories: Math.round(totals.calories),
            protein: Math.round(totals.protein),
            fat: Math.round(totals.fat),
            carbs: Math.round(totals.carbs),
        };
    }, [dayData, eatenMeals, selectedDay]);

    // Handle copy all meals button click
    const handleCopyAllMeals = async () => {
        setCopying(true);
        
        try {
            const result = await exportMealPlanToClipboard(mealPlan || []);
            
            if (showToast) {
                showToast(result.message, result.success ? 'success' : 'error');
            }
        } catch (error) {
            console.error('[MealPlanDisplay] Error copying meals:', error);
            if (showToast) {
                showToast('Failed to copy meal plan', 'error');
            }
        } finally {
            setCopying(false);
        }
    };

    if (!dayData) {
        console.warn(`[MealPlanDisplay] No valid data found for day ${selectedDay}.`);
        return <div className="p-6 text-center bg-yellow-50 rounded-lg"><AlertTriangle className="inline mr-2" />No meal plan data found for Day {selectedDay}.</div>;
    }
    if (!Array.isArray(dayData.meals)) {
        console.error(`[MealPlanDisplay] Invalid meals structure for day ${selectedDay}. Expected array, got:`, dayData.meals);
        return <div className="p-6 text-center bg-red-50 text-red-800 rounded-lg"><AlertTriangle className="inline mr-2" />Error loading meals for Day {selectedDay}. Data invalid.</div>;
    }

    const calTarget = nutritionalTargets.calories || 0;
    
    return (
        <div className="space-y-6">
            {/* Premium Header with Copy Button */}
            <div className="flex items-center justify-between pb-4 border-b border-gray-200">
                <div className="flex items-center gap-3">
                    <div 
                        className="p-2.5 rounded-xl shadow-md"
                        style={{
                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                        }}
                    >
                        <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-900 tracking-tight">
                            Meals for Day {selectedDay}
                        </h3>
                        <p className="text-sm text-gray-500 font-medium mt-0.5">
                            Your personalized nutrition plan
                        </p>
                    </div>
                </div>
                
                {/* Copy All Meals Button */}
                <button
                    onClick={handleCopyAllMeals}
                    disabled={copying || !mealPlan || mealPlan.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Copy all meals to clipboard"
                >
                    <Copy className="w-4 h-4" />
                    <span className="hidden sm:inline">
                        {copying ? 'Copying...' : 'Copy Meals'}
                    </span>
                </button>
            </div>
            
            {/* Enhanced Tracker with Macro Bars */}
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm p-6 rounded-xl shadow-lg border z-10">
                <h4 className="text-lg font-bold mb-4 flex items-center">
                    <Target className="w-5 h-5 mr-2"/>Daily Progress
                </h4>
                
                {/* Main Calorie Bar */}
                <div className="mb-4">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-semibold text-gray-700">Calories</span>
                        <span className="text-sm font-bold">
                            <span className={dailyMacrosEaten.calories > calTarget * 1.05 ? 'text-red-600' : 
                                dailyMacrosEaten.calories >= calTarget * 0.95 ? 'text-green-600' : 
                                'text-gray-700'}>
                                {dailyMacrosEaten.calories}
                            </span>
                            {' / '}{calTarget} kcal
                        </span>
                    </div>
                    <div className="relative w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div 
                            className={`h-3 transition-all duration-500 ease-out ${
                                dailyMacrosEaten.calories > calTarget * 1.05 ? 'bg-red-500' : 
                                dailyMacrosEaten.calories >= calTarget * 0.95 ? 'bg-green-500' : 
                                'bg-indigo-500'
                            }`}
                            style={{ 
                                width: `${calTarget > 0 ? Math.min(100, (dailyMacrosEaten.calories / calTarget) * 100) : 0}%`,
                                willChange: 'width'
                            }}
                        />
                    </div>
                    <p className="text-xs text-gray-500 text-right">
                        {Math.max(0, calTarget - dailyMacrosEaten.calories)} kcal remaining
                    </p>
                </div>

                {/* Macro Bars */}
                <div className="space-y-3 pt-3 border-t">
                    <MacroBar
                        label="Protein"
                        current={dailyMacrosEaten.protein}
                        target={nutritionalTargets.protein || 0}
                        unit="g"
                        color="green"
                        Icon={Soup}
                    />
                    <MacroBar
                        label="Fat"
                        current={dailyMacrosEaten.fat}
                        target={nutritionalTargets.fat || 0}
                        unit="g"
                        color="yellow"
                        Icon={Droplet}
                    />
                    <MacroBar
                        label="Carbs"
                        current={dailyMacrosEaten.carbs}
                        target={nutritionalTargets.carbs || 0}
                        unit="g"
                        color="orange"
                        Icon={Wheat}
                    />
                </div>
            </div>

            {/* Meal Cards */}
            {dayData.meals.map((meal, index) => {
                if (!meal || typeof meal !== 'object') {
                    console.warn(`[MealPlanDisplay] Invalid meal item index ${index} day ${selectedDay}`, meal);
                    return null;
                }
                const mealName = meal.name || `Unnamed Meal ${index + 1}`;
                const mealDesc = meal.description || "No description available.";
                const mealType = meal.type || "Meal";
                const mealCalories = typeof meal.subtotal_kcal === 'number' ? `${Math.round(meal.subtotal_kcal)} kcal` : 'N/A';
                const isEaten = eatenMeals[`day${selectedDay}`]?.[mealName] || false;
                
                const mealMacros = {
                    p: Math.round(meal.subtotal_protein || 0),
                    f: Math.round(meal.subtotal_fat || 0),
                    c: Math.round(meal.subtotal_carbs || 0)
                };

                // Calculate what % of daily target this meal represents
                const percentOfDaily = {
                    calories: calTarget > 0 ? Math.round((meal.subtotal_kcal / calTarget) * 100) : 0,
                    protein: nutritionalTargets.protein > 0 ? Math.round((mealMacros.p / nutritionalTargets.protein) * 100) : 0,
                };

                return (
                    <div 
                        key={index}
                        className={`bg-white rounded-xl shadow-lg border-2 overflow-hidden transition-all duration-300 hover:shadow-2xl ${
                            isEaten ? 'border-green-400 bg-green-50/30' : 'border-gray-200 hover:border-indigo-300'
                        }`}
                    >
                        <div className="p-6">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex-1">
                                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full inline-block mb-2">
                                        {mealType}
                                    </span>
                                    <h4 className="text-xl font-bold text-gray-900">{mealName}</h4>
                                    <p className="text-sm text-gray-600 font-semibold mt-1">{mealCalories}</p>
                                </div>
                                <button
                                    onClick={() => onViewRecipe && onViewRecipe(meal)}
                                    className="ml-3 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                                >
                                    View Recipe
                                </button>
                            </div>
                            
                            <div className="flex gap-2 mb-3">
                                <button
                                    onClick={() => onToggleMealEaten && onToggleMealEaten(selectedDay, mealName)}
                                    className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                                        isEaten ? 'bg-green-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                                    }`}
                                >
                                    <CheckCircle className="w-4 h-4 mr-1" /> {isEaten ? 'Eaten' : 'Mark as Eaten'}
                                </button>
                            </div>
                            
                            <p className="text-gray-600 leading-relaxed mt-2">{mealDesc}</p>

                            {/* Macro Breakout with Visual Indicators */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4 text-center">
                                <div className="bg-green-50 p-2 rounded-lg border border-green-200">
                                    <p className="text-sm font-semibold text-green-800">Protein</p>
                                    <p className="text-lg font-bold">{mealMacros.p}g</p>
                                    <p className="text-xs text-green-600">{percentOfDaily.protein}% daily</p>
                                </div>
                                <div className="bg-yellow-50 p-2 rounded-lg border border-yellow-200">
                                    <p className="text-sm font-semibold text-yellow-800">Fat</p>
                                    <p className="text-lg font-bold">{mealMacros.f}g</p>
                                </div>
                                <div className="bg-orange-50 p-2 rounded-lg border border-orange-200">
                                    <p className="text-sm font-semibold text-orange-800">Carbs</p>
                                    <p className="text-lg font-bold">{mealMacros.c}g</p>
                                </div>
                            </div>

                            {/* Ingredient Pills */}
                            <div className="mt-4">
                                <h5 className="text-sm font-semibold mb-2 text-gray-700">Ingredients:</h5>
                                <div className="flex flex-wrap gap-2">
                                    {meal.items && meal.items.map((item, i) => (
                                        <span key={i} className="bg-gray-200 text-gray-800 text-xs font-medium px-3 py-1 rounded-full">
                                            {item.qty}{item.unit} {item.key}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default MealPlanDisplay;