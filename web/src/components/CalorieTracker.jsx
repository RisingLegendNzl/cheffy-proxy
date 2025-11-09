import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { DataDrivenTracker } from './DataDrivenTracker';
import { GamifiedTracker } from './GamifiedTracker';
import { MindfulTracker } from './MindfulTracker';
import { Loader2 } from 'lucide-react';

/**
 * The main wrapper component for the calorie tracker.
 * ...
 * Props:
 * - targets (object): { calories, protein, fat, carbs }
 * - actual (object): { calories, protein, fat, carbs }
 * - isLoading (boolean): True if data is still being fetched.
 * - planned (object): [REMOVED from requirements, but still accepted]
 */
export const CalorieTracker = ({ targets, planned, actual, isLoading }) => {
  const { activeTheme } = useTheme();

  // 1. Handle Loading State
  if (isLoading) {
    return (
      <div className="w-full p-6 bg-gray-100 rounded-xl shadow-lg flex justify-center items-center min-h-[200px] border">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-gray-600">Loading Tracker...</span>
      </div>
    );
  }

  // 2. Handle Empty/Error State
  // --- [FIX] ---
  // Removed the '!planned' check. The 'planned' prop is no longer
  // required for the component to render, as it's not used by the themes.
  if (!targets || !actual) {
  // --- [END FIX] ---
    return (
      <div className="w-full p-6 bg-gray-50 rounded-xl shadow-lg flex justify-center items-center min-h-[200px] border border-dashed">
        <span className="text-gray-500">No data available for tracker.</span>
      </div>
    );
  }

  // 3. Render the correct theme based on context
  const renderTheme = () => {
    switch (activeTheme) {
      case 'gamified':
        return <GamifiedTracker targets={targets} planned={planned} actual={actual} />;
      case 'mindful':
        return <MindfulTracker targets={targets} planned={planned} actual={actual} />;
      case 'data-driven':
      default:
        return <DataDrivenTracker targets={targets} planned={planned} actual={actual} />;
    }
  };

  return (
    <div className="w-full animate-fadeIn">
      {/* The renderTheme function returns the correct component */}
      {renderTheme()}
    </div>
  );
};


