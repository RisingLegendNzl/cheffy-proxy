// web/src/components/generation/ForgeStageOne.jsx
import React, { useEffect, useState } from 'react';
import { Apple, Fish, Milk, Wheat, Egg, Cookie } from 'lucide-react';
import {
    generateCircularPositions,
    createIngredientFloatStyles,
    prefersReducedMotion
} from '../../utils/animationHelpers';

/**
 * Forge Stage One - "Gathering"
 * Animated ingredient icons float in from edges, swirling toward center
 * Visual metaphor: Ingredients being assembled from all corners
 */
const ForgeStageOne = () => {
    const [ingredients, setIngredients] = useState([]);

    useEffect(() => {
        if (prefersReducedMotion()) return;

        // Define ingredient icons and their starting positions
        const ingredientIcons = [
            { Icon: Apple, name: 'Apple', color: '#ef4444' },
            { Icon: Fish, name: 'Fish', color: '#3b82f6' },
            { Icon: Milk, name: 'Milk', color: '#f3f4f6' },
            { Icon: Wheat, name: 'Wheat', color: '#f59e0b' },
            { Icon: Egg, name: 'Egg', color: '#fef3c7' },
            { Icon: Cookie, name: 'Cookie', color: '#d97706' },
        ];

        // Generate starting positions (from edges of container)
        const positions = [
            { x: -100, y: -100 },
            { x: 100, y: -100 },
            { x: -100, y: 100 },
            { x: 100, y: 100 },
            { x: 0, y: -120 },
            { x: 0, y: 120 },
        ];

        const newIngredients = ingredientIcons.map((item, index) => ({
            ...item,
            id: index,
            startX: positions[index].x,
            startY: positions[index].y,
            delay: index * 100,
        }));

        setIngredients(newIngredients);
    }, []);

    if (prefersReducedMotion()) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="grid grid-cols-3 gap-6">
                    <Apple size={48} className="text-red-500" />
                    <Fish size={48} className="text-blue-500" />
                    <Milk size={48} className="text-gray-300" />
                    <Wheat size={48} className="text-yellow-600" />
                    <Egg size={48} className="text-yellow-100" />
                    <Cookie size={48} className="text-yellow-700" />
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex items-center justify-center" style={{ height: '250px' }}>
            {/* Central gathering point */}
            <div className="absolute inset-0 flex items-center justify-center">
                <div
                    className="w-32 h-32 rounded-full animate-pulse"
                    style={{
                        background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 70%)',
                    }}
                />
            </div>

            {/* Floating ingredients */}
            {ingredients.map((ingredient) => {
                const { Icon, id, startX, startY, delay, color } = ingredient;

                return (
                    <div
                        key={id}
                        className="absolute animate-ingredientFloatIn"
                        style={{
                            ...createIngredientFloatStyles(startX, startY),
                            animationDelay: `${delay}ms`,
                            left: '50%',
                            top: '50%',
                            marginLeft: '-24px',
                            marginTop: '-24px',
                        }}
                    >
                        <div className="animate-ingredientSwirl">
                            <Icon
                                size={48}
                                style={{ color }}
                                className="drop-shadow-lg"
                            />
                        </div>
                    </div>
                );
            })}

            {/* Particle effects */}
            <div className="absolute inset-0 pointer-events-none">
                {[...Array(12)].map((_, i) => (
                    <div
                        key={i}
                        className="absolute w-1 h-1 bg-white rounded-full animate-floatUp"
                        style={{
                            left: `${Math.random() * 100}%`,
                            top: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 2000}ms`,
                            opacity: 0.6,
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export default ForgeStageOne;