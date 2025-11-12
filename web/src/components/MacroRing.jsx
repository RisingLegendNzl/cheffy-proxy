// web/src/components/MacroRing.jsx
import React, { useEffect, useRef, useState } from 'react';
import { COLORS } from '../constants';
import { calculateStrokeDashoffset, animateValue, isInViewport, prefersReducedMotion } from '../utils/animationHelpers';

/**
 * Macro Ring - Animated circular progress indicator
 * Features:
 * - Smooth animation from 0 to target value on scroll into view
 * - Color transitions based on progress
 * - Respects prefers-reduced-motion
 */
const MacroRing = ({
    label = "Macro",
    current = 0,
    target = 1,
    unit = "g",
    size = 120,
    strokeWidth = 10,
    color = "primary",
}) => {
    const ringRef = useRef(null);
    const [hasAnimated, setHasAnimated] = useState(false);
    const [animatedCurrent, setAnimatedCurrent] = useState(0);
    const [animatedPercentage, setAnimatedPercentage] = useState(0);

    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    // Calculate display percentage
    const actualPercentage = Math.min(Math.round((current / target) * 100), 100);

    // Animate on scroll into view
    useEffect(() => {
        if (prefersReducedMotion() || hasAnimated) return;

        const checkVisibility = () => {
            if (ringRef.current && isInViewport(ringRef.current, 0.5)) {
                setHasAnimated(true);

                animateValue({
                    from: 0,
                    to: current,
                    duration: 1000,
                    onUpdate: (value) => {
                        setAnimatedCurrent(value);
                        const pct = Math.min(Math.round((value / target) * 100), 100);
                        setAnimatedPercentage(pct);
                    },
                });
            }
        };

        checkVisibility();
        window.addEventListener('scroll', checkVisibility);
        return () => window.removeEventListener('scroll', checkVisibility);
    }, [hasAnimated, current, target]);

    const displayCurrent = hasAnimated ? animatedCurrent : current;
    const displayPercentage = hasAnimated ? animatedPercentage : actualPercentage;

    // Get color scheme
    const getColorScheme = () => {
        const schemes = {
            primary: {
                bg: COLORS.primary[100],
                fill: COLORS.primary[500],
                text: COLORS.primary[700],
            },
            secondary: {
                bg: COLORS.secondary[100],
                fill: COLORS.secondary[500],
                text: COLORS.secondary[700],
            },
            success: {
                bg: COLORS.success.light,
                fill: COLORS.success.main,
                text: COLORS.success.dark,
            },
        };
        return schemes[color] || schemes.primary;
    };

    const colorScheme = getColorScheme();

    // Status color based on percentage
    const getStatusColor = () => {
        if (displayPercentage < 50) return COLORS.error.main;
        if (displayPercentage < 85) return COLORS.warning.main;
        if (displayPercentage <= 110) return COLORS.success.main;
        return COLORS.error.main;
    };

    const statusColor = getStatusColor();
    const offset = calculateStrokeDashoffset(radius, displayPercentage);

    return (
        <div ref={ringRef} className="flex flex-col items-center">
            {/* Ring Container */}
            <div className="relative" style={{ width: size, height: size }}>
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
                    {/* Progress Circle */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke={statusColor}
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className="transition-all duration-500"
                    />
                </svg>

                {/* Center Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-center">
                        <div style={{
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
    );
};

export default MacroRing;