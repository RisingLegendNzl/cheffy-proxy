import React from 'react';
import { Target, BarChart3, CheckCircle } from 'lucide-react';

/**
 * A single progress bar component to show Target vs. Planned vs. Actual.
 * - 'target' is a line marker.
 * - 'planned' is a light grey background bar.
 * - 'actual' is the main fill bar.
 */
const MacroBar = ({ value, planned, target, color, unit }) => {
  const actualPct = target > 0 ? (value / target) * 100 : 0;
  const plannedPct = target > 0 ? (planned / target) * 100 : 0;
  
  // Cap percentages at 100% for the visual width
  const actualWidth = Math.min(100, actualPct);
  const plannedWidth = Math.min(100, plannedPct);

  return (
    <div className="w-full">
      <div className="flex justify-between items-end mb-1">
        <span className="font-semibold text-sm text-gray-700">
          {value.toFixed(0)}{unit}
        </span>
        <span className="text-xs text-gray-500">
          Target: {target.toFixed(0)}{unit}
        </span>
      </div>
      <div className="relative w-full h-4 bg-gray-200 rounded-full overflow-hidden">
        {/* Planned Bar (light grey) */}
        <div
          className="absolute top-0 left-0 h-4 bg-gray-300"
          style={{ width: `${plannedWidth}%` }}
          title={`Planned: ${planned.toFixed(0)}${unit}`}
        />
        {/* Actual Bar (colored) */}
        <div
          className={`absolute top-0 left-0 h-4 ${color} transition-all duration-300`}
          style={{ width: `${actualWidth}%` }}
          title={`Actual: ${value.toFixed(0)}${unit}`}
        />
      </div>
    </div>
  );
};

/**
 * Displays the "Data-Driven" theme.
 * Assumes it receives 'targets', 'planned', and 'actual' objects,
 * each with properties: { calories, protein, fat, carbs }.
 */
export const DataDrivenTracker = ({ targets, planned, actual }) => {
  const macros = [
    {
      name: 'Calories',
      value: actual.calories,
      planned: planned.calories,
      target: targets.calories,
      color: 'bg-blue-500',
      unit: 'kcal',
    },
    {
      name: 'Protein',
      value: actual.protein,
      planned: planned.protein,
      target: targets.protein,
      color: 'bg-red-500',
      unit: 'g',
    },
    {
      name: 'Fat',
      value: actual.fat,
      planned: planned.fat,
      target: targets.fat,
      color: 'bg-yellow-500',
      unit: 'g',
    },
    {
      name: 'Carbs',
      value: actual.carbs,
      planned: planned.carbs,
      target: targets.carbs,
      color: 'bg-green-500',
      unit: 'g',
    },
  ];

  return (
    <div className="w-full p-6 bg-white rounded-xl shadow-lg border border-gray-200">
      <h2 className="text-xl font-bold text-gray-800 mb-6">Daily Nutrition Summary</h2>
      
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-700 mb-2">Calories</h3>
        <MacroBar {...macros[0]} />
      </div>

      <h3 className="text-lg font-semibold text-gray-700 mb-4">Macros</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MacroBar {...macros[1]} />
        <MacroBar {...macros[2]} />
        <MacroBar {...macros[3]} />
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-500">
        <ul className="space-y-1">
          <li className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-gray-300 mr-2" />
            <span className="font-medium text-gray-600">Planned:</span>
            <span className="ml-1">Total from your AI-generated meal plan.</span>
          </li>
          <li className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-blue-500 mr-2" />
            <span className="font-medium text-gray-600">Actual:</span>
            <span className="ml-1">Total from meals you have logged today.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

