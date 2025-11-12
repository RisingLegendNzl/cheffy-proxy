// web/src/components/generation/ForgeStageThree.jsx
import React, { useEffect, useState } from ‘react’;
import { ChefHat, Sparkles } from ‘lucide-react’;
import { COLORS } from ‘../../constants’;
import { prefersReducedMotion, calculateStaggerDelay } from ‘../../utils/animationHelpers’;

/**

- Forge Stage Three - “Optimizing”
- Meal cards mint/forge one by one with glow effect
- Cards fan out in a flourish, settling with soft bounce
- Visual metaphor: Final products being crafted and presented
  */
  const ForgeStageThree = () => {
  const [cards, setCards] = useState([]);

useEffect(() => {
if (prefersReducedMotion()) return;

```
// Generate meal cards
const mealTypes = [
  { name: 'Breakfast', icon: '🌅', color: COLORS.warning.main },
  { name: 'Lunch', icon: '☀️', color: COLORS.info.main },
  { name: 'Dinner', icon: '🌙', color: COLORS.secondary[500] },
  { name: 'Snack', icon: '🍎', color: COLORS.success.main },
];

const newCards = mealTypes.map((meal, index) => ({
  ...meal,
  id: index,
  delay: calculateStaggerDelay(index, 150),
}));

setCards(newCards);
```

}, []);

if (prefersReducedMotion()) {
return (
<div className="flex items-center justify-center py-12">
<div className="flex items-center space-x-3 text-white text-lg font-semibold">
<Sparkles size={24} />
<span>Finalizing your meal plan…</span>
<Sparkles size={24} />
</div>
</div>
);
}

return (
<div className=“relative flex items-center justify-center py-8” style={{ minHeight: ‘250px’ }}>
{/* Radiant background glow */}
<div
className=“absolute inset-0 flex items-center justify-center animate-forgeGlow”
style={{
background: `radial-gradient(circle, ${COLORS.forge.hot}40 0%, transparent 70%)`,
}}
/>

```
  {/* Meal cards */}
  <div className="relative flex flex-wrap justify-center gap-4 max-w-xl">
    {cards.map((card) => (
      <div
        key={card.id}
        className="animate-mealCardMint"
        style={{
          animationDelay: `${card.delay}ms`,
        }}
      >
        <div
          className="w-32 h-40 rounded-xl p-4 flex flex-col items-center justify-center shadow-xl animate-mintGlow"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)',
            backdropFilter: 'blur(10px)',
            border: `2px solid ${card.color}`,
            animationDelay: `${card.delay}ms`,
          }}
        >
          {/* Icon */}
          <div className="text-4xl mb-2">{card.icon}</div>

          {/* Name */}
          <div
            className="text-sm font-bold text-center"
            style={{ color: card.color }}
          >
            {card.name}
          </div>

          {/* Shimmer effect */}
          <div
            className="absolute inset-0 rounded-xl pointer-events-none animate-shimmerWash"
            style={{
              animationDelay: `${card.delay + 300}ms`,
            }}
          />
        </div>
      </div>
    ))}
  </div>

  {/* Sparkle particles */}
  <div className="absolute inset-0 pointer-events-none">
    {[...Array(16)].map((_, i) => (
      <div
        key={i}
        className="absolute animate-floatUp"
        style={{
          left: `${Math.random() * 100}%`,
          top: `${50 + Math.random() * 50}%`,
          animationDelay: `${Math.random() * 2000}ms`,
          animationDuration: `${3000 + Math.random() * 2000}ms`,
        }}
      >
        <Sparkles
          size={12 + Math.random() * 12}
          className="text-white"
          style={{ opacity: 0.7 }}
        />
      </div>
    ))}
  </div>

  {/* Success indicator */}
  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 animate-bounceIn">
    <div className="flex items-center space-x-2 bg-white rounded-full px-6 py-3 shadow-lg">
      <ChefHat size={20} style={{ color: COLORS.success.main }} />
      <span className="text-sm font-bold" style={{ color: COLORS.success.dark }}>
        Plan Ready!
      </span>
    </div>
  </div>
</div>
```

);
};

export default ForgeStageThree;