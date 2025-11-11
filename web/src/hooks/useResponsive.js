// web/src/hooks/useResponsive.js
import { useState, useEffect, useRef }
from 'react';
import { BREAKPOINTS } from '../constants';

/**
 * Custom hook for responsive design
 * Detects screen size and provides helpful utilities
 */
export const useResponsive = () => {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowSize.width < parseInt(BREAKPOINTS.md);
  const isTablet = windowSize.width >= parseInt(BREAKPOINTS.md) && windowSize.width < parseInt(BREAKPOINTS.lg);
  const isDesktop = windowSize.width >= parseInt(BREAKPOINTS.lg);
  
  const isSmallScreen = windowSize.width < parseInt(BREAKPOINTS.sm);
  const isMediumScreen = windowSize.width >= parseInt(BREAKPOINTS.sm) && windowSize.width < parseInt(BREAKPOINTS.lg);
  const isLargeScreen = windowSize.width >= parseInt(BREAKPOINTS.lg);

  return {
    windowSize,
    isMobile,
    isTablet,
    isDesktop,
    isSmallScreen,
    isMediumScreen,
    isLargeScreen,
    // Helper for conditional classes
    mobile: isMobile,
    tablet: isTablet,
    desktop: isDesktop,
  };
};

/**
 * Custom hook for detecting scroll position
 */
export const useScrollPosition = () => {
  const [scrollY, setScrollY] = useState(0);
  const [scrollDirection, setScrollDirection] = useState('up');
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      if (currentScrollY > lastScrollY) {
        setScrollDirection('down');
      } else if (currentScrollY < lastScrollY) {
        setScrollDirection('up');
      }
      
      setScrollY(currentScrollY);
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  return {
    scrollY,
    scrollDirection,
    isAtTop: scrollY < 10,
    isScrollingDown: scrollDirection === 'down',
    isScrollingUp: scrollDirection === 'up',
  };
};

/**
 * Custom hook for detecting if element is in viewport
 *
 * @param {React.RefObject} ref - The ref of the element to observe
 * @param {object} options - IntersectionObserver options (e.g., threshold, rootMargin)
 * @param {boolean} options.triggerOnce - If true, stops observing after in view
 * @param {number} options.threshold - Percentage of element in view to trigger
 * @returns {boolean} - True if element is in view
 */
export const useInView = (ref, options = { triggerOnce: true, threshold: 0.1 }) => {
  const [isInView, setIsInView] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);

  useEffect(() => {
    // Ensure ref.current is valid
    const element = ref.current;
    if (!element) return;

    // Don't run observer if it has already triggered and triggerOnce is true
    if (hasTriggered && options.triggerOnce) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          if (options.triggerOnce) {
            setHasTriggered(true);
            // Stop observing
            observer.unobserve(element);
          }
        } else {
          // Only set to false if not triggerOnce
          if (!options.triggerOnce) {
            setIsInView(false);
          }
        }
      },
      {
        threshold: options.threshold,
        rootMargin: options.rootMargin,
      }
    );

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, [ref, options, hasTriggered]); // Rerun if ref or options change

  return isInView;
};

export default useResponsive;

