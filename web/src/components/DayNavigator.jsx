// web/src/components/DayNavigator.jsx
import React from ‘react’;
import WeekHorizonSelector from ‘./day-selector/WeekHorizonSelector’;

/**

- Day Navigator - Wrapper component for day selection
- Now uses the Week Horizon concept for premium UX
  */
  const DayNavigator = ({
  selectedDay,
  totalDays,
  onDayChange,
  eatenMeals = {},
  mealPlan = [],
  }) => {
  return (
  <WeekHorizonSelector
selectedDay={selectedDay}
totalDays={totalDays}
onDayChange={onDayChange}
eatenMeals={eatenMeals}
mealPlan={mealPlan}
/>
  );
  };

export default DayNavigator;