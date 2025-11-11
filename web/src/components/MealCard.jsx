// web/src/components/MealCard.jsx
import React, { useState } from 'react';
import { CheckCircle, Clock, ChefHat, Flame, Eye, Circle } from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';
import { formatCalories, formatGrams } from '../helpers';
import useReducedMotion from '../hooks/useReducedMotion';

/**
 * Enhanced meal card component with hover states and gradient overlays
 * Features: image thumbnails, floating badges, smooth transitions
 */
const MealCard = ({
  meal,
  isEaten = false,
  onToggleEaten,
  onViewRecipe,
  showNutrition = true,
  nutritionalTargets = {},
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  if (!meal || typeof meal !== 'object') return null;

  const mealName = meal.name || 'Unnamed Meal';
  const mealDesc = meal.description || 'No description available.';
  const mealType = meal.type || 'Meal';
  const prepTime = meal.prepTime || '15 min';

  const macros = {
    calories: Math.round(meal.subtotal_kcal || 0),
    protein: Math.round(meal.subtotal_protein || 0),
    fat: Math.round(meal.subtotal_fat || 0),
    carbs: Math.round(meal.subtotal_carbs || 0),
  };

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
      className="rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer group"
      style={{
        backgroundColor: '#ffffff',
        border: `2px solid ${isEaten ? COLORS.success.main : COLORS.gray[200]}`,
        boxShadow: isHovered ? SHADOWS.lg : SHADOWS.sm,
        transform: isHovered && !prefersReducedMotion ? 'translateY(-4px)' : 'translateY(0)',
        opacity: isEaten ? 0.7 : 1,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onViewRecipe}
    >
      {/* Image Thumbnail with Gradient Overlay */}
      <div className="relative h-48 bg-gradient-to-br from-indigo-100 to-purple-100 overflow-hidden">
        {/* Placeholder gradient background */}
        <div 
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${COLORS.primary[100]} 0%, ${COLORS.accent[100]} 100%)`,
          }}
        />
        
        {/* Icon overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <ChefHat 
            size={64} 
            style={{ color: COLORS.primary[300], opacity: 0.4 }} 
          />
        </div>

        {/* Gradient overlay on hover */}
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{
            background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%)',
            opacity: isHovered ? 1 : 0,
          }}
        />

        {/* Floating badges */}
        <div className="absolute top-3 left-3 flex space-x-2">
          {/* Meal type badge */}
          <span
            className="px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-1"
            style={{
              backgroundColor: badge.bg,
              color: badge.text,
            }}
          >
            <span>{badge.icon}</span>
            <span>{mealType}</span>
          </span>
        </div>

        {/* Eaten checkmark */}
        {isEaten && (
          <div className="absolute top-3 right-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: COLORS.success.main }}
            >
              <CheckCircle size={20} className="text-white" />
            </div>
          </div>
        )}

        {/* View Recipe button on hover */}
        {isHovered && (
          <button
            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-2 bg-white rounded-lg flex items-center space-x-2 animate-fadeInUp shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              onViewRecipe && onViewRecipe();
            }}
            style={{ color: COLORS.primary[600] }}
          >
            <Eye size={16} />
            <span className="font-semibold text-sm">View Recipe</span>
          </button>
        )}
      </div>

      {/* Card Content */}
      <div className="p-4">
        {/* Meal Name */}
        <h3
          className="text-lg font-bold mb-2 line-clamp-2"
          style={{
            color: COLORS.gray[900],
            fontFamily: 'var(--font-family-display)',
          }}
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

        {/* Prep Time */}
        <div className="flex items-center mb-4 text-sm" style={{ color: COLORS.gray[500] }}>
          <Clock size={14} className="mr-1" />
          <span>{prepTime}</span>
        </div>

        {/* Macros Pills */}
        {showNutrition && (
          <div className="flex flex-wrap gap-2">
            <div
              className="px-3 py-1 rounded-full flex items-center space-x-1 text-xs font-semibold"
              style={{
                backgroundColor: COLORS.macros.calories.light,
                color: COLORS.macros.calories.dark,
              }}
            >
              <Flame size={12} />
              <span>{formatCalories(macros.calories)}</span>
            </div>

            <div
              className="px-3 py-1 rounded-full flex items-center space-x-1 text-xs font-semibold"
              style={{
                backgroundColor: COLORS.macros.protein.light,
                color: COLORS.macros.protein.dark,
              }}
            >
              <span>P:</span>
              <span>{macros.protein}g</span>
            </div>

            <div
              className="px-3 py-1 rounded-full flex items-center space-x-1 text-xs font-semibold"
              style={{
                backgroundColor: COLORS.macros.carbs.light,
                color: COLORS.macros.carbs.dark,
              }}
            >
              <span>C:</span>
              <span>{macros.carbs}g</span>
            </div>

            <div
              className="px-3 py-1 rounded-full flex items-center space-x-1 text-xs font-semibold"
              style={{
                backgroundColor: COLORS.macros.fats.light,
                color: COLORS.macros.fats.dark,
              }}
            >
              <span>F:</span>
              <span>{macros.fat}g</span>
            </div>
          </div>
        )}

        {/* Mark as Eaten Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleEaten && onToggleEaten();
          }}
          className="mt-4 w-full py-2 rounded-lg font-semibold text-sm transition-all duration-200"
          style={{
            backgroundColor: isEaten ? COLORS.gray[100] : COLORS.success.light,
            color: isEaten ? COLORS.gray[600] : COLORS.success.dark,
            border: `2px solid ${isEaten ? COLORS.gray[300] : COLORS.success.main}`,
          }}
        >
          {isEaten ? '✓ Eaten' : 'Mark as Eaten'}
        </button>
      </div>
    </div>
  );
};

export default MealCard;