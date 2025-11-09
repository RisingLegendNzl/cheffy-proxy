import React, { useEffect, useState } from 'react';
import { Flame, Soup, Droplet, Wheat } from 'lucide-react';

/**
 * A single animated "blob" that fills vertically.
 * Animates the `height` property for a smooth fill effect.
 */
const AnimatedBlob = ({ value, max, colorClass }) => {
  const [height, setHeight] = useState('0%');

  useEffect(() => {
    // Calculate percentage, ensuring it's between 0 and 100
    const percentage = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
    
    // Set height for animation. The CSS transition will handle the smooth fill.
    requestAnimationFrame(() => {
      setHeight(`${percentage}%`);
    });
  }, [value, max]);

  return (
    <div className="w-full h-24 bg-gray-200 rounded-lg overflow-hidden relative">
      <div
        className={`absolute bottom-0 left-0 right-0 ${colorClass} transition-all duration-500 ease-out`}
        style={{ height: height }}
      ></div>
    </div>
  );
};

/**
 * The "Mindful" tracker theme.
 * Displays Eaten/Target/Remaining calories and macros with animated filling blobs.
 */
export const MindfulTracker = ({ targets, actual }) => {
  // Ensure targets and actual are valid objects
  const validTargets = targets || { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const validActual = actual || { calories: 0, protein: 0, fat: 0, carbs: 0 };

  const remaining = (validTargets.calories || 0) - (validActual.calories || 0);
  const remainingCalories = Math.max(0, remaining);

  return (
    <div className="p-4 bg-white rounded-lg shadow-md border border-gray-200">
      <h3 className="text-lg font-bold text-gray-800 mb-4 text-center flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>
        Calorie Tracker
      </h3>

      {/* Main Calorie Blob */}
      <div className="w-1/2 mx-auto">
        <AnimatedBlob
          value={validActual.calories}
          max={validTargets.calories}
          colorClass="bg-green-500/70"
        />
      </div>

      {/* Eaten / Target / Remaining Stats */}
      <div className="flex justify-between mt-3 mb-4 text-center">
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

      {/* Macro Blobs */}
      <div className="flex justify-around pt-3 border-t border-gray-100 space-x-2">
        {/* Protein */}
        <div className="flex-1 flex flex-col items-center">
          <AnimatedBlob
            value={validActual.protein}
            max={validTargets.protein}
            colorClass="bg-green-500/70"
          />
          <span className="text-xs font-medium text-gray-600 mt-2">Protein</span>
          <span className="text-xs text-gray-500">
            {Math.round(validActual.protein)}g / {Math.round(validTargets.protein)}g
          </span>
        </div>

        {/* Fat */}
        <div className="flex-1 flex flex-col items-center">
          <AnimatedBlob
            value={validActual.fat}
            max={validTargets.fat}
            colorClass="bg-yellow-500/70"
          />
          <span className="text-xs font-medium text-gray-600 mt-2">Fat</span>
          <span className="text-xs text-gray-500">
            {Math.round(validActual.fat)}g / {Math.round(validTargets.fat)}g
          </span>
        </div>

        {/* Carbs */}
        <div className="flex-1 flex flex-col items-center">
          <AnimatedBlob
            value={validActual.carbs}
            max={validTargets.carbs}
            colorClass="bg-orange-500/70"
          />
          <span className="text-xs font-medium text-gray-600 mt-2">Carbs</span>
          <span className="text-xs text-gray-500">
            {Math.round(validActual.carbs)}g / {Math.round(validTargets.carbs)}g
          </span>
        </div>
      </div>
    </div>
  );
};


