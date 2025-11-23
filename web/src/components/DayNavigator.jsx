// web/src/components/DayNavigator.jsx
import React from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';

/**
 * Component to display the large, horizontally scrollable day pills.
 * This component structure is assumed based on user screenshots to fix clipping issues.
 */
const LargeDayPills = ({ totalDays, currentDay, onSelectDay }) => (
  // The negative margin (-mx-6/-mx-10) counteracts the padding of the parent <div>,
  // making this element span the full width of the card.
  // The inner padding (px-6/px-10) then pushes the content back in, ensuring the pills
  // are fully visible and don't get clipped on the edges.
  <div className="flex space-x-3 overflow-x-auto py-2 -mx-6 sm:-mx-10 px-6 sm:px-10 scrollbar-hide">
    {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
      const isCurrent = day === currentDay;
      
      const pillStyle = isCurrent 
        ? { 
            background: `linear-gradient(135deg, ${COLORS.primary[500]}, ${COLORS.secondary[500]})`,
            color: 'white',
            // Stronger shadow for the selected pill
            boxShadow: '0 8px 15px -3px rgba(99, 102, 241, 0.4), 0 4px 6px -2px rgba(99, 102, 241, 0.2)',
          }
        : { 
            backgroundColor: 'white', 
            color: COLORS.gray[900], 
            borderColor: COLORS.gray[200],
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
          };

      return (
        <button
          key={day}
          onClick={() => onSelectDay(day)}
          // flex-shrink-0 ensures the pill is never squeezed by the flex container.
          className={`flex-shrink-0 min-w-[100px] h-12 py-2 px-6 rounded-full font-bold text-base transition-all duration-300 border ${
            isCurrent ? 'scale-105' : 'hover:scale-[1.02] active:scale-95'
          }`}
          style={pillStyle}
        >
          DAY {day}
        </button>
      );
    })}
  </div>
);

/**
 * Enhanced day navigation with arrows and progress dots, now including a large pill selector.
 */
const DayNavigator = ({ 
  currentDay, 
  totalDays, 
  onSelectDay,
  completedDays = [] 
}) => {
  const canGoPrevious = currentDay > 1;
  const canGoNext = currentDay < totalDays;

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

  // Use the large pill selector for plans with up to 7 days, otherwise use the detailed control.
  const showLargePillSelector = totalDays <= 7;

  // Tailwind utility to hide the scrollbar without affecting scrolling functionality
  const scrollbarHideStyle = `
    .scrollbar-hide::-webkit-scrollbar {
        display: none;
    }
    .scrollbar-hide {
        -ms-overflow-style: none; /* IE and Edge */
        scrollbar-width: none; /* Firefox */
    }
  `;

  return (
    <div
      // Main container with generous padding (px-6/sm:px-10) and no overflow-hidden.
      className="relative rounded-2xl py-6 px-6 sm:px-10 shadow-lg border backdrop-blur-sm transition-all duration-300 hover:shadow-xl"
      style={{ 
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(249, 250, 251, 0.98) 100%)',
        borderColor: COLORS.gray[200] 
      }}
    >
      {/* Scrollbar hide CSS injected via style tag */}
      <style>{scrollbarHideStyle}</style>

      {/* Subtle gradient overlay */}
      <div 
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{
          background: `radial-gradient(circle at top right, ${COLORS.primary[300]}, transparent 70%)`
        }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <div 
            className="p-2 rounded-lg transition-colors duration-200"
            style={{ backgroundColor: `${COLORS.primary[50]}` }}
          >
            <Calendar size={20} style={{ color: COLORS.primary[600] }} />
          </div>
          <span 
            className="font-semibold tracking-tight" 
            style={{ color: COLORS.gray[900] }}
          >
            Your {totalDays}-Day Plan
          </span>
        </div>
        <span 
          className="text-sm font-medium tracking-wide px-3 py-1 rounded-full" 
          style={{ 
            color: COLORS.gray[600],
            backgroundColor: COLORS.gray[100]
          }}
        >
          {completedDays.length}/{totalDays}
        </span>
      </div>

      {/* --- BEGIN LARGE PILL SELECTOR BLOCK (Fixes Clipping) --- */}
      {showLargePillSelector && (
        <div className="mb-6">
          <LargeDayPills
            totalDays={totalDays}
            currentDay={currentDay}
            onSelectDay={onSelectDay}
          />
        </div>
      )}
      {/* --- END LARGE PILL SELECTOR BLOCK --- */}


      {/* Navigation Controls (Use only for > 7 days or if large pill selector is hidden) */}
      {!showLargePillSelector && (
        <div className="flex items-center justify-between mb-6">
          {/* Previous Button */}
          <button
            onClick={handlePrevious}
            disabled={!canGoPrevious}
            className={`group relative p-3 rounded-xl transition-all duration-300 ${
              canGoPrevious
                ? 'hover:scale-110 hover:-translate-y-0.5 active:scale-95'
                : 'opacity-30 cursor-not-allowed'
            }`}
            style={{ 
              color: COLORS.primary[600],
              backgroundColor: canGoPrevious ? COLORS.primary[50] : 'transparent'
            }}
            aria-label="Previous day"
          >
            <ChevronLeft 
              size={24} 
              className={canGoPrevious ? 'transition-transform duration-300 group-hover:-translate-x-0.5' : ''}
            />
          </button>

          {/* Current Day Display */}
          <div className="text-center">
            <p 
              className="text-xs font-semibold uppercase tracking-widest mb-2" 
              style={{ color: COLORS.gray[500] }}
            >
              Current Day
            </p>
            <div className="relative">
              <p
                className="text-5xl font-bold tracking-tight transition-all duration-300"
                style={{
                  background: `linear-gradient(135deg, ${COLORS.primary[600]}, ${COLORS.secondary[600]})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 2px 4px rgba(99, 102, 241, 0.1))'
                }}
              >
                {currentDay}
              </p>
            </div>
          </div>

          {/* Next Button */}
          <button
            onClick={handleNext}
            disabled={!canGoNext}
            className={`group relative p-3 rounded-xl transition-all duration-300 ${
              canGoNext
                ? 'hover:scale-110 hover:-translate-y-0.5 active:scale-95'
                : 'opacity-30 cursor-not-allowed'
            }`}
            style={{ 
              color: COLORS.primary[600],
              backgroundColor: canGoNext ? COLORS.primary[50] : 'transparent'
            }}
            aria-label="Next day"
          >
            <ChevronRight 
              size={24}
              className={canGoNext ? 'transition-transform duration-300 group-hover:translate-x-0.5' : ''}
            />
          </button>
        </div>
      )}


      {/* Progress Dots (Use only for > 7 days or if large pill selector is hidden) */}
      {!showLargePillSelector && (
        <div className="flex justify-center items-center gap-1.5 flex-wrap">
          {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
            const isCompleted = completedDays.includes(day);
            const isCurrent = day === currentDay;

            return (
              <button
                key={day}
                onClick={() => onSelectDay(day)}
                className={`relative rounded-full transition-all duration-300 ease-out ${
                  isCurrent 
                    ? 'w-10 h-3.5 hover:scale-105' 
                    : 'w-3 h-3 hover:scale-150 hover:-translate-y-0.5'
                }`}
                style={{
                  backgroundColor: isCompleted
                    ? COLORS.success.main
                    : isCurrent
                    ? COLORS.primary[500]
                    : COLORS.gray[300],
                  boxShadow: isCurrent 
                    ? `0 0 12px ${COLORS.primary[400]}40, 0 4px 8px ${COLORS.primary[500]}20`
                    : isCompleted
                    ? `0 0 8px ${COLORS.success.main}30`
                    : 'none'
                }}
                aria-label={`Day ${day}`}
                title={`Day ${day}${isCompleted ? ' (Completed)' : ''}`}
              >
                {/* Pulse animation for current day */}
                {isCurrent && (
                  <span 
                    className="absolute inset-0 rounded-full animate-ping opacity-40"
                    style={{ backgroundColor: COLORS.primary[400] }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Jump (for plans with many days, e.g., totalDays > 7) */}
      {!showLargePillSelector && totalDays > 7 && (
        <div 
          className="mt-6 pt-5 border-t transition-colors duration-200" 
          style={{ borderColor: COLORS.gray[150] }}
        >
          <label 
            className="block text-xs font-semibold uppercase tracking-wider mb-3" 
            style={{ color: COLORS.gray[600] }}
          >
            Jump to day
          </label>
          <select
            value={currentDay}
            onChange={(e) => onSelectDay(Number(e.target.value))}
            className="w-full p-3 border rounded-xl text-sm font-medium transition-all duration-200 hover:border-opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1 cursor-pointer"
            style={{
              borderColor: COLORS.gray[300],
              color: COLORS.gray[900],
              backgroundColor: 'white',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
            }}
          >
            {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                Day {day}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default DayNavigator;

