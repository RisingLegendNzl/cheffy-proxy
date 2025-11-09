import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { BarChart3, Star, Heart } from 'lucide-react';

// An array defining the themes
const themes = [
  { id: 'data-driven', name: 'Data-Driven', icon: BarChart3 },
  { id: 'gamified', name: 'Gamified', icon: Star },
  { id: 'mindful', name: 'Mindful', icon: Heart },
];

/**
 * A component that allows the user to switch between available themes.
 * It uses the ThemeContext to get and set the active theme.
 */
export const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="p-4 bg-gray-100 rounded-lg">
      <label
        htmlFor="theme-select"
        className="block text-sm font-medium text-gray-700 mb-2"
      >
        Tracker Theme
      </label>
      
      {/* Segmented Control Style */}
      <div className="flex w-full rounded-md bg-gray-300 p-1">
        {themes.map((themeOption) => (
          <button
            key={themeOption.id}
            onClick={() => setTheme(themeOption.id)}
            className={`flex-1 flex items-center justify-center px-3 py-2 text-sm font-medium rounded ${
              theme === themeOption.id
                ? 'bg-white text-blue-600 shadow'
                : 'text-gray-600 hover:bg-gray-200'
            } transition-all duration-200`}
            aria-pressed={theme === themeOption.id}
          >
            <themeOption.icon size={16} className="mr-2" />
            {themeOption.name}
          </button>
        ))}
      </div>

      {/* Alternative: Dropdown Style (if you prefer) */}
      {/* <select
        id="theme-select"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {themes.map((themeOption) => (
          <option key={themeOption.id} value={themeOption.id}>
            {themeOption.name}
          </option>
        ))}
      </select>
      */}
    </div>
  );
};

