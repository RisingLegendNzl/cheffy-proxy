// web/src/components/day-selector/WeekHorizonSelector.jsx
import React, { useRef, useEffect, useState } from ‘react’;
import { ChevronLeft, ChevronRight } from ‘lucide-react’;
import DayCard from ‘./DayCard’;
import { COLORS, SPACING } from ‘../../constants’;
import { prefersReducedMotion } from ‘../../utils/animationHelpers’;

/**

- Week Horizon Selector - Panoramic day timeline
- Visual metaphor: A journey across the week with meal suns rising across a gradient sky
- Features:
- - Horizontal scroll/swipe navigation
- - Temporal gradient (Sunday = dawn, Saturday = dusk)
- - Calorie ring previews per day
- - Completion constellations for past days
- - Zoom-forward effect on active day
    */
    const WeekHorizonSelector = ({
    selectedDay,
    totalDays,
    onDayChange,
    eatenMeals = {},
    mealPlan = [],
    }) => {
    const scrollContainerRef = useRef(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

// Calculate scroll button visibility
const updateScrollButtons = () => {
if (!scrollContainerRef.current) return;

```
const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
setCanScrollLeft(scrollLeft > 0);
setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
```

};

// Scroll to selected day on mount and when selectedDay changes
useEffect(() => {
if (!scrollContainerRef.current) return;

```
const container = scrollContainerRef.current;
const dayCard = container.querySelector(`[data-day="${selectedDay}"]`);

if (dayCard) {
  const cardLeft = dayCard.offsetLeft;
  const cardWidth = dayCard.offsetWidth;
  const containerWidth = container.clientWidth;
  const scrollPosition = cardLeft - (containerWidth / 2) + (cardWidth / 2);

  container.scrollTo({
    left: scrollPosition,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

updateScrollButtons();
```

}, [selectedDay]);

// Handle scroll buttons
const handleScroll = (direction) => {
if (!scrollContainerRef.current) return;

```
const scrollAmount = 300;
const newScrollLeft =
  direction === 'left'
    ? scrollContainerRef.current.scrollLeft - scrollAmount
    : scrollContainerRef.current.scrollLeft + scrollAmount;

scrollContainerRef.current.scrollTo({
  left: newScrollLeft,
  behavior: 'smooth',
});
```

};

// Get day name
const getDayName = (dayIndex) => {
const days = [‘Sunday’, ‘Monday’, ‘Tuesday’, ‘Wednesday’, ‘Thursday’, ‘Friday’, ‘Saturday’];
const today = new Date().getDay();
const dayName = days[(today + dayIndex - 1) % 7];
return dayName;
};

// Calculate completion status for a day
const getDayCompletion = (dayIndex) => {
const dayData = mealPlan[dayIndex - 1];
if (!dayData || !dayData.meals || dayData.meals.length === 0) {
return { completed: 0, total: 0, percentage: 0 };
}

```
const dayKey = `day${dayIndex}`;
const dayEatenMeals = eatenMeals[dayKey] || {};
const total = dayData.meals.length;
const completed = dayData.meals.filter((meal) => dayEatenMeals[meal.name]).length;
const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

return { completed, total, percentage };
```

};

// Calculate total calories for a day
const getDayCalories = (dayIndex) => {
const dayData = mealPlan[dayIndex - 1];
if (!dayData || !dayData.meals) return { current: 0, target: 0 };

```
const dayKey = `day${dayIndex}`;
const dayEatenMeals = eatenMeals[dayKey] || {};

let current = 0;
let target = 0;

dayData.meals.forEach((meal) => {
  const calories = meal.subtotal_kcal || 0;
  target += calories;
  if (dayEatenMeals[meal.name]) {
    current += calories;
  }
});

return { current: Math.round(current), target: Math.round(target) };
```

};

// Get gradient color for day position (temporal gradient)
const getTemporalGradient = () => {
// Create a gradient from dawn (left) to dusk (right)
return COLORS.weekGradient;
};

return (
<div className="relative">
{/* Gradient Background */}
<div
className=“absolute inset-0 rounded-2xl opacity-20 pointer-events-none”
style={{
background: getTemporalGradient(),
}}
/>

```
  {/* Container */}
  <div className="relative bg-white rounded-2xl shadow-lg border p-4" style={{ borderColor: COLORS.gray[200] }}>
    {/* Header */}
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-bold" style={{ color: COLORS.gray[900] }}>
        Your Week
      </h3>
      <div className="text-sm" style={{ color: COLORS.gray[500] }}>
        Day {selectedDay} of {totalDays}
      </div>
    </div>

    {/* Scrollable Day Cards Container */}
    <div className="relative">
      {/* Left Scroll Button */}
      {canScrollLeft && (
        <button
          onClick={() => handleScroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white rounded-full p-2 shadow-lg hover-lift transition-spring"
          style={{
            border: `2px solid ${COLORS.gray[200]}`,
          }}
          aria-label="Scroll left"
        >
          <ChevronLeft size={20} style={{ color: COLORS.gray[700] }} />
        </button>
      )}

      {/* Day Cards */}
      <div
        ref={scrollContainerRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide py-2 px-1"
        onScroll={updateScrollButtons}
        style={{
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {Array.from({ length: totalDays }, (_, index) => {
          const dayIndex = index + 1;
          const isSelected = dayIndex === selectedDay;
          const isPast = dayIndex < selectedDay;
          const isFuture = dayIndex > selectedDay;
          const completion = getDayCompletion(dayIndex);
          const calories = getDayCalories(dayIndex);
          const dayName = getDayName(dayIndex);

          return (
            <DayCard
              key={dayIndex}
              day={dayIndex}
              dayName={dayName}
              isSelected={isSelected}
              isPast={isPast}
              isFuture={isFuture}
              completion={completion}
              calories={calories}
              onClick={() => onDayChange(dayIndex)}
            />
          );
        })}
      </div>

      {/* Right Scroll Button */}
      {canScrollRight && (
        <button
          onClick={() => handleScroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white rounded-full p-2 shadow-lg hover-lift transition-spring"
          style={{
            border: `2px solid ${COLORS.gray[200]}`,
          }}
          aria-label="Scroll right"
        >
          <ChevronRight size={20} style={{ color: COLORS.gray[700] }} />
        </button>
      )}
    </div>
  </div>

  {/* Hide scrollbar */}
  <style jsx>{`
    .scrollbar-hide::-webkit-scrollbar {
      display: none;
    }
    .scrollbar-hide {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
  `}</style>
</div>
```

);
};

export default WeekHorizonSelector;