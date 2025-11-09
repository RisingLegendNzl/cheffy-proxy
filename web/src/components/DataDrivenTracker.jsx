import React, { useEffect, useState } from 'react';
import { Flame, Soup, Droplet, Wheat } from 'lucide-react';

/**
 * A single animated progress bar.
 * It uses a `useEffect` to update its width, allowing the CSS transition to animate smoothly.
 */
const AnimatedBar = ({ value, max, colorClass }) => {
  const [width, setWidth] = useState('0%');

  useEffect(() => {
    // Calculate percentage, ensuring it's between 0 and 100
    const percentage = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
    
    // Set width for animation. The CSS transition will handle the smooth fill.
    // We request a new animation frame to ensure the transition triggers properly on mount.
    requestAnimationFrame(() => {
      setWidth(`${percentage}%`);
    });
  }, [value, max]);

  return (
    <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
      <div
        className={`h-2.5 rounded-full ${colorClass} transition-all duration-500 ease-out`}
        style={{ width: width }}
      ></div>
    </div>
  );
};

/**
 * The "Data-Driven" tracker theme.
 * Displays Eaten/Target/Remaining calories and macros with animated progress bars.
 */
export const DataDrivenTracker = ({ targets, actual }) => {
  // Ensure targets and actual are valid objects
  const validTargets = targets || { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const validActual = actual || { calories: 0, protein: 0, fat: 0, carbs: 0 };

  const remaining = (validTargets.calories || 0) - (validActual.calories || 0);
  const remainingCalories = Math.max(0, remaining); // Don't show negative remaining

  return (
    <div className="p-4 bg-white rounded-lg shadow-md border border-gray-200">
      <h3 className="text-lg font-bold text-gray-800 mb-4 text-center flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>
        Calorie Tracker
      </h3>

      {/* Main Calorie Bar */}
      <AnimatedBar
        value={validActual.calories}
        max={validTargets.calories}
        colorClass="bg-green-500"
      />

      {/* Eaten / Target / Remaining Stats */}
      <div className="flex justify-between mt-2 mb-4 text-center">
        <div>
          <p className="text-xs text-gray-500">Eaten</p>
          <p className="text-lg font-bold text-gray-900">
            {Math.round(validActual.calories)} <span className="text-sm font-normal">kcal</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Target</p>
          <p className="text-lg font-bold text-gray-900">
            {Math.round(validTargets.calories)} <span className="text-sm font-normal">kcal</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Remaining</p>
          <p className="text-lg font-bold text-green-600">
            {Math.round(remainingCalories)} <span className="text-sm font-normal">kcal</span>
          </p>
        </div>
      </div>

      {/* Macro Bars */}
      <div className="space-y-3 pt-3 border-t border-gray-100">
        {/* Protein */}
        <div className="flex items-center">
          <Soup size={16} className="text-green-500 mr-2 flex-shrink-0" />
          <div className="flex-grow">
            <div className="flex justify-between text-xs font-medium text-gray-600 mb-0.5">
              <span>Protein</span>
              <span>
                {Math.round(validActual.protein)}g / {Math.round(validTargets.protein)}g
              </span>
            </div>
            <AnimatedBar
              value={validActual.protein}
              max={validTargets.protein}
              colorClass="bg-green-500"
            />
          </div>
        </div>

        {/* Fat */}
        <div className="flex items-center">
          <Droplet size={16} className="text-yellow-500 mr-2 flex-shrink-0" />
          <div className="flex-grow">
            <div className="flex justify-between text-xs font-medium text-gray-600 mb-0.5">
              <span>Fat</span>
              <span>
                {Math.round(validActual.fat)}g / {Math.round(validTargets.fat)}g
              </span>
            </div>
            <AnimatedBar
              value={validActual.fat}
              max={validTargets.fat}
              colorClass="bg-yellow-500"
            />
          </div>
        </div>

        {/* Carbs */}
        <div className="flex items-center">
          <Wheat size={16} className="text-orange-500 mr-2 flex-shrink-0" />
          <div className="flex-grow">
            <div className="flex justify-between text-xs font-medium text-gray-600 mb-0.5">
              <span>Carbs</span>
              <span>
                {Math.round(validActual.carbs)}g / {Math.round(validTargets.carbs)}g
              </span>
            </div>
            <AnimatedBar
              value={validActual.carbs}
              max={validTargets.carbs}
              colorClass="bg-orange-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};


