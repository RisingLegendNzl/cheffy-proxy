// web/src/components/PullToRefresh.jsx
import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { COLORS } from '../constants';

/**
 * Pull-to-refresh functionality for mobile
 * Wraps content and adds pull-down refresh gesture
 */
const PullToRefresh = ({ 
  onRefresh, 
  children,
  refreshing = false,
  threshold = 80 
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const startY = useRef(0);
  const containerRef = useRef(null);

  useEffect(() => {
    setIsRefreshing(refreshing);
  }, [refreshing]);

  const handleTouchStart = (e) => {
    // Only trigger if at the top of the page
    if (window.scrollY === 0 && !isRefreshing) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e) => {
    if (!isPulling || isRefreshing) return;

    const currentY = e.touches[0].clientY;
    const distance = currentY - startY.current;

    if (distance > 0) {
      // Apply resistance curve
      const resistance = Math.min(distance * 0.5, threshold * 1.5);
      setPullDistance(resistance);
      
      // Prevent default scroll if pulling
      if (distance > 10) {
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling) return;

    setIsPulling(false);

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } catch (error) {
        console.error('Refresh failed:', error);
      } finally {
        setTimeout(() => {
          setIsRefreshing(false);
          setPullDistance(0);
        }, 500);
      }
    } else {
      setPullDistance(0);
    }
  };

  const rotation = Math.min((pullDistance / threshold) * 360, 360);
  const opacity = Math.min(pullDistance / threshold, 1);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative"
    >
      {/* Pull indicator */}
      <div
        className="absolute top-0 left-0 right-0 flex justify-center transition-all duration-200"
        style={{
          transform: `translateY(${Math.min(pullDistance - 40, 40)}px)`,
          opacity: isRefreshing ? 1 : opacity,
          pointerEvents: 'none',
        }}
      >
        <div
          className="flex items-center justify-center w-10 h-10 rounded-full"
          style={{ backgroundColor: COLORS.primary[100] }}
        >
          <RefreshCw
            size={20}
            style={{
              color: COLORS.primary[600],
              transform: `rotate(${isRefreshing ? 0 : rotation}deg)`,
              transition: 'transform 0.2s ease',
            }}
            className={isRefreshing ? 'animate-spin' : ''}
          />
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          transform: `translateY(${isPulling ? pullDistance : 0}px)`,
          transition: isPulling ? 'none' : 'transform 0.3s ease',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default PullToRefresh;