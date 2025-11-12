// web/src/components/MealPlanDisplay.jsx
import React, { useMemo } from ‘react’;
import { AlertTriangle } from ‘lucide-react’;
import MealCard from ‘./MealCard’;
import MacroBar from ‘./MacroBar’;
import { COLORS } from ‘../constants’;
import { calculateStaggerDelay } from ‘../utils/animationHelpers’;

/**

- Meal Plan Display - Enhanced with stagger animations
- Features:
- - Scroll-triggered animations for meal cards
- - Stagger effect when loading meal list
- - Daily macro progress tracking
    */
    const MealPlanDisplay = ({
    mealPlan,
    selectedDay,
    nutritionalTargets,
    eatenMeals,
    onToggleMealEaten,
    onViewRecipe
    }) => {
    const dayData = mealPlan[selectedDay - 1];

// Calculate eaten macros for the day
const dailyMacrosEaten = useMemo(() => {
if (!dayData || !Array.isArray(dayData.meals)) {
return { calories: 0, protein: 0, fat: 0, carbs: 0 };
}

```
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
```

}, [dayData, eatenMeals, selectedDay]);

if (!dayData) {
return (
<div className="p-6 text-center bg-yellow-50 rounded-lg">
<AlertTriangle className="inline mr-2" />
No meal plan data found for Day {selectedDay}.
</div>
);
}

if (!Array.isArray(dayData.meals)) {
return (
<div className="p-6 text-center bg-red-50 text-red-800 rounded-lg">
<AlertTriangle className="inline mr-2" />
Error loading meals for Day {selectedDay}.
</div>
);
}

return (
<div className="space-y-6">
{/* Daily Progress Summary */}
<div className=“bg-white rounded-xl shadow-lg border p-6” style={{ borderColor: COLORS.gray[200] }}>
<h3 className=“text-lg font-bold mb-4” style={{ color: COLORS.gray[900] }}>
Daily Progress
</h3>

```
    <div className="space-y-3">
      <MacroBar
        label="Calories"
        current={dailyMacrosEaten.calories}
        target={nutritionalTargets.calories}
        unit="kcal"
        color="error"
      />
      <MacroBar
        label="Protein"
        current={dailyMacrosEaten.protein}
        target={nutritionalTargets.protein}
        unit="g"
        color="primary"
      />
      <MacroBar
        label="Fat"
        current={dailyMacrosEaten.fat}
        target={nutritionalTargets.fat}
        unit="g"
        color="secondary"
      />
      <MacroBar
        label="Carbs"
        current={dailyMacrosEaten.carbs}
        target={nutritionalTargets.carbs}
        unit="g"
        color="warning"
      />
    </div>
  </div>

  {/* Meals Grid */}
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {dayData.meals.map((meal, index) => {
      if (!meal || !meal.name) return null;

      const dayKey = `day${selectedDay}`;
      const isEaten = eatenMeals[dayKey]?.[meal.name] || false;

      return (
        <div
          key={meal.name || index}
          className="stagger-item"
          style={{
            animationDelay: calculateStaggerDelay(index, 100),
          }}
        >
          <MealCard
            meal={meal}
            isEaten={isEaten}
            onToggleEaten={() => onToggleMealEaten(meal.name)}
            onViewRecipe={onViewRecipe}
            showNutrition={true}
            nutritionalTargets={nutritionalTargets}
          />
        </div>
      );
    })}
  </div>

  {/* Empty State */}
  {dayData.meals.length === 0 && (
    <div className="text-center py-12">
      <p className="text-lg" style={{ color: COLORS.gray[500] }}>
        No meals planned for this day.
      </p>
    </div>
  )}
</div>
```

);
};

export default MealPlanDisplay;