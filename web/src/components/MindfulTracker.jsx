import React from 'react';
import { Zap, Heart, Brain, Wind, Check } from 'lucide-react';

/**
 * A single "Blob" component that visually scales from 0 to 100%
 * based on the 'value' (actual) vs 'target'.
 */
const MacroBlob = ({ label, value, target, color, icon: Icon, size = "large" }) => {
  // Calculate percentage, but cap it at 1 (100%) for the visual
  const pct = target > 0 ? value / target : 0;
  const scale = Math.min(1, pct);
  const isComplete = pct >= 1;

  const sizeClasses = {
    large: "w-40 h-40",
    small: "w-28 h-28"
  };

  return (
    <div className="flex flex-col items-center justify-center p-2">
      <div
        className={`relative ${sizeClasses[size]} flex items-center justify-center transition-all duration-500`}
        style={{
          // This complex border-radius creates the "blob" shape
          borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%",
        }}
      >
        {/* Background Track */}
        <div className="absolute inset-0 bg-gray-100 opacity-75 rounded-[inherit]" />
        
        {/* Fill */}
        <div
          className={`absolute inset-0 ${color} opacity-80 rounded-[inherit] transition-transform duration-700 ease-out`}
          style={{
            transform: `scale(${scale})`,
            // Animate from the bottom
            transformOrigin: 'bottom',
          }}
        />
        
        {/* Content (Icon and Text) */}
        <div className="relative z-10 flex flex-col items-center text-gray-800">
          {isComplete ? (
            <Check size={size === 'large' ? 40 : 28} className="text-white" />
          ) : (
            <Icon size={size === 'large' ? 32 : 24} className="opacity-70" />
          )}
          <span className={`mt-2 text-sm font-semibold ${isComplete ? 'text-white' : 'text-gray-700'}`}>
            {label}
          </span>
          {/* We hide the numbers unless the user is close or complete */}
          {(pct > 0.8 || isComplete) && !isComplete && (
            <span className="text-xs font-medium text-gray-600 mt-1">
              {(pct * 100).toFixed(0)}%
            </span>
          )}
          {isComplete && (
            <span className="text-xs font-medium text-white mt-1">
              Complete!
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Displays the "Mindful" theme.
 * Focuses on abstract visualization of 'actual' vs 'targets'.
 */
export const MindfulTracker = ({ targets, planned, actual }) => {
  const data = {
    calories: {
      label: 'Energy',
      value: actual.calories,
      target: targets.calories,
      color: 'bg-blue-300',
      icon: Zap,
    },
    protein: {
      label: 'Protein',
      value: actual.protein,
      target: targets.protein,
      color: 'bg-red-300',
      icon: Heart,
    },
    fat: {
      label: 'Fat',
      value: actual.fat,
      target: targets.fat,
      color: 'bg-yellow-300',
      icon: Brain,
    },
    carbs: {
      label: 'Carbs',
      value: actual.carbs,
      target: targets.carbs,
      color: 'bg-green-300',
      icon: Wind,
    },
  };

  return (
    <div className="w-full p-6 bg-white rounded-xl shadow-lg border border-gray-200">
      <h2 className="text-xl font-bold text-gray-800 mb-4 text-center">
        Today's Balance
      </h2>
      
      {/* Main Calories Blob */}
      <div className="flex justify-center mb-4">
        <MacroBlob {...data.calories} size="large" />
      </div>

      {/* Smaller Macro Blobs */}
      <div className="grid grid-cols-3 gap-2">
        <MacroBlob {...data.protein} size="small" />
        <MacroBlob {...data.fat} size="small" />
        <MacroBlob {...data.carbs} size="small" />
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100">
        <p className="text-center text-xs text-gray-500">
          Focus on balance and how you feel, not just the numbers. Your plan is
          already designed to meet your goals.
        </p>
      </div>
    </div>
  );
};

