// web/src/components/MacroRing.jsx
import React from 'react';

/**
 * A reusable circular progress ring component for displaying macro progress.
 * Inspired by fitness apps like MyFitnessPal.
 * 
 * @param {number} current - Current value (e.g., calories eaten)
 * @param {number} target - Target value (e.g., calorie goal)
 * @param {string} label - Label to display (e.g., "Calories")
 * @param {string} color - Tailwind color class for the ring (e.g., "indigo")
 * @param {number} size - Size of the ring in pixels (default: 120)
 * @param {string} unit - Unit to display (e.g., "kcal", "g")
 */
const MacroRing = ({ 
    current = 0, 
    target = 1, 
    label = "Macro", 
    color = "indigo", 
    size = 120,
    unit = ""
}) => {
    const percentage = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    // Determine color based on progress
    const getColorClasses = () => {
        if (percentage >= 95 && percentage <= 105) {
            return { ring: 'stroke-green-500', text: 'text-green-700' };
        } else if (percentage > 105) {
            return { ring: 'stroke-red-500', text: 'text-red-700' };
        } else {
            return { ring: `stroke-${color}-500`, text: `text-${color}-700` };
        }
    };

    const colors = getColorClasses();

    return (
        <div className="flex flex-col items-center">
            <div className="relative" style={{ width: size, height: size }}>
                {/* Background Circle */}
                <svg className="transform -rotate-90" width={size} height={size}>
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        fill="none"
                        className="text-gray-200"
                    />
                    {/* Progress Circle */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className={`${colors.ring} transition-all duration-500 ease-out`}
                    />
                </svg>
                {/* Center Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-2xl font-extrabold ${colors.text}`}>
                        {Math.round(current)}
                    </span>
                    <span className="text-xs text-gray-500">
                        / {target}
                    </span>
                </div>
            </div>
            {/* Label */}
            <p className="mt-2 text-sm font-semibold text-gray-700">
                {label} {unit && <span className="text-gray-500">({unit})</span>}
            </p>
        </div>
    );
};

export default MacroRing;