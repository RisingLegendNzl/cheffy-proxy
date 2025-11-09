import React from 'react';
import { Flame, Fish, Droplet, Wheat } from 'lucide-react';

/**
 * A single "Macro Ring" component.
 * Uses SVG with stroke-dasharray to create a progress circle.
 */
const MacroRing = ({ label, value, target, color, stroke, unit, icon: Icon }) => {
  const radius = 15.9155; // 2 * pi * 15.9155 = 100
  const circumference = 100;

  // Calculate percentage, clamp between 0 and 1
  const pct = target > 0 ? value / target : 0;
  const clampedPct = Math.min(Math.max(pct, 0), 1);
  
  // Calculate the stroke offset
  const offset = circumference - (clampedPct * circumference);

  // Determine if goal is met
  const goalMet = value >= target;

  return (
    <div className="flex flex-col items-center p-2">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 36 36" className="w-full h-full">
          {/* Background Track */}
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="transparent"
            strokeWidth="3"
            className="text-gray-700"
          />
          {/* Progress Fill */}
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="transparent"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 18 18)"
            className={`transition-all duration-500 ${stroke}`}
          />
        </svg>
        {/* Text in middle */}
        <div className="absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center">
          {goalMet ? (
            <Check size={28} className={color} />
          ) : (
            <span className={`text-2xl font-bold ${color}`}>
              {value.toFixed(0)}
            </span>
          )}
          <span className="text-xs text-gray-400">
            / {target.toFixed(0)} {unit}
          </span>
        </div>
      </div>
      <div className="flex items-center mt-2">
        <Icon size={16} className={`mr-1.5 ${color}`} />
        <span className="text-sm font-semibold text-gray-200">{label}</span>
      </div>
    </div>
  );
};

/**
 * Displays the "Gamified" theme.
 * Assumes it receives 'targets', 'planned', and 'actual' objects,
 * each with properties: { calories, protein, fat, carbs }.
 */
export const GamifiedTracker = ({ targets, planned, actual }) => {
  const macroData = [
    {
      label: 'Calories',
      value: actual.calories,
      target: targets.calories,
      color: 'text-blue-400',
      stroke: 'stroke-blue-400',
      unit: 'kcal',
      icon: Flame,
    },
    {
      label: 'Protein',
      value: actual.protein,
      target: targets.protein,
      color: 'text-red-400',
      stroke: 'stroke-red-400',
      unit: 'g',
      icon: Fish,
    },
    {
      label: 'Fat',
      value: actual.fat,
      target: targets.fat,
      color: 'text-yellow-400',
      stroke: 'stroke-yellow-400',
      unit: 'g',
      icon: Droplet,
    },
    {
      label: 'Carbs',
      value: actual.carbs,
      target: targets.carbs,
      color: 'text-green-400',
      stroke: 'stroke-green-400',
      unit: 'g',
      icon: Wheat,
    },
  ];

  const goalsMet = macroData.filter(m => m.value >= m.target).length;

  return (
    <div className="w-full p-6 bg-gray-800 rounded-xl shadow-2xl border border-gray-700">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">Daily Goals</h2>
        <span className="px-3 py-1 text-sm font-semibold bg-yellow-400 text-yellow-900 rounded-full">
          {goalsMet} / 4 Goals Met!
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {macroData.map((macro) => (
          <MacroRing key={macro.label} {...macro} />
        ))}
      </div>
    </div>
  );
};

