// web/src/components/MacroRing.jsx
import React, { useState, useEffect } from 'react';
import { COLORS } from '../constants';
import useReducedMotion from '../hooks/useReducedMotion';

/**
 * A reusable circular progress ring component for displaying macro progress.
 * Enhanced with gradient strokes and count-up animation
 * 
 * @param {number} current - Current value (e.g., calories eaten)
 * @param {number} target - Target value (e.g., calorie goal)
 * @param {string} label - Label to display (e.g., "Calories")
 * @param {string} color - Color key from COLORS.macros (e.g., "protein")
 * @param {number} size - Size of the ring in pixels (default: 120)
 * @param {string} unit - Unit to display (e.g., "kcal", "g")
 */
const MacroRing = ({ 
    current = 0, 
    target = 1, 
    label = "Macro", 
    color = "protein", 
    size = 120,
    unit = ""
}) => {
    const [animatedCurrent, setAnimatedCurrent] = useState(0);
    const prefersReducedMotion = useReducedMotion();
    
    const percentage = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    
    const gradientId = `macro-gradient-${label}-${Math.random().toString(36).substr(2, 9)}`;

    // Count-up animation for current value
    useEffect(() => {
        if (prefersReducedMotion) {
            setAnimatedCurrent(current);
            return;
        }

        let start = null;
        const duration = 1000;
        
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = Math.min((timestamp - start) / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            setAnimatedCurrent(current * easeOut);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        requestAnimationFrame(animate);
    }, [current, prefersReducedMotion]);

    // Determine color based on progress
    const getColors = () => {
        if (percentage >= 95 && percentage <= 105) {
            return {
                main: COLORS.success.main,
                light: COLORS.success.light,
                dark: COLORS.success.dark,
            };
        } else if (percentage > 105) {
            return {
                main: COLORS.error.main,
                light: COLORS.error.light,
                dark: COLORS.error.dark,
            };
        } else {
            const macroColor = COLORS.macros[color] || COLORS.macros.protein;
            return {
                main: macroColor.main,
                light: macroColor.light,
                dark: macroColor.dark,
            };
        }
    };

    const colors = getColors();

    return (
        <div className="flex flex-col items-center">
            <div className="relative" style={{ width: size, height: size }}>
                {/* Background Circle */}
                <svg className="transform -rotate-90" width={size} height={size}>
                    <defs>
                        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={colors.main} />
                            <stop offset="100%" stopColor={colors.dark} />
                        </linearGradient>
                    </defs>
                    
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke={COLORS.gray[200]}
                        strokeWidth={strokeWidth}
                        fill="none"
                    />
                    
                    {/* Progress Circle with Gradient */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke={`url(#${gradientId})`}
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className="transition-all duration-500 ease-out"
                        style={{
                            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                        }}
                    />
                </svg>
                
                {/* Center Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span 
                        className="text-2xl font-extrabold tabular-nums"
                        style={{ 
                            color: colors.main,
                            fontFamily: 'var(--font-family-display)',
                        }}
                    >
                        {Math.round(animatedCurrent)}
                    </span>
                    <span className="text-xs" style={{ color: COLORS.gray[500] }}>
                        / {target}
                    </span>
                </div>
            </div>
            
            {/* Label */}
            <p 
                className="mt-2 text-sm font-semibold"
                style={{ color: COLORS.gray[700] }}
            >
                {label} {unit && <span style={{ color: COLORS.gray[500] }}>({unit})</span>}
            </p>
        </div>
    );
};

export default MacroRing;