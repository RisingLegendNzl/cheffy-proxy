// web/src/components/FloatingActionButton.jsx
import React from 'react';
import { COLORS, SHADOWS, Z_INDEX } from '../constants';

/**
 * Floating Action Button with gradient background
 * Includes breathing shadow animation
 */
const FloatingActionButton = ({
  icon: Icon,
  label = '',
  onClick,
  className = '',
  gradient = COLORS.gradients.primary,
}) => {
  return (
    <button
      onClick={onClick}
      className={`fixed bottom-6 right-6 p-4 rounded-full text-white font-semibold flex items-center space-x-2 hover-lift transition-spring shadow-lg ${className}`}
      style={{
        background: gradient,
        zIndex: Z_INDEX.fixed,
        boxShadow: SHADOWS.primary,
      }}
      aria-label={label || 'Action button'}
    >
      {Icon && <Icon size={24} />}
      {label && <span className="hidden md:inline">{label}</span>}
      
      <style jsx>{`
        @keyframes breathe {
          0%, 100% {
            box-shadow: ${SHADOWS.primary};
          }
          50% {
            box-shadow: ${SHADOWS.xl};
          }
        }
        
        button {
          animation: breathe 3s ease-in-out infinite;
        }
      `}</style>
    </button>
  );
};

export default FloatingActionButton;