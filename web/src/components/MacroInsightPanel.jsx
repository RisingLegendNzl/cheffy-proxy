// web/src/components/MacroInsightPanel.jsx
import React from 'react';
import { Flame, Droplet, Wheat, TrendingUp, Info } from 'lucide-react';
import { COLORS, SHADOWS, RADIUS } from '../constants';
import ProgressRing from './ProgressRing';
import MacroBar from './MacroBar';
import { formatCalories, formatGrams } from '../helpers';

/**
 * Multi-layer insight panel for daily nutrition progress
 * Layer 1: Macro rings (Calories, Protein, Carbs, Fats)
 * Layer 2: Micro targets (Fiber, Sugar, Sodium)
 * Layer 3: Contextual insights
 */
const MacroInsightPanel = ({
  calories = { current: 0, target: 2000 },
  protein = { current: 0, target: 150 },
  carbs = { current: 0, target: 250 },
  fats = { current: 0, target: 65 },
  fiber = { current: 0, target: 30 },
  sugar = { current: 0, target: 50 },
  sodium = { current: 0, target: 2300 },
  showMicroTargets = true,
  showInsights = true,
  className = '',
}) => {
  // Calculate percentages
  const caloriePercentage = (calories.current / calories.target) * 100;
  const proteinPercentage = (protein.current / protein.target) * 100;
  
  // Generate contextual insight
  const getInsight = () => {
    const calorieDeficit = calories.target - calories.current;
    
    if (calorieDeficit > 200) {
      return {
        text: `You're ${Math.round(calorieDeficit)} cal under target—consider adding a snack.`,
        icon: TrendingUp,
        color: COLORS.warning.main,
      };
    } else if (calorieDeficit < -200) {
      return {
        text: `You're ${Math.abs(Math.round(calorieDeficit))} cal over target today.`,
        icon: Info,
        color: COLORS.info.main,
      };
    } else if (proteinPercentage >= 95 && caloriePercentage >= 95) {
      return {
        text: 'Great job! You\'re hitting your targets today.',
        icon: null,
        color: COLORS.success.main,
      };
    } else {
      return {
        text: 'You\'re on track for a balanced day.',
        icon: null,
        color: COLORS.gray[600],
      };
    }
  };

  const insight = getInsight();

  return (
    <div 
      className={`bg-white rounded-2xl p-6 ${className}`}
      style={{ boxShadow: SHADOWS.md }}
    >
      {/* Header */}
      <div className="mb-6">
        <h2 
          className="text-2xl font-bold mb-1"
          style={{ 
            color: COLORS.gray[900],
            fontFamily: 'var(--font-family-display)',
          }}
        >
          Daily Progress
        </h2>
        <p className="text-sm" style={{ color: COLORS.gray[500] }}>
          Track your nutrition targets
        </p>
      </div>

      {/* Layer 1: Macro Rings */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <ProgressRing
          percentage={caloriePercentage}
          value={formatCalories(calories.current)}
          label="Calories"
          size={100}
          strokeWidth={8}
          gradientColors={[COLORS.macros.calories.main, COLORS.macros.calories.dark]}
        />
        
        <ProgressRing
          percentage={proteinPercentage}
          value={Math.round(protein.current)}
          label="Protein"
          unit="g"
          size={100}
          strokeWidth={8}
          gradientColors={[COLORS.macros.protein.main, COLORS.macros.protein.dark]}
        />
        
        <ProgressRing
          percentage={(carbs.current / carbs.target) * 100}
          value={Math.round(carbs.current)}
          label="Carbs"
          unit="g"
          size={100}
          strokeWidth={8}
          gradientColors={[COLORS.macros.carbs.main, COLORS.macros.carbs.dark]}
        />
        
        <ProgressRing
          percentage={(fats.current / fats.target) * 100}
          value={Math.round(fats.current)}
          label="Fats"
          unit="g"
          size={100}
          strokeWidth={8}
          gradientColors={[COLORS.macros.fats.main, COLORS.macros.fats.dark]}
        />
      </div>

      {/* Layer 2: Micro Targets */}
      {showMicroTargets && (
        <div className="space-y-4 mb-6">
          <h3 
            className="text-sm font-semibold mb-3"
            style={{ color: COLORS.gray[700] }}
          >
            Additional Targets
          </h3>
          
          <MacroBar
            label="Fiber"
            current={fiber.current}
            target={fiber.target}
            unit="g"
            color="fats"
            Icon={Wheat}
          />
          
          <MacroBar
            label="Sugar"
            current={sugar.current}
            target={sugar.target}
            unit="g"
            color="carbs"
            Icon={Droplet}
          />
          
          <MacroBar
            label="Sodium"
            current={sodium.current}
            target={sodium.target}
            unit="mg"
            color="protein"
            Icon={Flame}
          />
        </div>
      )}

      {/* Layer 3: Contextual Insights */}
      {showInsights && (
        <div
          className="rounded-xl p-4 flex items-start space-x-3"
          style={{ 
            backgroundColor: `${insight.color}10`,
            border: `1px solid ${insight.color}30`,
          }}
        >
          {insight.icon && (
            <insight.icon 
              size={20} 
              style={{ color: insight.color, flexShrink: 0, marginTop: '2px' }} 
            />
          )}
          <p 
            className="text-sm font-medium"
            style={{ color: insight.color }}
          >
            {insight.text}
          </p>
        </div>
      )}
    </div>
  );
};

export default MacroInsightPanel;