// web/src/components/MealPlanDisplay.js
import React, { useMemo } from 'react';
import { BookOpen, Target, CheckCircle, AlertTriangle } from 'lucide-react';

// --- [MODIFIED] MealPlanDisplay Component ---
const MealPlanDisplay = ({ mealPlan, selectedDay, nutritionalTargets, eatenMeals, onToggleMealEaten, onViewRecipe }) => {
    const dayData = mealPlan[selectedDay - 1];

    const caloriesEaten = useMemo(() => {
        if (!dayData || !Array.isArray(dayData.meals)) return 0;
        let total = 0;
        const dayMealsEatenState = eatenMeals[`day${selectedDay}`] || {};
        dayData.meals.forEach(meal => {
            if (meal && meal.name && dayMealsEatenState[meal.name] && typeof meal.subtotal_kcal === 'number') {
                total += meal.subtotal_kcal;
            }
        });
        return Math.round(total);
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
            <h3 className="text-2xl font-bold border-b-2 pb-1 flex items-center"><BookOpen className="w-6 h-6 mr-2" /> Meals for Day {selectedDay}</h3>
            <div className="sticky top-0 bg-white/80 backdrop-blur-sm p-4 rounded-xl shadow-lg border z-10">
                <h4 className="text-lg font-bold mb-3 flex items-center"><Target className="w-5 h-5 mr-2"/>Calorie Tracker</h4>
                <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
                    <div className="bg-green-500 h-4 rounded-full" style={{ width: `${calTarget > 0 ? Math.min(100, (caloriesEaten / calTarget) * 100) : 0}%` }}></div>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                    <span>Eaten: {caloriesEaten} kcal</span>
                    <span>Target: {calTarget} kcal</span>
                    <span>Remaining: {Math.max(0, calTarget - caloriesEaten)} kcal</span>
                </div>
            </div>
            {dayData.meals.map((meal, index) => {
                if (!meal || typeof meal !== 'object') {
                    console.warn(`[MealPlanDisplay] Invalid meal item index ${index} day ${selectedDay}`, meal);
                    return null;
                }
                const mealName = meal.name || `Unnamed Meal ${index + 1}`;
                const mealDesc = meal.description || ""; // <-- This now displays the new description
                const mealType = meal.type || "Meal";
                const mealCalories = typeof meal.subtotal_kcal === 'number' ? `${Math.round(meal.subtotal_kcal)} kcal` : 'N/A';
                const isEaten = eatenMeals[`day${selectedDay}`]?.[mealName] || false;
                return (
                    <div 
                        key={index} 
                        // --- [MODIFIED] Added onClick, cursor-pointer, and hover effect ---
                        className={`p-4 border-l-4 bg-white rounded-lg shadow-md ${isEaten ? 'border-green-500 opacity-60' : 'border-indigo-500'} cursor-pointer hover:shadow-lg transition-shadow`}
                        onClick={() => onViewRecipe(meal)}
                    >
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-sm font-bold uppercase text-indigo-600">{mealType}</p>
                                <h4 className="text-xl font-semibold">{mealName}</h4>
                                <p className="text-sm text-gray-500 font-medium mt-1">{mealCalories}</p>
                            </div>
                            <button 
                                // --- [MODIFIED] Added stopPropagation to prevent modal from opening ---
                                onClick={(e) => {
                                    e.stopPropagation(); // <-- This is the key change
                                    onToggleMealEaten(selectedDay, mealName);
                                }} 
                                className={`flex items-center text-xs py-1 px-3 rounded-full ${isEaten ? 'bg-green-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
                            >
                                <CheckCircle className="w-4 h-4 mr-1" /> {isEaten ? 'Eaten' : 'Mark as Eaten'}
                            </button>
                        </div>
                        {/* This line correctly displays the new meal.description */}
                        <p className="text-gray-600 leading-relaxed mt-2">{mealDesc}</p>
                    </div>
                );
            })}
        </div>
    );
};
// --- END: MealPlanDisplay Modifications ---

export default MealPlanDisplay;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


