// web/src/components/LoadingOverlay.jsx
import React from 'react';
import { Loader, CheckCircle } from 'lucide-react';
import { COLORS, Z_INDEX } from '../constants';

/**
 * Full-screen loading overlay with progress tracking
 * Shows during plan generation
 */
const LoadingOverlay = ({ 
  isVisible, 
  progress = 0, 
  currentStep = '',
  steps = [],
  isComplete = false 
}) => {
  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 animate-fadeIn"
      style={{ zIndex: Z_INDEX.modal }}
    >
      <div
        className="bg-white rounded-2xl p-8 max-w-md w-full animate-scaleIn"
        style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}
      >
        {/* Icon */}
        <div className="flex justify-center mb-6">
          {isComplete ? (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center animate-bounceIn"
              style={{ backgroundColor: COLORS.success.light }}
            >
              <CheckCircle size={40} style={{ color: COLORS.success.main }} />
            </div>
          ) : (
            <div className="spinner-lg" />
          )}
        </div>

        {/* Title */}
        <h3
          className="text-2xl font-bold text-center mb-2"
          style={{ color: COLORS.gray[900] }}
        >
          {isComplete ? 'All Done!' : 'Generating Your Plan'}
        </h3>

        {/* Description */}
        <p
          className="text-center text-sm mb-6"
          style={{ color: COLORS.gray[600] }}
        >
          {isComplete
            ? 'Your personalized meal plan is ready!'
            : 'Please wait while we create your perfect meal plan...'}
        </p>

        {/* Progress Bar */}
        {!isComplete && (
          <>
            <div
              className="relative w-full h-2 rounded-full mb-2 overflow-hidden"
              style={{ backgroundColor: COLORS.gray[200] }}
            >
              <div
                className="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(to right, ${COLORS.primary[500]}, ${COLORS.secondary[500]})`,
                }}
              />
            </div>

            <p
              className="text-center text-xs mb-6"
              style={{ color: COLORS.gray[500] }}
            >
              {progress}% Complete
            </p>
          </>
        )}

        {/* Current Step */}
        {currentStep && !isComplete && (
          <div
            className="p-3 rounded-lg mb-4"
            style={{ backgroundColor: COLORS.primary[50] }}
          >
            <p
              className="text-sm font-medium text-center"
              style={{ color: COLORS.primary[700] }}
            >
              {currentStep}
            </p>
          </div>
        )}

        {/* Step List */}
        {steps.length > 0 && !isComplete && (
          <div className="space-y-2">
            {steps.map((step, index) => (
              <div key={index} className="flex items-center text-sm">
                {step.completed ? (
                  <CheckCircle
                    size={16}
                    className="mr-2 flex-shrink-0"
                    style={{ color: COLORS.success.main }}
                  />
                ) : step.active ? (
                  <Loader
                    size={16}
                    className="mr-2 flex-shrink-0 animate-spin"
                    style={{ color: COLORS.primary[500] }}
                  />
                ) : (
                  <div
                    className="w-4 h-4 mr-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: COLORS.gray[300] }}
                  />
                )}
                <span
                  style={{
                    color: step.completed || step.active
                      ? COLORS.gray[900]
                      : COLORS.gray[500],
                    fontWeight: step.active ? 600 : 400,
                  }}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Complete Button */}
        {isComplete && (
          <button
            onClick={() => {}}
            className="w-full py-3 rounded-lg font-semibold hover-lift transition-spring mt-4"
            style={{
              backgroundColor: COLORS.success.main,
              color: '#ffffff',
            }}
          >
            View My Plan
          </button>
        )}
      </div>
    </div>
  );
};

export default LoadingOverlay;