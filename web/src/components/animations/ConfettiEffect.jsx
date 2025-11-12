// web/src/components/animations/ConfettiEffect.jsx
// web/src/components/animations/ConfettiEffect.jsx
import React, { useEffect, useState } from 'react';
import { COLORS, Z_INDEX } from '../../constants';
import { generateConfettiParticles, prefersReducedMotion } from '../../utils/animationHelpers';

/**
 * Confetti effect component for celebrating milestones
 * Features custom ingredient illustrations (carrots, dumbbells, chef hats)
 * Automatically removes itself after animation completes
 */
const ConfettiEffect = ({ 
  isActive = false, 
  duration = 3000,
  particleCount = 50,
  onComplete 
}) => {
  const [particles, setParticles] = useState([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isActive && !prefersReducedMotion()) {
      // Generate particles
      const newParticles = generateConfettiParticles(particleCount);
      setParticles(newParticles);
      setIsVisible(true);

      // Clean up after animation completes
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete && onComplete();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isActive, duration, particleCount, onComplete]);

  if (!isVisible || prefersReducedMotion()) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: Z_INDEX.confetti }}
      aria-hidden="true"
    >
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute animate-confettiFall"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            animationDelay: `${particle.delay}ms`,
            animationDuration: `${particle.duration}ms`,
            '--sway-amount': `${particle.swayAmount}px`,
          }}
        >
          <div
            className="text-2xl"
            style={{
              transform: `rotate(${particle.rotation}deg) scale(${particle.size})`,
              opacity: 0.9,
              filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1))',
            }}
          >
            {particle.shape}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ConfettiEffect;