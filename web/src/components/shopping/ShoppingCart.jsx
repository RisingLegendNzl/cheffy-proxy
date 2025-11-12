// web/src/components/shopping/ShoppingCart.jsx
import React from ‘react’;
import { ShoppingCart as CartIcon, Trash2 } from ‘lucide-react’;
import { COLORS } from ‘../../constants’;
import { prefersReducedMotion, calculateStrokeDashoffset } from ‘../../utils/animationHelpers’;

/**

- Shopping Cart - Animated cart showing collected items
- Features:
- - Gentle sway animation
- - Progress ring showing % complete
- - Collected items list
- - Clear all button
    */
    const ShoppingCart = ({ items, progress, onClear }) => {
    // Calculate total cost
    const totalCost = items.reduce((sum, item) => {
    const product = item.allProducts?.[0];
    if (product) {
    return sum + (product.price * (item.userQuantity || 1));
    }
    return sum;
    }, 0);

// Progress ring calculations
const ringSize = 80;
const strokeWidth = 6;
const radius = (ringSize - strokeWidth) / 2;
const circumference = 2 * Math.PI * radius;
const offset = calculateStrokeDashoffset(radius, progress);

return (
<div
className={`bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl shadow-xl border-2 p-6 ${ prefersReducedMotion() ? '' : 'animate-cartSway' }`}
style={{
borderColor: COLORS.success.main,
}}
>
{/* Header */}
<div className="flex items-center justify-between mb-6">
<div className="flex items-center space-x-3">
<div
className=“w-12 h-12 rounded-full flex items-center justify-center”
style={{
backgroundColor: COLORS.success.main,
}}
>
<CartIcon size={24} className="text-white" />
</div>
<div>
<h3 className=“text-xl font-bold” style={{ color: COLORS.success.dark }}>
Shopping Cart
</h3>
<p className=“text-sm” style={{ color: COLORS.success.dark }}>
{items.length} items collected
</p>
</div>
</div>

```
    {/* Progress Ring */}
    <div className="relative" style={{ width: ringSize, height: ringSize }}>
      <svg
        className="transform -rotate-90"
        width={ringSize}
        height={ringSize}
      >
        <circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={radius}
          stroke={COLORS.success.light}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={radius}
          stroke={COLORS.success.main}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold" style={{ color: COLORS.success.dark }}>
          {progress}%
        </span>
      </div>
    </div>
  </div>

  {/* Items List */}
  <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
    {items.map((item, index) => {
      const product = item.allProducts?.[0];
      const itemCost = product ? product.price * (item.userQuantity || 1) : 0;

      return (
        <div
          key={item.key || index}
          className="flex items-center justify-between p-3 bg-white rounded-lg"
        >
          <div className="flex-1">
            <p className="font-semibold text-sm" style={{ color: COLORS.gray[900] }}>
              {item.key}
            </p>
            <p className="text-xs" style={{ color: COLORS.gray[500] }}>
              Qty: {item.userQuantity || 1}
            </p>
          </div>
          {product && (
            <p className="font-bold text-sm" style={{ color: COLORS.success.main }}>
              ${itemCost.toFixed(2)}
            </p>
          )}
        </div>
      );
    })}
  </div>

  {/* Total Cost */}
  {totalCost > 0 && (
    <div
      className="p-4 rounded-lg mb-4"
      style={{
        backgroundColor: COLORS.success.main,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold text-white">Total Cost</span>
        <span className="text-2xl font-bold text-white">${totalCost.toFixed(2)}</span>
      </div>
    </div>
  )}

  {/* Clear Button */}
  <button
    onClick={onClear}
    className="w-full flex items-center justify-center py-3 rounded-lg font-semibold hover-lift transition-spring"
    style={{
      backgroundColor: COLORS.error.light,
      color: COLORS.error.dark,
    }}
  >
    <Trash2 size={18} className="mr-2" />
    Clear Cart
  </button>
</div>
```

);
};

export default ShoppingCart;