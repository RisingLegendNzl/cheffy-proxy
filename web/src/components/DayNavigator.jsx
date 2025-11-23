// web/src/components/DayNavigator.jsx
import React from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';

/**
 * Enhanced day navigation with arrows and progress dots
 * More intuitive than the current sidebar
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

  return (
    <div
      // 1. Removed overflow-hidden to prevent cutting off expanded pill shadow/animation.
      // 2. Adjusted padding to ensure enough space for the expanded pill.
      className="relative rounded-2xl py-6 px-4 sm:px-8 shadow-lg border backdrop-blur-sm transition-all duration-300 hover:shadow-xl"
      style={{ 
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(249, 250, 251, 0.98) 100%)',
        borderColor: COLORS.gray[200] 
      }}
    >
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

      {/* Navigation Controls */}
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

      {/* Progress Dots Container */}
      {/* Increased spacing flexibility by using gap and removing horizontal margin/padding on dots themselves */}
      <div className="flex justify-center items-center gap-1.5 flex-wrap">
        {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
          const isCompleted = completedDays.includes(day);
          const isCurrent = day === currentDay;

          return (
            <button
              key={day}
              onClick={() => onSelectDay(day)}
              className={`relative rounded-full transition-all duration-300 ease-out ${
                // The current pill is w-10 (40px). The original container padding p-6 (24px) 
                // on both sides was likely not enough for the full span of dots + the wider pill.
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

      {/* Quick Jump (for plans with many days) */}
      {totalDays > 7 && (
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

