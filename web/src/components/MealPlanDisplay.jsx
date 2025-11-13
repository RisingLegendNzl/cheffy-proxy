// web/src/components/MealPlanDisplay.jsx
import React, { useMemo } from 'react';
import { BookOpen, Target, CheckCircle, AlertTriangle, Soup, Droplet, Wheat } from 'lucide-react';
import MacroBar from './MacroBar';

// --- [MODIFIED] MealPlanDisplay Component ---
const MealPlanDisplay = ({ mealPlan, selectedDay, nutritionalTargets, eatenMeals, onToggleMealEaten, onViewRecipe }) => {
    const dayData = mealPlan[selectedDay - 1];

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
            {/* Premium Header */}
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
            </div>
            
            {/* Enhanced Tracker with Macro Bars */}
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm p-6 rounded-xl shadow-lg border z-10">
                <h4 className="text-lg font-bold mb-4 flex items-center">
                    <Target className="w-5 h-5 mr-2"/>Daily Progress
                </h4>
                
                {/* Main Calorie Bar - FIXED: Added relative and overflow-hidden */}
                <div className="mb-4">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-semibold text-gray-700">Calories</span>
                        <span className="text-sm font-bold">
                            <span className={dailyMacrosEaten.calories > calTarget * 1.05 ? 'text-red-600' : 'text-green-600'}>
                                {dailyMacrosEaten.calories}
                            </span>
                            <span className="text-gray-400"> / </span>
                            <span className="text-gray-600">{calTarget} kcal</span>
                        </span>
                    </div>
                    {/* FIXED: Added relative and overflow-hidden to container */}
                    <div className="relative w-full bg-gray-200 rounded-full h-4 mb-1 overflow-hidden">
                        {/* FIXED: Added absolute positioning and will-change */}
                        <div 
                            className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${
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
                    cal: calTarget > 0 ? Math.round((meal.subtotal_kcal / calTarget) * 100) : 0,
                    protein: nutritionalTargets.protein > 0 ? Math.round((mealMacros.p / nutritionalTargets.protein) * 100) : 0,
                };

                // Determine if meal is high protein
                const isHighProtein = percentOfDaily.protein >= 30;

                return (
                    <div 
                        key={index} 
                        className={`p-5 border-l-4 bg-white rounded-lg shadow-md ${isEaten ? 'border-green-500 opacity-60' : 'border-indigo-500'} cursor-pointer hover:shadow-lg transition-shadow`}
                        onClick={() => onViewRecipe(meal)}
                    >
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold uppercase text-indigo-600">{mealType}</p>
                                    {isHighProtein && (
                                        <span className="px-2 py-0.5 text-xs font-bold bg-green-100 text-green-700 rounded-full">
                                            High Protein
                                        </span>
                                    )}
                                </div>
                                <h4 className="text-xl font-semibold">{mealName}</h4>
                                <p className="text-xl font-bold text-red-600 mt-1">{mealCalories}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {percentOfDaily.cal}% of daily calories
                                </p>
                            </div>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleMealEaten(selectedDay, mealName);
                                }} 
                                className={`flex items-center text-xs py-1 px-3 rounded-full ${isEaten ? 'bg-green-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
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
                );
            })}
        </div>
    );
};

export default MealPlanDisplay;