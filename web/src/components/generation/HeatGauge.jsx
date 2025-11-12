// web/src/components/generation/HeatGauge.jsx
import React from 'react';
import { COLORS } from '../../constants';
import { prefersReducedMotion } from '../../utils/animationHelpers';

/**
 * Heat Gauge - Custom progress bar styled as heat gauge
 * Glows warmer as progress advances
 * Visual metaphor: Temperature rising as meal plan "forges"
 */
const HeatGauge = ({ progress = 0, currentStage = 1 }) => {
    const clampedProgress = Math.min(Math.max(progress, 0), 100);

    // Get color based on progress
    const getHeatColor = () => {
        if (clampedProgress < 40) return COLORS.forge.cool;
        if (clampedProgress < 80) return COLORS.forge.warm;
        return COLORS.forge.hot;
    };

    // Get glow intensity
    const getGlowIntensity = () => {
        return Math.min(clampedProgress / 100, 1) * 30;
    };

    const heatColor = getHeatColor();
    const glowIntensity = getGlowIntensity();

    return (
        <div className="w-full max-w-2xl mx-auto">
            {/* Labels */}
            <div className="flex justify-between mb-2 text-white text-sm font-semibold">
                <span className={currentStage === 1 ? 'opacity-100' : 'opacity-50'}>
                    Gathering
                </span>
                <span className={currentStage === 2 ? 'opacity-100' : 'opacity-50'}>
                    Calculating
                </span>
                <span className={currentStage === 3 ? 'opacity-100' : 'opacity-50'}>
                    Optimizing
                </span>
            </div>

            {/* Gauge Container */}
            <div
                className="relative h-8 rounded-full overflow-hidden"
                style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    border: '2px solid rgba(255, 255, 255, 0.3)',
                }}
            >
                {/* Progress Fill */}
                <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                        prefersReducedMotion() ? '' : 'duration-500 ease-out'
                    }`}
                    style={{
                        width: `${clampedProgress}%`,
                        background: `linear-gradient(90deg, ${COLORS.forge.cool} 0%, ${COLORS.forge.warm} 50%, ${COLORS.forge.hot} 100%)`,
                        boxShadow: `0 0 ${glowIntensity}px ${heatColor}`,
                    }}
                >
                    {/* Shimmer effect */}
                    {!prefersReducedMotion() && clampedProgress > 0 && (
                        <div
                            className="absolute inset-0 animate-shimmer"
                            style={{
                                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                                backgroundSize: '200% 100%',
                            }}
                        />
                    )}
                </div>

                {/* Stage markers */}
                <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
                    {[33, 66].map((position, index) => (
                        <div
                            key={index}
                            className="w-px h-4 bg-white opacity-30"
                            style={{ marginLeft: `${position}%` }}
                        />
                    ))}
                </div>

                {/* Percentage Text */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-xs font-bold text-white drop-shadow-lg">
                        {Math.round(clampedProgress)}%
                    </span>
                </div>
            </div>

            {/* Heat indicator dots */}
            <div className="flex justify-center mt-3 space-x-2">
                {[1, 2, 3].map((stage) => (
                    <div
                        key={stage}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                            currentStage >= stage ? 'animate-pulse' : ''
                        }`}
                        style={{
                            backgroundColor: currentStage >= stage ? heatColor : 'rgba(255, 255, 255, 0.3)',
                            boxShadow: currentStage >= stage ? `0 0 8px ${heatColor}` : 'none',
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export default HeatGauge;