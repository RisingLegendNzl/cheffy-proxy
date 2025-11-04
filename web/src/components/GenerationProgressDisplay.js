// web/src/components/GenerationProgressDisplay.js
import React from 'react';
import { ChefHat, Target, CheckCircle, AlertTriangle } from 'lucide-react';

// --- START: MODIFIED GenerationProgressDisplay ---
const GenerationProgressDisplay = ({ status, error }) => { // Removed progress prop
    // 1. Determine the current stage
    // -1: error, 0: init, 1: targets, 2: planning, 3: complete
    let currentStage = 0; 
    
    if (error) {
        currentStage = -1;
    } else if (status === 'Initializing...') {
        currentStage = 0;
    } else if (status === 'Calculating nutritional targets...') {
        currentStage = 1;
    } else if (status.startsWith('Generating plan for Day')) {
        currentStage = 2;
    } else if (status === 'Plan generation finished.') {
        currentStage = 3;
    }

    // 2. Determine Main Icon
    let MainIconComponent = ChefHat;
    let mainIconProps = { size: 64, className: "text-indigo-600 opacity-50" }; // Default for init

    if (currentStage === 1) { // Targets
        MainIconComponent = Target;
        mainIconProps = { size: 64, className: "text-indigo-600 animate-pulse" };
    } else if (currentStage === 2) { // Planning
        MainIconComponent = ChefHat;
        mainIconProps = { size: 64, className: "text-indigo-600 animate-pulse" };
    } else if (currentStage === 3) { // Complete
        MainIconComponent = CheckCircle;
        mainIconProps = { size: 64, className: "text-green-600" };
    } else if (currentStage === -1) { // Error
        MainIconComponent = AlertTriangle;
        mainIconProps = { size: 64, className: "text-red-600" };
    } else if (currentStage === 0) { // Init
         MainIconComponent = ChefHat;
         mainIconProps = { size: 64, className: "text-indigo-600 animate-pulse" }; // Also pulse for init
    }
    
    const MainIcon = MainIconComponent;

    // 3. Determine Timeline Icon States
    const getTimelineIcon = (stageName, StageIcon, stageNumber) => {
        let iconClassName = "w-8 h-8 text-gray-400"; // Default: pending
        let textClassName = "text-gray-500";
        let wrapperClassName = "bg-gray-100";
        let connectorClassName = "bg-gray-300";

        if (currentStage === -1) { // Error State
             iconClassName = "w-8 h-8 text-red-400";
             textClassName = "text-red-500";
             wrapperClassName = "bg-red-50";
             connectorClassName = "bg-red-300";
        } else if (currentStage > stageNumber) { // Completed
            iconClassName = "w-8 h-8 text-green-600";
            textClassName = "text-green-700";
            wrapperClassName = "bg-green-100";
            connectorClassName = "bg-green-500";
        } else if (currentStage === stageNumber) { // Active
            iconClassName = "w-10 h-10 text-indigo-600 animate-pulse";
            textClassName = "text-indigo-700 font-bold";
            wrapperClassName = "bg-indigo-100 shadow-lg";
            connectorClassName = "bg-gray-300"; // Connector before active is still gray
        }
        
        // Special override for "Complete" stage text when active
        if (stageName === "Complete" && currentStage === stageNumber) {
             textClassName = "text-green-700 font-bold";
        }
        // Special override for "Failed" text
        if (stageName === "Complete" && currentStage === -1) {
            stageName = "Failed";
        }

        return {
            Icon: currentStage === -1 && stageName !== "Failed" ? AlertTriangle : StageIcon,
            iconClassName,
            textClassName,
            wrapperClassName,
            connectorClassName, // This will be used for the *previous* connector
            stageName
        };
    };

    const targetState = getTimelineIcon("Targets", Target, 1);
    const planningState = getTimelineIcon("Planning", ChefHat, 2);
    const completeState = getTimelineIcon("Complete", CheckCircle, 3);
    
    // Connectors take the state of the *preceding* icon
    const connector1State = (currentStage > 1 || currentStage === -1) ? targetState.connectorClassName : "bg-gray-300";
    const connector2State = (currentStage > 2 || currentStage === -1) ? planningState.connectorClassName : "bg-gray-300";


    return (
        <div className="w-full p-8 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl shadow-lg border border-indigo-100 flex flex-col items-center">
            
            {/* 1. Main Dynamic Icon */}
            <div className="mb-6 h-16 flex items-center justify-center">
                <MainIcon {...mainIconProps} />
            </div>

            {/* 2. Status Text */}
            <h3 className="text-xl font-bold text-indigo-700 mb-8 text-center min-h-[2.5rem]">
                {status}
            </h3>

            {/* 3. Stage Timeline */}
            <div className="w-full max-w-xs flex items-center justify-between">
                {/* Icon 1: Targets */}
                <div className="flex flex-col items-center text-center w-20">
                    <div className={`p-3 rounded-full flex items-center justify-center transition-all ${targetState.wrapperClassName}`}>
                        <targetState.Icon className={targetState.iconClassName} />
                    </div>
                    <span className={`text-xs font-semibold mt-2 transition-colors ${targetState.textClassName}`}>
                        {targetState.stageName}
                    </span>
                </div>
                
                {/* Connector */}
                <div className={`flex-1 h-1 mx-2 rounded-full transition-colors ${connector1State}`}></div>

                {/* Icon 2: Planning */}
                <div className="flex flex-col items-center text-center w-20">
                     <div className={`p-3 rounded-full flex items-center justify-center transition-all ${planningState.wrapperClassName}`}>
                        <planningState.Icon className={planningState.iconClassName} />
                    </div>
                     <span className={`text-xs font-semibold mt-2 transition-colors ${planningState.textClassName}`}>
                        {planningState.stageName}
                    </span>
                </div>
                
                {/* Connector */}
                <div className={`flex-1 h-1 mx-2 rounded-full transition-colors ${connector2State}`}></div>

                {/* Icon 3: Complete */}
                <div className="flex flex-col items-center text-center w-20">
                     <div className={`p-3 rounded-full flex items-center justify-center transition-all ${completeState.wrapperClassName}`}>
                        <completeState.Icon className={completeState.iconClassName} />
                    </div>
                     <span className={`text-xs font-semibold mt-2 transition-colors ${completeState.textClassName}`}>
                        {completeState.stageName}
                    </span>
                </div>
            </div>

            {/* 4. Error Display */}
            {error && (
                <div className="w-full p-3 bg-red-100 text-red-800 rounded-lg mt-8">
                    <p className="font-bold flex items-center"><AlertTriangle className="w-5 h-5 mr-2" /> An Error Occurred</p>
                    <p className="text-sm mt-1">{error}</p>
                </div>
            )}
            
            {/* 5. Sub-text (if not finished or errored) */}
            {currentStage < 3 && currentStage !== -1 && (
                <div className="mt-8 text-center text-sm text-indigo-500 font-medium">
                    Please wait, this can take up to a minute per day...
                </div>
            )}
        </div>
    );
};
// --- END: MODIFIED GenerationProgressDisplay ---

export default GenerationProgressDisplay;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


