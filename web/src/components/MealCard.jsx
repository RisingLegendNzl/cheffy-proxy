// web/src/components/MealCard.jsx
import React from 'react';
import { CheckCircle, Clock, ChefHat, Flame, Heart, Eye } from 'lucide-react';
import { COLORS, SPACING, SHADOWS } from '../constants';
import { formatCalories, formatGrams } from '../helpers';

/**
 * Enhanced meal card component with better visuals and interactions
 * Extracted from MealPlanDisplay for reusability
 */
const MealCard = ({
  meal,
  isEaten = false,
  onToggleEaten,
  onViewRecipe,
  showNutrition = true,
  nutritionalTargets = {},
}) => {
  if (!meal || typeof meal !== 'object') return null;

  const mealName = meal.name || 'Unnamed Meal';
  const mealDesc = meal.description || 'No description available.';
  const mealType = meal.type || 'Meal';
  const prepTime = meal.prepTime || '15 min'; // TODO: Add to meal data

  const macros = {
    calories: Math.round(meal.subtotal_kcal || 0),
    protein: Math.round(meal.subtotal_protein || 0),
    fat: Math.round(meal.subtotal_fat || 0),
    carbs: Math.round(meal.subtotal_carbs || 0),
  };

  // Calculate percentage of daily target
  const percentOfDaily = {
    cal: nutritionalTargets.calories > 0
      ? Math.round((macros.calories / nutritionalTargets.calories) * 100)
      : 0,
    protein: nutritionalTargets.protein > 0
      ? Math.round((macros.protein / nutritionalTargets.protein) * 100)
      : 0,
  };

  const isHighProtein = percentOfDaily.protein >= 30;

  // Meal type badge colors
  const getMealTypeBadge = () => {
    const typeMap = {
      breakfast: { bg: COLORS.warning.light, text: COLORS.warning.dark, icon: '🌅' },
      lunch: { bg: COLORS.info.light, text: COLORS.info.dark, icon: '☀️' },
      dinner: { bg: COLORS.secondary[100], text: COLORS.secondary[700], icon: '🌙' },
      snack: { bg: COLORS.success.light, text: COLORS.success.dark, icon: '🍎' },
    };
    const key = mealType.toLowerCase();
    return typeMap[key] || { bg: COLORS.gray[100], text: COLORS.gray[700], icon: '🍽️' };
  };

  const badge = getMealTypeBadge();

  return (
    <div
      className={`rounded-xl overflow-hidden transition-all duration-300 cursor-pointer group ${
        isEaten ? 'opacity-60' : 'hover-lift'
      }`}
      style={{
        backgroundColor: '#ffffff',
        border: `2px solid ${isEaten ? COLORS.success.main : COLORS.primary[200]}`,
        boxShadow: SHADOWS.md,
      }}
      onClick={() => onViewRecipe && onViewRecipe(meal)}
    >
      {/* Header with Image Placeholder */}
      <div
        className="relative h-32 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${COLORS.primary[400]} 0%, ${COLORS.secondary[500]} 100%)`,
        }}
      >
        {/* Decorative Pattern Overlay */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 left-4">
            <ChefHat size={60} className="text-white" />
          </div>
          <div className="absolute bottom-4 right-4">
            <ChefHat size={40} className="text-white" />
          </div>
        </div>

        {/* Meal Type Badge */}
        <div
          className="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold flex items-center"
          style={{
            backgroundColor: badge.bg,
            color: badge.text,
          }}
        >
          <span className="mr-1">{badge.icon}</span>
          {mealType.toUpperCase()}
        </div>

        {/* High Protein Badge */}
        {isHighProtein && (
          <div
            className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold"
            style={{
              backgroundColor: COLORS.success.main,
              color: '#ffffff',
            }}
          >
            💪 High Protein
          </div>
        )}

        {/* Eaten Checkmark */}
        {isEaten && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(16, 185, 129, 0.9)' }}
          >
            <CheckCircle size={48} className="text-white" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        {/* Title */}
        <h3
          className="text-xl font-bold mb-2 group-hover:text-indigo-600 transition-colors"
          style={{ color: COLORS.gray[900] }}
        >
          {mealName}
        </h3>

        {/* Description */}
        <p
          className="text-sm mb-4 line-clamp-2"
          style={{ color: COLORS.gray[600] }}
        >
          {mealDesc}
        </p>

        {/* Quick Stats */}
        <div className="flex items-center space-x-4 mb-4 text-sm">
          <div className="flex items-center" style={{ color: COLORS.error.main }}>
            <Flame size={16} className="mr-1" />
            <span className="font-bold">{formatCalories(macros.calories, false)}</span>
          </div>
          <div className="flex items-center" style={{ color: COLORS.gray[500] }}>
            <Clock size={16} className="mr-1" />
            <span>{prepTime}</span>
          </div>
          <div className="flex items-center" style={{ color: COLORS.gray[500] }}>
            <ChefHat size={16} className="mr-1" />
            <span>{meal.items?.length || 0} ingredients</span>
          </div>
        </div>

        {/* Macros Grid */}
        {showNutrition && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div
              className="p-3 rounded-lg text-center"
              style={{
                backgroundColor: COLORS.macros.protein.light,
                border: `1px solid ${COLORS.macros.protein.main}`,
              }}
            >
              <p className="text-xs font-semibold mb-1" style={{ color: COLORS.macros.protein.dark }}>
                Protein
              </p>
              <p className="text-lg font-bold" style={{ color: COLORS.macros.protein.dark }}>
                {macros.protein}g
              </p>
              {percentOfDaily.protein > 0 && (
                <p className="text-xs" style={{ color: COLORS.macros.protein.dark }}>
                  {percentOfDaily.protein}%
                </p>
              )}
            </div>

            <div
              className="p-3 rounded-lg text-center"
              style={{
                backgroundColor: COLORS.macros.fat.light,
                border: `1px solid ${COLORS.macros.fat.main}`,
              }}
            >
              <p className="text-xs font-semibold mb-1" style={{ color: COLORS.macros.fat.dark }}>
                Fat
              </p>
              <p className="text-lg font-bold" style={{ color: COLORS.macros.fat.dark }}>
                {macros.fat}g
              </p>
            </div>

            <div
              className="p-3 rounded-lg text-center"
              style={{
                backgroundColor: COLORS.macros.carbs.light,
                border: `1px solid ${COLORS.macros.carbs.main}`,
              }}
            >
              <p className="text-xs font-semibold mb-1" style={{ color: COLORS.macros.carbs.dark }}>
                Carbs
              </p>
              <p className="text-lg font-bold" style={{ color: COLORS.macros.carbs.dark }}>
                {macros.carbs}g
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleEaten && onToggleEaten();
            }}
            className={`flex-1 flex items-center justify-center py-2 px-4 rounded-lg font-semibold transition-all duration-200 ${
              isEaten ? 'bg-green-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
            style={{
              color: isEaten ? '#ffffff' : COLORS.gray[700],
            }}
          >
            <CheckCircle size={16} className="mr-2" />
            {isEaten ? 'Eaten' : 'Mark as Eaten'}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewRecipe && onViewRecipe(meal);
            }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-fast"
            style={{ color: COLORS.primary[600] }}
            aria-label="View recipe"
          >
            <Eye size={20} />
          </button>
        </div>

        {/* Calorie Percentage */}
        {percentOfDaily.cal > 0 && (
          <p className="text-xs text-center mt-3" style={{ color: COLORS.gray[500] }}>
            {percentOfDaily.cal}% of daily calories
          </p>
        )}
      </div>
    </div>
  );
};

export default MealCard;