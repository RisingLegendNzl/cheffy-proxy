// web/src/constants.js

/**
 * Design System Constants for Cheffy
 * Centralized design tokens for consistency across the app
 */

// ============================================
// COLOR PALETTE
// ============================================
export const COLORS = {
  // Primary Brand Colors
  primary: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',  // Main brand color
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
  },
  
  // Secondary Colors (Purple accent)
  secondary: {
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
  
  // Macro Colors (for nutrition displays)
  macros: {
    protein: {
      light: '#d1fae5',
      main: '#10b981',
      dark: '#059669',
      icon: '💪',
    },
    fat: {
      light: '#fef3c7',
      main: '#f59e0b',
      dark: '#d97706',
      icon: '🥑',
    },
    carbs: {
      light: '#fed7aa',
      main: '#f97316',
      dark: '#ea580c',
      icon: '🌾',
    },
    calories: {
      light: '#fee2e2',
      main: '#ef4444',
      dark: '#dc2626',
      icon: '🔥',
    },
  },
  
  // Background Colors
  background: {
    primary: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
  },
};

// ============================================
// SPACING SYSTEM (8px grid)
// ============================================
export const SPACING = {
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.25rem',   // 20px
  6: '1.5rem',    // 24px
  8: '2rem',      // 32px
  10: '2.5rem',   // 40px
  12: '3rem',     // 48px
  16: '4rem',     // 64px
  20: '5rem',     // 80px
  24: '6rem',     // 96px
};

// ============================================
// TYPOGRAPHY
// ============================================
export const TYPOGRAPHY = {
  fontFamily: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "'Poppins', 'Inter', sans-serif",
    mono: "'Fira Code', 'Courier New', monospace",
  },
  
  fontSize: {
    xs: '0.75rem',      // 12px
    sm: '0.875rem',     // 14px
    base: '1rem',       // 16px
    lg: '1.125rem',     // 18px
    xl: '1.25rem',      // 20px
    '2xl': '1.5rem',    // 24px
    '3xl': '1.875rem',  // 30px
    '4xl': '2.25rem',   // 36px
    '5xl': '3rem',      // 48px
    '6xl': '3.75rem',   // 60px
  },
  
  fontWeight: {
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  
  lineHeight: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
};

// ============================================
// SHADOWS (Elevation system)
// ============================================
export const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
  
  // Colored shadows for brand elements
  primary: '0 10px 25px -5px rgba(99, 102, 241, 0.3)',
  success: '0 10px 25px -5px rgba(16, 185, 129, 0.3)',
  error: '0 10px 25px -5px rgba(239, 68, 68, 0.3)',
};

// ============================================
// BORDER RADIUS
// ============================================
export const RADIUS = {
  none: '0',
  sm: '0.25rem',    // 4px
  base: '0.5rem',   // 8px
  md: '0.75rem',    // 12px
  lg: '1rem',       // 16px
  xl: '1.5rem',     // 24px
  '2xl': '2rem',    // 32px
  full: '9999px',   // Pill shape
};

// ============================================
// TRANSITIONS
// ============================================
export const TRANSITIONS = {
  duration: {
    fast: '150ms',
    base: '200ms',
    medium: '300ms',
    slow: '500ms',
  },
  timing: {
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
    spring: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
};

// ============================================
// BREAKPOINTS (for responsive design)
// ============================================
export const BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
};

// ============================================
// Z-INDEX LAYERS
// ============================================
export const Z_INDEX = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
};

// ============================================
// COMPONENT SIZES
// ============================================
export const SIZES = {
  button: {
    sm: {
      height: '2rem',      // 32px
      padding: '0.5rem 1rem',
      fontSize: TYPOGRAPHY.fontSize.sm,
    },
    md: {
      height: '2.5rem',    // 40px
      padding: '0.625rem 1.25rem',
      fontSize: TYPOGRAPHY.fontSize.base,
    },
    lg: {
      height: '3rem',      // 48px
      padding: '0.75rem 1.5rem',
      fontSize: TYPOGRAPHY.fontSize.lg,
    },
  },
  
  input: {
    sm: {
      height: '2rem',      // 32px
      padding: '0.5rem 0.75rem',
      fontSize: TYPOGRAPHY.fontSize.sm,
    },
    md: {
      height: '2.5rem',    // 40px
      padding: '0.625rem 1rem',
      fontSize: TYPOGRAPHY.fontSize.base,
    },
    lg: {
      height: '3rem',      // 48px
      padding: '0.75rem 1.25rem',
      fontSize: TYPOGRAPHY.fontSize.lg,
    },
  },
  
  icon: {
    xs: '1rem',     // 16px
    sm: '1.25rem',  // 20px
    md: '1.5rem',   // 24px
    lg: '2rem',     // 32px
    xl: '3rem',     // 48px
  },
};

// ============================================
// ANIMATION PRESETS
// ============================================
export const ANIMATIONS = {
  fadeIn: 'fadeIn',
  slideUp: 'slideUp',
  slideDown: 'slideDown',
  slideLeft: 'slideLeft',
  slideRight: 'slideRight',
  scaleIn: 'scaleIn',
  bounce: 'bounce',
  spin: 'spin',
  pulse: 'pulse',
  shimmer: 'shimmer',
};

// ============================================
// APP-SPECIFIC CONSTANTS
// ============================================
export const APP_CONFIG = {
  name: 'Cheffy',
  tagline: 'Your Personal Meal Planning Assistant',
  version: '1.0.0',
  
  // Feature flags
  features: {
    firebase: true,
    analytics: false,
    darkMode: false,
    mealImages: false, // Enable when image generation is added
  },
  
  // Limits
  limits: {
    maxDays: 7,
    minDays: 1,
    maxSubstitutes: 5,
    maxIngredients: 50,
  },
  
  // Default values
  defaults: {
    store: 'Woolworths',
    eatingOccasions: '3',
    costPriority: 'Best Value',
    mealVariety: 'Balanced Variety',
  },
};

// ============================================
// GOAL LABELS (human-readable)
// ============================================
export const GOAL_LABELS = {
  maintain: {
    label: 'Maintain Weight',
    description: 'Maintain current weight',
    icon: '⚖️',
    color: COLORS.info.main,
  },
  cut_moderate: {
    label: 'Moderate Cut',
    description: '15% calorie deficit',
    icon: '📉',
    color: COLORS.primary[500],
  },
  cut_aggressive: {
    label: 'Aggressive Cut',
    description: '25% calorie deficit',
    icon: '⚡',
    color: COLORS.error.main,
  },
  bulk_lean: {
    label: 'Lean Bulk',
    description: '15% calorie surplus',
    icon: '📈',
    color: COLORS.success.main,
  },
  bulk_aggressive: {
    label: 'Aggressive Bulk',
    description: '25% calorie surplus',
    icon: '💪',
    color: COLORS.success.dark,
  },
};

// ============================================
// ACTIVITY LEVEL LABELS
// ============================================
export const ACTIVITY_LABELS = {
  sedentary: {
    label: 'Sedentary',
    description: 'Little to no exercise',
    icon: '🛋️',
  },
  light: {
    label: 'Lightly Active',
    description: 'Light exercise 1-3 days/week',
    icon: '🚶',
  },
  moderate: {
    label: 'Moderately Active',
    description: 'Moderate exercise 3-5 days/week',
    icon: '🏃',
  },
  active: {
    label: 'Very Active',
    description: 'Hard exercise 6-7 days/week',
    icon: '🏋️',
  },
  veryActive: {
    label: 'Extremely Active',
    description: 'Very hard exercise & physical job',
    icon: '💪',
  },
};

// Export default for convenience
export default {
  COLORS,
  SPACING,
  TYPOGRAPHY,
  SHADOWS,
  RADIUS,
  TRANSITIONS,
  BREAKPOINTS,
  Z_INDEX,
  SIZES,
  ANIMATIONS,
  APP_CONFIG,
  GOAL_LABELS,
  ACTIVITY_LABELS,
};