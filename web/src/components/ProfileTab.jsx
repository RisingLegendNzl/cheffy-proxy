// web/src/components/ProfileTab.jsx
import React, { useMemo } from 'react';
import { Target, Flame, Soup, Droplet, Wheat, User as UserIcon, Zap, TrendingUp } from 'lucide-react';

// A simple display card for the User Profile
const ProfileCard = ({ formData }) => (
  <div className="bg-white rounded-xl shadow-lg border p-6">
    <h3 className="text-xl font-bold text-indigo-700 flex items-center mb-4">
      <UserIcon className="w-5 h-5 mr-2" />
      User Profile
    </h3>
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-gray-50 p-3 rounded-lg">
        <span className="text-sm text-gray-500">Weight</span>
        <p className="text-lg font-bold">{formData.weight}kg</p>
      </div>
      <div className="bg-gray-50 p-3 rounded-lg">
        <span className="text-sm text-gray-500">Body Fat</span>
        <p className="text-lg font-bold">{formData.bodyFat || 'N/A'}%</p>
      </div>
      <div className="bg-gray-50 p-3 rounded-lg">
        <span className="text-sm text-gray-500">Goal</span>
        <p className="text-lg font-bold uppercase">
          {formData.goal.replace('_', ' ')}
        </p>
      </div>
      <div className="bg-gray-50 p-3 rounded-lg">
        <span className="text-sm text-gray-500">Activity</span>
        <p className="text-lg font-bold capitalize">
          {formData.activityLevel}
        </p>
      </div>
    </div>
  </div>
);

// Mini progress bar component for the macro breakdown
const MacroProgressBar = ({ label, amount, unit, kcal, color, Icon, percentage }) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          {Icon && <Icon size={16} className={`mr-2 text-${color}-600`} />}
          <span className="text-sm font-semibold text-gray-700">{label}</span>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-gray-900">{amount}{unit}</span>
          <span className="text-xs text-gray-500 ml-1">({kcal} kcal)</span>
        </div>
      </div>
      {/* Progress bar filled to 100% */}
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div 
          className={`h-2 rounded-full bg-gradient-to-r from-${color}-400 to-${color}-600 transition-all duration-700 ease-out`}
          style={{ width: '100%' }}
        />
      </div>
      <p className="text-xs text-gray-500 text-right">{percentage}% of daily calories</p>
    </div>
  );
};

// Enhanced SPLIT VIEW component for nutritional targets
const TargetsCard = ({ nutritionalTargets }) => {
  const hasTargets = nutritionalTargets.calories > 0;

  // 🆕 EMPTY STATE: Show before generation
  if (!hasTargets) {
    return (
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl shadow-lg border border-indigo-200 p-8 text-center">
        <div className="w-20 h-20 mx-auto mb-4 bg-indigo-100 rounded-full flex items-center justify-center">
          <Target className="w-10 h-10 text-indigo-400" />
        </div>
        <h3 className="text-xl font-bold text-indigo-700 mb-2">
          No Targets Yet
        </h3>
        <p className="text-gray-600 text-sm mb-4">
          Generate a plan to see your personalized nutritional targets
        </p>
        <div className="flex items-center justify-center text-sm text-indigo-500">
          <Zap className="w-4 h-4 mr-1" />
          Click "Generate Plan" to get started
        </div>
      </div>
    );
  }

  // Calculate macro ratios
  const macroRatios = useMemo(() => {
    const { protein, fat, carbs } = nutritionalTargets;
    const proteinCal = protein * 4;
    const fatCal = fat * 9;
    const carbsCal = carbs * 4;
    const totalCal = proteinCal + fatCal + carbsCal;
    
    if (totalCal === 0) return { protein: 0, fat: 0, carbs: 0 };
    
    return {
      protein: Math.round((proteinCal / totalCal) * 100),
      fat: Math.round((fatCal / totalCal) * 100),
      carbs: Math.round((carbsCal / totalCal) * 100),
    };
  }, [nutritionalTargets]);

  // SVG Circle calculations for the calorie ring
  const size = 180;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = 0; // Always show as "full" since this is a target, not progress

  return (
    <div className="bg-white rounded-xl shadow-lg border overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6">
        <h3 className="text-2xl font-bold text-center flex items-center justify-center">
          <Target className="w-6 h-6 mr-2" />
          Your Daily Nutritional Blueprint
        </h3>
        <p className="text-center text-indigo-100 text-sm mt-1">
          Personalized for your goals
        </p>
      </div>

      {/* SPLIT VIEW LAYOUT */}
      <div className="grid md:grid-cols-2 gap-0">
        
        {/* LEFT SIDE: Calorie Target with Ring */}
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-8 flex flex-col items-center justify-center border-r">
          <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Daily Target
          </p>
          
          {/* Calorie Ring */}
          <div className="relative mb-4" style={{ width: size, height: size }}>
            {/* Background Circle */}
            <svg className="transform -rotate-90" width={size} height={size}>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="currentColor"
                strokeWidth={strokeWidth}
                fill="none"
                className="text-gray-200"
              />
              {/* Filled Circle (100% for target display) */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="url(#gradient)"
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
              {/* Gradient Definition */}
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            {/* Center Text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-extrabold text-indigo-700">
                {nutritionalTargets.calories.toLocaleString()}
              </span>
              <span className="text-sm text-gray-500 font-medium mt-1">
                calories
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center max-w-xs">
            This is your daily calorie target based on your profile and goals
          </p>
        </div>

        {/* RIGHT SIDE: Macro Breakdown */}
        <div className="p-6 flex flex-col justify-center">
          <div className="mb-4">
            <h4 className="text-lg font-bold text-gray-800 mb-1">Macro Split</h4>
            <p className="text-sm text-gray-600">
              {macroRatios.protein}% Protein • {macroRatios.fat}% Fat • {macroRatios.carbs}% Carbs
            </p>
          </div>

          <div className="space-y-6">
            {/* Protein */}
            <MacroProgressBar
              label="Protein"
              amount={nutritionalTargets.protein}
              unit="g"
              kcal={nutritionalTargets.protein * 4}
              color="green"
              Icon={Soup}
              percentage={macroRatios.protein}
            />

            {/* Fat */}
            <MacroProgressBar
              label="Fat"
              amount={nutritionalTargets.fat}
              unit="g"
              kcal={nutritionalTargets.fat * 9}
              color="yellow"
              Icon={Droplet}
              percentage={macroRatios.fat}
            />

            {/* Carbs */}
            <MacroProgressBar
              label="Carbs"
              amount={nutritionalTargets.carbs}
              unit="g"
              kcal={nutritionalTargets.carbs * 4}
              color="orange"
              Icon={Wheat}
              percentage={macroRatios.carbs}
            />
          </div>
        </div>
      </div>

      {/* Footer Info Card */}
      <div className="bg-blue-50 border-t p-4">
        <div className="flex items-start">
          <TrendingUp className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-700">
            <p className="font-semibold text-blue-900 mb-1">Track Your Progress</p>
            <p className="text-gray-600">
              Head to the <span className="font-semibold">Meals tab</span> to track your daily intake and see real-time progress towards these targets.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// The main component that combines the two cards
const ProfileTab = ({ formData, nutritionalTargets }) => {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <ProfileCard formData={formData} />
      <TargetsCard nutritionalTargets={nutritionalTargets} />
    </div>
  );
};

export default ProfileTab;