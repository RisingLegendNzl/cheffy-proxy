// src/components/ProfileTab.jsx
import React from 'react';
import { Target, Flame, Soup, Droplet, Wheat } from 'lucide-react';

// A simple display card for the User Profile
const ProfileCard = ({ formData }) => (
  <div className="bg-white rounded-xl shadow-lg border p-6">
    <h3 className="text-xl font-bold text-indigo-700 flex items-center mb-4">
      <Target className="w-5 h-5 mr-2" />
      User Profile & Targets
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

[cite_start]// This is the *exact* logic from your App.jsx "Plan Summary" [cite: 260-267]
// moved into its own component.
const TargetsCard = ({ nutritionalTargets }) => (
  <div className="bg-white rounded-xl shadow-lg border p-6">
    <h3 className="text-xl font-bold text-indigo-700 text-center mb-4">
      Daily Targets
    </h3>
    <div className="grid grid-cols-2 gap-4">
      <div className="p-3 bg-red-50 rounded-lg text-center">
        <Flame size={20} className="mx-auto text-red-500" />
        <p className="text-sm font-bold mt-1">Calories</p>
        <p className="text-2xl font-extrabold">
          {nutritionalTargets.calories}
        </p>
      </div>
      <div className="p-3 bg-green-50 rounded-lg text-center">
        <Soup size={20} className="mx-auto text-green-500" />
        <p className="text-sm font-bold mt-1">Protein</p>
        <p className="text-2xl font-extrabold">
          {nutritionalTargets.protein}g
        </p>
      </div>
      <div className="p-3 bg-yellow-50 rounded-lg text-center">
        <Droplet size={20} className="mx-auto text-yellow-500" />
        <p className="text-sm font-bold mt-1">Fat</p>
        <p className="text-2xl font-extrabold">{nutritionalTargets.fat}g</p>
      </div>
      <div className="p-3 bg-orange-50 rounded-lg text-center">
        <Wheat size={20} className="mx-auto text-orange-500" />
        <p className="text-sm font-bold mt-1">Carbs</p>
        <p className="text-2xl font-extrabold">{nutritionalTargets.carbs}g</p>
      </div>
    </div>
  </div>
);

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
