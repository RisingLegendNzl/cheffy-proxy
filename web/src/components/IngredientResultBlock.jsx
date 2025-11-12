// web/src/components/IngredientResultBlock.jsx
import React, { useState } from ‘react’;
import { ChevronDown, ChevronUp, AlertCircle, Package } from ‘lucide-react’;
import { COLORS } from ‘../constants’;
import ProductCard from ‘./ProductCard’;
import IngredientIcon from ‘./shopping/IngredientIcon’;
import { prefersReducedMotion } from ‘../utils/animationHelpers’;

/**

- Ingredient Result Block - Enhanced with illustrative icons
- Features:
- - Illustrative icons (watercolor veggies, sketched meat)
- - Fresh badge for high-nutrient items
- - Smooth accordion expand/collapse with elastic easing
- - Better visual hierarchy
    */
    const IngredientResultBlock = ({
    ingredientKey,
    ingredientData,
    onProductSelect,
    onQuantityChange,
    }) => {
    const [isExpanded, setIsExpanded] = useState(false);

if (!ingredientData) return null;

const {
source,
allProducts = [],
currentSelectionURL,
userQuantity = 1,
nutritionData,
} = ingredientData;

const selectedProduct = allProducts.find(p => p && p.url === currentSelectionURL);
const hasMultipleOptions = allProducts.length > 1;
const isDiscovery = source === ‘discovery’;

// Determine if item is “fresh” (high nutrient density)
const isFresh = nutritionData && (
(nutritionData.protein_per_100g || 0) > 15 ||
(nutritionData.fiber_per_100g || 0) > 5
);

const handleToggle = () => {
setIsExpanded(!isExpanded);
};

return (
<div
className=“bg-white rounded-xl shadow-lg border overflow-hidden hover-lift transition-spring”
style={{
borderColor: COLORS.gray[200],
}}
>
{/* Header */}
<button
onClick={handleToggle}
className="w-full p-6 flex items-start justify-between hover:bg-gray-50 transition-fast"
>
<div className="flex items-start flex-1 text-left">
{/* Ingredient Icon */}
<div className="mr-4 flex-shrink-0">
<IngredientIcon ingredient={ingredientKey} size={48} />
</div>

```
      {/* Info */}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-lg font-bold" style={{ color: COLORS.gray[900] }}>
            {ingredientKey}
          </h3>
          
          {/* Fresh Badge */}
          {isFresh && (
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                prefersReducedMotion() ? '' : 'animate-pulse'
              }`}
              style={{
                backgroundColor: COLORS.success.light,
                color: COLORS.success.dark,
              }}
            >
              ✨ Fresh
            </span>
          )}
        </div>

        {/* Selected Product or Status */}
        {isDiscovery && selectedProduct ? (
          <div className="space-y-1">
            <p className="text-sm font-medium" style={{ color: COLORS.gray[700] }}>
              {selectedProduct.productName || 'Selected Product'}
            </p>
            <div className="flex items-center space-x-3 text-xs" style={{ color: COLORS.gray[500] }}>
              <span>{selectedProduct.size || 'N/A'}</span>
              <span>•</span>
              <span className="font-bold" style={{ color: COLORS.success.main }}>
                ${(selectedProduct.price * userQuantity).toFixed(2)}
              </span>
              <span>•</span>
              <span>Qty: {userQuantity}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center text-sm" style={{ color: COLORS.gray[500] }}>
            <Package size={14} className="mr-1" />
            <span>{source === 'cache' ? 'From nutrition cache' : 'No products found'}</span>
          </div>
        )}

        {/* Options Count */}
        {hasMultipleOptions && (
          <p className="text-xs mt-2" style={{ color: COLORS.primary[600] }}>
            {allProducts.length} options available
          </p>
        )}
      </div>
    </div>

    {/* Expand/Collapse Icon */}
    <div className="ml-4 flex-shrink-0">
      {isExpanded ? (
        <ChevronUp size={20} style={{ color: COLORS.gray[400] }} />
      ) : (
        <ChevronDown size={20} style={{ color: COLORS.gray[400] }} />
      )}
    </div>
  </button>

  {/* Expanded Content */}
  {isExpanded && (
    <div
      className={`border-t px-6 py-4 space-y-4 ${
        prefersReducedMotion() ? '' : 'animate-fadeIn'
      }`}
      style={{
        borderColor: COLORS.gray[200],
        backgroundColor: COLORS.gray[50],
      }}
    >
      {/* Nutrition Info */}
      {nutritionData && (
        <div className="p-4 rounded-lg bg-white border" style={{ borderColor: COLORS.gray[200] }}>
          <h4 className="text-sm font-bold mb-3" style={{ color: COLORS.gray[900] }}>
            Nutrition (per 100g)
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs" style={{ color: COLORS.gray[500] }}>Calories</p>
              <p className="text-sm font-bold" style={{ color: COLORS.gray[900] }}>
                {Math.round(nutritionData.kcal_per_100g || 0)} kcal
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: COLORS.gray[500] }}>Protein</p>
              <p className="text-sm font-bold" style={{ color: COLORS.macros.protein.dark }}>
                {(nutritionData.protein_per_100g || 0).toFixed(1)}g
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: COLORS.gray[500] }}>Fat</p>
              <p className="text-sm font-bold" style={{ color: COLORS.macros.fat.dark }}>
                {(nutritionData.fat_per_100g || 0).toFixed(1)}g
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: COLORS.gray[500] }}>Carbs</p>
              <p className="text-sm font-bold" style={{ color: COLORS.macros.carbs.dark }}>
                {(nutritionData.carbs_per_100g || 0).toFixed(1)}g
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quantity Control */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-white border" style={{ borderColor: COLORS.gray[200] }}>
        <span className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
          Quantity
        </span>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => onQuantityChange && onQuantityChange(ingredientKey, Math.max(1, userQuantity - 1))}
            className="w-8 h-8 rounded-full flex items-center justify-center hover-lift transition-spring"
            style={{
              backgroundColor: COLORS.gray[100],
              color: COLORS.gray[700],
            }}
          >
            -
          </button>
          <span className="text-lg font-bold w-12 text-center" style={{ color: COLORS.gray[900] }}>
            {userQuantity}
          </span>
          <button
            onClick={() => onQuantityChange && onQuantityChange(ingredientKey, userQuantity + 1)}
            className="w-8 h-8 rounded-full flex items-center justify-center hover-lift transition-spring"
            style={{
              backgroundColor: COLORS.primary[500],
              color: '#ffffff',
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Product Options */}
      {isDiscovery && allProducts.length > 0 && (
        <div>
          <h4 className="text-sm font-bold mb-3" style={{ color: COLORS.gray[900] }}>
            Available Options
          </h4>
          <div className="space-y-3">
            {allProducts.map((product, index) => (
              <ProductCard
                key={index}
                product={product}
                isSelected={product.url === currentSelectionURL}
                onSelect={() => onProductSelect && onProductSelect(ingredientKey, product.url)}
              />
            ))}
          </div>
        </div>
      )}

      {/* No Products Message */}
      {isDiscovery && allProducts.length === 0 && (
        <div className="flex items-center justify-center p-6 text-center">
          <div>
            <AlertCircle size={32} className="mx-auto mb-2" style={{ color: COLORS.gray[400] }} />
            <p className="text-sm" style={{ color: COLORS.gray[500] }}>
              No products available for this ingredient
            </p>
          </div>
        </div>
      )}
    </div>
  )}
</div>
```

);
};

export default IngredientResultBlock;