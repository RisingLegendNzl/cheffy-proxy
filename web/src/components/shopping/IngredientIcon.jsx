// web/src/components/shopping/IngredientIcon.jsx
import React from ‘react’;
import { Apple, Fish, Milk, Wheat, Egg, Cookie, Beef, Carrot, Droplet, Cherry, Salad, Croissant, IceCream, ShoppingBag } from ‘lucide-react’;
import { COLORS } from ‘../../constants’;

/**

- Ingredient Icon - Illustrative icons for ingredients
- Extends EmojiIcon pattern with more variety
- Features:
- - Category-based icon mapping
- - Watercolor-style colors
- - Fallback to generic icon
    */
    const IngredientIcon = ({ ingredient, size = 32 }) => {
    // Normalize ingredient name
    const normalized = (ingredient || ‘’).toLowerCase().trim();

// Icon mapping based on keywords
const getIcon = () => {
// Fruits
if (
normalized.includes(‘apple’) ||
normalized.includes(‘fruit’) ||
normalized.includes(‘berry’)
) {
return { Icon: Apple, color: ‘#ef4444’ };
}
if (normalized.includes(‘cherry’) || normalized.includes(‘grape’)) {
return { Icon: Cherry, color: ‘#dc2626’ };
}

```
// Vegetables
if (
  normalized.includes('carrot') ||
  normalized.includes('vegetable') ||
  normalized.includes('veg')
) {
  return { Icon: Carrot, color: '#f97316' };
}
if (
  normalized.includes('salad') ||
  normalized.includes('lettuce') ||
  normalized.includes('spinach') ||
  normalized.includes('kale')
) {
  return { Icon: Salad, color: '#10b981' };
}

// Proteins
if (
  normalized.includes('fish') ||
  normalized.includes('salmon') ||
  normalized.includes('tuna') ||
  normalized.includes('seafood')
) {
  return { Icon: Fish, color: '#3b82f6' };
}
if (
  normalized.includes('beef') ||
  normalized.includes('meat') ||
  normalized.includes('chicken') ||
  normalized.includes('pork')
) {
  return { Icon: Beef, color: '#b91c1c' };
}
if (normalized.includes('egg')) {
  return { Icon: Egg, color: '#fbbf24' };
}

// Dairy
if (
  normalized.includes('milk') ||
  normalized.includes('dairy') ||
  normalized.includes('cheese') ||
  normalized.includes('yogurt')
) {
  return { Icon: Milk, color: '#f3f4f6' };
}
if (
  normalized.includes('cream') ||
  normalized.includes('ice cream') ||
  normalized.includes('frozen')
) {
  return { Icon: IceCream, color: '#fde68a' };
}

// Grains & Carbs
if (
  normalized.includes('wheat') ||
  normalized.includes('bread') ||
  normalized.includes('grain') ||
  normalized.includes('rice') ||
  normalized.includes('pasta')
) {
  return { Icon: Wheat, color: '#d97706' };
}
if (
  normalized.includes('croissant') ||
  normalized.includes('pastry') ||
  normalized.includes('bakery')
) {
  return { Icon: Croissant, color: '#f59e0b' };
}

// Snacks & Treats
if (
  normalized.includes('cookie') ||
  normalized.includes('snack') ||
  normalized.includes('chip')
) {
  return { Icon: Cookie, color: '#92400e' };
}

// Beverages
if (
  normalized.includes('water') ||
  normalized.includes('drink') ||
  normalized.includes('beverage') ||
  normalized.includes('juice')
) {
  return { Icon: Droplet, color: '#0ea5e9' };
}

// Default
return { Icon: ShoppingBag, color: COLORS.gray[500] };
```

};

const { Icon, color } = getIcon();

return (
<div
className=“rounded-lg flex items-center justify-center”
style={{
width: size,
height: size,
backgroundColor: `${color}20`,
}}
>
<Icon size={size * 0.6} style={{ color }} />
</div>
);
};

export default IngredientIcon;