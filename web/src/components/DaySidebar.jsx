// web/src/components/DaySidebar.jsx
import React from 'react';
import { Calendar } from 'lucide-react';
import { COLORS } from '../constants';

const DaySidebar = ({ days, selectedDay, onSelect }) => {
    const isSingleDay = days === 1;
    
    return (
        <div className={`w-full ${isSingleDay ? 'md:w-auto' : 'md:w-64'}`}>
            {/* Header - hide for single day */}
            {!isSingleDay && (
                <div className="hidden md:flex items-center mb-3 pb-2 border-b" style={{ borderColor: COLORS.gray[200] }}>
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
            <div className={`flex md:flex-col gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 scroll-smooth snap-x snap-mandatory md:snap-none ${isSingleDay ? 'justify-center' : ''}`}>
                {Array.from({ length: days }, (_, i) => i + 1).map(day => {
                    const isSelected = day === selectedDay;
                    
                    return (
                        <button
                            key={day}
                            onClick={() => onSelect(day)}
                            className={`
                                flex-shrink-0 snap-center
                                flex items-center justify-center
                                font-semibold
                                transition-all duration-300 ease-out
                                whitespace-nowrap
                                backdrop-blur-sm
                                ${isSelected 
                                    ? 'px-6 py-3 text-white transform scale-105 shadow-lg' 
                                    : 'px-5 py-2.5 border transform hover:scale-103 active:scale-98 hover:shadow-md'
                                }
                            `}
                            style={{
                                background: isSelected
                                    ? `linear-gradient(135deg, ${COLORS.primary[600]} 0%, ${COLORS.secondary[600]} 100%)`
                                    : 'rgba(255, 255, 255, 0.8)',
                                borderColor: isSelected ? 'transparent' : COLORS.gray[200],
                                color: isSelected ? 'white' : COLORS.gray[700],
                                fontWeight: isSelected ? '700' : '600',
                                minWidth: isSingleDay ? 'auto' : '120px',
                                borderRadius: '16px',
                                boxShadow: isSelected 
                                    ? `0 8px 16px -4px ${COLORS.primary[500]}40, 0 4px 8px -2px ${COLORS.primary[600]}30`
                                    : '0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                            }}
                            onMouseEnter={(e) => {
                                if (!isSelected) {
                                    e.currentTarget.style.background = `linear-gradient(135deg, ${COLORS.primary[50]} 0%, ${COLORS.secondary[50]} 100%)`;
                                    e.currentTarget.style.borderColor = COLORS.primary[200];
                                    e.currentTarget.style.color = COLORS.primary[700];
                                    e.currentTarget.style.backdropFilter = 'blur(8px)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isSelected) {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)';
                                    e.currentTarget.style.borderColor = COLORS.gray[200];
                                    e.currentTarget.style.color = COLORS.gray[700];
                                    e.currentTarget.style.backdropFilter = 'blur(4px)';
                                }
                            }}
                        >
                            {/* Subtle glow effect for selected state */}
                            {isSelected && (
                                <div 
                                    className="absolute inset-0 rounded-[16px] opacity-50 blur-md"
                                    style={{
                                        background: `linear-gradient(135deg, ${COLORS.primary[400]} 0%, ${COLORS.secondary[400]} 100%)`,
                                        zIndex: -1,
                                    }}
                                />
                            )}
                            
                            {/* Day Label */}
                            <span className="flex items-center gap-2 relative">
                                <span className={`text-xs uppercase tracking-wide ${isSelected ? 'opacity-90' : 'opacity-60'}`}>
                                    Day
                                </span>
                                <span className={isSelected ? 'text-xl' : 'text-lg'}>
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
                                    boxShadow: day === selectedDay 
                                        ? `0 2px 6px ${COLORS.primary[500]}40`
                                        : 'none',
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
                
                button {
                    position: relative;
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