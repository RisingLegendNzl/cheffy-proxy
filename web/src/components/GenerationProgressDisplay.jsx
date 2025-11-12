// web/src/components/GenerationProgressDisplay.jsx
import React, { useState, useEffect } from 'react';
import { COLORS, STAGE_TIMING } from '../constants';
import ForgeStageOne from './generation/ForgeStageOne';
import ForgeStageTwo from './generation/ForgeStageTwo';
import ForgeStageThree from './generation/ForgeStageThree';
import HeatGauge from './generation/HeatGauge';
import { prefersReducedMotion } from '../utils/animationHelpers';

/**
 * Generation Progress Display - Nutrition Forge Concept
 * Transforms meal generation into a crafting experience
 * Three stages: Gathering → Calculating → Optimizing
 * Background shifts from cool blue → warm amber → vibrant green
 */
const GenerationProgressDisplay = ({ activeStepKey, errorMsg, latestLog }) => {
    const [currentStage, setCurrentStage] = useState(1);
    const [stageProgress, setStageProgress] = useState(0);

    // Map step keys to stages
    useEffect(() => {
        if (!activeStepKey) {
            setCurrentStage(1);
            setStageProgress(0);
            return;
        }

        const stepToStage = {
            'step_targets': { stage: 1, progress: 20 },
            'step_planning': { stage: 2, progress: 50 },
            'step_complete': { stage: 3, progress: 100 },
        };

        const mapping = stepToStage[activeStepKey];
        if (mapping) {
            setCurrentStage(mapping.stage);
            setStageProgress(mapping.progress);
        }
    }, [activeStepKey]);

    // Get background gradient based on stage
    const getBackgroundGradient = () => {
        if (currentStage === 1) {
            return `linear-gradient(135deg, ${COLORS.forge.cool} 0%, #7c3aed 100%)`;
        }
        if (currentStage === 2) {
            return `linear-gradient(135deg, #7c3aed 0%, ${COLORS.forge.warm} 100%)`;
        }
        return `linear-gradient(135deg, ${COLORS.forge.warm} 0%, ${COLORS.forge.hot} 100%)`;
    };

    // Get stage title
    const getStageTitle = () => {
        if (currentStage === 1) return 'Gathering Ingredients';
        if (currentStage === 2) return 'Calculating Nutrition';
        return 'Optimizing Your Plan';
    };

    // Get stage description
    const getStageDescription = () => {
        if (currentStage === 1) return 'Assembling the finest ingredients for your goals';
        if (currentStage === 2) return 'Balancing macros and optimizing combinations';
        return 'Crafting your personalized meal plan';
    };

    if (errorMsg) {
        return (
            <div className="p-6 rounded-xl bg-red-50 border-2 border-red-200 animate-shake">
                <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                        <span className="text-white font-bold">!</span>
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-red-900 mb-2">Generation Failed</h3>
                        <p className="text-sm text-red-700">{errorMsg}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="relative rounded-2xl overflow-hidden transition-all duration-1000"
            style={{
                background: getBackgroundGradient(),
                minHeight: '400px',
            }}
        >
            {/* Content Container */}
            <div className="relative z-10 p-8">
                {/* Header */}
                <div className="text-center mb-8 animate-fadeIn">
                    <h2 className="text-3xl font-bold text-white mb-2">
                        {getStageTitle()}
                    </h2>
                    <p className="text-white opacity-90 text-lg">
                        {getStageDescription()}
                    </p>
                </div>

                {/* Heat Gauge */}
                <div className="mb-8">
                    <HeatGauge progress={stageProgress} currentStage={currentStage} />
                </div>

                {/* Stage Visualizations */}
                <div className="relative" style={{ minHeight: '200px' }}>
                    {currentStage === 1 && <ForgeStageOne />}
                    {currentStage === 2 && <ForgeStageTwo />}
                    {currentStage === 3 && <ForgeStageThree />}
                </div>

                {/* Latest Log (Optional) */}
                {latestLog && (
                    <div className="mt-6 text-center animate-fadeIn">
                        <p className="text-sm text-white opacity-75 font-mono">
                            {latestLog}
                        </p>
                    </div>
                )}
            </div>

            {/* Decorative Overlay */}
            <div
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                    backgroundImage: `radial-gradient(circle at 50% 50%, white 1px, transparent 1px)`,
                    backgroundSize: '30px 30px',
                }}
            />
        </div>
    );
};

export default GenerationProgressDisplay;