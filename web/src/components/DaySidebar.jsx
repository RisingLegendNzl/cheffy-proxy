// web/src/components/DaySidebar.jsx
import React from 'react';

const DaySidebar = ({ days, selectedDay, onSelect }) => (
    <div className="w-full md:w-56 flex md:flex-col overflow-x-auto">
        <h3 
            className="text-base font-bold text-gray-700 hidden md:block mb-4 pb-3 border-b tracking-tight" 
            style={{ borderColor: 'rgba(209, 213, 219, 0.6)' }}
        >
            Plan Days <span className="text-indigo-600 font-extrabold">({days})</span>
        </h3>
        <div className="flex md:flex-col gap-2.5 pb-2">
            {Array.from({ length: days }, (_, i) => i + 1).map(day => {
                const isSelected = day === selectedDay;
                return (
                    <button
                        key={day}
                        onClick={() => onSelect(day)}
                        className={`
                            px-6 py-2.5 text-sm font-semibold rounded-full
                            transition-all duration-300 ease-out whitespace-nowrap
                            ${isSelected 
                                ? 'text-white transform scale-105' 
                                : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 hover:border-indigo-300 shadow-sm hover:shadow-md hover:scale-105 hover:-translate-y-0.5 active:scale-100'
                            }
                        `}
                        style={isSelected ? {
                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25), 0 2px 4px rgba(99, 102, 241, 0.15)'
                        } : {}}
                    >
                        <span className="tracking-wide">
                            Day {day}
                        </span>
                    </button>
                );
            })}
        </div>
    </div>
);

export default DaySidebar;