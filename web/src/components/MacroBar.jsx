// web/src/components/MacroBar.jsx
import React from 'react';

/**
 * A horizontal progress bar for displaying macro progress.
 * Shows current/target values with color coding.
 * 
 * @param {string} label - Label for the macro (e.g., "Protein")
 * @param {number} current - Current amount consumed
 * @param {number} target - Target amount
 * @param {string} unit - Unit (e.g., "g")
 * @param {string} color - Tailwind color name (e.g., "green", "yellow", "orange")
 * @param {object} Icon - Lucide icon component
 */
const MacroBar = ({ 
    label = "Macro", 
    current = 0, 
    target = 1, 
    unit = "g",
    color = "indigo",
    Icon = null
}) => {
    const percentage = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const remaining = Math.max(0, target - current);

    // Determine bar color based on progress
    const getBarColor = () => {
        if (percentage >= 95 && percentage <= 105) {
            return 'bg-green-500';
        } else if (percentage > 105) {
            return 'bg-red-500';
        } else if (percentage < 50) {
            return 'bg-gray-400';
        } else {
            return `bg-${color}-500`;
        }
    };

    const getTextColor = () => {
        if (percentage >= 95 && percentage <= 105) {
            return 'text-green-700';
        } else if (percentage > 105) {
            return 'text-red-700';
        } else {
            return `text-${color}-700`;
        }
    };

    return (
        <div className="space-y-1">
            {/* Header with label and values */}
            <div className="flex justify-between items-center">
                <div className="flex items-center">
                    {Icon && <Icon size={16} className={`mr-2 ${getTextColor()}`} />}
                    <span className="text-sm font-semibold text-gray-700">{label}</span>
                </div>
                <div className="text-sm font-bold">
                    <span className={getTextColor()}>{Math.round(current)}</span>
                    <span className="text-gray-400"> / </span>
                    <span className="text-gray-600">{target}{unit}</span>
                </div>
            </div>
            
            {/* Progress Bar Container - FIX: Added relative, overflow-hidden */}
            <div className="relative w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                {/* Progress Bar Fill - FIX: Added absolute positioning, will-change */}
                <div 
                    className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out ${getBarColor()}`}
                    style={{ 
                        width: `${percentage}%`,
                        willChange: 'width'
                    }}
                />
            </div>
            
            {/* Remaining amount (optional) */}
            {remaining > 0 && (
                <p className="text-xs text-gray-500 text-right">
                    {Math.round(remaining)}{unit} remaining
                </p>
            )}
        </div>
    );
};

export default MacroBar;