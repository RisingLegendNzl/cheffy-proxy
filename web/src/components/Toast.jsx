// web/src/components/Toast.jsx
import React, { useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, X, XCircle } from 'lucide-react';
import { COLORS, SHADOWS, Z_INDEX } from '../constants';

/**
 * Toast notification component for user feedback
 * Shows success, error, warning, or info messages
 * Auto-dismisses after a set duration
 */
const Toast = ({ message, type = 'info', duration = 3000, onClose }) => {
  useEffect(() => {
    if (duration && duration > 0) {
      const timer = setTimeout(() => {
        onClose && onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const getToastConfig = () => {
    switch (type) {
      case 'success':
        return {
          icon: CheckCircle,
          bgColor: COLORS.success.light,
          textColor: COLORS.success.dark,
          iconColor: COLORS.success.main,
          borderColor: COLORS.success.main,
        };
      case 'error':
        return {
          icon: XCircle,
          bgColor: COLORS.error.light,
          textColor: COLORS.error.dark,
          iconColor: COLORS.error.main,
          borderColor: COLORS.error.main,
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          bgColor: COLORS.warning.light,
          textColor: COLORS.warning.dark,
          iconColor: COLORS.warning.main,
          borderColor: COLORS.warning.main,
        };
      case 'info':
      default:
        return {
          icon: Info,
          bgColor: COLORS.info.light,
          textColor: COLORS.info.dark,
          iconColor: COLORS.info.main,
          borderColor: COLORS.info.main,
        };
    }
  };

  const config = getToastConfig();
  const Icon = config.icon;

  return (
    <div
      className="flex items-center p-4 rounded-lg border-l-4 animate-slideLeft"
      style={{
        backgroundColor: config.bgColor,
        borderColor: config.borderColor,
        boxShadow: SHADOWS.lg,
        minWidth: '300px',
        maxWidth: '500px',
      }}
    >
      <Icon size={20} style={{ color: config.iconColor }} className="flex-shrink-0" />
      <p
        className="flex-1 mx-3 text-sm font-medium"
        style={{ color: config.textColor }}
      >
        {message}
      </p>
      <button
        onClick={onClose}
        className="flex-shrink-0 p-1 rounded hover:bg-black hover:bg-opacity-10 transition-fast"
        style={{ color: config.textColor }}
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>
  );
};

/**
 * Toast Container component to manage multiple toasts
 * Place this once in your App.jsx
 */
export const ToastContainer = ({ toasts, onRemoveToast }) => {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 space-y-2"
      style={{ zIndex: Z_INDEX.tooltip }}
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => onRemoveToast(toast.id)}
        />
      ))}
    </div>
  );
};

export default Toast;