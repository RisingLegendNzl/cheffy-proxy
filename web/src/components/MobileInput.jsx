// web/src/components/MobileInput.jsx
import React from 'react';
import { COLORS, SIZES } from '../constants';

/**
 * Mobile-optimized input component
 * Better touch targets and keyboard handling
 */
const MobileInput = ({
  label,
  name,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  icon: Icon,
  required = false,
  autoComplete = 'off',
  inputMode, // 'numeric', 'tel', 'email', etc.
}) => {
  const hasError = Boolean(error);

  return (
    <div className="mb-4">
      {/* Label */}
      {label && (
        <label
          htmlFor={name}
          className="block text-sm font-semibold mb-2"
          style={{ color: COLORS.gray[700] }}
        >
          {label}
          {required && <span style={{ color: COLORS.error.main }}> *</span>}
        </label>
      )}

      {/* Input Container */}
      <div className="relative">
        {/* Icon */}
        {Icon && (
          <div
            className="absolute left-3 top-1/2 transform -translate-y-1/2 pointer-events-none"
            style={{ color: hasError ? COLORS.error.main : COLORS.gray[400] }}
          >
            <Icon size={20} />
          </div>
        )}

        {/* Input */}
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          inputMode={inputMode}
          className={`w-full rounded-lg border-2 transition-all focus:outline-none focus:ring-2 ${
            Icon ? 'pl-12' : 'pl-4'
          } pr-4`}
          style={{
            ...SIZES.input.lg,
            borderColor: hasError ? COLORS.error.main : COLORS.gray[300],
            color: COLORS.gray[900],
            backgroundColor: '#ffffff',
          }}
        />
      </div>

      {/* Error Message */}
      {error && (
        <p
          className="mt-1 text-sm font-medium animate-fadeIn"
          style={{ color: COLORS.error.main }}
        >
          {error}
        </p>
      )}
    </div>
  );
};

export default MobileInput;