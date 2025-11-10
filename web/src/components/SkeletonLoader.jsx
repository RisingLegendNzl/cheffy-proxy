// web/src/components/SkeletonLoader.jsx
import React from 'react';
import { COLORS } from '../constants';

/**
 * Skeleton loader components for better perceived performance
 * Shows while content is loading instead of blank space
 */

// Base skeleton element
export const Skeleton = ({ width = '100%', height = '1rem', className = '' }) => (
  <div
    className={`animate-skeleton rounded ${className}`}
    style={{
      width,
      height,
      backgroundColor: COLORS.gray[200],
    }}
  />
);

// Skeleton for meal cards
export const MealCardSkeleton = () => (
  <div className="bg-white rounded-xl p-5 shadow-md border animate-fadeIn" style={{ borderColor: COLORS.gray[200] }}>
    {/* Header image placeholder */}
    <Skeleton height="8rem" className="mb-4" />
    
    {/* Title */}
    <Skeleton width="70%" height="1.5rem" className="mb-2" />
    
    {/* Description */}
    <Skeleton width="100%" height="1rem" className="mb-2" />
    <Skeleton width="85%" height="1rem" className="mb-4" />
    
    {/* Stats */}
    <div className="flex space-x-4 mb-4">
      <Skeleton width="80px" height="1.25rem" />
      <Skeleton width="80px" height="1.25rem" />
      <Skeleton width="80px" height="1.25rem" />
    </div>
    
    {/* Macros grid */}
    <div className="grid grid-cols-3 gap-2 mb-4">
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
    </div>
    
    {/* Button */}
    <Skeleton height="2.5rem" />
  </div>
);

// Skeleton for ingredient cards
export const IngredientCardSkeleton = () => (
  <div className="bg-white rounded-xl p-6 shadow-lg border animate-fadeIn" style={{ borderColor: COLORS.gray[200] }}>
    <div className="flex justify-between items-start mb-4">
      <Skeleton width="60%" height="1.5rem" />
      <Skeleton width="80px" height="1.5rem" />
    </div>
    
    <Skeleton width="100%" height="4rem" className="mb-4" />
    
    <div className="space-y-3">
      <Skeleton height="6rem" />
      <Skeleton height="3rem" />
    </div>
  </div>
);

// Skeleton for shopping list
export const ShoppingListSkeleton = () => (
  <div className="space-y-3 animate-fadeIn">
    {/* Header */}
    <Skeleton height="8rem" className="rounded-xl" />
    
    {/* Category items */}
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-white rounded-xl p-4 border" style={{ borderColor: COLORS.gray[200] }}>
        <div className="flex items-center justify-between mb-3">
          <Skeleton width="40%" height="1.5rem" />
          <Skeleton width="24px" height="24px" className="rounded-full" />
        </div>
        <div className="space-y-2">
          <Skeleton height="3rem" />
          <Skeleton height="3rem" />
          <Skeleton height="3rem" />
        </div>
      </div>
    ))}
  </div>
);

// Skeleton for profile/stats
export const ProfileCardSkeleton = () => (
  <div className="bg-white rounded-xl p-6 shadow-lg border animate-fadeIn" style={{ borderColor: COLORS.gray[200] }}>
    <Skeleton width="50%" height="1.5rem" className="mb-4" />
    <div className="grid grid-cols-2 gap-4 mb-6">
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
    </div>
    <Skeleton height="12rem" />
  </div>
);

// Loading spinner with text
export const LoadingSpinner = ({ text = 'Loading...' }) => (
  <div className="flex flex-col items-center justify-center p-8 animate-fadeIn">
    <div className="spinner mb-4" />
    <p className="text-sm font-medium" style={{ color: COLORS.gray[600] }}>
      {text}
    </p>
  </div>
);

export default Skeleton;