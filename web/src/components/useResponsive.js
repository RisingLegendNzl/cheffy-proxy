// web/src/hooks/useResponsive.js
import { useState, useEffect } from 'react';
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
 */
export const useInView = (ref, options = {}) => {
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    }, options);

    observer.observe(ref.current);

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, [ref, options]);

  return isInView;
};

export default useResponsive;