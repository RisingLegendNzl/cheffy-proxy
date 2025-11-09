import React, { useEffect, useState } from 'react';
import { Flame, Soup, Droplet, Wheat } from 'lucide-react';

/**
 * A single animated SVG ring.
 * Animates the `stroke-dashoffset` property for a smooth fill effect.
 */
const AnimatedRing = ({ value, max, colorClass, size = 32 }) => {
  const [offset, setOffset] = useState(0);
  const radius = size;
  const circumference = 2 * Math.PI * radius; // 2 * pi * r

  useEffect(() => {
    // Calculate percentage, ensuring it's between 0 and 100
    const percentage = max > 0 ? Math.min(Math.max(value / max, 0), 100) : 0;
    // Calculate the new dash offset
    const newOffset = circumference - (percentage / 100) * circumference;
    
    requestAnimationFrame(() => {
      setOffset(newOffset);
    });
  }, [value, max, circumference]);

  return (
    <svg className="transform -rotate-90" width={size * 2 + 8} height={size * 2 + 8}>
      <circle
        className="text-gray-200"
        strokeWidth="4"
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size + 4}
        cy={size + 4}
      />
      <circle
        className={`${colorClass} transition-all duration-500 ease-out`}
        strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size + 4}
        cy={size + 4}
      />
    </svg>
  );
};

/**
 * The "Gamified" tracker theme.
 * Displays Eaten/Target/Remaining calories and macros with animated rings.
 */
export const GamifiedTracker = ({ targets, actual }) => {
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

      {/* Main Calorie Ring */}
      <div className="flex justify-center items-center my-2">
        <div className="relative">
          <AnimatedRing
            value={validActual.calories}
            max={validTargets.calories}
            colorClass="text-green-500"
            size={48}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-gray-900">
              {Math.round(validActual.calories)}
            </span>
            <span className="text-xs text-gray-500">kcal</span>
          </div>
        </div>
      </div>

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

      {/* Macro Rings */}
      <div className="flex justify-around pt-3 border-t border-gray-100">
        {/* Protein */}
        <div className="flex flex-col items-center">
          <div className="relative">
            <AnimatedRing
              value={validActual.protein}
              max={validTargets.protein}
              colorClass="text-green-500"
              size={24}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Soup size={16} className="text-green-500" />
            </div>
          </div>
          <span className="text-xs font-medium text-gray-600 mt-1">Protein</span>
          <span className="text-xs text-gray-500">
            {Math.round(validActual.protein)}g / {Math.round(validTargets.protein)}g
          </span>
        </div>

        {/* Fat */}
        <div className="flex flex-col items-center">
          <div className="relative">
            <AnimatedRing
              value={validActual.fat}
              max={validTargets.fat}
              colorClass="text-yellow-500"
              size={24}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Droplet size={16} className="text-yellow-500" />
            </div>
          </div>
          <span className="text-xs font-medium text-gray-600 mt-1">Fat</span>
          <span className="text-xs text-gray-500">
            {Math.round(validActual.fat)}g / {Math.round(validTargets.fat)}g
          </span>
        </div>

        {/* Carbs */}
        <div className="flex flex-col items-center">
          <div className="relative">
            <AnimatedRing
              value={validActual.carbs}
              max={validTargets.carbs}
              colorClass="text-orange-500"
              size={24}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Wheat size={16} className="text-orange-500" />
            </div>
          </div>
          <span className="text-xs font-medium text-gray-600 mt-1">Carbs</span>
          <span className="text-xs text-gray-500">
            {Math.round(validActual.carbs)}g / {Math.round(validTargets.carbs)}g
          </span>
        </div>
      </div>
    </div>
  );
};


