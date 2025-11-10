// web/src/components/SwipeHandler.jsx
import React, { useRef, useState } from 'react';
import { COLORS } from '../constants';

/**
 * Swipe gesture handler for mobile interactions
 * Wraps content and detects swipe left/right
 */
const SwipeHandler = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  threshold = 50,
  showHint = false,
}) => {
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeDistance, setSwipeDistance] = useState(0);

  const minSwipeDistance = threshold;

  const onTouchStart = (e) => {
    setTouchEnd(0);
    setTouchStart(e.targetTouches[0].clientX);
    setIsSwiping(true);
  };

  const onTouchMove = (e) => {
    const currentTouch = e.targetTouches[0].clientX;
    setTouchEnd(currentTouch);
    setSwipeDistance(currentTouch - touchStart);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      setIsSwiping(false);
      setSwipeDistance(0);
      return;
    }

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && onSwipeLeft) {
      onSwipeLeft();
    }

    if (isRightSwipe && onSwipeRight) {
      onSwipeRight();
    }

    setIsSwiping(false);
    setSwipeDistance(0);
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="relative touch-pan-y"
      style={{
        transform: isSwiping ? `translateX(${swipeDistance * 0.3}px)` : 'none',
        transition: isSwiping ? 'none' : 'transform 0.2s ease',
      }}
    >
      {children}

      {/* Swipe hints */}
      {showHint && (
        <>
          {/* Left hint */}
          <div
            className="absolute left-0 top-1/2 transform -translate-y-1/2 px-4 py-2 rounded-r-lg text-white text-sm font-semibold pointer-events-none"
            style={{
              backgroundColor: COLORS.primary[500],
              opacity: Math.min(Math.abs(swipeDistance) / minSwipeDistance, 0.8),
              transform: `translateY(-50%) translateX(${Math.min(swipeDistance * 0.5, 0)}px)`,
            }}
          >
            ← Previous
          </div>

          {/* Right hint */}
          <div
            className="absolute right-0 top-1/2 transform -translate-y-1/2 px-4 py-2 rounded-l-lg text-white text-sm font-semibold pointer-events-none"
            style={{
              backgroundColor: COLORS.primary[500],
              opacity: Math.min(Math.abs(swipeDistance) / minSwipeDistance, 0.8),
              transform: `translateY(-50%) translateX(${Math.max(swipeDistance * 0.5, 0)}px)`,
            }}
          >
            Next →
          </div>
        </>
      )}
    </div>
  );
};

export default SwipeHandler;