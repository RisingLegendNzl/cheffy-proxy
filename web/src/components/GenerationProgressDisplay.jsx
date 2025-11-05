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
    Loader,
    Circle, // Used for pending steps
} from 'lucide-react';

// --- Thematic Agent Mapping ---
// Translates technical log tags into "fun names" and icons for the live-ticker
const agentMap = {
    'LLM': { name: "Creative Chef", Icon: ChefHat, color: "text-purple-600" },
    'LLM_PROMPT': { name: "Creative Chef", Icon: ChefHat, color: "text-purple-600" },
    'LLM_CHEF': { name: "Creative Chef", Icon: ChefHat, color: "text-purple-600" },
    'MARKET_RUN': { name: "Smart Shopper", Icon: ShoppingBag, color: "text-orange-600" },
    'CHECKLIST': { name: "Smart Shopper", Icon: ShoppingBag, color: "text-orange-600" },
    'CALC': { name: "Nutritionist", Icon: Flame, color: "text-red-600" },
    'CANON': { name: "Librarian", Icon: BookOpen, color: "text-green-700" },
    'DATA': { name: "Librarian", Icon: BookOpen, color: "text-green-700" },
    'HTTP': { name: "Data Scout", Icon: Download, color: "text-blue-600" },
    'SWR_REFRESH': { name: "Data Scout", Icon: Download, color: "text-blue-600" },
    'SYSTEM': { name: "Orchestrator", Icon: Terminal, color: "text-gray-700" },
    'PHASE': { name: "Orchestrator", Icon: Terminal, color: "text-gray-700" },
    'TARGETS': { name: "Targeting", Icon: Target, color: "text-gray-700" },
    'default': { name: "AI Agent", Icon: Loader, color: "text-indigo-600" }
};

// --- Stepper Logic ---
// Defines the steps of the generation process
const STEPS = [
    {
        key: 'targets',
        title: 'Calculating Targets',
        description: 'Assessing your profile and goals.',
        Icon: Target,
    },
    {
        key: 'planning',
        title: 'Designing Your Meal Plan',
        description: 'The AI Chef is creating your daily meals.',
        Icon: ChefHat,
    },
    {
        key: 'market',
        title: 'Running the Market',
        description: 'Intelligently fetching real-time prices.',
        Icon: ShoppingBag,
    },
    {
        key: 'finalizing',
        title: 'Calculating Nutrition & Finalizing',
        description: 'Assembling the dashboard and data.',
        Icon: Flame,
    },
];

/**
 * Determines the current active step based on generation status and logs.
 * @param {string} status - The high-level generationStatus string.
 * @param {object} latestLog - The most recent log object from the SSE stream.
 * @returns {string} The key of the current active step (e.g., 'targets', 'planning').
 */
const getActiveStep = (status, latestLog) => {
    const logTag = latestLog?.tag || null;

    if (status === 'Calculating nutritional targets...') {
        return 'targets';
    }

    if (status.startsWith('Generating plan for Day')) {
        // We are in the main generation loop
        if (logTag === 'MARKET_RUN' || logTag === 'CHECKLIST' || logTag === 'HTTP') {
            return 'market';
        }
        if (logTag === 'CALC') {
            return 'finalizing';
        }
        // Default to 'planning' if the tag is for the LLM or system
        return 'planning';
    }

    // Default to the first step if status is 'Initializing...' or unknown
    return 'targets';
};

/**
 * Renders a single step in the "Live Stepper".
 */
const Step = ({ step, state, agentName, liveMessage }) => {
    let IconComponent;
    let iconColor;
    let titleColor = 'text-gray-500';
    let descriptionColor = 'text-gray-400';
    let isSpinning = false;

    switch (state) {
        case 'complete':
            IconComponent = CheckCircle;
            iconColor = 'text-green-500 bg-green-100';
            titleColor = 'text-gray-900';
            descriptionColor = 'text-gray-500';
            break;
        case 'active':
            IconComponent = Loader; // Always show Loader for the active step
            iconColor = 'text-indigo-600 bg-indigo-100';
            titleColor = 'text-indigo-700 font-bold';
            descriptionColor = 'text-indigo-700'; // Will be replaced by live ticker
            isSpinning = true;
            break;
        case 'pending':
        default:
            IconComponent = step.Icon || Circle;
            iconColor = 'text-gray-400 bg-gray-100';
            break;
    }

    return (
        <div className="flex space-x-4">
            {/* Icon */}
            <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${iconColor}`}>
                <IconComponent className={`w-6 h-6 ${isSpinning ? 'animate-spin' : ''}`} />
            </div>
            {/* Text Content */}
            <div className="flex-1 pt-1">
                <h4 className={`text-lg font-semibold ${titleColor}`}>{step.title}</h4>
                {/* Show live-ticker if active, otherwise show default description */}
                {state === 'active' ? (
                    <div className="mt-1">
                        <p className={`text-sm font-bold ${agentName.color}`}>{agentName.name}</p>
                        <p className="text-sm text-gray-600 font-mono truncate" title={liveMessage}>
                            {liveMessage}
                        </p>
                    </div>
                ) : (
                    <p className={`text-sm ${descriptionColor}`}>{step.description}</p>
                )}
            </div>
        </div>
    );
};

/**
 * A "live-stepper" dashboard for generation progress, inspired by the user's image.
 */
const GenerationProgressDisplay = ({
    status,
    error,
    latestLog,
}) => {
    // 1. Determine overall state
    const isError = !!error;
    const isComplete = status === 'Plan generation finished.';
    const isRunning = !isError && !isComplete;

    // 2. Find the active step
    const activeStepKey = isRunning ? getActiveStep(status, latestLog) : null;
    const activeStepIndex = STEPS.findIndex(s => s.key === activeStepKey);

    // 3. Determine live-ticker content
    const agent = agentMap[latestLog?.tag || 'default'] || agentMap['default'];
    const liveMessage = latestLog?.message || status || 'Initializing...';

    return (
        <div className="w-full p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl shadow-lg border border-indigo-100 overflow-hidden">
            
            {/* Title */}
            <h3 className="text-2xl font-bold text-indigo-800 text-center mb-6 font-poppins">
                {isError ? "An Error Occurred" : isComplete ? "Plan Generation Complete!" : "Your Personal Chef is Working..."}
            </h3>

            {/* State 1: ERROR */}
            {isError && (
                <div className="flex flex-col items-center text-center p-4">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center bg-red-100">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                    <p className="text-gray-700 mt-4 font-mono text-sm break-words">{error}</p>
                </div>
            )}

            {/* State 2: COMPLETE */}
            {isComplete && (
                <div className="flex flex-col items-center text-center p-4">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center bg-green-100">
                        <CheckCircle className="w-8 h-8 text-green-500" />
                    </div>
                    <p className="text-gray-600 mt-4">Your plan is ready. You can now view your meals and ingredients.</p>
                </div>
            )}

            {/* State 3: RUNNING (The Live Stepper) */}
            {isRunning && (
                <div className="space-y-6">
                    {STEPS.map((step, index) => {
                        let state = 'pending';
                        if (index < activeStepIndex) {
                            state = 'complete';
                        } else if (index === activeStepIndex) {
                            state = 'active';
                        }
                        
                        return (
                            <Step
                                key={step.key}
                                step={step}
                                state={state}
                                agentName={agent}
                                liveMessage={liveMessage}
                            />
                        );
                    })}
                    <p className="text-center text-sm text-indigo-500 font-medium pt-4 border-t border-indigo-100">
                        Please wait, this can take up to a minute...
                    </p>
                </div>
            )}
        </div>
    );
};

export default GenerationProgressDisplay;


