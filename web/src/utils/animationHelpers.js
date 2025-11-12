// web/src/utils/animationHelpers.js
// web/src/utils/animationHelpers.js

/**
 * Animation utility functions for Cheffy
 * Handles motion preferences, timing calculations, and animation helpers
 */

/**
 * Check if user prefers reduced motion
 * @returns {boolean}
 */
export const prefersReducedMotion = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

/**
 * Get safe animation duration
 * Returns 0 if user prefers reduced motion, otherwise returns the duration
 * @param {number} duration - Duration in milliseconds
 * @returns {number}
 */
export const getSafeAnimationDuration = (duration) => {
  return prefersReducedMotion() ? 0 : duration;
};

/**
 * Calculate stagger delay for list items
 * @param {number} index - Item index
 * @param {number} baseDelay - Base delay in milliseconds (default: 50ms)
 * @returns {number}
 */
export const calculateStaggerDelay = (index, baseDelay = 50) => {
  if (prefersReducedMotion()) return 0;
  return index * baseDelay;
};

/**
 * Generate random position for particle effects
 * @param {number} maxX - Maximum X coordinate
 * @param {number} maxY - Maximum Y coordinate
 * @returns {{ x: number, y: number }}
 */
export const generateRandomPosition = (maxX, maxY) => {
  return {
    x: Math.random() * maxX,
    y: Math.random() * maxY,
  };
};

/**
 * Generate random positions in a circular pattern (for ingredient swirl)
 * @param {number} count - Number of positions to generate
 * @param {number} radius - Radius of the circle
 * @returns {Array<{ x: number, y: number }>}
 */
export const generateCircularPositions = (count, radius) => {
  const positions = [];
  const angleStep = (2 * Math.PI) / count;
  
  for (let i = 0; i < count; i++) {
    const angle = i * angleStep;
    positions.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  
  return positions;
};

/**
 * Easing functions for custom animations
 */
export const easingFunctions = {
  // Standard easing
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  
  // Cubic easing
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => (--t) * t * t + 1,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  
  // Elastic easing (for spring effects)
  easeOutElastic: (t) => {
    const p = 0.3;
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
  },
  
  // Back easing (overshoots then returns)
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/**
 * Animate a value over time with custom easing
 * @param {Object} options
 * @param {number} options.from - Start value
 * @param {number} options.to - End value
 * @param {number} options.duration - Duration in milliseconds
 * @param {function} options.onUpdate - Callback with current value
 * @param {function} options.onComplete - Callback when animation completes
 * @param {function} options.easing - Easing function (default: easeOutQuad)
 */
export const animateValue = ({
  from,
  to,
  duration,
  onUpdate,
  onComplete,
  easing = easingFunctions.easeOutQuad,
}) => {
  if (prefersReducedMotion()) {
    onUpdate(to);
    onComplete && onComplete();
    return;
  }

  const startTime = performance.now();
  const change = to - from;

  const animate = (currentTime) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easing(progress);
    const currentValue = from + change * easedProgress;

    onUpdate(currentValue);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onComplete && onComplete();
    }
  };

  requestAnimationFrame(animate);
};

/**
 * Generate confetti particle properties
 * @param {number} count - Number of particles
 * @returns {Array<Object>}
 */
export const generateConfettiParticles = (count) => {
  const particles = [];
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6'];
  const shapes = ['🥕', '🏋️', '👨‍🍳', '🥗', '💪', '🍎', '🥦'];

  for (let i = 0; i < count; i++) {
    particles.push({
      id: i,
      x: Math.random() * 100, // percentage
      y: -10, // start above viewport
      rotation: Math.random() * 360,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      size: 0.8 + Math.random() * 0.8, // 0.8 to 1.6
      delay: Math.random() * 500, // stagger start
      duration: 2000 + Math.random() * 1000, // 2-3 seconds
      swayAmount: 20 + Math.random() * 20, // 20-40px sway
    });
  }

  return particles;
};

/**
 * Generate floating particle properties for ambient background
 * @param {number} count - Number of particles
 * @returns {Array<Object>}
 */
export const generateFloatingParticles = (count) => {
  const particles = [];
  const sizes = [2, 3, 4, 5];

  for (let i = 0; i < count; i++) {
    particles.push({
      id: i,
      x: Math.random() * 100, // percentage
      y: Math.random() * 100, // percentage
      size: sizes[Math.floor(Math.random() * sizes.length)],
      opacity: 0.2 + Math.random() * 0.3, // 0.2 to 0.5
      duration: 8000 + Math.random() * 4000, // 8-12 seconds
      delay: Math.random() * 5000,
      driftDistance: 20 + Math.random() * 30, // 20-50px
    });
  }

  return particles;
};

/**
 * Get time of day for ambient theme
 * @returns {string} - 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'
 */
export const getTimeOfDay = () => {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
};

/**
 * Calculate progress percentage for rings/bars
 * @param {number} current - Current value
 * @param {number} target - Target value
 * @returns {number} - Percentage (0-100), capped at 100
 */
export const calculateProgress = (current, target) => {
  if (target === 0) return 0;
  return Math.min(Math.round((current / target) * 100), 100);
};

/**
 * Calculate stroke dashoffset for SVG ring animations
 * @param {number} radius - Circle radius
 * @param {number} percentage - Progress percentage (0-100)
 * @returns {number}
 */
export const calculateStrokeDashoffset = (radius, percentage) => {
  const circumference = 2 * Math.PI * radius;
  return circumference - (percentage / 100) * circumference;
};

/**
 * Format animation delay for inline styles
 * @param {number} index - Item index
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {string}
 */
export const formatAnimationDelay = (index, baseDelay = 50) => {
  const delay = calculateStaggerDelay(index, baseDelay);
  return `${delay}ms`;
};

/**
 * Create CSS custom properties for ingredient float-in animation
 * @param {number} startX - Start X position
 * @param {number} startY - Start Y position
 * @returns {Object}
 */
export const createIngredientFloatStyles = (startX, startY) => {
  return {
    '--start-x': `${startX}px`,
    '--start-y': `${startY}px`,
  };
};

/**
 * Create CSS custom properties for orbital animation
 * @param {number} radius - Orbit radius in pixels
 * @returns {Object}
 */
export const createOrbitStyles = (radius) => {
  return {
    '--orbit-radius': `${radius}px`,
  };
};

/**
 * Debounce function for scroll/resize handlers
 * @param {function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {function}
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Check if element is in viewport (for scroll-triggered animations)
 * @param {HTMLElement} element - Element to check
 * @param {number} threshold - Percentage of element that should be visible (0-1)
 * @returns {boolean}
 */
export const isInViewport = (element, threshold = 0.1) => {
  if (!element) return false;
  
  const rect = element.getBoundingClientRect();
  const elementHeight = rect.height;
  const visibleHeight = threshold * elementHeight;
  
  return (
    rect.top + visibleHeight <= window.innerHeight &&
    rect.bottom - visibleHeight >= 0
  );
};

/**
 * Get random item from array
 * @param {Array} array
 * @returns {*}
 */
export const getRandomItem = (array) => {
  return array[Math.floor(Math.random() * array.length)];
};

/**
 * Clamp a number between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const clamp = (value, min, max) => {
  return Math.min(Math.max(value, min), max);
};

export default {
  prefersReducedMotion,
  getSafeAnimationDuration,
  calculateStaggerDelay,
  generateRandomPosition,
  generateCircularPositions,
  easingFunctions,
  animateValue,
  generateConfettiParticles,
  generateFloatingParticles,
  getTimeOfDay,
  calculateProgress,
  calculateStrokeDashoffset,
  formatAnimationDelay,
  createIngredientFloatStyles,
  createOrbitStyles,
  debounce,
  isInViewport,
  getRandomItem,
  clamp,
};