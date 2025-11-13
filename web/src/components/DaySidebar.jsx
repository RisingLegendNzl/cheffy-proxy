// web/src/components/DaySidebar.jsx
import React from 'react';

const DaySidebar = ({ days, selectedDay, onSelect }) => (
    <div className="w-full md:w-56 flex md:flex-col overflow-x-auto">
        <h3 
            className="text-lg font-bold text-gray-800 hidden md:block mb-4 pb-3 border-b-2 tracking-tight" 
            style={{ borderColor: 'rgba(99, 102, 241, 0.15)' }}
        >
            Plan Days <span className="text-indigo-600">({days})</span>
        </h3>
        <div className="flex md:flex-col space-x-2 md:space-x-0 md:space-y-2.5 pb-2">
            {Array.from({ length: days }, (_, i) => i + 1).map(day => {
                const isSelected = day === selectedDay;
                return (
                    <button
                        key={day}
                        onClick={() => onSelect(day)}
                        className={`
                            group relative px-5 py-3 text-sm font-semibold rounded-2xl 
                            transition-all duration-300 ease-out whitespace-nowrap
                            ${isSelected 
                                ? 'text-white shadow-lg scale-105' 
                                : 'text-gray-700 hover:text-gray-900 bg-white hover:bg-gradient-to-br hover:from-white hover:to-gray-50 border border-gray-200 hover:border-indigo-200 shadow-sm hover:shadow-md hover:scale-105 hover:-translate-y-0.5'
                            }
                        `}
                        style={isSelected ? {
                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                            boxShadow: '0 8px 16px rgba(99, 102, 241, 0.3), 0 2px 4px rgba(99, 102, 241, 0.2)'
                        } : {}}
                    >
                        {/* Gradient border overlay for selected state */}
                        {isSelected && (
                            <span 
                                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.2), transparent)',
                                    pointerEvents: 'none'
                                }}
                            />
                        )}
                        
                        {/* Subtle glow for active state */}
                        {isSelected && (
                            <span 
                                className="absolute inset-0 rounded-2xl blur-sm -z-10"
                                style={{
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    opacity: 0.4
                                }}
                            />
                        )}

                        <span className="relative z-10 tracking-wide">
                            Day {day}
                        </span>
                    </button>
                );
            })}
        </div>
    </div>
);

export default DaySidebar;