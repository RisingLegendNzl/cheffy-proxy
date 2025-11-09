// web/src/components/ThemeSwitcher.jsx
import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { BarChart, Gem, Smile } from 'lucide-react'; // Using icons for a cleaner look

// This is a NAMED export
export const ThemeSwitcher = () => {
  const { activeTheme, setActiveTheme } = useTheme();

  const themes = [
    { name: 'data-driven', label: 'Data', icon: <BarChart size={16} /> },
    { name: 'gamified', label: 'Game', icon: <Gem size={16} /> },
    { name: 'mindful', label: 'Mindful', icon: <Smile size={16} /> },
  ];

  return (
    <div className="p-1 bg-gray-100 rounded-lg flex space-x-1">
      {themes.map((theme) => {
        const isActive = activeTheme === theme.name;
        return (
          <button
            key={theme.name}
            onClick={() => setActiveTheme(theme.name)}
            className={`
              flex-1 py-2 px-3 rounded-md text-sm font-medium
              flex items-center justify-center space-x-1.5
              transition-all duration-200
              ${
                isActive
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
              }
            `}
            aria-pressed={isActive}
          >
            {theme.icon}
            <span>{theme.label}</span>
          </button>
        );
      })}
    </div>
  );
};


