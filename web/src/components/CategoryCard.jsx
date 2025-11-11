// web/src/components/CategoryCard.jsx
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';
import { COLORS, SHADOWS, RADIUS, TRANSITIONS } from '../constants';
import { formatGrams } from '../helpers';
import useReducedMotion from '../hooks/useReducedMotion';

/**
 * Enhanced category card for shopping list
 * Features: smooth expansion, staggered children, spring animations
 */
const CategoryCard = ({
  category,
  items = [],
  categoryIcon = '🛒',
  gradientColors = null,
  isExpanded = false,
  onToggle,
  checkedItems = {},
  onToggleItem,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  
  const categoryCheckedCount = items.filter(item => 
    checkedItems[item.originalIngredient]
  ).length;
  
  const allChecked = items.length > 0 && categoryCheckedCount === items.length;
  
  const gradientStyle = gradientColors 
    ? { background: `linear-gradient(135deg, ${gradientColors[0]} 0%, ${gradientColors[1]} 100%)` }
    : { backgroundColor: COLORS.gray[100] };

  return (
    <div
      className="bg-white rounded-xl overflow-hidden border transition-all duration-200"
      style={{ 
        borderColor: isExpanded ? COLORS.primary[200] : COLORS.gray[200],
        boxShadow: isHovered ? SHADOWS.md : SHADOWS.sm,
        transform: isHovered && !prefersReducedMotion ? 'translateY(-2px)' : 'translateY(0)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        style={{ transition: TRANSITIONS.fast }}
      >
        <div className="flex items-center space-x-3">
          {/* Icon with gradient background */}
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
            style={{
              ...gradientStyle,
              boxShadow: SHADOWS.sm,
            }}
          >
            {categoryIcon}
          </div>
          
          <div className="text-left">
            <h3 
              className="font-bold text-lg"
              style={{ 
                color: COLORS.gray[900],
                fontFamily: 'var(--font-family-display)',
              }}
            >
              {category}
            </h3>
            <p className="text-sm" style={{ color: COLORS.gray[500] }}>
              {categoryCheckedCount} of {items.length} items
              {allChecked && ' ✓'}
            </p>
          </div>
        </div>
        
        {/* Chevron with rotation animation */}
        <div 
          className="transition-transform duration-300"
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <ChevronDown style={{ color: COLORS.gray[400] }} />
        </div>
      </button>

      {/* Category Items with staggered animation */}
      {isExpanded && (
        <div 
          className="border-t"
          style={{ borderColor: COLORS.gray[200] }}
        >
          <div className={prefersReducedMotion ? '' : 'stagger-children'}>
            {items.map((item, index) => {
              const isChecked = checkedItems[item.originalIngredient] || false;

              return (
                <div
                  key={item.originalIngredient || index}
                  className="flex items-center p-4 border-b last:border-b-0 transition-all duration-200"
                  style={{ 
                    borderColor: COLORS.gray[100],
                    backgroundColor: isChecked ? COLORS.gray[50] : 'transparent',
                    opacity: isChecked ? 0.6 : 1,
                    transform: isChecked && !prefersReducedMotion ? 'scale(0.98)' : 'scale(1)',
                  }}
                >
                  {/* Checkbox with animation */}
                  <button
                    onClick={() => onToggleItem(item.originalIngredient)}
                    className="w-8 h-8 rounded-lg border-2 flex items-center justify-center mr-3 transition-all duration-300 flex-shrink-0"
                    style={{
                      borderColor: isChecked ? COLORS.success.main : COLORS.gray[300],
                      backgroundColor: isChecked ? COLORS.success.main : 'transparent',
                      transform: isChecked && !prefersReducedMotion ? 'rotate(360deg)' : 'rotate(0deg)',
                    }}
                  >
                    {isChecked && (
                      <Check size={18} className="text-white animate-scaleIn" />
                    )}
                  </button>

                  {/* Item Details */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-semibold truncate ${
                        isChecked ? 'line-through' : ''
                      }`}
                      style={{ 
                        color: COLORS.gray[900],
                        transition: TRANSITIONS.base,
                      }}
                    >
                      {item.originalIngredient}
                    </p>
                    <div className="flex items-center space-x-2 text-sm">
                      <span style={{ color: COLORS.gray[500] }}>
                        {formatGrams(item.totalGramsRequired)}
                      </span>
                      {item.quantityUnits && (
                        <>
                          <span style={{ color: COLORS.gray[400] }}>•</span>
                          <span style={{ color: COLORS.gray[500] }}>
                            {item.quantityUnits}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoryCard;