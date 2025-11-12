// web/src/components/animations/ParticleBackground.jsx
// web/src/components/animations/ParticleBackground.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { COLORS } from '../../constants';
import { 
  generateFloatingParticles, 
  prefersReducedMotion,
  getTimeOfDay 
} from '../../utils/animationHelpers';

/**
 * Ambient particle background with time-of-day gradients
 * Subtle floating particles create a sense of depth and calm
 * Gradient shifts based on current time (morning, afternoon, evening, night)
 */
const ParticleBackground = ({ 
  particleCount = 30,
  enableGradient = true,
  customGradient = null 
}) => {
  const [particles, setParticles] = useState([]);
  const [timeOfDay, setTimeOfDay] = useState('morning');

  // Generate particles on mount
  useEffect(() => {
    if (!prefersReducedMotion()) {
      const newParticles = generateFloatingParticles(particleCount);
      setParticles(newParticles);
    }
  }, [particleCount]);

  // Update time of day gradient
  useEffect(() => {
    const updateTimeOfDay = () => {
      setTimeOfDay(getTimeOfDay());
    };

    updateTimeOfDay();
    
    // Update every 30 minutes
    const interval = setInterval(updateTimeOfDay, 1800000);
    
    return () => clearInterval(interval);
  }, []);

  // Get gradient based on time of day or custom override
  const gradient = useMemo(() => {
    if (customGradient) return customGradient;
    if (!enableGradient) return 'transparent';
    
    const ambientColors = COLORS.ambient[timeOfDay];
    return ambientColors ? ambientColors.gradient : COLORS.ambient.morning.gradient;
  }, [timeOfDay, enableGradient, customGradient]);

  if (prefersReducedMotion()) {
    // Show static gradient only
    return (
      <div
        className="fixed inset-0 pointer-events-none transition-all duration-1000"
        style={{
          background: gradient,
          opacity: 0.3,
          zIndex: 0,
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Gradient Background */}
      {enableGradient && (
        <div
          className="absolute inset-0 transition-all duration-1000"
          style={{
            background: gradient,
            opacity: 0.3,
          }}
        />
      )}

      {/* Floating Particles */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute rounded-full animate-floatUp"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            backgroundColor: COLORS.primary[300],
            opacity: particle.opacity,
            animationDuration: `${particle.duration}ms`,
            animationDelay: `${particle.delay}ms`,
            '--drift-distance': `${particle.driftDistance}px`,
          }}
        />
      ))}

      {/* Additional drift animation layer */}
      {particles.slice(0, 10).map((particle) => (
        <div
          key={`drift-${particle.id}`}
          className="absolute rounded-full animate-floatDrift"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: `${particle.size * 1.5}px`,
            height: `${particle.size * 1.5}px`,
            backgroundColor: COLORS.secondary[300],
            opacity: particle.opacity * 0.5,
            animationDuration: `${particle.duration * 0.7}ms`,
            animationDelay: `${particle.delay}ms`,
            '--drift-distance': `${particle.driftDistance}px`,
          }}
        />
      ))}
    </div>
  );
};

export default ParticleBackground;