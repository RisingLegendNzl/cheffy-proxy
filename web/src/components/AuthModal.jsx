// web/src/components/AuthModal.jsx
import React, { useState } from 'react';
import { X, Mail, Lock, User, Eye, EyeOff, Loader } from 'lucide-react';
import { COLORS, SHADOWS, Z_INDEX } from '../constants';

/**
 * Authentication Modal Component
 * Handles both sign up and sign in with 7-day free trial
 */
const AuthModal = ({ isOpen, onClose, onSignUp, onSignIn, loading = false }) => {
  const [mode, setMode] = useState('signup'); // 'signup' or 'signin'
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    agreeToTerms: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});

  if (!isOpen) return null;

  const validateForm = () => {
    const newErrors = {};

    if (mode === 'signup' && !formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    if (mode === 'signup' && !formData.agreeToTerms) {
      newErrors.agreeToTerms = 'You must agree to the terms';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    if (mode === 'signup') {
      await onSignUp({
        name: formData.name,
        email: formData.email,
        password: formData.password
      });
    } else {
      await onSignIn({
        email: formData.email,
        password: formData.password
      });
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const toggleMode = () => {
    setMode(mode === 'signup' ? 'signin' : 'signup');
    setErrors({});
    setFormData({
      name: '',
      email: formData.email, // Keep email
      password: '',
      agreeToTerms: false
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn"
        style={{ zIndex: Z_INDEX.modalBackdrop }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed inset-0 flex items-center justify-center p-4 animate-scaleIn"
        style={{ zIndex: Z_INDEX.modal }}
      >
        <div
          className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          style={{ boxShadow: SHADOWS['2xl'] }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <h2 
              className="text-2xl font-bold"
              style={{ color: COLORS.gray[900] }}
            >
              {mode === 'signup' ? 'Start Your Free Trial' : 'Welcome Back'}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              disabled={loading}
            >
              <X size={24} style={{ color: COLORS.gray[600] }} />
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Trial Badge (Sign Up Only) */}
            {mode === 'signup' && (
              <div 
                className="text-center py-3 px-4 rounded-lg"
                style={{ 
                  backgroundColor: COLORS.success.light,
                  color: COLORS.success.dark
                }}
              >
                <p className="font-semibold">✨ 7 Days Free • No Credit Card Required</p>
              </div>
            )}

            {/* Name Field (Sign Up Only) */}
            {mode === 'signup' && (
              <div>
                <label 
                  htmlFor="name"
                  className="block text-sm font-semibold mb-2"
                  style={{ color: COLORS.gray[700] }}
                >
                  Name
                </label>
                <div className="relative">
                  <User 
                    size={20} 
                    className="absolute left-3 top-1/2 transform -translate-y-1/2"
                    style={{ color: errors.name ? COLORS.error.main : COLORS.gray[400] }}
                  />
                  <input
                    id="name"
                    name="name"
                    type="text"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="John Doe"
                    disabled={loading}
                    className={`w-full pl-12 pr-4 py-3 rounded-lg border-2 transition-all focus:outline-none ${
                      errors.name ? 'border-red-500' : 'border-gray-300 focus:border-indigo-500'
                    }`}
                    style={{
                      backgroundColor: loading ? COLORS.gray[50] : 'white'
                    }}
                  />
                </div>
                {errors.name && (
                  <p className="text-sm mt-1" style={{ color: COLORS.error.main }}>
                    {errors.name}
                  </p>
                )}
              </div>
            )}

            {/* Email Field */}
            <div>
              <label 
                htmlFor="email"
                className="block text-sm font-semibold mb-2"
                style={{ color: COLORS.gray[700] }}
              >
                Email
              </label>
              <div className="relative">
                <Mail 
                  size={20} 
                  className="absolute left-3 top-1/2 transform -translate-y-1/2"
                  style={{ color: errors.email ? COLORS.error.main : COLORS.gray[400] }}
                />
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="you@example.com"
                  disabled={loading}
                  className={`w-full pl-12 pr-4 py-3 rounded-lg border-2 transition-all focus:outline-none ${
                    errors.email ? 'border-red-500' : 'border-gray-300 focus:border-indigo-500'
                  }`}
                  style={{
                    backgroundColor: loading ? COLORS.gray[50] : 'white'
                  }}
                />
              </div>
              {errors.email && (
                <p className="text-sm mt-1" style={{ color: COLORS.error.main }}>
                  {errors.email}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div>
              <label 
                htmlFor="password"
                className="block text-sm font-semibold mb-2"
                style={{ color: COLORS.gray[700] }}
              >
                Password
              </label>
              <div className="relative">
                <Lock 
                  size={20} 
                  className="absolute left-3 top-1/2 transform -translate-y-1/2"
                  style={{ color: errors.password ? COLORS.error.main : COLORS.gray[400] }}
                />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="••••••••"
                  disabled={loading}
                  className={`w-full pl-12 pr-12 py-3 rounded-lg border-2 transition-all focus:outline-none ${
                    errors.password ? 'border-red-500' : 'border-gray-300 focus:border-indigo-500'
                  }`}
                  style={{
                    backgroundColor: loading ? COLORS.gray[50] : 'white'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff size={20} style={{ color: COLORS.gray[400] }} />
                  ) : (
                    <Eye size={20} style={{ color: COLORS.gray[400] }} />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm mt-1" style={{ color: COLORS.error.main }}>
                  {errors.password}
                </p>
              )}
            </div>

            {/* Terms Checkbox (Sign Up Only) */}
            {mode === 'signup' && (
              <div>
                <label className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="agreeToTerms"
                    checked={formData.agreeToTerms}
                    onChange={handleInputChange}
                    disabled={loading}
                    className="mt-1 w-4 h-4 rounded"
                    style={{ accentColor: COLORS.primary[600] }}
                  />
                  <span 
                    className="text-sm"
                    style={{ color: COLORS.gray[600] }}
                  >
                    I agree to the{' '}
                    <a 
                      href="#terms" 
                      className="underline"
                      style={{ color: COLORS.primary[600] }}
                    >
                      Terms of Service
                    </a>
                    {' '}and{' '}
                    <a 
                      href="#privacy" 
                      className="underline"
                      style={{ color: COLORS.primary[600] }}
                    >
                      Privacy Policy
                    </a>
                  </span>
                </label>
                {errors.agreeToTerms && (
                  <p className="text-sm mt-1" style={{ color: COLORS.error.main }}>
                    {errors.agreeToTerms}
                  </p>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              style={{ 
                backgroundColor: COLORS.primary[600]
              }}
            >
              {loading ? (
                <>
                  <Loader size={20} className="animate-spin" />
                  <span>{mode === 'signup' ? 'Creating Account...' : 'Signing In...'}</span>
                </>
              ) : (
                <span>{mode === 'signup' ? 'Start Free Trial' : 'Sign In'}</span>
              )}
            </button>

            {/* Toggle Mode */}
            <div className="text-center">
              <button
                type="button"
                onClick={toggleMode}
                disabled={loading}
                className="text-sm"
                style={{ color: COLORS.primary[600] }}
              >
                {mode === 'signup' ? (
                  <>Already have an account? <span className="font-semibold">Sign In</span></>
                ) : (
                  <>Don't have an account? <span className="font-semibold">Sign Up</span></>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default AuthModal;