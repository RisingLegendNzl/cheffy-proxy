// web/src/components/EmptyState.jsx
import React from 'react';
import { COLORS, SPACING } from '../constants';

/**
 * Reusable empty state component
 * Shows when there's no data to display
 */
const EmptyState = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  illustrationUrl,
}) => {
  return (
    <div
      className="flex flex-col items-center justify-center text-center p-8 md:p-12 animate-fadeIn"
      style={{ minHeight: '300px' }}
    >
      {/* Icon or Illustration */}
      {illustrationUrl ? (
        <img
          src={illustrationUrl}
          alt={title}
          className="w-48 h-48 mb-6 opacity-80"
        />
      ) : Icon ? (
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
          style={{ backgroundColor: COLORS.gray[100] }}
        >
          <Icon size={40} style={{ color: COLORS.gray[400] }} />
        </div>
      ) : null}

      {/* Title */}
      {title && (
        <h3
          className="text-xl font-bold mb-2"
          style={{ color: COLORS.gray[900] }}
        >
          {title}
        </h3>
      )}

      {/* Description */}
      {description && (
        <p
          className="text-sm max-w-md mb-6"
          style={{ color: COLORS.gray[600] }}
        >
          {description}
        </p>
      )}

      {/* Action Button */}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-6 py-3 rounded-lg font-semibold hover-lift transition-spring"
          style={{
            backgroundColor: COLORS.primary[500],
            color: '#ffffff',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;