// web/src/components/MacroRing.jsx
import React, { useEffect, useState } from ‘react’;
import { COLORS } from ‘../constants’;
import {
calculateProgress,
calculateStrokeDashoffset,
animateValue,
prefersReducedMotion
} from ‘../utils/animationHelpers’;

/**

- Macro Ring - Enhanced with animated fill and glassy finish
- Features:
- - Animated fill effect on mount
- - Glassy translucent finish with inner glow
- - Color gradients for each macro type
- - Smooth transitions
    */
    const MacroRing = ({
    current = 0,
    target = 1,
    label = “Macro”,
    color = “indigo”,
    size = 120,
    unit = “”,
    animated = true,
    }) => {
    const [animatedCurrent, setAnimatedCurrent] = useState(0);
    const [hasAnimated, setHasAnimated] = useState(false);

const percentage = calculateProgress(current, target);
const displayCurrent = animated && !hasAnimated ? animatedCurrent : current;
const displayPercentage = calculateProgress(displayCurrent, target);

// Animate on mount
useEffect(() => {
if (!animated || hasAnimated || prefersReducedMotion()) {
setAnimatedCurrent(current);
setHasAnimated(true);
return;
}

```
const timer = setTimeout(() => {
  animateValue({
    from: 0,
    to: current,
    duration: 1000,
    onUpdate: (value) => {
      setAnimatedCurrent(value);
    },
    onComplete: () => {
      setHasAnimated(true);
    },
  });
}, 100);

return () => clearTimeout(timer);
```

}, [current, animated, hasAnimated]);

// SVG Circle calculations
const strokeWidth = size > 100 ? 12 : 8;
const radius = (size - strokeWidth) / 2;
const circumference = 2 * Math.PI * radius;
const offset = calculateStrokeDashoffset(radius, displayPercentage);

// Get color scheme
const getColorScheme = () => {
const schemes = {
indigo: {
bg: COLORS.primary[100],
stroke: COLORS.primary[500],
gradient: COLORS.macros.protein.gradient,
text: COLORS.primary[700],
},
error: {
bg: COLORS.error.light,
stroke: COLORS.error.main,
gradient: COLORS.macros.calories.gradient,
text: COLORS.error.dark,
},
primary: {
bg: COLORS.primary[100],
stroke: COLORS.primary[500],
gradient: COLORS.macros.protein.gradient,
text: COLORS.primary[700],
},
secondary: {
bg: COLORS.secondary[100],
stroke: COLORS.secondary[500],
gradient: COLORS.macros.fat.gradient,
text: COLORS.secondary[700],
},
warning: {
bg: COLORS.warning.light,
stroke: COLORS.warning.main,
gradient: COLORS.macros.carbs.gradient,
text: COLORS.warning.dark,
},
success: {
bg: COLORS.success.light,
stroke: COLORS.success.main,
gradient: ‘linear-gradient(135deg, #10b981 0%, #059669 100%)’,
text: COLORS.success.dark,
},
};
return schemes[color] || schemes.indigo;
};

const colorScheme = getColorScheme();

// Status color
const getStatusColor = () => {
if (percentage < 50) return COLORS.error.main;
if (percentage < 85) return COLORS.warning.main;
if (percentage <= 110) return COLORS.success.main;
return COLORS.error.main;
};

const statusColor = getStatusColor();

return (
<div className="flex flex-col items-center">
{/* Ring Container */}
<div className=“relative” style={{ width: size, height: size }}>
{/* Background glow */}
<div
className=“absolute inset-0 rounded-full opacity-20 blur-xl”
style={{
background: colorScheme.gradient,
}}
/>

```
    {/* SVG Ring */}
    <svg
      className="transform -rotate-90"
      width={size}
      height={size}
    >
      {/* Background Circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={colorScheme.bg}
        strokeWidth={strokeWidth}
        fill="none"
      />

      {/* Progress Circle with gradient */}
      <defs>
        <linearGradient id={`gradient-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colorScheme.stroke} stopOpacity="1" />
          <stop offset="100%" stopColor={statusColor} stopOpacity="0.8" />
        </linearGradient>
        
        {/* Glass effect filter */}
        <filter id={`glass-${label}`}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="glow" />
          <feBlend in="SourceGraphic" in2="glow" />
        </filter>
      </defs>

      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={`url(#gradient-${label})`}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        filter={`url(#glass-${label})`}
        className="transition-all duration-1000 ease-out"
        style={{
          filter: 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.4))',
        }}
      />

      {/* Inner glow effect */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius - strokeWidth / 2}
        fill="none"
        stroke={colorScheme.stroke}
        strokeWidth="1"
        opacity="0.2"
      />
    </svg>

    {/* Center Content */}
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <div className="text-center">
        <div className="font-bold" style={{ 
          fontSize: size > 100 ? '1.5rem' : '1.25rem',
          color: colorScheme.text,
        }}>
          {Math.round(displayCurrent)}
        </div>
        <div className="text-xs font-semibold" style={{ color: COLORS.gray[500] }}>
          / {target}{unit}
        </div>
      </div>
    </div>

    {/* Percentage Badge */}
    <div
      className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{
        backgroundColor: statusColor,
        color: '#ffffff',
      }}
    >
      {Math.round(displayPercentage)}%
    </div>
  </div>

  {/* Label */}
  <div className="mt-3 text-center">
    <p className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
      {label}
    </p>
  </div>
</div>
```

);
};

export default MacroRing;