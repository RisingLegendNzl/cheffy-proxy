import React, { createContext, useState, useContext, useMemo } from 'react';

// Define the available theme names
export const THEME_OPTIONS = {
  DATA: 'data-driven',
  GAME: 'gamified',
  MINDFUL: 'mindful',
};

// Create the context
const ThemeContext = createContext(null);

/**
 * This provider component wraps your entire application.
 * It holds the state for the current theme and provides a
 * function to update it.
 */
export const ThemeProvider = ({ children }) => {
  const [activeTheme, setActiveTheme] = useState(THEME_OPTIONS.DATA); // Default theme

  // Use useMemo to prevent unnecessary re-renders of consuming components
  // This ensures the context value object is stable
  const value = useMemo(() => ({
    activeTheme,
    setActiveTheme,
  }), [activeTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * This is the custom hook we'll use in our components.
 * It gives us easy access to the current theme and the
 * function to change it.
 *
 * e.g., const { activeTheme, setActiveTheme } = useTheme();
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

