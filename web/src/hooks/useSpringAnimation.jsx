// web/src/hooks/useSpringAnimation.jsx
import { useState, useEffect, useRef } from 'react';

/**
 * Hook for spring-based animations
 * Provides smooth, physics-based motion
 * 
 * @param {number} targetValue - Target value to animate to
 * @param {object} config - Spring configuration
 * @returns {number} - Current animated value
 */
const useSpringAnimation = (
  targetValue, 
  { 
    stiffness = 170, 
    damping = 26, 
    mass = 1,
    precision = 0.01 
  } = {}
) => {
  const [currentValue, setCurrentValue] = useState(targetValue);
  const velocity = useRef(0);
  const animationFrame = useRef(null);

  useEffect(() => {
    let value = currentValue;
    let vel = velocity.current;

    const animate = () => {
      // Spring physics calculation
      const springForce = -stiffness * (value - targetValue);
      const dampingForce = -damping * vel;
      const acceleration = (springForce + dampingForce) / mass;

      // Update velocity and position
      vel += acceleration * (1 / 60); // Assume 60fps
      value += vel * (1 / 60);

      // Check if animation is complete (within precision threshold)
      const isComplete = 
        Math.abs(value - targetValue) < precision && 
        Math.abs(vel) < precision;

      if (isComplete) {
        setCurrentValue(targetValue);
        velocity.current = 0;
        return;
      }

      // Update state and continue animation
      setCurrentValue(value);
      velocity.current = vel;
      animationFrame.current = requestAnimationFrame(animate);
    };

    // Start animation if target changed
    if (Math.abs(targetValue - currentValue) > precision) {
      animationFrame.current = requestAnimationFrame(animate);
    }

    // Cleanup
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [targetValue, stiffness, damping, mass, precision]);

  return currentValue;
};

export default useSpringAnimation;