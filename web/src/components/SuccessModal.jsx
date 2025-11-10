// web/src/components/SuccessModal.jsx
import React, { useEffect } from 'react';
import { CheckCircle, X, ChevronRight } from 'lucide-react';
import { COLORS, Z_INDEX, SHADOWS } from '../constants';

/**
 * Success modal shown after plan generation
 * Auto-dismisses or can be closed manually
 */
const SuccessModal = ({
  isVisible,
  title = 'Success!',
  message,
  stats = [],
  onClose,
  onViewPlan,
  autoDismiss = true,
  dismissDelay = 3000,
}) => {
  useEffect(() => {
    if (isVisible && autoDismiss && dismissDelay > 0) {
      const timer = setTimeout(() => {
        onClose && onClose();
      }, dismissDelay);

      return () => clearTimeout(timer);
    }
  }, [isVisible, autoDismiss, dismissDelay, onClose]);

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 animate-fadeIn"
      style={{ zIndex: Z_INDEX.modal }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-8 max-w-md w-full animate-bounceIn"
        style={{ boxShadow: SHADOWS['2xl'] }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-fast"
          style={{ color: COLORS.gray[400] }}
        >
          <X size={20} />
        </button>

        {/* Success Icon */}
        <div className="flex justify-center mb-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center animate-pulse"
            style={{
              backgroundColor: COLORS.success.light,
            }}
          >
            <CheckCircle size={40} style={{ color: COLORS.success.main }} />
          </div>
        </div>

        {/* Title */}
        <h3
          className="text-2xl font-bold text-center mb-2"
          style={{ color: COLORS.gray[900] }}
        >
          {title}
        </h3>

        {/* Message */}
        {message && (
          <p
            className="text-center text-sm mb-6"
            style={{ color: COLORS.gray[600] }}
          >
            {message}
          </p>
        )}

        {/* Stats Grid */}
        {stats.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {stats.map((stat, index) => (
              <div
                key={index}
                className="p-4 rounded-lg text-center"
                style={{
                  backgroundColor: COLORS.gray[50],
                  border: `1px solid ${COLORS.gray[200]}`,
                }}
              >
                <p className="text-2xl font-bold mb-1" style={{ color: stat.color || COLORS.primary[600] }}>
                  {stat.value}
                </p>
                <p className="text-xs" style={{ color: COLORS.gray[600] }}>
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Action Button */}
        {onViewPlan && (
          <button
            onClick={onViewPlan}
            className="w-full flex items-center justify-center py-3 rounded-lg font-semibold hover-lift transition-spring"
            style={{
              backgroundColor: COLORS.primary[500],
              color: '#ffffff',
            }}
          >
            View My Plan
            <ChevronRight size={20} className="ml-2" />
          </button>
        )}
      </div>
    </div>
  );
};

export default SuccessModal;
