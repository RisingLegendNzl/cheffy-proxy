// web/src/components/MealPlanDisplay.jsx
import React from 'react'; // Removed useMemo, no longer needed
import { BookOpen, Target, CheckCircle, AlertTriangle } from 'lucide-react';

// --- [NEW] Import the theme-aware tracker ---
// --- [FIX] Corrected to be a named import ---
import { CalorieTracker } from './CalorieTracker';

// --- [MODIFIED] MealPlanDisplay Component ---
// Updated props: removed onToggleMealEaten, added actualMacros and onToggleMealLog
const MealPlanDisplay = ({ mealPlan, selectedDay, nutritionalTargets, actualMacros, eatenMeals, onToggleMealLog, onViewRecipe }) => {
    const dayData = mealPlan[selectedDay - 1];

    // --- [REMOVED] The 'caloriesEaten' useMemo is no longer needed.
    // The 'actualMacros' prop from App.jsx now provides this data.
    
    if (!dayData) {
        console.warn(`[MealPlanDisplay] No valid data found for day ${selectedDay}.`);
        return <div className="p-6 text-center bg-yellow-50 rounded-lg"><AlertTriangle className="inline mr-2" />No meal plan data found for Day {selectedDay}.</div>;
    }
    if (!Array.isArray(dayData.meals)) {
        console.error(`[MealPlanDisplay] Invalid meals structure for day ${selectedDay}. Expected array, got:`, dayData.meals);
        return <div className="p-6 text-center bg-red-50 text-red-800 rounded-lg"><AlertTriangle className="inline mr-2" />Error loading meals for Day {selectedDay}. Data invalid.</div>;
    }

    return (
        <div className="space-y-6">
            <h3 className="text-2xl font-bold border-b-2 pb-1 flex items-center"><BookOpen className="w-6 h-6 mr-2" /> Meals for Day {selectedDay}</h3>
            
            {/* --- [REPLACED] Old tracker is replaced with the new theme-aware component --- */}
            <div className="sticky top-0 bg-white/80 backdrop-blur-sm p-4 rounded-xl shadow-lg border z-10">
                <CalorieTracker 
                    targets={nutritionalTargets} 
                    actual={actualMacros} 
                />
            </div>
            {/* --- [END REPLACEMENT] --- */}

            {dayData.meals.map((meal, index) => {
                if (!meal || typeof meal !== 'object') {
                    console.warn(`[MealPlanDisplay] Invalid meal item index ${index} day ${selectedDay}`, meal);
                    return null;
                }
                const mealName = meal.name || `Unnamed Meal ${index + 1}`;
                const mealDesc = meal.description || "";
                const mealType = meal.type || "Meal";
                const mealCalories = typeof meal.subtotal_kcal === 'number' ? `${Math.round(meal.subtotal_kcal)} kcal` : 'N/A';
                const isEaten = eatenMeals[`day${selectedDay}`]?.[mealName] || false;
                
                return (
                    <div 
                        key={index} 
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
                                // --- [MODIFIED] onClick now uses the new prop from App.jsx ---
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleMealLog(selectedDay, mealName); // Use new, correct handler
                                }} 
                                className={`flex items-center text-xs py-1 px-3 rounded-full ${isEaten ? 'bg-green-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
                            >
                                <CheckCircle className="w-4 h-4 mr-1" /> {isEaten ? 'Eaten' : 'Mark as Eaten'}
                            </button>
                        </div>
                        <p className="text-gray-600 leading-relaxed mt-2">{mealDesc}</p>
                    </div>
                );
            })}
        </div>
    );
};
// --- END: MealPlanDisplay Modifications ---

export default MealPlanDisplay;


