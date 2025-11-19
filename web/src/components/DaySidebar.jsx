// web/src/components/DaySidebar.jsx
import React from 'react';
import { Calendar } from 'lucide-react';
import { COLORS } from '../constants';

const DaySidebar = ({ days, selectedDay, onSelect }) => {
    const isSingleDay = days === 1;
    
    return (
        <div className={`w-full ${isSingleDay ? 'md:w-auto' : 'md:w-64'} bg-white md:rounded-2xl md:border md:p-5 overflow-hidden`} style={{ borderColor: COLORS.gray[200] }}>
            {/* Header - hide for single day */}
            {!isSingleDay && (
                <div className="hidden md:flex items-center mb-4 pb-3 border-b" style={{ borderColor: COLORS.gray[200] }}>
                    <Calendar size={18} className="mr-2" style={{ color: COLORS.primary[600] }} />
                    <h3 
                        className="text-xs uppercase tracking-wider font-semibold"
                        style={{ color: COLORS.gray[600] }}
                    >
                        Plan Days ({days})
                    </h3>
                </div>
            )}

            {/* Day Pills Container */}
            <div className={`flex md:flex-col gap-3 overflow-x-auto md:overflow-visible pb-3 md:pb-0 px-2 md:px-0 scroll-smooth snap-x snap-mandatory md:snap-none ${isSingleDay ? 'justify-center' : ''}`}>
                {Array.from({ length: days }, (_, i) => i + 1).map(day => {
                    const isSelected = day === selectedDay;
                    
                    return (
                        <button
                            key={day}
                            onClick={() => onSelect(day)}
                            className={`
                                relative flex-shrink-0 snap-center
                                flex items-center justify-center
                                font-semibold rounded-xl
                                transition-all duration-300 ease-out
                                whitespace-nowrap
                                ${isSelected 
                                    ? 'px-6 py-4 text-white transform scale-105' 
                                    : 'px-5 py-3 border transform hover:scale-103 active:scale-98'
                                }
                            `}
                            style={{
                                background: isSelected
                                    ? `linear-gradient(135deg, ${COLORS.primary[600]} 0%, ${COLORS.secondary[600]} 100%)`
                                    : 'white',
                                borderColor: isSelected ? 'transparent' : COLORS.gray[200],
                                color: isSelected ? 'white' : COLORS.gray[700],
                                fontWeight: isSelected ? '700' : '600',
                                minWidth: isSingleDay ? 'auto' : '120px',
                            }}
                            onMouseEnter={(e) => {
                                if (!isSelected) {
                                    e.currentTarget.style.backgroundColor = COLORS.primary[50];
                                    e.currentTarget.style.borderColor = COLORS.primary[200];
                                    e.currentTarget.style.color = COLORS.primary[700];
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isSelected) {
                                    e.currentTarget.style.backgroundColor = 'white';
                                    e.currentTarget.style.borderColor = COLORS.gray[200];
                                    e.currentTarget.style.color = COLORS.gray[700];
                                }
                            }}
                        >
                            {/* Day Label */}
                            <span className="flex items-center gap-2">
                                <span className={`text-xs uppercase tracking-wide ${isSelected ? 'opacity-90' : 'opacity-60'}`}>
                                    Day
                                </span>
                                <span className={isSelected ? 'text-2xl' : 'text-xl'}>
                                    {day}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Scroll Hint for Mobile - hide for single day */}
            {!isSingleDay && days <= 7 && (
                <div className="md:hidden flex justify-center mt-2 gap-1">
                    {Array.from({ length: days }, (_, i) => {
                        const day = i + 1;
                        return (
                            <div
                                key={day}
                                className="w-1.5 h-1.5 rounded-full transition-all duration-200"
                                style={{
                                    backgroundColor: day === selectedDay 
                                        ? COLORS.primary[600]
                                        : COLORS.gray[300],
                                    transform: day === selectedDay ? 'scale(1.3)' : 'scale(1)',
                                }}
                            />
                        );
                    })}
                </div>
            )}

            {/* CSS for transitions and reduced motion */}
            <style jsx>{`
                @media (prefers-reduced-motion: reduce) {
                    button {
                        transition: none !important;
                    }
                }
                
                button:active {
                    transform: scale(0.98) !important;
                }
                
                .hover\\:scale-103:hover {
                    transform: scale(1.03);
                }
                
                .active\\:scale-98:active {
                    transform: scale(0.98);
                }
            `}</style>
        </div>
    );
};

export default DaySidebar;