// web/src/constants.js

/**
 * Design System Constants for Cheffy
 * Centralized design tokens for consistency across the app
 */

// ============================================
// COLOR PALETTE - Premium Warm-Meets-Cool
// ============================================
export const COLORS = {
  // Primary Brand Colors (Deep Plum)
  primary: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    400: '#c084fc',
    500: '#a855f7',
    600: '#9333ea',
    700: '#7e22ce',
    800: '#6b21a8',
    900: '#581c87',
  },
  
  // Accent Colors (Coral/Rose)
  accent: {
    50: '#fff1f2',
    100: '#ffe4e6',
    200: '#fecdd3',
    300: '#fda4af',
    400: '#fb7185',
    500: '#f97583',
    600: '#e11d48',
    700: '#be123c',
    800: '#9f1239',
    900: '#881337',
  },
  
  // Semantic Colors
  success: {
    light: '#d1fae5',
    main: '#10b981',
    dark: '#059669',
  },
  warning: {
    light: '#fef3c7',
    main: '#f59e0b',
    dark: '#d97706',
  },
  error: {
    light: '#fee2e2',
    main: '#ef4444',
    dark: '#dc2626',
  },
  info: {
    light: '#dbeafe',
    main: '#3b82f6',
    dark: '#2563eb',
  },
  
  // Neutral Grays
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
  
  // Macro Colors - Refined Palette
  macros: {
    protein: {
      light: '#dbeafe',
      main: '#2563eb',  // Deep ocean blue
      dark: '#1e40af',
      icon: '💪',
    },
    carbs: {
      light: '#fef3c7',
      main: '#f59e0b',  // Warm amber
      dark: '#d97706',
      icon: '🌾',
    },
    fats: {
      light: '#d1fae5',
      main: '#10b981',  // Rich avocado green
      dark: '#059669',
      icon: '🥑',
    },
    calories: {
      light: '#fed7aa',
      main: '#f97316',  // Vibrant coral
      dark: '#ea580c',
      icon: '🔥',
    },
  },
  
  // Background Colors
  background: {
    primary: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
  },
  
  // Gradients
  gradients: {
    primary: 'linear-gradient(135deg, #6b21a8 0%, #f97583 100%)',
    accent: 'linear-gradient(135deg, #f97583 0%, #fb7185 100%)',
    success: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
    warning: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
    produce: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
    meat: 'linear-gradient(135deg, #dc2626 0%, #f87171 100%)',
    dairy: 'linear-gradient(135deg, #a5b4fc 0%, #e0e7ff 100%)',
  },
};

// ============================================
// SPACING SCALE
// ============================================
export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
  '3xl': '64px',
};

// ============================================
// TYPOGRAPHY
// ============================================
export const TYPOGRAPHY = {
  fontFamily: {
    display: "'Poppins', -apple-system, BlinkMacSystemFont, sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'SF Mono', 'Monaco', 'Cascadia Code', monospace",
  },
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem', // 36px
    '5xl': '3rem',    // 48px
  },
  fontWeight: {
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.6,
    loose: 2,
  },
  letterSpacing: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.025em',
  },
};

// ============================================
// SHADOWS
// ============================================
export const SHADOWS = {
  xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  sm: '0 2px 8px 0 rgba(0, 0, 0, 0.04)',
  md: '0 4px 12px 0 rgba(0, 0, 0, 0.08)',
  lg: '0 8px 24px 0 rgba(0, 0, 0, 0.12)',
  xl: '0 16px 48px 0 rgba(0, 0, 0, 0.16)',
  // Colored shadows
  primary: '0 4px 12px 0 rgba(168, 85, 247, 0.2)',
  accent: '0 4px 12px 0 rgba(249, 117, 131, 0.2)',
  success: '0 4px 12px 0 rgba(16, 185, 129, 0.2)',
};

// ============================================
// BORDER RADIUS
// ============================================
export const RADIUS = {
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '24px',
  full: '9999px',
};

// ============================================
// Z-INDEX SCALE
// ============================================
export const Z_INDEX = {
  base: 1,
  dropdown: 100,
  sticky: 200,
  fixed: 300,
  modalBackdrop: 400,
  modal: 500,
  popover: 600,
  tooltip: 700,
};

// ============================================
// TRANSITIONS
// ============================================
export const TRANSITIONS = {
  fast: '150ms ease-out',
  base: '200ms ease-out',
  slow: '300ms ease-in-out',
  spring: '350ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
};

// ============================================
// BREAKPOINTS
// ============================================
export const BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
};

// ============================================
// APP CONFIG
// ============================================
export const APP_CONFIG = {
  name: 'Cheffy',
  tagline: 'Your AI Meal Planning Assistant',
  version: '1.0.0',
};

// ============================================
// CATEGORY ICONS (for shopping list)
// ============================================
export const CATEGORY_ICONS = {
  produce: '🥕',
  fruit: '🍎',
  vegetables: '🥬',
  grains: '🌾',
  meat: '🥩',
  seafood: '🐟',
  dairy: '🥛',
  pantry: '🥫',
  frozen: '❄️',
  bakery: '🍞',
  snacks: '🍿',
  beverages: '🥤',
  condiments: '🧂',
  spreads: '🥜',
  canned: '🥫',
};

// ============================================
// GLASSMORPHISM
// ============================================
export const GLASS = {
  background: 'rgba(255, 255, 255, 0.9)',
  border: 'rgba(255, 255, 255, 0.2)',
  blur: 'blur(10px)',
};