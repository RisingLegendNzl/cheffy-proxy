// web/src/components/day-selector/DayCard.jsx
import React from 'react';
import { CheckCircle, Sun, Moon, Sunrise } from 'lucide-react';
import { COLORS } from '../../constants';
import { calculateProgress, calculateStrokeDashoffset } from '../../utils/animationHelpers';

/**
 * Day Card - Individual day representation in Week Horizon
 * Features:
 * - Meal sun icon that changes based on completion
 * - Calorie ring preview
 * - Completion constellation for past days
 * - Zoom-forward effect when selected
 * - Translucent appearance for future days
 */
const DayCard = ({
    day,
    dayName,
    isSelected,
    isPast,
    isFuture,
    completion = { completed: 0, total: 0, percentage: 0 },
    calories = { current: 0, target: 0 },
    onClick,
}) => {
    const { completed, total, percentage } = completion;
    const { current, target } = calories;
    const caloriePercentage = calculateProgress(current, target);

    // Determine icon based on day state
    const getIcon = () => {
        if (isSelected) return <Sun size={32} className="text-yellow-500" />;
        if (isPast && percentage === 100) return <CheckCircle size={32} className="text-green-500" />;
        if (isPast) return <Sunrise size={32} className="text-orange-400" />;
        return <Moon size={32} className="text-gray-400" />;
    };

    // SVG circle for calorie ring
    const ringSize = 80;
    const strokeWidth = 4;
    const radius = (ringSize - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = calculateStrokeDashoffset(radius, caloriePercentage);

    // Determine card styles
    const getCardStyles = () => {
        if (isSelected) {
            return {
                transform: 'scale(1.1)',
                opacity: 1,
                border: `3px solid ${COLORS.primary[500]}`,
                boxShadow: COLORS.shadows.primary,
            };
        }
        if (isPast) {
            return {
                opacity: 0.8,
                border: `2px solid ${COLORS.gray[200]}`,
            };
        }
        if (isFuture) {
            return {
                opacity: 0.5,
                border: `2px solid ${COLORS.gray[200]}`,
            };
        }
        return {
            opacity: 1,
            border: `2px solid ${COLORS.gray[200]}`,
        };
    };

    const cardStyles = getCardStyles();

    return (
        <button
            data-day={day}
            onClick={onClick}
            className={`flex-shrink-0 w-32 rounded-xl p-4 transition-all duration-300 hover-lift ${
                isSelected ? 'animate-breathe' : ''
            }`}
            style={{
                backgroundColor: '#ffffff',
                scrollSnapAlign: 'center',
                ...cardStyles,
            }}
            aria-label={`Select ${dayName}, Day ${day}`}
            aria-pressed={isSelected}
        >
            {/* Day Name */}
            <div className="text-xs font-semibold mb-2" style={{ color: COLORS.gray[600] }}>
                {dayName.slice(0, 3)}
            </div>

            {/* Day Number */}
            <div className="text-2xl font-bold mb-3" style={{ color: COLORS.gray[900] }}>
                {day}
            </div>

            {/* Calorie Ring with Icon */}
            <div className="relative mx-auto mb-3" style={{ width: ringSize, height: ringSize }}>
                {/* Background Circle */}
                <svg
                    className="transform -rotate-90"
                    width={ringSize}
                    height={ringSize}
                    style={{ position: 'absolute', top: 0, left: 0 }}
                >
                    <circle
                        cx={ringSize / 2}
                        cy={ringSize / 2}
                        r={radius}
                        stroke={COLORS.gray[200]}
                        strokeWidth={strokeWidth}
                        fill="none"
                    />
                    {/* Progress Circle */}
                    <circle
                        cx={ringSize / 2}
                        cy={ringSize / 2}
                        r={radius}
                        stroke={COLORS.primary[500]}
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className="transition-all duration-500"
                    />
                </svg>

                {/* Icon in center */}
                <div className="absolute inset-0 flex items-center justify-center">
                    {getIcon()}
                </div>
            </div>

            {/* Completion Status */}
            {total > 0 && (
                <div className="text-xs" style={{ color: COLORS.gray[500] }}>
                    {completed}/{total} meals
                </div>
            )}

            {/* Completion Constellation for fully completed past days */}
            {isPast && percentage === 100 && (
                <div className="mt-2 flex justify-center gap-1">
                    {[...Array(3)].map((_, i) => (
                        <div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                                backgroundColor: COLORS.success.main,
                                opacity: 0.8,
                            }}
                        />
                    ))}
                </div>
            )}
        </button>
    );
};

export default DayCard;