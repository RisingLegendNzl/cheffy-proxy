// web/src/components/ui/MilestoneToast.jsx
import React, { useEffect, useState } from ‘react’;
import { Trophy, Star, Target, CheckCircle } from ‘lucide-react’;
import { COLORS, SHADOWS, Z_INDEX } from ‘../../constants’;
import ConfettiEffect from ‘../animations/ConfettiEffect’;

/**

- Milestone Toast - Special toast for celebrations
- Features:
- - Larger, more prominent design
- - Triggers confetti effect
- - Achievement badges
- - Custom animations
    */
    const MilestoneToast = ({
    milestone = ‘Plan Generated’,
    message = ‘Your meal plan is ready!’,
    icon: CustomIcon,
    duration = 5000,
    onClose
    }) => {
    const [showConfetti, setShowConfetti] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

useEffect(() => {
setShowConfetti(true);
setIsVisible(true);

```
if (duration && duration > 0) {
  const timer = setTimeout(() => {
    setIsVisible(false);
    setTimeout(() => {
      onClose && onClose();
    }, 300);
  }, duration);

  return () => clearTimeout(timer);
}
```

}, [duration, onClose]);

const handleConfettiComplete = () => {
setShowConfetti(false);
};

const getIcon = () => {
if (CustomIcon) return CustomIcon;
if (milestone.toLowerCase().includes(‘complete’)) return CheckCircle;
if (milestone.toLowerCase().includes(‘week’)) return Trophy;
if (milestone.toLowerCase().includes(‘plan’)) return Star;
return Target;
};

const Icon = getIcon();

return (
<>
<ConfettiEffect
isActive={showConfetti}
duration={3000}
particleCount={50}
onComplete={handleConfettiComplete}
/>

```
  <div
    className={`flex items-center p-6 rounded-xl border-2 transition-all duration-300 ${
      isVisible ? 'animate-bounceIn opacity-100' : 'opacity-0 scale-95'
    }`}
    style={{
      backgroundColor: '#ffffff',
      borderColor: COLORS.success.main,
      boxShadow: `${SHADOWS['2xl']}, 0 0 40px ${COLORS.success.main}40`,
      minWidth: '350px',
      maxWidth: '500px',
    }}
  >
    <div
      className="flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center mr-4 animate-pulse"
      style={{
        backgroundColor: COLORS.success.main,
      }}
    >
      <Icon size={32} className="text-white" />
    </div>

    <div className="flex-1">
      <h4
        className="text-lg font-bold mb-1"
        style={{ color: COLORS.gray[900] }}
      >
        🎉 {milestone}
      </h4>
      <p
        className="text-sm"
        style={{ color: COLORS.gray[600] }}
      >
        {message}
      </p>
    </div>

    <button
      onClick={() => {
        setIsVisible(false);
        setTimeout(() => onClose && onClose(), 300);
      }}
      className="flex-shrink-0 ml-4 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-fast"
      aria-label="Close"
    >
      <span style={{ color: COLORS.gray[400] }}>✕</span>
    </button>
  </div>
</>
```

);
};

export const MilestoneToastContainer = ({ milestones, onRemoveMilestone }) => {
if (!milestones || milestones.length === 0) return null;

return (
<div
className=“fixed top-20 right-4 space-y-3”
style={{ zIndex: Z_INDEX.tooltip }}
>
{milestones.map((milestone) => (
<MilestoneToast
key={milestone.id}
milestone={milestone.milestone}
message={milestone.message}
icon={milestone.icon}
duration={milestone.duration || 5000}
onClose={() => onRemoveMilestone(milestone.id)}
/>
))}
</div>
);
};

export default MilestoneToast;