// web/src/components/ShimmerLoader.jsx
import React from 'react';
import { COLORS } from '../constants';
import useReducedMotion from '../hooks/useReducedMotion';

/**
 * Enhanced skeleton loader with shimmer effect
 * Provides visual feedback during content loading
 */
const ShimmerLoader = ({
  width = '100%',
  height = '20px',
  borderRadius = '8px',
  className = '',
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: COLORS.gray[200],
      }}
    >
      {!prefersReducedMotion && (
        <div
          className="absolute inset-0 animate-shimmer"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
          }}
        />
      )}
    </div>
  );
};

/**
 * Pre-built skeleton shapes for common use cases
 */
export const SkeletonText = ({ lines = 3, className = '' }) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <ShimmerLoader
        key={i}
        height="16px"
        width={i === lines - 1 ? '70%' : '100%'}
      />
    ))}
  </div>
);

export const SkeletonCard = ({ className = '' }) => (
  <div className={`p-4 bg-white rounded-xl ${className}`}>
    <ShimmerLoader height="120px" className="mb-4" />
    <ShimmerLoader height="20px" width="60%" className="mb-2" />
    <SkeletonText lines={2} />
  </div>
);

export const SkeletonCircle = ({ size = 48, className = '' }) => (
  <ShimmerLoader
    width={`${size}px`}
    height={`${size}px`}
    borderRadius="50%"
    className={className}
  />
);

export default ShimmerLoader;