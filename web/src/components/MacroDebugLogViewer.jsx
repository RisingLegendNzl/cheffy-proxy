// web/src/components/MacroDebugLogViewer.jsx
import React, { useState } from 'react';
import { Target, Download, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * MacroDebugLogViewer - Displays macro debug data from plan generation
 * Shows per-day, per-meal breakdown of macro calculations
 * 
 * @param {object} macroDebug - The macro debug object from plan generation (default: {})
 * @param {function} onDownload - Handler to download macro debug as JSON (default: () => {})
 */
const MacroDebugLogViewer = ({ 
    macroDebug = {}, 
    onDownload = () => {} 
}) => {
    const [isOpen, setIsOpen] = useState(true);

    // Determine if we have any data to display
    const hasData = macroDebug && typeof macroDebug === 'object' && Object.keys(macroDebug).length > 0;

    // Don't render if no data
    if (!hasData) {
        return null;
    }

    /**
     * Renders a single day's macro debug data
     */
    const renderDayDebug = (dayKey, dayData) => {
        if (!dayData || typeof dayData !== 'object') return null;

        return (
            <div key={dayKey} className="mb-4 border-b border-teal-700/50 pb-3">
                <h4 className="font-bold text-teal-100 mb-2 text-sm">
                    📅 {dayKey}
                </h4>
                
                {/* Render targets if present */}
                {dayData.targets && (
                    <div className="mb-2 pl-3">
                        <p className="text-teal-300 text-xs font-semibold">Targets:</p>
                        <pre className="text-teal-200 text-xs bg-black/20 p-1 rounded mt-1">
                            {JSON.stringify(dayData.targets, null, 2)}
                        </pre>
                    </div>
                )}

                {/* Render meals if present */}
                {dayData.meals && Array.isArray(dayData.meals) && (
                    <div className="pl-3">
                        <p className="text-teal-300 text-xs font-semibold mb-1">Meals:</p>
                        {dayData.meals.map((meal, mealIndex) => (
                            <div key={mealIndex} className="mb-2 pl-2 border-l-2 border-teal-600/50">
                                <p className="text-teal-100 text-xs font-medium">
                                    {meal.name || `Meal ${mealIndex + 1}`}
                                </p>
                                {meal.macros && (
                                    <div className="text-teal-200 text-xs mt-1 grid grid-cols-4 gap-1">
                                        <span>Cal: {meal.macros.calories || 0}</span>
                                        <span>P: {meal.macros.protein || 0}g</span>
                                        <span>F: {meal.macros.fat || 0}g</span>
                                        <span>C: {meal.macros.carbs || 0}g</span>
                                    </div>
                                )}
                                {meal.adjustments && (
                                    <pre className="text-yellow-200 text-xs bg-yellow-900/30 p-1 rounded mt-1">
                                        Adjustments: {JSON.stringify(meal.adjustments, null, 2)}
                                    </pre>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Render totals if present */}
                {dayData.totals && (
                    <div className="pl-3 mt-2">
                        <p className="text-teal-300 text-xs font-semibold">Day Totals:</p>
                        <div className="text-teal-100 text-xs mt-1 grid grid-cols-4 gap-1 bg-teal-800/50 p-1 rounded">
                            <span>Cal: {dayData.totals.calories || 0}</span>
                            <span>P: {dayData.totals.protein || 0}g</span>
                            <span>F: {dayData.totals.fat || 0}g</span>
                            <span>C: {dayData.totals.carbs || 0}g</span>
                        </div>
                    </div>
                )}

                {/* Render variance/delta if present */}
                {dayData.variance && (
                    <div className="pl-3 mt-2">
                        <p className="text-yellow-300 text-xs font-semibold">Variance from Target:</p>
                        <div className="text-yellow-100 text-xs mt-1 grid grid-cols-4 gap-1 bg-yellow-900/30 p-1 rounded">
                            <span>Cal: {dayData.variance.calories > 0 ? '+' : ''}{dayData.variance.calories || 0}</span>
                            <span>P: {dayData.variance.protein > 0 ? '+' : ''}{dayData.variance.protein || 0}g</span>
                            <span>F: {dayData.variance.fat > 0 ? '+' : ''}{dayData.variance.fat || 0}g</span>
                            <span>C: {dayData.variance.carbs > 0 ? '+' : ''}{dayData.variance.carbs || 0}g</span>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    /**
     * Renders the macro debug data in a structured format
     * Handles various possible structures of the macroDebug object
     */
    const renderMacroDebugContent = () => {
        // If macroDebug has a 'days' array structure
        if (macroDebug.days && Array.isArray(macroDebug.days)) {
            return macroDebug.days.map((dayData, index) => 
                renderDayDebug(`Day ${index + 1}`, dayData)
            );
        }

        // If macroDebug has day keys like 'day1', 'day2', etc.
        const dayKeys = Object.keys(macroDebug).filter(key => 
            key.toLowerCase().startsWith('day') || 
            key.match(/^d\d+$/) ||
            key.match(/^\d+$/)
        ).sort();

        if (dayKeys.length > 0) {
            return dayKeys.map(dayKey => 
                renderDayDebug(dayKey, macroDebug[dayKey])
            );
        }

        // If macroDebug has a 'summary' or 'overview' at root level, show it
        if (macroDebug.summary || macroDebug.overview || macroDebug.planSummary) {
            const summary = macroDebug.summary || macroDebug.overview || macroDebug.planSummary;
            return (
                <div className="mb-4">
                    <h4 className="font-bold text-teal-100 mb-2 text-sm">📊 Plan Summary</h4>
                    <pre className="text-teal-200 text-xs bg-black/20 p-2 rounded whitespace-pre-wrap">
                        {JSON.stringify(summary, null, 2)}
                    </pre>
                </div>
            );
        }

        // Fallback: just render the entire object as JSON
        return (
            <div className="mb-4">
                <h4 className="font-bold text-teal-100 mb-2 text-sm">📋 Raw Debug Data</h4>
                <pre className="text-teal-200 text-xs bg-black/20 p-2 rounded whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(macroDebug, null, 2)}
                </pre>
            </div>
        );
    };

    return (
        <div className="w-full bg-teal-900/95 text-teal-100 font-mono text-xs shadow-inner border-t-2 border-teal-700">
            {/* Header */}
            <div className="p-3 bg-teal-800/90 border-b border-teal-700 flex items-center justify-between">
                <div className="flex items-center">
                    <Target className="w-5 h-5 mr-3 text-teal-300" />
                    <h3 className="font-bold">Macro Debug Log</h3>
                </div>
                <div className="flex items-center space-x-4">
                    <button 
                        onClick={onDownload} 
                        className="flex items-center px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold" 
                        title="Download Macro Debug as JSON"
                    >
                        <Download size={14} className="mr-1" /> Download
                    </button>
                    <button 
                        onClick={() => setIsOpen(!isOpen)} 
                        className="text-teal-300 hover:text-white"
                    >
                        {isOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                    </button>
                </div>
            </div>

            {/* Content */}
            {isOpen && (
                <div className="max-h-80 overflow-y-auto p-3">
                    {renderMacroDebugContent()}
                </div>
            )}
        </div>
    );
};

export default MacroDebugLogViewer;