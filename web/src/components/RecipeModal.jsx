// web/src/components/RecipeModal.jsx
import React, { useEffect, useState } from ‘react’;
import { X, Clock, Users, ChefHat, ListChecks, ListOrdered, Flame } from ‘lucide-react’;
import { COLORS, Z_INDEX, SHADOWS } from ‘../constants’;
import { prefersReducedMotion } from ‘../utils/animationHelpers’;

/**

- Recipe Modal - Enhanced with flip animation
- Features:
- - Smooth flip animation on open
- - Better visual hierarchy
- - Improved readability
- - Enhanced transitions
    */
    const RecipeModal = ({ meal, onClose }) => {
    const [isVisible, setIsVisible] = useState(false);

useEffect(() => {
if (meal) {
// Trigger animation after mount
setTimeout(() => setIsVisible(true), 10);
}
}, [meal]);

const handleClose = () => {
if (prefersReducedMotion()) {
onClose();
return;
}

```
setIsVisible(false);
setTimeout(() => onClose(), 300);
```

};

if (!meal) return null;

const mealName = meal.name || ‘Recipe’;
const mealDesc = meal.description || ‘’;
const prepTime = meal.prepTime || ‘15 min’;
const servings = meal.servings || 1;

const macros = {
calories: Math.round(meal.subtotal_kcal || 0),
protein: Math.round(meal.subtotal_protein || 0),
fat: Math.round(meal.subtotal_fat || 0),
carbs: Math.round(meal.subtotal_carbs || 0),
};

return (
<>
{/* Backdrop */}
<div
className={`fixed inset-0 bg-black transition-opacity duration-300 ${ isVisible ? 'bg-opacity-50' : 'bg-opacity-0' }`}
style={{ zIndex: Z_INDEX.modalBackdrop }}
onClick={handleClose}
/>

```
  {/* Modal */}
  <div
    className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
    style={{ zIndex: Z_INDEX.modal }}
  >
    <div
      className={`bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden pointer-events-auto transition-all duration-400 ${
        isVisible
          ? prefersReducedMotion()
            ? 'opacity-100 scale-100'
            : 'animate-flipIn'
          : 'opacity-0 scale-95'
      }`}
      style={{
        boxShadow: SHADOWS['2xl'],
      }}
    >
      {/* Header */}
      <div
        className="relative p-6"
        style={{
          background: `linear-gradient(135deg, ${COLORS.primary[500]} 0%, ${COLORS.secondary[500]} 100%)`,
        }}
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 transition-fast"
          aria-label="Close modal"
        >
          <X size={24} className="text-white" />
        </button>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white mb-2 pr-12">
          {mealName}
        </h2>

        {/* Description */}
        {mealDesc && (
          <p className="text-white text-opacity-90 text-sm">
            {mealDesc}
          </p>
        )}

        {/* Meta Info */}
        <div className="flex items-center space-x-4 mt-4 text-white text-sm">
          <div className="flex items-center">
            <Clock size={16} className="mr-1" />
            <span>{prepTime}</span>
          </div>
          <div className="flex items-center">
            <Users size={16} className="mr-1" />
            <span>{servings} serving{servings > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center">
            <Flame size={16} className="mr-1" />
            <span className="font-bold">{macros.calories} cal</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto p-6" style={{ maxHeight: 'calc(90vh - 200px)' }}>
        {/* Macros Summary */}
        <div className="grid grid-cols-3 gap-3 mb-6">
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
            <p className="text-xl font-bold" style={{ color: COLORS.macros.protein.dark }}>
              {macros.protein}g
            </p>
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
            <p className="text-xl font-bold" style={{ color: COLORS.macros.fat.dark }}>
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
            <p className="text-xl font-bold" style={{ color: COLORS.macros.carbs.dark }}>
              {macros.carbs}g
            </p>
          </div>
        </div>

        {/* Ingredients */}
        {meal.items && meal.items.length > 0 && (
          <div className="mb-6">
            <h3
              className="text-lg font-bold flex items-center mb-3"
              style={{ color: COLORS.gray[900] }}
            >
              <ListChecks size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
              Ingredients
            </h3>
            <ul className="space-y-2">
              {meal.items.map((item, index) => (
                <li
                  key={index}
                  className="flex items-start p-3 rounded-lg hover:bg-gray-50 transition-fast"
                  style={{
                    backgroundColor: COLORS.gray[50],
                  }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mr-3 mt-0.5"
                    style={{
                      backgroundColor: COLORS.primary[100],
                      color: COLORS.primary[700],
                    }}
                  >
                    <span className="text-xs font-bold">{index + 1}</span>
                  </div>
                  <div className="flex-1">
                    <span className="font-medium" style={{ color: COLORS.gray[900] }}>
                      {item.qty}{item.unit}
                    </span>
                    <span style={{ color: COLORS.gray[700] }}> {item.key}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Instructions */}
        {meal.instructions && meal.instructions.length > 0 && (
          <div>
            <h3
              className="text-lg font-bold flex items-center mb-3"
              style={{ color: COLORS.gray[900] }}
            >
              <ListOrdered size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
              Instructions
            </h3>
            <ol className="space-y-3">
              {meal.instructions.map((step, index) => (
                <li
                  key={index}
                  className="flex items-start p-4 rounded-lg"
                  style={{
                    backgroundColor: COLORS.gray[50],
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mr-3"
                    style={{
                      backgroundColor: COLORS.primary[500],
                      color: '#ffffff',
                    }}
                  >
                    <span className="font-bold">{index + 1}</span>
                  </div>
                  <p
                    className="flex-1 leading-relaxed"
                    style={{ color: COLORS.gray[700] }}
                  >
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Empty State */}
        {(!meal.items || meal.items.length === 0) && (!meal.instructions || meal.instructions.length === 0) && (
          <div className="text-center py-8">
            <ChefHat size={48} className="mx-auto mb-3" style={{ color: COLORS.gray[300] }} />
            <p style={{ color: COLORS.gray[500] }}>
              No recipe details available for this meal.
            </p>
          </div>
        )}
      </div>
    </div>
  </div>
</>
```

);
};

export default RecipeModal;