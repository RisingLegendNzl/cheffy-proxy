// web/src/components/profile/BlueprintRings.jsx
import React, { useEffect, useState } from 'react';
import { Flame, Droplet, Wheat } from 'lucide-react';
import { COLORS } from '../../constants';
import {
    calculateStrokeDashoffset,
    animateValue,
    prefersReducedMotion
} from '../../utils/animationHelpers';

/**
 * Blueprint Rings - Central calorie ring with concentric macro rings
 * Features:
 * - Drawing animation effect on first load
 * - Blueprint aesthetic
 * - Concentric layout
 * - Technical styling
 */
const BlueprintRings = ({ nutritionalTargets, macroPercentages }) => {
    const [hasAnimated, setHasAnimated] = useState(false);
    const [animatedProgress, setAnimatedProgress] = useState(0);

    const { calories = 0, protein = 0, fat = 0, carbs = 0 } = nutritionalTargets;

    // Animate drawing effect on mount
    useEffect(() => {
        if (hasAnimated || prefersReducedMotion()) {
            setAnimatedProgress(100);
            setHasAnimated(true);
            return;
        }

        const timer = setTimeout(() => {
            animateValue({
                from: 0,
                to: 100,
                duration: 2000,
                onUpdate: (value) => {
                    setAnimatedProgress(value);
                },
                onComplete: () => {
                    setHasAnimated(true);
                },
            });
        }, 300);

        return () => clearTimeout(timer);
    }, [hasAnimated]);

    // Ring calculations
    const centerX = 200;
    const centerY = 200;
    const calorieRadius = 140;
    const proteinRadius = 110;
    const fatRadius = 80;
    const carbsRadius = 50;
    const strokeWidth = 20;

    const calorieCircumference = 2 * Math.PI * calorieRadius;
    const proteinCircumference = 2 * Math.PI * proteinRadius;
    const fatCircumference = 2 * Math.PI * fatRadius;
    const carbsCircumference = 2 * Math.PI * carbsRadius;

    const calorieOffset = calculateStrokeDashoffset(calorieRadius, animatedProgress);
    const proteinOffset = calculateStrokeDashoffset(proteinRadius, animatedProgress);
    const fatOffset = calculateStrokeDashoffset(fatRadius, animatedProgress);
    const carbsOffset = calculateStrokeDashoffset(carbsRadius, animatedProgress);

    return (
        <div className="bg-white rounded-xl shadow-lg border p-8" style={{ borderColor: COLORS.gray[200] }}>
            {/* Header */}
            <div className="text-center mb-8">
                <h3 className="text-2xl font-bold mb-2" style={{ color: COLORS.gray[900] }}>
                    Daily Targets
                </h3>
                <p className="text-sm" style={{ color: COLORS.gray[600] }}>
                    Your personalized nutritional blueprint
                </p>
            </div>

            {/* Rings Container */}
            <div className="flex flex-col md:flex-row items-center justify-center gap-8">
                {/* SVG Rings */}
                <div className="relative" style={{ width: 400, height: 400 }}>
                    {/* Blueprint grid overlay */}
                    <div
                        className="absolute inset-0 pointer-events-none opacity-20"
                        style={{
                            backgroundImage: `
                                linear-gradient(${COLORS.blueprint.grid} 1px, transparent 1px),
                                linear-gradient(90deg, ${COLORS.blueprint.grid} 1px, transparent 1px)
                            `,
                            backgroundSize: '20px 20px',
                        }}
                    />

                    <svg width="400" height="400" className="transform -rotate-90">
                        {/* Calorie Ring */}
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={calorieRadius}
                            stroke={COLORS.gray[200]}
                            strokeWidth={strokeWidth}
                            fill="none"
                        />
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={calorieRadius}
                            stroke={COLORS.macros.calories.main}
                            strokeWidth={strokeWidth}
                            fill="none"
                            strokeDasharray={calorieCircumference}
                            strokeDashoffset={calorieOffset}
                            strokeLinecap="round"
                            className={`transition-all ${hasAnimated ? 'duration-500' : 'duration-2000'}`}
                            style={{
                                filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.3))',
                            }}
                        />

                        {/* Protein Ring */}
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={proteinRadius}
                            stroke={COLORS.gray[200]}
                            strokeWidth={strokeWidth}
                            fill="none"
                        />
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={proteinRadius}
                            stroke={COLORS.macros.protein.main}
                            strokeWidth={strokeWidth}
                            fill="none"
                            strokeDasharray={proteinCircumference}
                            strokeDashoffset={proteinOffset}
                            strokeLinecap="round"
                            className={`transition-all ${hasAnimated ? 'duration-500' : 'duration-2000'}`}
                            style={{
                                filter: 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.3))',
                            }}
                        />

                        {/* Fat Ring */}
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={fatRadius}
                            stroke={COLORS.gray[200]}
                            strokeWidth={strokeWidth}
                            fill="none"
                        />
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={fatRadius}
                            stroke={COLORS.macros.fat.main}
                            strokeWidth={strokeWidth}
                            fill="none"
                            strokeDasharray={fatCircumference}
                            strokeDashoffset={fatOffset}
                            strokeLinecap="round"
                            className={`transition-all ${hasAnimated ? 'duration-500' : 'duration-2000'}`}
                            style={{
                                filter: 'drop-shadow(0 0 8px rgba(236, 72, 153, 0.3))',
                            }}
                        />

                        {/* Carbs Ring */}
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={carbsRadius}
                            stroke={COLORS.gray[200]}
                            strokeWidth={strokeWidth}
                            fill="none"
                        />
                        <circle
                            cx={centerX}
                            cy={centerY}
                            r={carbsRadius}
                            stroke={COLORS.macros.carbs.main}
                            strokeWidth={strokeWidth}
                            fill="none"
                            strokeDasharray={carbsCircumference}
                            strokeDashoffset={carbsOffset}
                            strokeLinecap="round"
                            className={`transition-all ${hasAnimated ? 'duration-500' : 'duration-2000'}`}
                            style={{
                                filter: 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.3))',
                            }}
                        />
                    </svg>

                    {/* Center Label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <Flame size={32} style={{ color: COLORS.macros.calories.main }} className="mb-2" />
                        <div className="text-4xl font-bold" style={{ color: COLORS.gray[900] }}>
                            {calories}
                        </div>
                        <div className="text-sm font-semibold" style={{ color: COLORS.gray[500] }}>
                            kcal/day
                        </div>
                    </div>
                </div>

                {/* Legend */}
                <div className="space-y-4">
                    <div className="space-y-3">
                        {/* Calories */}
                        <div className="flex items-center space-x-3">
                            <div
                                className="w-12 h-12 rounded-lg flex items-center justify-center"
                                style={{
                                    backgroundColor: COLORS.macros.calories.light,
                                }}
                            >
                                <Flame size={24} style={{ color: COLORS.macros.calories.main }} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
                                    Calories
                                </p>
                                <p className="text-2xl font-bold" style={{ color: COLORS.macros.calories.dark }}>
                                    {calories} kcal
                                </p>
                            </div>
                        </div>

                        {/* Protein */}
                        <div className="flex items-center space-x-3">
                            <div
                                className="w-12 h-12 rounded-lg flex items-center justify-center"
                                style={{
                                    backgroundColor: COLORS.macros.protein.light,
                                }}
                            >
                                <Droplet size={24} style={{ color: COLORS.macros.protein.main }} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
                                    Protein
                                </p>
                                <p className="text-2xl font-bold" style={{ color: COLORS.macros.protein.dark }}>
                                    {protein}g
                                    <span className="text-sm ml-2" style={{ color: COLORS.gray[500] }}>
                                        ({macroPercentages.protein}%)
                                    </span>
                                </p>
                            </div>
                        </div>

                        {/* Fat */}
                        <div className="flex items-center space-x-3">
                            <div
                                className="w-12 h-12 rounded-lg flex items-center justify-center"
                                style={{
                                    backgroundColor: COLORS.macros.fat.light,
                                }}
                            >
                                <div className="text-2xl">🥑</div>
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
                                    Fat
                                </p>
                                <p className="text-2xl font-bold" style={{ color: COLORS.macros.fat.dark }}>
                                    {fat}g
                                    <span className="text-sm ml-2" style={{ color: COLORS.gray[500] }}>
                                        ({macroPercentages.fat}%)
                                    </span>
                                </p>
                            </div>
                        </div>

                        {/* Carbs */}
                        <div className="flex items-center space-x-3">
                            <div
                                className="w-12 h-12 rounded-lg flex items-center justify-center"
                                style={{
                                    backgroundColor: COLORS.macros.carbs.light,
                                }}
                            >
                                <Wheat size={24} style={{ color: COLORS.macros.carbs.main }} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
                                    Carbs
                                </p>
                                <p className="text-2xl font-bold" style={{ color: COLORS.macros.carbs.dark }}>
                                    {carbs}g
                                    <span className="text-sm ml-2" style={{ color: COLORS.gray[500] }}>
                                        ({macroPercentages.carbs}%)
                                    </span>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BlueprintRings;