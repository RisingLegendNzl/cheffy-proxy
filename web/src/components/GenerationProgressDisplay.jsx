// web/src/components/GenerationProgressDisplay.jsx
import React from 'react';
import {
    ChefHat,
    Target,
    CheckCircle,
    AlertTriangle,
    ShoppingBag,
    BookOpen,
    Flame,
    Download,
    Terminal,
    Loader
} from 'lucide-react';

/**
 * Maps a log tag to a thematic icon.
 * This function determines which icon to show based on the AI's current task.
 * @param {string | undefined} tag - The log tag (e.g., "MARKET_RUN", "LLM").
 * @returns {import('lucide-react').LucideIcon} - The corresponding Lucide icon component.
 */
const getThematicIcon = (tag) => {
    switch (tag) {
        case 'LLM':
        case 'LLM_PROMPT':
        case 'LLM_CHEF':
            return ChefHat; // AI is "thinking" or writing
        case 'MARKET_RUN':
        case 'CHECKLIST':
            return ShoppingBag; // AI is "shopping" for products
        case 'HTTP':
        case 'SWR_REFRESH':
            return Download; // Fetching from an external API
        case 'CALC':
            return Flame; // "Calculating" macros
        case 'CANON':
        case 'DATA':
            return BookOpen; // "Researching" the canonical database
        case 'SYSTEM':
        case 'PHASE':
            return Terminal; // General system messages
        case 'TARGETS':
            return Target; // Initial target calculation
        default:
            return Loader; // Default/loading state
    }
};

/**
 * A live "dashboard" that displays generation progress.
 * It consumes the SSE stream's latest log to show real-time activity.
 */
const GenerationProgressDisplay = ({
    status,
    error,
    latestLog,
    completedDays,
    totalDays
}) => {
    // 1. Determine overall state
    const isError = !!error;
    const isComplete = status === 'Plan generation finished.';
    const isRunning = !isError && !isComplete;

    // 2. Determine the main icon based on the *overall* state
    let MainIcon, mainIconProps, mainIconColor;

    if (isError) {
        MainIcon = AlertTriangle;
        mainIconColor = 'text-red-400';
    } else if (isComplete) {
        MainIcon = CheckCircle;
        mainIconColor = 'text-green-400';
    } else {
        // If running, the icon is *thematic* based on the latest log
        MainIcon = getThematicIcon(latestLog?.tag || (status === 'Calculating nutritional targets...' ? 'TARGETS' : 'SYSTEM'));
        mainIconColor = 'text-indigo-400 animate-pulse'; // Pulse while running
    }

    // 3. Determine the "live-ticker" text
    // Use the latest log message, but fall back to the main status if no log is present yet
    const liveTag = latestLog?.tag || (status === 'Calculating nutritional targets...' ? 'TARGETS' : 'SYSTEM');
    const liveMessage = latestLog?.message || status || 'Initializing...';

    // 4. Ensure totalDays is a valid number for the segmented bar
    const validTotalDays = Math.max(1, totalDays || 0);

    return (
        <div className="w-full p-6 bg-gray-900 rounded-xl shadow-2xl border border-indigo-800/50 text-white">

            {/* Header: Main Status */}
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white">
                    {status}
                </h3>
                {isError && (
                    <span className="px-3 py-1 text-sm font-bold bg-red-900 text-red-300 rounded-full">Failed</span>
                )}
                {isComplete && (
                    <span className="px-3 py-1 text-sm font-bold bg-green-900 text-green-300 rounded-full">Complete</span>
                )}
            </div>

            {/* Segmented Progress Bar: Shows day-by-day completion */}
            {!isError && (
                <div className="flex space-x-1 mb-6" title={`Day ${completedDays} of ${validTotalDays} complete`}>
                    {Array.from({ length: validTotalDays }, (_, i) => i).map((dayIndex) => {
                        const isDayComplete = dayIndex < completedDays;
                        return (
                            <div
                                key={dayIndex}
                                className={`h-2 flex-1 rounded-full transition-all duration-500 ${isDayComplete ? 'bg-green-500' : 'bg-gray-700'}`}
                            ></div>
                        );
                    })}
                </div>
            )}

            {/* Live Activity Feed: Shows the real-time log activity */}
            <div className="flex items-start space-x-4 min-h-[60px] p-4 bg-gray-800/70 rounded-lg">
                {/* Left: Dynamic Icon */}
                <div className={`flex-shrink-0 p-3 bg-gray-900 rounded-lg shadow-inner ${mainIconColor}`}>
                    <MainIcon size={32} />
                </div>

                {/* Right: Live Ticker Text */}
                <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-bold text-indigo-400 uppercase">
                        {isError ? 'ERROR' : (isComplete ? 'FINISHED' : liveTag)}
                    </p>
                    <p className="text-sm text-gray-300 font-mono truncate" title={isError ? error : liveMessage}>
                        {isError ? error : liveMessage}
                    </p>
                </div>
            </div>

            {/* Error Display (Only shows on critical failure in the main 'status' prop) */}
            {isError && error && (
                <div className="w-full p-3 bg-red-900/50 text-red-300 rounded-lg mt-4 font-mono text-sm">
                    <p className="font-bold">A critical error stopped the generation:</p>
                    <p className="mt-1">{error}</p>
                </div>
            )}
        </div>
    );
};

export default GenerationProgressDisplay;

