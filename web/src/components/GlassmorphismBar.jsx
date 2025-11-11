// web/src/components/GlassmorphismBar.jsx
import React, { useState, useEffect } from 'react';
import { ShoppingBag } from 'lucide-react';
import { COLORS, GLASS, Z_INDEX } from '../constants';
import ProgressRing from './ProgressRing';

/**
 * Sticky glassmorphism summary bar
 * Compresses when scrolling for minimal UI footprint
 */
const GlassmorphismBar = ({
  totalCost = 0,
  totalItems = 0,
  checkedItems = 0,
  storeName = 'Woolworths',
}) => {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsCompact(window.scrollY > 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const progressPercentage = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

  return (
    <div
      className={`fixed top-0 left-0 right-0 transition-all duration-300 ${
        isCompact ? 'py-2' : 'py-4'
      }`}
      style={{
        zIndex: Z_INDEX.sticky,
        background: GLASS.background,
        backdropFilter: GLASS.blur,
        WebkitBackdropFilter: GLASS.blur,
        borderBottom: `1px solid ${GLASS.border}`,
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="flex items-center justify-between">
          {/* Left: Store & Items */}
          <div className="flex items-center space-x-4">
            <ShoppingBag
              size={isCompact ? 20 : 24}
              style={{ color: COLORS.primary[600] }}
            />
            <div>
              <p
                className={`font-bold transition-all ${
                  isCompact ? 'text-sm' : 'text-lg'
                }`}
                style={{ color: COLORS.gray[900] }}
              >
                {storeName}
              </p>
              {!isCompact && (
                <p className="text-xs animate-fadeIn" style={{ color: COLORS.gray[500] }}>
                  {totalItems} items
                </p>
              )}
            </div>
          </div>

          {/* Center: Progress (desktop only) */}
          {!isCompact && (
            <div className="hidden md:block animate-fadeIn">
              <ProgressRing
                percentage={progressPercentage}
                size={60}
                strokeWidth={6}
                showPercentage
                gradientColors={[COLORS.primary[500], COLORS.accent[500]]}
              />
            </div>
          )}

          {/* Right: Total Cost */}
          <div className="text-right">
            <p
              className={`font-bold tabular-nums transition-all ${
                isCompact ? 'text-lg' : 'text-3xl'
              }`}
              style={{
                background: COLORS.gradients.primary,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              ${totalCost.toFixed(2)}
            </p>
            {!isCompact && (
              <p className="text-xs animate-fadeIn" style={{ color: COLORS.gray[500] }}>
                Total Cost
              </p>
            )}
          </div>
        </div>

        {/* Compact mode progress bar */}
        {isCompact && (
          <div
            className="mt-2 h-1 rounded-full overflow-hidden animate-fadeIn"
            style={{ backgroundColor: COLORS.gray[200] }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${progressPercentage}%`,
                background: COLORS.gradients.primary,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default GlassmorphismBar;