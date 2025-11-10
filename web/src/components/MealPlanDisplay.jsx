// web/src/components/MealPlanDisplay.jsx
import React, { useState, useMemo } from 'react';
import { 
  ChefHat, 
  Calendar, 
  TrendingUp,
  CheckCircle,
  Clock,
  Flame
} from 'lucide-react';
import MealCard from './MealCard';
import DayNavigator from './DayNavigator';
import EmptyState from './EmptyState';
import SwipeHandler from './SwipeHandler';
import { MealCardSkeleton } from './SkeletonLoader';
import { COLORS, SHADOWS } from '../constants';
import { 
  formatCalories, 
  formatGrams, 
  calculatePercentage,
  formatPercentage 
} from '../helpers';
import { useResponsive } from '../hooks/useResponsive';

/**
 * Enhanced Meal Plan Display Component
 * Shows daily meals with better visuals and interactions
 */
const MealPlanDisplay = ({ 
  mealPlan, 
  selectedDay, 
  setSelectedDay, 
  eatenMeals, 
  onToggleMealEaten, 
  setSelectedMeal,
  nutritionalTargets,
  loading = false 
}) => {
  const { isMobile } = useResponsive();
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'

  // Get current day's data
  const dayData = useMemo(() => {
    if (!mealPlan || mealPlan.length === 0) return null;
    return mealPlan.find(day => day.day === selectedDay);
  }, [mealPlan, selectedDay]);

  // Calculate completed days (days where all meals are eaten)
  const completedDays = useMemo(() => {
    if (!mealPlan || !eatenMeals) return [];
    
    return mealPlan
      .filter(day => {
        const dayKey = `day${day.day}`;
        const dayMeals = eatenMeals[dayKey];
        if (!dayMeals || !day.meals) return false;
        
        // Check if all meals are eaten
        return day.meals.every((_, index) => dayMeals[index] === true);
      })
      .map(day => day.day);
  }, [mealPlan, eatenMeals]);

  // Calculate daily totals
  const dailyTotals = useMemo(() => {
    if (!dayData || !dayData.meals) {
      return { calories: 0, protein: 0, fat: 0, carbs: 0 };
    }

    return dayData.meals.reduce((totals, meal) => ({
      calories: totals.calories + (meal.subtotal_kcal || 0),
      protein: totals.protein + (meal.subtotal_protein || 0),
      fat: totals.fat + (meal.subtotal_fat || 0),
      carbs: totals.carbs + (meal.subtotal_carbs || 0),
    }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  }, [dayData]);

  // Calculate eaten totals for the day
  const eatenTotals = useMemo(() => {
    if (!dayData || !dayData.meals || !eatenMeals) {
      return { calories: 0, protein: 0, fat: 0, carbs: 0 };
    }

    const dayKey = `day${selectedDay}`;
    const dayEatenMeals = eatenMeals[dayKey] || {};

    return dayData.meals.reduce((totals, meal, index) => {
      if (dayEatenMeals[index]) {
        return {
          calories: totals.calories + (meal.subtotal_kcal || 0),
          protein: totals.protein + (meal.subtotal_protein || 0),
          fat: totals.fat + (meal.subtotal_fat || 0),
          carbs: totals.carbs + (meal.subtotal_carbs || 0),
        };
      }
      return totals;
    }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
  }, [dayData, selectedDay, eatenMeals]);

  // Handle swipe navigation
  const handleSwipeLeft = () => {
    if (selectedDay < mealPlan.length) {
      setSelectedDay(selectedDay + 1);
    }
  };

  const handleSwipeRight = () => {
    if (selectedDay > 1) {
      setSelectedDay(selectedDay - 1);
    }
  };

  // Empty state
  if (!mealPlan || mealPlan.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ChefHat}
          title="No Meal Plan Yet"
          description="Generate a meal plan to see your personalized meals here"
          actionLabel="Get Started"
          onAction={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <MealCardSkeleton />
        <MealCardSkeleton />
        <MealCardSkeleton />
      </div>
    );
  }

  // No data for selected day
  if (!dayData || !dayData.meals) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Calendar}
          title="No Meals for This Day"
          description="This day doesn't have any meals yet"
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Day Navigator */}
      <div className="p-4 md:p-6 border-b animate-fadeIn" style={{ borderColor: COLORS.gray[200] }}>
        <DayNavigator
          currentDay={selectedDay}
          totalDays={mealPlan.length}
          onSelectDay={setSelectedDay}
          completedDays={completedDays}
        />
      </div>

      {/* Daily Macro Summary */}
      <div className="p-4 md:p-6 bg-gradient-to-br from-indigo-50 to-purple-50 border-b animate-fadeInDown" style={{ borderColor: COLORS.gray[200] }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold flex items-center" style={{ color: COLORS.gray[900] }}>
            <TrendingUp size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
            Daily Progress
          </h3>
          <span className="text-sm" style={{ color: COLORS.gray[600] }}>
            {formatPercentage(eatenTotals.calories, dailyTotals.calories)} Complete
          </span>
        </div>

        {/* Macro Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Calories */}
          <div
            className="p-3 rounded-lg border-2"
            style={{
              backgroundColor: COLORS.macros.calories.light,
              borderColor: COLORS.macros.calories.main,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: COLORS.macros.calories.dark }}>
                Calories
              </span>
              <Flame size={14} style={{ color: COLORS.macros.calories.main }} />
            </div>
            <p className="text-xl font-bold" style={{ color: COLORS.macros.calories.dark }}>
              {formatCalories(eatenTotals.calories, false)}
            </p>
            <p className="text-xs" style={{ color: COLORS.macros.calories.dark }}>
              of {formatCalories(dailyTotals.calories, false)}
            </p>
            {/* Progress bar */}
            <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(calculatePercentage(eatenTotals.calories, dailyTotals.calories), 100)}%`,
                  backgroundColor: COLORS.macros.calories.main,
                }}
              />
            </div>
          </div>

          {/* Protein */}
          <div
            className="p-3 rounded-lg border-2"
            style={{
              backgroundColor: COLORS.macros.protein.light,
              borderColor: COLORS.macros.protein.main,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: COLORS.macros.protein.dark }}>
                Protein
              </span>
              <span className="text-sm">{COLORS.macros.protein.icon}</span>
            </div>
            <p className="text-xl font-bold" style={{ color: COLORS.macros.protein.dark }}>
              {Math.round(eatenTotals.protein)}g
            </p>
            <p className="text-xs" style={{ color: COLORS.macros.protein.dark }}>
              of {Math.round(dailyTotals.protein)}g
            </p>
            <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(calculatePercentage(eatenTotals.protein, dailyTotals.protein), 100)}%`,
                  backgroundColor: COLORS.macros.protein.main,
                }}
              />
            </div>
          </div>

          {/* Fat */}
          <div
            className="p-3 rounded-lg border-2"
            style={{
              backgroundColor: COLORS.macros.fat.light,
              borderColor: COLORS.macros.fat.main,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: COLORS.macros.fat.dark }}>
                Fat
              </span>
              <span className="text-sm">{COLORS.macros.fat.icon}</span>
            </div>
            <p className="text-xl font-bold" style={{ color: COLORS.macros.fat.dark }}>
              {Math.round(eatenTotals.fat)}g
            </p>
            <p className="text-xs" style={{ color: COLORS.macros.fat.dark }}>
              of {Math.round(dailyTotals.fat)}g
            </p>
            <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(calculatePercentage(eatenTotals.fat, dailyTotals.fat), 100)}%`,
                  backgroundColor: COLORS.macros.fat.main,
                }}
              />
            </div>
          </div>

          {/* Carbs */}
          <div
            className="p-3 rounded-lg border-2"
            style={{
              backgroundColor: COLORS.macros.carbs.light,
              borderColor: COLORS.macros.carbs.main,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: COLORS.macros.carbs.dark }}>
                Carbs
              </span>
              <span className="text-sm">{COLORS.macros.carbs.icon}</span>
            </div>
            <p className="text-xl font-bold" style={{ color: COLORS.macros.carbs.dark }}>
              {Math.round(eatenTotals.carbs)}g
            </p>
            <p className="text-xs" style={{ color: COLORS.macros.carbs.dark }}>
              of {Math.round(dailyTotals.carbs)}g
            </p>
            <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(calculatePercentage(eatenTotals.carbs, dailyTotals.carbs), 100)}%`,
                  backgroundColor: COLORS.macros.carbs.main,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Meal Cards with Swipe Handler */}
      <SwipeHandler
        onSwipeLeft={handleSwipeLeft}
        onSwipeRight={handleSwipeRight}
        showHint={isMobile}
      >
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 stagger-container">
            {dayData.meals.map((meal, index) => {
              const dayKey = `day${selectedDay}`;
              const isEaten = eatenMeals?.[dayKey]?.[index] || false;

              return (
                <div key={index} className="stagger-item">
                  <MealCard
                    meal={meal}
                    isEaten={isEaten}
                    onToggleEaten={() => onToggleMealEaten(selectedDay, index)}
                    onViewRecipe={() => setSelectedMeal(meal)}
                    showNutrition={true}
                    nutritionalTargets={nutritionalTargets}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </SwipeHandler>

      {/* Day Completion Badge */}
      {completedDays.includes(selectedDay) && (
        <div
          className="p-4 m-4 rounded-lg text-center animate-bounceIn"
          style={{
            backgroundColor: COLORS.success.light,
            border: `2px solid ${COLORS.success.main}`,
          }}
        >
          <CheckCircle
            size={32}
            className="mx-auto mb-2"
            style={{ color: COLORS.success.main }}
          />
          <p className="font-bold" style={{ color: COLORS.success.dark }}>
            Day {selectedDay} Complete! 🎉
          </p>
          <p className="text-sm" style={{ color: COLORS.success.dark }}>
            All meals eaten for today
          </p>
        </div>
      )}
    </div>
  );
};

export default MealPlanDisplay;