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

// --- [NEW] Thematic Agent Mapping ---
// This map translates technical log tags into "fun names" and icons.
const agentMap = {
    // LLM Tags
    'LLM': { name: "The Creative Chef", Icon: ChefHat, color: "text-purple-600" },
    'LLM_PROMPT': { name: "The Creative Chef", Icon: ChefHat, color: "text-purple-600" },
    'LLM_CHEF': { name: "The Creative Chef", Icon: ChefHat, color: "text-purple-600" },
    // Market/Shopping Tags
    'MARKET_RUN': { name: "The Smart Shopper", Icon: ShoppingBag, color: "text-orange-600" },
    'CHECKLIST': { name: "The Smart Shopper", Icon: ShoppingBag, color: "text-orange-600" },
    // Calculation Tags
    'CALC': { name: "The Nutritionist", Icon: Flame, color: "text-red-600" },
    // Data/API Tags
    'CANON': { name: "The Librarian", Icon: BookOpen, color: "text-green-700" },
    'DATA': { name: "The Librarian", Icon: BookOpen, color: "text-green-700" },
    'HTTP': { name: "The Data Scout", Icon: Download, color: "text-blue-600" },
    'SWR_REFRESH': { name: "The Data Scout", Icon: Download, color: "text-blue-600" },
    // System Tags
    'SYSTEM': { name: "The Orchestrator", Icon: Terminal, color: "text-gray-700" },
    'PHASE': { name: "The Orchestrator", Icon: Terminal, color: "text-gray-700" },
    'TARGETS': { name: "The Orchestrator", Icon: Target, color: "text-gray-700" },
    // Default Fallback
    'default': { name: "AI Agent", Icon: Loader, color: "text-indigo-600" }
};
// --- [END] Thematic Agent Mapping ---

/**
 * A "live-ticker" dashboard for generation progress.
 * It has three states: Running, Complete, or Error.
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

    // 2. Determine thematic content for the "Running" state
    let agent = agentMap['default'];
    let message = status || 'Initializing...';
    let pulseClass = 'animate-spin'; // Default to spinning loader

    if (isRunning) {
        // Get the "fun name" and icon from the latest log
        const tag = latestLog?.tag || (status === 'Calculating nutritional targets...' ? 'TARGETS' : 'SYSTEM');
        agent = agentMap[tag] || agentMap['default'];
        message = latestLog?.message || message;
        
        // Use a "pulse" for agents, but "spin" for the default loader
        pulseClass = agent.Icon === Loader ? 'animate-spin' : 'animate-pulse';
    }

    // 3. Ensure totalDays is a valid number for the segmented bar
    const validTotalDays = Math.max(1, totalDays || 0);
    const { Icon, name, color } = agent;

    return (
        <div className="w-full p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl shadow-lg border border-indigo-100 overflow-hidden">

            {/* State 1: ERROR */}
            {isError && (
                <div className="flex flex-col items-center text-center p-4">
                    <AlertTriangle className="w-12 h-12 text-red-500" />
                    <h3 className="text-xl font-bold text-red-700 mt-4">Generation Failed</h3>
                    <p className="text-gray-700 mt-2 font-mono text-sm break-words">{error}</p>
                </div>
            )}

            {/* State 2: COMPLETE */}
            {isComplete && (
                <div className="flex flex-col items-center text-center p-4">
                    <CheckCircle className="w-12 h-12 text-green-500" />
                    <h3 className="text-xl font-bold text-green-700 mt-4">Plan Generation Finished!</h3>
                    <p className="text-gray-600 mt-2">Your plan is ready. You can now view your meals and ingredients.</p>
                </div>
            )}

            {/* State 3: RUNNING */}
            {isRunning && (
                <>
                    {/* Main Title (e.g., "Planning Day 1/7") */}
                    <h3 className="text-xl font-bold text-indigo-700 mb-4">{status}</h3>

                    {/* Segmented Day Bar */}
                    <div className="flex space-x-1 mb-6" title={`Day ${completedDays} of ${validTotalDays} complete`}>
                        {Array.from({ length: validTotalDays }, (_, i) => (
                            <div
                                key={i}
                                className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                                    i < completedDays ? 'bg-indigo-600' : 'bg-gray-200'
                                }`}
                            ></div>
                        ))}
                    </div>

                    {/* Live-Ticker Area */}
                    <div className="flex items-start space-x-4">
                        {/* Left: Animated Icon */}
                        <div className={`flex-shrink-0 p-3 bg-white rounded-full shadow-lg ${pulseClass} ${color}`}>
                            {/* The icon itself changes based on the 'agent.Icon' */}
                            <Icon className={`w-8 h-8 transition-all`} />
                        </div>
                        {/* Right: Text Stack (The "Ticker") */}
                        <div className="flex-1 overflow-hidden pt-1">
                            <p className="text-sm font-bold text-gray-500 uppercase">AI AGENT</p>
                            <p className={`text-lg font-bold ${color}`}>{name}</p>
                            <p className="text-sm text-gray-600 font-mono truncate" title={message}>
                                {message}
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default GenerationProgressDisplay;


