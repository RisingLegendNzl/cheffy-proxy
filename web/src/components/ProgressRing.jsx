// web/src/components/ProgressRing.jsx
import React, { useState, useEffect } from 'react';
import { COLORS } from '../constants';
import useReducedMotion from '../hooks/useReducedMotion';

/**
 * Animated SVG progress ring with gradient support
 * Animates from 0 to target percentage with spring physics
 */
const ProgressRing = ({
  percentage = 0,
  size = 120,
  strokeWidth = 8,
  color = COLORS.primary[600],
  gradientColors = null,
  label = '',
  value = '',
  unit = '',
  showPercentage = false,
  className = '',
}) => {
  const [animatedPercentage, setAnimatedPercentage] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (animatedPercentage / 100) * circumference;
  
  const gradientId = `gradient-${Math.random().toString(36).substr(2, 9)}`;

  useEffect(() => {
    if (prefersReducedMotion) {
      setAnimatedPercentage(percentage);
      return;
    }

    let start = null;
    const duration = 1000; // 1 second
    
    const animate = (timestamp) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      
      // Ease-out cubic for smooth deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setAnimatedPercentage(percentage * easeOut);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
  }, [percentage, prefersReducedMotion]);

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <svg width={size} height={size} className="transform -rotate-90">
        <defs>
          {gradientColors && (
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={gradientColors[0]} />
              <stop offset="100%" stopColor={gradientColors[1]} />
            </linearGradient>
          )}
        </defs>
        
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLORS.gray[200]}
          strokeWidth={strokeWidth}
          fill="none"
        />
        
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={gradientColors ? `url(#${gradientId})` : color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition: prefersReducedMotion ? 'none' : 'stroke-dashoffset 0.5s ease-out',
          }}
        />
        
        {/* Center text */}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dy="0.3em"
          className="transform rotate-90"
          style={{
            fontSize: size * 0.2,
            fontWeight: 700,
            fill: COLORS.gray[900],
            fontFamily: 'var(--font-family-display)',
          }}
        >
          {showPercentage
            ? `${Math.round(animatedPercentage)}%`
            : value
          }
        </text>
      </svg>
      
      {label && (
        <p
          className="mt-2 text-sm font-medium text-center"
          style={{ color: COLORS.gray[600] }}
        >
          {label}
        </p>
      )}
      
      {unit && !showPercentage && (
        <p
          className="text-xs"
          style={{ color: COLORS.gray[500] }}
        >
          {unit}
        </p>
      )}
    </div>
  );
};

export default ProgressRing;