// web/src/components/ProfileTab.jsx
import React, { useMemo } from ‘react’;
import { Target, User, Activity } from ‘lucide-react’;
import { COLORS } from ‘../constants’;
import BlueprintRings from ‘./profile/BlueprintRings’;
import GoalCard from ‘./profile/GoalCard’;
import MetricCard from ‘./profile/MetricCard’;

/**

- Profile Tab - Nutrition Blueprint Concept
- Features:
- - Central large calorie ring with concentric macro rings
- - Drawing animation effect on first load
- - Blueprint aesthetic with graph paper texture
- - Goal cards with morphing body silhouettes
- - Ripple effect on recalculate
    */
    const ProfileTab = ({ formData, nutritionalTargets }) => {
    // Calculate macro percentages
    const macroPercentages = useMemo(() => {
    const { protein = 0, fat = 0, carbs = 0 } = nutritionalTargets;
  
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
<div
className=“min-h-screen p-6”
style={{
backgroundColor: COLORS.blueprint.paper,
backgroundImage: `linear-gradient(${COLORS.blueprint.grid} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.blueprint.grid} 1px, transparent 1px)`,
backgroundSize: ‘20px 20px’,
}}
>
<div className="max-w-6xl mx-auto space-y-6">
{/* Header */}
<div className=“bg-white rounded-xl shadow-lg border p-6” style={{ borderColor: COLORS.gray[200] }}>
<div className="flex items-center space-x-3 mb-2">
<div
className=“w-12 h-12 rounded-full flex items-center justify-center”
style={{
backgroundColor: COLORS.primary[100],
}}
>
<Target size={24} style={{ color: COLORS.primary[600] }} />
</div>
<div>
<h2 className=“text-2xl font-bold” style={{ color: COLORS.gray[900] }}>
Your Nutritional Blueprint
</h2>
<p className=“text-sm” style={{ color: COLORS.gray[600] }}>
Personalized targets designed for your goals
</p>
</div>
</div>
</div>

```
    {/* Blueprint Rings */}
    <BlueprintRings
      nutritionalTargets={nutritionalTargets}
      macroPercentages={macroPercentages}
    />

    {/* Body Metrics */}
    <div className="bg-white rounded-xl shadow-lg border p-6" style={{ borderColor: COLORS.gray[200] }}>
      <h3 className="text-lg font-bold mb-4 flex items-center" style={{ color: COLORS.gray[900] }}>
        <User size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
        Body Metrics
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Height"
          value={`${formData.height} cm`}
          icon="📏"
        />
        <MetricCard
          label="Weight"
          value={`${formData.weight} kg`}
          icon="⚖️"
        />
        <MetricCard
          label="Age"
          value={`${formData.age} years`}
          icon="🎂"
        />
        <MetricCard
          label="Gender"
          value={formData.gender.charAt(0).toUpperCase() + formData.gender.slice(1)}
          icon={formData.gender === 'male' ? '♂️' : '♀️'}
        />
      </div>

      {formData.bodyFat && (
        <div className="mt-4">
          <MetricCard
            label="Body Fat"
            value={`${formData.bodyFat}%`}
            icon="📊"
          />
        </div>
      )}
    </div>

    {/* Activity & Goal */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Activity Level */}
      <div className="bg-white rounded-xl shadow-lg border p-6" style={{ borderColor: COLORS.gray[200] }}>
        <h3 className="text-lg font-bold mb-4 flex items-center" style={{ color: COLORS.gray[900] }}>
          <Activity size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
          Activity Level
        </h3>
        <GoalCard
          goal={formData.activityLevel}
          type="activity"
        />
      </div>

      {/* Goal */}
      <div className="bg-white rounded-xl shadow-lg border p-6" style={{ borderColor: COLORS.gray[200] }}>
        <h3 className="text-lg font-bold mb-4 flex items-center" style={{ color: COLORS.gray[900] }}>
          <Target size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
          Fitness Goal
        </h3>
        <GoalCard
          goal={formData.goal}
          type="goal"
        />
      </div>
    </div>

    {/* Preferences */}
    <div className="bg-white rounded-xl shadow-lg border p-6" style={{ borderColor: COLORS.gray[200] }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: COLORS.gray[900] }}>
        Meal Preferences
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          label="Store"
          value={formData.store}
          icon="🏪"
        />
        <MetricCard
          label="Eating Occasions"
          value={`${formData.eatingOccasions} meals/day`}
          icon="🍽️"
        />
        <MetricCard
          label="Cost Priority"
          value={formData.costPriority}
          icon="💰"
        />
        <MetricCard
          label="Meal Variety"
          value={formData.mealVariety}
          icon="🎨"
        />
        {formData.dietary && formData.dietary !== 'None' && (
          <MetricCard
            label="Dietary"
            value={formData.dietary}
            icon="🥗"
          />
        )}
        {formData.cuisine && (
          <MetricCard
            label="Cuisine"
            value={formData.cuisine}
            icon="🌍"
          />
        )}
      </div>
    </div>
  </div>
</div>
```

);
};

export default ProfileTab;