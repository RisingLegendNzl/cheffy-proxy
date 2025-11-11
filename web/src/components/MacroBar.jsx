// web/src/components/MacroBar.jsx
import React, { useState, useEffect } from 'react';
import { COLORS } from '../constants';
import useReducedMotion from '../hooks/useReducedMotion';

/**
 * A horizontal progress bar for displaying macro progress.
 * Enhanced with refined visual hierarchy and smooth animations
 * 
 * @param {string} label - Label for the macro (e.g., "Protein")
 * @param {number} current - Current amount consumed
 * @param {number} target - Target amount
 * @param {string} unit - Unit (e.g., "g")
 * @param {string} color - Color key from COLORS.macros (e.g., "protein")
 * @param {object} Icon - Lucide icon component
 */
const MacroBar = ({ 
    label = "Macro", 
    current = 0, 
    target = 1, 
    unit = "g",
    color = "protein",
    Icon = null
}) => {
    const [animatedPercentage, setAnimatedPercentage] = useState(0);
    const prefersReducedMotion = useReducedMotion();
    
    const percentage = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const remaining = Math.max(0, target - current);

    // Animate percentage fill
    useEffect(() => {
        if (prefersReducedMotion) {
            setAnimatedPercentage(percentage);
            return;
        }

        let start = null;
        const duration = 800;
        
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = Math.min((timestamp - start) / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            setAnimatedPercentage(percentage * easeOut);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        requestAnimationFrame(animate);
    }, [percentage, prefersReducedMotion]);

    // Determine colors based on progress
    const getColors = () => {
        if (percentage >= 95 && percentage <= 105) {
            return {
                bar: COLORS.success.main,
                text: COLORS.success.dark,
                bg: COLORS.success.light,
            };
        } else if (percentage > 105) {
            return {
                bar: COLORS.error.main,
                text: COLORS.error.dark,
                bg: COLORS.error.light,
            };
        } else if (percentage < 50) {
            return {
                bar: COLORS.gray[400],
                text: COLORS.gray[600],
                bg: COLORS.gray[100],
            };
        } else {
            const macroColor = COLORS.macros[color] || COLORS.macros.protein;
            return {
                bar: macroColor.main,
                text: macroColor.dark,
                bg: macroColor.light,
            };
        }
    };

    const colors = getColors();

    return (
        <div className="space-y-2">
            {/* Header with label and values */}
            <div className="flex justify-between items-center">
                <div className="flex items-center">
                    {Icon && (
                        <Icon 
                            size={16} 
                            className="mr-2"
                            style={{ color: colors.text }}
                        />
                    )}
                    <span 
                        className="text-sm font-semibold"
                        style={{ color: COLORS.gray[700] }}
                    >
                        {label}
                    </span>
                </div>
                <div className="text-sm font-bold tabular-nums">
                    <span style={{ color: colors.text }}>
                        {Math.round(current)}
                    </span>
                    <span style={{ color: COLORS.gray[400] }}> / </span>
                    <span style={{ color: COLORS.gray[600] }}>
                        {target}{unit}
                    </span>
                </div>
            </div>
            
            {/* Progress Bar Container */}
            <div 
                className="relative w-full rounded-full h-2 overflow-hidden"
                style={{ backgroundColor: COLORS.gray[200] }}
            >
                {/* Progress Bar Fill */}
                <div 
                    className="absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out"
                    style={{ 
                        width: `${animatedPercentage}%`,
                        backgroundColor: colors.bar,
                        boxShadow: `0 0 8px ${colors.bar}40`,
                    }}
                />
            </div>
            
            {/* Remaining amount */}
            {remaining > 0 && (
                <p 
                    className="text-xs text-right"
                    style={{ color: COLORS.gray[500] }}
                >
                    {Math.round(remaining)}{unit} remaining
                </p>
            )}
        </div>
    );
};

export default MacroBar;