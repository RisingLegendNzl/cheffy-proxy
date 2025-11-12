// web/src/components/ui/ChefMascot.jsx
import React from 'react';
import { ChefHat } from 'lucide-react';
import { COLORS } from '../../constants';
import { prefersReducedMotion } from '../../utils/animationHelpers';

/**
 * Chef Mascot - Animated character for empty states and celebrations
 * Features:
 * - Multiple variants (idle, cooking, celebrating)
 * - Looping animations
 * - Friendly and approachable design
 * - Size variations
 */
const ChefMascot = ({
    variant = 'idle',
    size = 120,
    className = ''
}) => {
    const shouldAnimate = !prefersReducedMotion();

    // Get animation class based on variant
    const getAnimationClass = () => {
        if (!shouldAnimate) return '';

        switch (variant) {
            case 'cooking':
                return 'animate-bounce';
            case 'celebrating':
                return 'animate-wiggle';
            case 'idle':
            default:
                return 'animate-breathe';
        }
    };

    // Get emoji based on variant
    const getEmoji = () => {
        switch (variant) {
            case 'cooking':
                return '👨‍🍳';
            case 'celebrating':
                return '🎉';
            case 'idle':
            default:
                return '👨‍🍳';
        }
    };

    return (
        <div
            className={`relative inline-flex items-center justify-center ${getAnimationClass()} ${className}`}
            style={{
                width: size,
                height: size,
            }}
        >
            {/* Background circle */}
            <div
                className="absolute inset-0 rounded-full"
                style={{
                    background: `linear-gradient(135deg, ${COLORS.primary[100]} 0%, ${COLORS.secondary[100]} 100%)`,
                }}
            />

            {/* Chef hat decoration */}
            <div
                className="absolute -top-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                    backgroundColor: COLORS.primary[500],
                }}
            >
                <ChefHat size={20} className="text-white" />
            </div>

            {/* Mascot emoji */}
            <div
                className="relative text-6xl"
                style={{
                    fontSize: size * 0.5,
                }}
            >
                {getEmoji()}
            </div>

            {/* Sparkle effects for celebrating variant */}
            {variant === 'celebrating' && shouldAnimate && (
                <>
                    <div
                        className="absolute top-0 left-0 text-2xl animate-floatUp"
                        style={{ animationDelay: '0ms' }}
                    >
                        ✨
                    </div>
                    <div
                        className="absolute top-0 right-0 text-2xl animate-floatUp"
                        style={{ animationDelay: '200ms' }}
                    >
                        ✨
                    </div>
                    <div
                        className="absolute bottom-0 left-1/4 text-2xl animate-floatUp"
                        style={{ animationDelay: '400ms' }}
                    >
                        ⭐
                    </div>
                </>
            )}

            {/* Steam effects for cooking variant */}
            {variant === 'cooking' && shouldAnimate && (
                <>
                    <div
                        className="absolute -top-4 left-1/4 text-xl animate-floatUp opacity-60"
                        style={{ animationDelay: '0ms' }}
                    >
                        💨
                    </div>
                    <div
                        className="absolute -top-4 right-1/4 text-xl animate-floatUp opacity-60"
                        style={{ animationDelay: '300ms' }}
                    >
                        💨
                    </div>
                </>
            )}
        </div>
    );
};

export default ChefMascot;