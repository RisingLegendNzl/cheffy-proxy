// web/src/components/BottomNav.jsx
import React from 'react';
import { Home, Utensils, ShoppingCart, User, Plus } from 'lucide-react';
import { COLORS, Z_INDEX, SHADOWS } from '../constants';

/**
 * Mobile bottom navigation bar
 * Enhanced with larger touch targets (44px min) and better accessibility
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
        paddingBottom: 'env(safe-area-inset-bottom)', // iOS safe area
      }}
    >
      <div className="flex items-center justify-around px-2" style={{ height: '72px' }}>
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
                  className="relative -mt-8 w-16 h-16 rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform active:scale-95"
                  style={{
                    background: COLORS.gradients.primary,
                    minWidth: '64px',
                    minHeight: '64px',
                  }}
                  aria-label="Generate new plan"
                >
                  <Plus size={32} className="text-white" />
                </button>

                {/* Regular tab */}
                <button
                  onClick={() => onTabChange(tab.id)}
                  className={`flex-1 flex flex-col items-center justify-center transition-all active:scale-95 ${
                    isActive ? 'scale-105' : 'scale-100'
                  }`}
                  style={{
                    color: isActive ? COLORS.primary[600] : COLORS.gray[400],
                    minHeight: '44px',
                    minWidth: '44px',
                  }}
                  aria-label={tab.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon size={24} className="mb-1" />
                  <span className="text-xs font-semibold">{tab.label}</span>
                  {isActive && (
                    <div
                      className="absolute bottom-0 w-12 h-1 rounded-t-full transition-all"
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
              className={`flex-1 flex flex-col items-center justify-center relative transition-all active:scale-95 ${
                isActive ? 'scale-105' : 'scale-100'
              }`}
              style={{
                color: isActive ? COLORS.primary[600] : COLORS.gray[400],
                minHeight: '44px',
                minWidth: '44px',
              }}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={24} className="mb-1" />
              <span className="text-xs font-semibold">{tab.label}</span>
              {isActive && (
                <div
                  className="absolute bottom-0 w-12 h-1 rounded-t-full transition-all"
                  style={{ backgroundColor: COLORS.primary[600] }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom padding for devices with notches/home indicators */}
      <style jsx>{`
        @supports (padding: env(safe-area-inset-bottom)) {
          nav {
            padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
          }
        }
      `}</style>
    </nav>
  );
};

export default BottomNav;