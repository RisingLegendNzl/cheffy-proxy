// web/src/components/profile/GoalCard.jsx
import React from ‘react’;
import { COLORS, GOAL_LABELS, ACTIVITY_LABELS } from ‘../../constants’;

/**

- Goal Card - Displays goal/activity with morphing body silhouettes
- Features:
- - Goal selection cards
- - Before/after body silhouettes (visual metaphor)
- - Color-coded styling
- - Icon and description
    */
    const GoalCard = ({ goal, type = ‘goal’ }) => {
    // Get label data
    const getGoalData = () => {
    if (type === ‘activity’) {
    return ACTIVITY_LABELS[goal] || {
    label: goal,
    description: ‘’,
    icon: ‘🏃’,
    };
    }
    return GOAL_LABELS[goal] || {
    label: goal,
    description: ‘’,
    icon: ‘⚖️’,
    color: COLORS.info.main,
    };
    };

const data = getGoalData();

// Body silhouette SVG paths (simplified representations)
const getBodySilhouette = () => {
if (type === ‘activity’) {
// Activity level uses different icons
return null;
}

```
// Different body shapes based on goal
const silhouettes = {
  maintain: {
    before: 'M50,20 L50,60 M40,30 L60,30 M40,70 L50,90 M60,70 L50,90',
    after: 'M50,20 L50,60 M40,30 L60,30 M40,70 L50,90 M60,70 L50,90',
  },
  cut_moderate: {
    before: 'M50,20 Q55,40 50,60 Q45,40 50,20 M35,30 L65,30 M40,70 L50,90 M60,70 L50,90',
    after: 'M50,20 L50,60 M40,30 L60,30 M42,70 L50,90 M58,70 L50,90',
  },
  cut_aggressive: {
    before: 'M50,20 Q58,40 50,60 Q42,40 50,20 M32,30 L68,30 M38,70 L50,90 M62,70 L50,90',
    after: 'M50,20 L50,60 M42,30 L58,30 M44,70 L50,90 M56,70 L50,90',
  },
  bulk_lean: {
    before: 'M50,20 L50,60 M42,30 L58,30 M44,70 L50,90 M56,70 L50,90',
    after: 'M50,20 Q52,40 50,60 Q48,40 50,20 M38,30 L62,30 M40,70 L50,90 M60,70 L50,90',
  },
  bulk_aggressive: {
    before: 'M50,20 L50,60 M42,30 L58,30 M44,70 L50,90 M56,70 L50,90',
    after: 'M50,20 Q55,40 50,60 Q45,40 50,20 M35,30 L65,30 M38,70 L50,90 M62,70 L50,90',
  },
};

return silhouettes[goal] || silhouettes.maintain;
```

};

const silhouette = getBodySilhouette();

return (
<div
className=“rounded-xl p-6 border-2”
style={{
backgroundColor: type === ‘activity’ ? COLORS.info.light : `${data.color}15`,
borderColor: type === ‘activity’ ? COLORS.info.main : data.color,
}}
>
{/* Icon and Label */}
<div className="flex items-center space-x-3 mb-4">
<div
className=“w-16 h-16 rounded-full flex items-center justify-center text-3xl”
style={{
backgroundColor: type === ‘activity’ ? COLORS.info.main : data.color,
}}
>
<span className="text-white">{data.icon}</span>
</div>
<div className="flex-1">
<h4 className=“text-xl font-bold” style={{ color: COLORS.gray[900] }}>
{data.label}
</h4>
{data.description && (
<p className=“text-sm” style={{ color: COLORS.gray[600] }}>
{data.description}
</p>
)}
</div>
</div>

```
  {/* Body Silhouettes (only for goals) */}
  {silhouette && type === 'goal' && (
    <div className="flex items-center justify-center space-x-8 pt-4 border-t" style={{ borderColor: COLORS.gray[200] }}>
      {/* Before */}
      <div className="text-center">
        <p className="text-xs font-semibold mb-2" style={{ color: COLORS.gray[500] }}>
          Before
        </p>
        <svg width="60" height="100" viewBox="0 0 100 100">
          <path
            d={silhouette.before}
            stroke={COLORS.gray[400]}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>

      {/* Arrow */}
      <div style={{ color: data.color }}>
        <svg width="40" height="20" viewBox="0 0 40 20">
          <path
            d="M5,10 L30,10 M25,5 L35,10 L25,15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>

      {/* After */}
      <div className="text-center">
        <p className="text-xs font-semibold mb-2" style={{ color: COLORS.gray[500] }}>
          After
        </p>
        <svg width="60" height="100" viewBox="0 0 100 100">
          <path
            d={silhouette.after}
            stroke={data.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className="animate-breathe"
          />
        </svg>
      </div>
    </div>
  )}
</div>
```

);
};

export default GoalCard;