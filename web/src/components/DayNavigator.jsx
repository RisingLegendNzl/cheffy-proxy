// web/src/components/DayNavigator.jsx
import React, { useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';
import DayCard from './DayCard';

/**
 * Enhanced day navigation with horizontal scroll snap and DayCard components
 * Features: smooth scrolling, pagination dots, day previews
 */
const DayNavigator = ({ 
  currentDay, 
  totalDays, 
  onSelectDay,
  completedDays = [],
  dayCalories = {} // Object mapping day number to calorie count
}) => {
  const scrollContainerRef = useRef(null);
  
  const canGoPrevious = currentDay > 1;
  const canGoNext = currentDay < totalDays;

  // Scroll to selected day on mount and when currentDay changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      const cardWidth = 160 + 16; // card width + gap
      const scrollPosition = (currentDay - 1) * cardWidth;
      scrollContainerRef.current.scrollTo({
        left: scrollPosition,
        behavior: 'smooth'
      });
    }
  }, [currentDay]);

  const handlePrevious = () => {
    if (canGoPrevious) {
      onSelectDay(currentDay - 1);
    }
  };

  const handleNext = () => {
    if (canGoNext) {
      onSelectDay(currentDay + 1);
    }
  };

  return (
    <div
      className="bg-white rounded-2xl p-6 shadow-md border"
      style={{ 
        borderColor: COLORS.gray[200],
        boxShadow: SHADOWS.md,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Calendar 
            size={20} 
            className="mr-2" 
            style={{ color: COLORS.primary[600] }} 
          />
          <span 
            className="font-semibold text-lg"
            style={{ 
              color: COLORS.gray[900],
              fontFamily: 'var(--font-family-display)',
            }}
          >
            Your {totalDays}-Day Plan
          </span>
        </div>
        <span className="text-sm" style={{ color: COLORS.gray[500] }}>
          {completedDays.length} of {totalDays} completed
        </span>
      </div>

      {/* Navigation with Cards */}
      <div className="relative">
        {/* Previous Button */}
        <button
          onClick={handlePrevious}
          disabled={!canGoPrevious}
          className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 p-2 rounded-full bg-white transition-all ${
            canGoPrevious
              ? 'hover:bg-gray-100 hover-lift shadow-md'
              : 'opacity-40 cursor-not-allowed'
          }`}
          style={{ 
            color: COLORS.primary[600],
            boxShadow: canGoPrevious ? SHADOWS.md : 'none',
          }}
          aria-label="Previous day"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Horizontal Scrollable Container */}
        <div
          ref={scrollContainerRef}
          className="overflow-x-auto pb-4 hide-scrollbar"
          style={{
            scrollSnapType: 'x mandatory',
            scrollBehavior: 'smooth',
          }}
        >
          <div className="flex space-x-4 px-1">
            {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => (
              <div
                key={day}
                style={{ scrollSnapAlign: 'start' }}
              >
                <DayCard
                  day={day}
                  isSelected={day === currentDay}
                  onClick={() => onSelectDay(day)}
                  calorieCount={dayCalories[day] || 0}
                  mealCount={3}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Next Button */}
        <button
          onClick={handleNext}
          disabled={!canGoNext}
          className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 p-2 rounded-full bg-white transition-all ${
            canGoNext
              ? 'hover:bg-gray-100 hover-lift shadow-md'
              : 'opacity-40 cursor-not-allowed'
          }`}
          style={{ 
            color: COLORS.primary[600],
            boxShadow: canGoNext ? SHADOWS.md : 'none',
          }}
          aria-label="Next day"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Pagination Dots */}
      <div className="flex justify-center space-x-2 mt-4">
        {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => (
          <button
            key={day}
            onClick={() => onSelectDay(day)}
            className="transition-all duration-200"
            style={{
              width: day === currentDay ? '24px' : '8px',
              height: '8px',
              borderRadius: '4px',
              backgroundColor: day === currentDay 
                ? COLORS.primary[600] 
                : COLORS.gray[300],
            }}
            aria-label={`Go to day ${day}`}
          />
        ))}
      </div>

      {/* Hide scrollbar CSS */}
      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default DayNavigator;