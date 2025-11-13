// web/src/components/DaySidebar.jsx
import React from 'react';

const DaySidebar = ({ days, selectedDay, onSelect }) => (
    <div className="w-full md:w-auto">
        {/* Title - Desktop only, minimal and refined */}
        <div className="hidden md:block mb-5">
            <p className="text-xs uppercase tracking-widest font-semibold text-gray-400 mb-1">
                Your Plan
            </p>
            <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-gray-900">{days}</span>
                <span className="text-sm font-medium text-gray-500">Days</span>
            </div>
        </div>

        {/* Day Pills - Clean and Premium */}
        <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-2 md:pb-0 scrollbar-hide">
            {Array.from({ length: days }, (_, i) => i + 1).map(day => {
                const isSelected = day === selectedDay;
                return (
                    <button
                        key={day}
                        onClick={() => onSelect(day)}
                        className={`
                            relative flex-shrink-0 min-w-[80px] md:min-w-0 md:w-full
                            px-5 py-3 rounded-2xl font-semibold text-sm
                            transition-all duration-300 ease-out
                            ${isSelected 
                                ? 'text-white shadow-lg' 
                                : 'text-gray-600 bg-white/80 backdrop-blur-sm border border-gray-200/60 hover:border-indigo-200 hover:bg-white hover:text-gray-900 hover:shadow-md active:scale-95'
                            }
                        `}
                        style={isSelected ? {
                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                            boxShadow: '0 8px 20px -4px rgba(99, 102, 241, 0.35), 0 4px 8px -2px rgba(99, 102, 241, 0.2)',
                            transform: 'translateY(-2px)'
                        } : {}}
                    >
                        {/* Content */}
                        <div className="flex items-center justify-center gap-2">
                            <span className="font-bold">Day</span>
                            <span className={`text-base font-extrabold ${isSelected ? 'text-white' : 'text-indigo-600'}`}>
                                {day}
                            </span>
                        </div>

                        {/* Subtle shine effect on selected */}
                        {isSelected && (
                            <div 
                                className="absolute inset-0 rounded-2xl opacity-20 pointer-events-none"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, transparent 50%, rgba(255,255,255,0.3) 100%)'
                                }}
                            />
                        )}
                    </button>
                );
            })}
        </div>

        {/* Subtle divider for desktop */}
        <div className="hidden md:block mt-5 pt-5 border-t border-gray-100" />
    </div>
);

export default DaySidebar;