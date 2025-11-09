// web/src/components/ProfileTab.jsx
import React, { useMemo } from 'react';
import { Target, Flame, Soup, Droplet, Wheat, User as UserIcon } from 'lucide-react';
import MacroRing from './MacroRing';
import MacroBar from './MacroBar';

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

// Enhanced component displaying nutritional targets with rings and bars
const TargetsCard = ({ nutritionalTargets }) => {
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

  return (
    <div className="bg-white rounded-xl shadow-lg border p-6">
      <h3 className="text-xl font-bold text-indigo-700 text-center mb-2">
        Daily Targets
      </h3>
      
      {/* Macro Ratio Display */}
      <p className="text-center text-sm text-gray-600 mb-6">
        {macroRatios.protein}% P • {macroRatios.fat}% F • {macroRatios.carbs}% C
      </p>

      {/* Circular Rings Section */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <MacroRing
          current={0}
          target={nutritionalTargets.calories}
          label="Calories"
          color="red"
          size={100}
          unit="kcal"
        />
        <MacroRing
          current={0}
          target={nutritionalTargets.protein}
          label="Protein"
          color="green"
          size={100}
          unit="g"
        />
      </div>

      {/* Progress Bars Section */}
      <div className="space-y-4">
        <MacroBar
          label="Protein"
          current={0}
          target={nutritionalTargets.protein}
          unit="g"
          color="green"
          Icon={Soup}
        />
        <MacroBar
          label="Fat"
          current={0}
          target={nutritionalTargets.fat}
          unit="g"
          color="yellow"
          Icon={Droplet}
        />
        <MacroBar
          label="Carbs"
          current={0}
          target={nutritionalTargets.carbs}
          unit="g"
          color="orange"
          Icon={Wheat}
        />
      </div>

      {/* Calorie Breakdown */}
      <div className="mt-6 p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg">
        <h4 className="text-sm font-bold text-gray-700 mb-2 flex items-center">
          <Flame className="w-4 h-4 mr-1 text-red-500" />
          Calorie Breakdown
        </h4>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-600">From Protein:</span>
            <span className="font-semibold">{nutritionalTargets.protein * 4} kcal ({macroRatios.protein}%)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">From Fat:</span>
            <span className="font-semibold">{nutritionalTargets.fat * 9} kcal ({macroRatios.fat}%)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">From Carbs:</span>
            <span className="font-semibold">{nutritionalTargets.carbs * 4} kcal ({macroRatios.carbs}%)</span>
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
      {nutritionalTargets.calories > 0 && (
        <TargetsCard nutritionalTargets={nutritionalTargets} />
      )}
    </div>
  );
};

export default ProfileTab;