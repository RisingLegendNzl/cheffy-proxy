// web/src/components/ui/AmbientOverlay.jsx
import React, { useEffect, useState } from 'react';
import ParticleBackground from '../animations/ParticleBackground';
import { getTimeOfDay } from '../../utils/animationHelpers';

/**
 * Ambient Overlay - Time-of-day gradients and particle effects
 * Features:
 * - Manages time-of-day gradients
 * - Ambient particle effects
 * - Smooth transitions between times
 * - Non-intrusive background layer
 */
const AmbientOverlay = ({
    enableGradient = true,
    enableParticles = true,
    particleCount = 20,
}) => {
    const [timeOfDay, setTimeOfDay] = useState('morning');

    useEffect(() => {
        const updateTimeOfDay = () => {
            setTimeOfDay(getTimeOfDay());
        };

        updateTimeOfDay();
        const interval = setInterval(updateTimeOfDay, 1800000); // 30 minutes

        return () => clearInterval(interval);
    }, []);

    return (
        <ParticleBackground
            particleCount={enableParticles ? particleCount : 0}
            enableGradient={enableGradient}
        />
    );
};

export default AmbientOverlay;