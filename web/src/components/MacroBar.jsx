// web/src/components/MacroBar.jsx
import React from 'react';
import { COLORS } from '../constants';
import { calculateProgress } from '../utils/animationHelpers';

/**
 * Macro Bar - Enhanced horizontal progress bar
 * Features:
 * - Blueprint styling option
 * - Technical typography
 * - Grid overlay
 * - Smooth transitions
 */
const MacroBar = ({
    label = "Macro",
    current = 0,
    target = 1,
    unit = "g",
    color = "indigo",
    Icon = null,
    variant = "default" // "default" | "blueprint"
}) => {
    const percentage = calculateProgress(current, target);

    // Get color scheme
    const getColorScheme = () => {
        const schemes = {
            indigo: {
                bg: COLORS.primary[100],
                fill: COLORS.primary[500],
                text: COLORS.primary[700],
            },
            error: {
                bg: COLORS.error.light,
                fill: COLORS.error.main,
                text: COLORS.error.dark,
            },
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
            warning: {
                bg: COLORS.warning.light,
                fill: COLORS.warning.main,
                text: COLORS.warning.dark,
            },
            success: {
                bg: COLORS.success.light,
                fill: COLORS.success.main,
                text: COLORS.success.dark,
            },
        };
        return schemes[color] || schemes.indigo;
    };

    const colorScheme = getColorScheme();

    // Status color based on percentage
    const getStatusColor = () => {
        if (percentage < 50) return COLORS.error.main;
        if (percentage < 85) return COLORS.warning.main;
        if (percentage <= 110) return COLORS.success.main;
        return COLORS.error.main;
    };

    const statusColor = getStatusColor();

    // Blueprint variant styling
    const isBlueprintVariant = variant === "blueprint";

    return (
        <div className={isBlueprintVariant ? "font-mono" : ""}>
            {/* Label and Values */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center">
                    {Icon && (
                        <Icon
                            size={18}
                            className="mr-2"
                            style={{ color: colorScheme.text }}
                        />
                    )}
                    <span
                        className={`font-semibold ${isBlueprintVariant ? 'text-xs tracking-wider uppercase' : 'text-sm'}`}
                        style={{ color: isBlueprintVariant ? COLORS.blueprint.text : COLORS.gray[700] }}
                    >
                        {label}
                    </span>
                </div>

                <div className="flex items-center space-x-2">
                    <span 
                        className="font-bold"
                        style={{ color: statusColor }}
                    >
                        {Math.round(current)}
                    </span>
                    <span 
                        className="text-sm"
                        style={{ color: COLORS.gray[500] }}
                    >
                        / {target}{unit}
                    </span>
                    <span 
                        className={`text-xs font-bold px-2 py-0.5 rounded ${
                            isBlueprintVariant ? 'border' : ''
                        }`}
                        style={{ 
                            color: statusColor,
                            backgroundColor: isBlueprintVariant ? 'transparent' : `${statusColor}20`,
                            borderColor: isBlueprintVariant ? statusColor : 'transparent',
                        }}
                    >
                        {percentage}%
                    </span>
                </div>
            </div>

            {/* Progress Bar Container */}
            <div 
                className={`relative h-3 rounded-full overflow-hidden ${
                    isBlueprintVariant ? 'border' : ''
                }`}
                style={{
                    backgroundColor: isBlueprintVariant ? 'transparent' : colorScheme.bg,
                    borderColor: isBlueprintVariant ? COLORS.blueprint.grid : 'transparent',
                }}
            >
                {/* Grid overlay for blueprint */}
                {isBlueprintVariant && (
                    <div 
                        className="absolute inset-0 pointer-events-none"
                        style={{
                            backgroundImage: `
                                linear-gradient(${COLORS.blueprint.grid} 1px, transparent 1px),
                                linear-gradient(90deg, ${COLORS.blueprint.grid} 1px, transparent 1px)
                            `,
                            backgroundSize: '4px 4px',
                            opacity: 0.3,
                        }}
                    />
                )}

                {/* Progress Fill */}
                <div
                    className="absolute inset-y-0 left-0 transition-all duration-500 ease-out"
                    style={{
                        width: `${Math.min(percentage, 100)}%`,
                        background: isBlueprintVariant
                            ? `repeating-linear-gradient(
                                45deg,
                                ${statusColor},
                                ${statusColor} 10px,
                                ${statusColor}cc 10px,
                                ${statusColor}cc 20px
                            )`
                            : `linear-gradient(90deg, ${colorScheme.fill} 0%, ${statusColor} 100%)`,
                    }}
                >
                    {/* Shimmer effect */}
                    {!isBlueprintVariant && (
                        <div
                            className="absolute inset-0 animate-shimmer"
                            style={{
                                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                                backgroundSize: '200% 100%',
                            }}
                        />
                    )}
                </div>

                {/* Over-target indicator */}
                {percentage > 100 && (
                    <div
                        className="absolute inset-y-0 left-0 w-full border-l-2"
                        style={{
                            left: '100%',
                            width: `${percentage - 100}%`,
                            backgroundColor: `${COLORS.error.main}40`,
                            borderColor: COLORS.error.main,
                        }}
                    />
                )}
            </div>
        </div>
    );
};

export default MacroBar;