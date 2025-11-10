// web/src/helpers.js

/**
 * Utility Helper Functions for Cheffy
 * Reusable functions for formatting, validation, and data manipulation
 */

import { GOAL_LABELS, ACTIVITY_LABELS } from './constants';

// ============================================
// TEXT FORMATTING
// ============================================

/**
 * Format goal text from database value to human-readable
 * @param {string} goal - Database goal value (e.g., "cut_moderate")
 * @returns {string} - Formatted goal text (e.g., "Moderate Cut")
 */
export const formatGoalText = (goal) => {
  if (!goal) return 'Unknown Goal';
  const goalData = GOAL_LABELS[goal];
  return goalData ? goalData.label : goal.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

/**
 * Get full goal information including icon and description
 * @param {string} goal - Database goal value
 * @returns {object} - Goal data object
 */
export const getGoalData = (goal) => {
  return GOAL_LABELS[goal] || {
    label: formatGoalText(goal),
    description: 'Custom goal',
    icon: '🎯',
    color: '#6366f1',
  };
};

/**
 * Format activity level to human-readable text
 * @param {string} activityLevel - Database activity value
 * @returns {string} - Formatted activity text
 */
export const formatActivityLevel = (activityLevel) => {
  if (!activityLevel) return 'Unknown Activity';
  const activityData = ACTIVITY_LABELS[activityLevel];
  return activityData ? activityData.label : activityLevel.charAt(0).toUpperCase() + activityLevel.slice(1);
};

/**
 * Get full activity information
 * @param {string} activityLevel - Database activity value
 * @returns {object} - Activity data object
 */
export const getActivityData = (activityLevel) => {
  return ACTIVITY_LABELS[activityLevel] || {
    label: formatActivityLevel(activityLevel),
    description: 'Custom activity level',
    icon: '🏃',
  };
};

/**
 * Truncate text to a maximum length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
export const truncateText = (text, maxLength = 50) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
};

/**
 * Capitalize first letter of each word
 * @param {string} text - Text to capitalize
 * @returns {string} - Capitalized text
 */
export const capitalizeWords = (text) => {
  if (!text) return '';
  return text.replace(/\b\w/g, l => l.toUpperCase());
};

// ============================================
// NUMBER FORMATTING
// ============================================

/**
 * Format price with currency symbol
 * @param {number} price - Price value
 * @param {string} currency - Currency symbol (default: $)
 * @returns {string} - Formatted price
 */
export const formatPrice = (price, currency = '$') => {
  if (price === null || price === undefined || isNaN(price)) return `${currency}0.00`;
  return `${currency}${Number(price).toFixed(2)}`;
};

/**
 * Format number with comma separators
 * @param {number} num - Number to format
 * @returns {string} - Formatted number
 */
export const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return num.toLocaleString();
};

/**
 * Format grams to a readable string
 * @param {number} grams - Grams value
 * @param {boolean} includeUnit - Whether to include 'g' unit
 * @returns {string} - Formatted grams
 */
export const formatGrams = (grams, includeUnit = true) => {
  if (grams === null || grams === undefined || isNaN(grams)) return includeUnit ? '0g' : '0';
  const rounded = Math.round(grams);
  return includeUnit ? `${rounded}g` : `${rounded}`;
};

/**
 * Format calories to a readable string
 * @param {number} calories - Calorie value
 * @param {boolean} includeUnit - Whether to include 'kcal' unit
 * @returns {string} - Formatted calories
 */
export const formatCalories = (calories, includeUnit = true) => {
  if (calories === null || calories === undefined || isNaN(calories)) return includeUnit ? '0 kcal' : '0';
  const rounded = Math.round(calories);
  return includeUnit ? `${formatNumber(rounded)} kcal` : formatNumber(rounded);
};

/**
 * Calculate percentage
 * @param {number} current - Current value
 * @param {number} target - Target value
 * @param {number} decimals - Number of decimal places
 * @returns {number} - Percentage
 */
export const calculatePercentage = (current, target, decimals = 0) => {
  if (!target || target === 0) return 0;
  const percentage = (current / target) * 100;
  return Number(percentage.toFixed(decimals));
};

/**
 * Format percentage
 * @param {number} current - Current value
 * @param {number} target - Target value
 * @param {boolean} includeSymbol - Whether to include % symbol
 * @returns {string} - Formatted percentage
 */
export const formatPercentage = (current, target, includeSymbol = true) => {
  const percentage = calculatePercentage(current, target, 0);
  return includeSymbol ? `${percentage}%` : `${percentage}`;
};

// ============================================
// DATE/TIME FORMATTING
// ============================================

/**
 * Format date to readable string
 * @param {Date|string} date - Date object or ISO string
 * @param {string} format - Format style ('short', 'long', 'time')
 * @returns {string} - Formatted date
 */
export const formatDate = (date, format = 'short') => {
  if (!date) return '';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  switch (format) {
    case 'short':
      return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    case 'long':
      return dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    case 'time':
      return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    default:
      return dateObj.toLocaleDateString();
  }
};

/**
 * Get relative time string (e.g., "2 hours ago")
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} - Relative time string
 */
export const getRelativeTime = (date) => {
  if (!date) return '';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now - dateObj;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  return formatDate(dateObj, 'short');
};

// ============================================
// VALIDATION
// ============================================

/**
 * Validate email format
 * @param {string} email - Email string
 * @returns {boolean} - Whether email is valid
 */
export const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate number within range
 * @param {number} value - Value to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {boolean} - Whether value is within range
 */
export const isInRange = (value, min, max) => {
  const num = Number(value);
  if (isNaN(num)) return false;
  return num >= min && num <= max;
};

/**
 * Validate required field
 * @param {any} value - Value to validate
 * @returns {boolean} - Whether value is present
 */
export const isRequired = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return !isNaN(value);
  return true;
};

// ============================================
// ARRAY/OBJECT UTILITIES
// ============================================

/**
 * Group array of objects by a key
 * @param {Array} array - Array to group
 * @param {string} key - Key to group by
 * @returns {object} - Grouped object
 */
export const groupBy = (array, key) => {
  if (!Array.isArray(array)) return {};
  return array.reduce((result, item) => {
    const groupKey = item[key] || 'uncategorized';
    if (!result[groupKey]) result[groupKey] = [];
    result[groupKey].push(item);
    return result;
  }, {});
};

/**
 * Sort array of objects by a key
 * @param {Array} array - Array to sort
 * @param {string} key - Key to sort by
 * @param {string} order - Sort order ('asc' or 'desc')
 * @returns {Array} - Sorted array
 */
export const sortBy = (array, key, order = 'asc') => {
  if (!Array.isArray(array)) return [];
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    
    if (aVal === bVal) return 0;
    
    if (order === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });
};

/**
 * Deep clone an object
 * @param {object} obj - Object to clone
 * @returns {object} - Cloned object
 */
export const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
};

// ============================================
// COLOR UTILITIES
// ============================================

/**
 * Get color based on macro progress
 * @param {number} current - Current value
 * @param {number} target - Target value
 * @returns {string} - Color class or hex
 */
export const getMacroProgressColor = (current, target) => {
  const percentage = calculatePercentage(current, target);
  
  if (percentage >= 95 && percentage <= 105) return '#10b981'; // Green - perfect
  if (percentage > 105) return '#ef4444'; // Red - over
  if (percentage < 50) return '#9ca3af'; // Gray - very low
  return '#6366f1'; // Indigo - in progress
};

/**
 * Convert hex to rgba
 * @param {string} hex - Hex color code
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} - RGBA color string
 */
export const hexToRgba = (hex, alpha = 1) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// ============================================
// LOCAL STORAGE HELPERS
// ============================================

/**
 * Save to local storage with error handling
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @returns {boolean} - Whether save was successful
 */
export const saveToStorage = (key, value) => {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
    return false;
  }
};

/**
 * Load from local storage with error handling
 * @param {string} key - Storage key
 * @param {any} defaultValue - Default value if key doesn't exist
 * @returns {any} - Stored value or default
 */
export const loadFromStorage = (key, defaultValue = null) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error('Failed to load from localStorage:', error);
    return defaultValue;
  }
};

/**
 * Remove from local storage
 * @param {string} key - Storage key
 * @returns {boolean} - Whether removal was successful
 */
export const removeFromStorage = (key) => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error('Failed to remove from localStorage:', error);
    return false;
  }
};

// ============================================
// CLIPBOARD UTILITIES
// ============================================

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - Whether copy was successful
 */
export const copyToClipboard = async (text) => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    }
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
};

// ============================================
// DEBOUNCE/THROTTLE
// ============================================

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
export const debounce = (func, delay = 300) => {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
};

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} - Throttled function
 */
export const throttle = (func, limit = 300) => {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// Export all as default for convenience
export default {
  formatGoalText,
  getGoalData,
  formatActivityLevel,
  getActivityData,
  truncateText,
  capitalizeWords,
  formatPrice,
  formatNumber,
  formatGrams,
  formatCalories,
  calculatePercentage,
  formatPercentage,
  formatDate,
  getRelativeTime,
  isValidEmail,
  isInRange,
  isRequired,
  groupBy,
  sortBy,
  deepClone,
  getMacroProgressColor,
  hexToRgba,
  saveToStorage,
  loadFromStorage,
  removeFromStorage,
  copyToClipboard,
  debounce,
  throttle,
};