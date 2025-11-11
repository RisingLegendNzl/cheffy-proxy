// web/src/components/DayCard.jsx
import React from 'react';
import { Utensils } from 'lucide-react';
import { COLORS, SHADOWS, RADIUS } from '../constants';
import { formatCalories } from '../helpers';

/**
 * Enhanced day card for day navigator
 * Shows mini preview with meal icons and calorie count
 */
const DayCard = ({
  day,
  isSelected = false,
  onClick,
  calorieCount = 0,
  mealCount = 3,
  className = '',
}) => {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 rounded-xl p-4 transition-all duration-300 ${className}`}
      style={{
        width: '160px',
        minWidth: '160px',
        backgroundColor: isSelected ? COLORS.primary[600] : COLORS.background.primary,
        border: `2px solid ${isSelected ? COLORS.primary[600] : COLORS.gray[200]}`,
        boxShadow: isSelected ? SHADOWS.primary : SHADOWS.sm,
        transform: isSelected ? 'scale(1.05)' : 'scale(1)',
        color: isSelected ? 'white' : COLORS.gray[900],
      }}
    >
      {/* Day Number */}
      <div className="text-center mb-3">
        <p 
          className="text-xs font-medium mb-1"
          style={{ 
            color: isSelected ? 'rgba(255,255,255,0.8)' : COLORS.gray[500],
            fontFamily: 'var(--font-family-body)',
          }}
        >
          Day
        </p>
        <p 
          className="text-3xl font-bold"
          style={{ 
            fontFamily: 'var(--font-family-display)',
            color: isSelected ? 'white' : COLORS.gray[900],
          }}
        >
          {day}
        </p>
      </div>

      {/* Mini Meal Icons */}
      <div className="flex justify-center space-x-1 mb-3">
        {Array.from({ length: mealCount }).map((_, i) => (
          <div
            key={i}
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: isSelected 
                ? 'rgba(255,255,255,0.2)' 
                : COLORS.gray[100],
            }}
          >
            <Utensils 
              size={12} 
              style={{ 
                color: isSelected ? 'white' : COLORS.gray[400] 
              }} 
            />
          </div>
        ))}
      </div>

      {/* Calorie Count */}
      <div 
        className="text-center pt-3 border-t"
        style={{ 
          borderColor: isSelected 
            ? 'rgba(255,255,255,0.2)' 
            : COLORS.gray[200] 
        }}
      >
        <p 
          className="text-sm font-semibold tabular-nums"
          style={{ 
            color: isSelected ? 'white' : COLORS.gray[600] 
          }}
        >
          {formatCalories(calorieCount)}
        </p>
        <p 
          className="text-xs"
          style={{ 
            color: isSelected 
              ? 'rgba(255,255,255,0.7)' 
              : COLORS.gray[400] 
          }}
        >
          calories
        </p>
      </div>
    </button>
  );
};

export default DayCard;