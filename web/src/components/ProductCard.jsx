// web/src/components/ProductCard.jsx
import React from ‘react’;
import { ExternalLink, Check } from ‘lucide-react’;
import { COLORS } from ‘../constants’;

/**

- Product Card - Enhanced with hover lift and selection animation
- Features:
- - Better shadow depth
- - Taken-off-shelf slide animation when selected
- - Improved visual hierarchy
    */
    const ProductCard = ({ product, isSelected, onSelect }) => {
    if (!product) return null;

const {
productName = ‘Unknown Product’,
size = ‘N/A’,
price = 0,
url = ‘’,
} = product;

return (
<button
onClick={onSelect}
className={`w-full p-4 rounded-lg border-2 text-left transition-all duration-300 ${ isSelected ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover-lift hover:border-indigo-300' }`}
style={{
boxShadow: isSelected ? COLORS.shadows.success : COLORS.shadows.base,
}}
>
<div className="flex items-start justify-between">
{/* Product Info */}
<div className="flex-1 pr-4">
<h4
className=“font-semibold mb-1 line-clamp-2”
style={{
color: isSelected ? COLORS.success.dark : COLORS.gray[900],
}}
>
{productName}
</h4>
<p className=“text-sm mb-2” style={{ color: COLORS.gray[600] }}>
{size}
</p>

```
      {/* Price */}
      <div className="flex items-center space-x-2">
        <span
          className="text-lg font-bold"
          style={{
            color: isSelected ? COLORS.success.main : COLORS.gray[900],
          }}
        >
          ${price.toFixed(2)}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs flex items-center hover:underline"
            style={{ color: COLORS.primary[600] }}
          >
            View <ExternalLink size={12} className="ml-1" />
          </a>
        )}
      </div>
    </div>

    {/* Selection Indicator */}
    <div
      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
        isSelected ? 'bg-green-500 scale-110' : 'bg-gray-200'
      }`}
    >
      {isSelected && <Check size={18} className="text-white" />}
    </div>
  </div>

  {/* Selected Badge */}
  {isSelected && (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: COLORS.success.light }}>
      <span
        className="text-xs font-bold"
        style={{ color: COLORS.success.dark }}
      >
        ✓ Currently Selected
      </span>
    </div>
  )}
</button>
```

);
};

export default ProductCard;