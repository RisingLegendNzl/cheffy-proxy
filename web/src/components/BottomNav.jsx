// web/src/components/BottomNav.jsx
import React from 'react';
import { Home, Utensils, ShoppingCart, User, Plus } from 'lucide-react';
import { COLORS, Z_INDEX, SHADOWS } from '../constants';

/**
 * Mobile bottom navigation bar
 * Shows on mobile devices for easy thumb navigation
 */
const BottomNav = ({ 
  activeTab, 
  onTabChange, 
  showPlanButton = true,
  onNewPlan 
}) => {
  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'meals', label: 'Meals', icon: Utensils },
    { id: 'ingredients', label: 'Shop', icon: ShoppingCart },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t"
      style={{
        zIndex: Z_INDEX.fixed,
        borderColor: COLORS.gray[200],
        boxShadow: SHADOWS.xl,
      }}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          // Insert FAB button in the middle
          if (showPlanButton && index === 1) {
            return (
              <React.Fragment key={`group-${tab.id}`}>
                {/* Generate Plan FAB */}
                <button
                  onClick={onNewPlan}
                  className="relative -mt-8 w-14 h-14 rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
                  style={{
                    background: `linear-gradient(135deg, ${COLORS.primary[500]}, ${COLORS.secondary[500]})`,
                  }}
                  aria-label="Generate new plan"
                >
                  <Plus size={28} className="text-white" />
                </button>

                {/* Regular tab */}
                <button
                  onClick={() => onTabChange(tab.id)}
                  className={`flex-1 flex flex-col items-center justify-center h-full transition-all ${
                    isActive ? 'scale-105' : 'scale-100'
                  }`}
                  style={{
                    color: isActive ? COLORS.primary[600] : COLORS.gray[400],
                  }}
                >
                  <Icon size={22} className="mb-1" />
                  <span className="text-xs font-semibold">{tab.label}</span>
                  {isActive && (
                    <div
                      className="absolute bottom-0 w-12 h-1 rounded-t-full"
                      style={{ backgroundColor: COLORS.primary[600] }}
                    />
                  )}
                </button>
              </React.Fragment>
            );
          }

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center h-full relative transition-all ${
                isActive ? 'scale-105' : 'scale-100'
              }`}
              style={{
                color: isActive ? COLORS.primary[600] : COLORS.gray[400],
              }}
            >
              <Icon size={22} className="mb-1" />
              <span className="text-xs font-semibold">{tab.label}</span>
              {isActive && (
                <div
                  className="absolute bottom-0 w-12 h-1 rounded-t-full"
                  style={{ backgroundColor: COLORS.primary[600] }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;