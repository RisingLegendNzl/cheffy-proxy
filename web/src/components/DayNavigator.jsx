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
      className="bg-white rounded-xl p-4 shadow-md border"
      style={{ borderColor: COLORS.gray[200] }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Calendar size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
          <span className="font-semibold" style={{ color: COLORS.gray[900] }}>
            Your {totalDays}-Day Plan
          </span>
        </div>
        <span className="text-sm" style={{ color: COLORS.gray[500] }}>
          {completedDays.length} of {totalDays} completed
        </span>
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center justify-between mb-4">
        {/* Previous Button */}
        <button
          onClick={handlePrevious}
          disabled={!canGoPrevious}
          className={`p-2 rounded-lg transition-all ${
            canGoPrevious
              ? 'hover:bg-gray-100 hover-lift'
              : 'opacity-40 cursor-not-allowed'
          }`}
          style={{ color: COLORS.primary[600] }}
          aria-label="Previous day"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Current Day Display */}
        <div className="text-center">
          <p className="text-sm font-semibold mb-1" style={{ color: COLORS.gray[600] }}>
            Current Day
          </p>
          <p
            className="text-4xl font-bold"
            style={{
              background: `linear-gradient(135deg, ${COLORS.primary[500]}, ${COLORS.secondary[500]})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {currentDay}
          </p>
        </div>

        {/* Next Button */}
        <button
          onClick={handleNext}
          disabled={!canGoNext}
          className={`p-2 rounded-lg transition-all ${
            canGoNext
              ? 'hover:bg-gray-100 hover-lift'
              : 'opacity-40 cursor-not-allowed'
          }`}
          style={{ color: COLORS.primary[600] }}
          aria-label="Next day"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Progress Dots */}
      <div className="flex justify-center space-x-2">
        {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
          const isCompleted = completedDays.includes(day);
          const isCurrent = day === currentDay;

          return (
            <button
              key={day}
              onClick={() => onSelectDay(day)}
              className={`rounded-full transition-all duration-300 ${
                isCurrent ? 'w-8 h-3' : 'w-3 h-3 hover:scale-125'
              }`}
              style={{
                backgroundColor: isCompleted
                  ? COLORS.success.main
                  : isCurrent
                  ? COLORS.primary[500]
                  : COLORS.gray[300],
              }}
              aria-label={`Day ${day}`}
              title={`Day ${day}${isCompleted ? ' (Completed)' : ''}`}
            />
          );
        })}
      </div>

      {/* Quick Jump (for plans with many days) */}
      {totalDays > 7 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: COLORS.gray[200] }}>
          <label className="block text-xs font-semibold mb-2" style={{ color: COLORS.gray[600] }}>
            Jump to day:
          </label>
          <select
            value={currentDay}
            onChange={(e) => onSelectDay(Number(e.target.value))}
            className="w-full p-2 border rounded-lg text-sm"
            style={{
              borderColor: COLORS.gray[300],
              color: COLORS.gray[900],
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