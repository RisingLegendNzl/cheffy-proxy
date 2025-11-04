// web/src/components/LogEntry.js
import React, { useState } from 'react';
import { ChevronsDown, ChevronRight } from 'lucide-react';

const LogEntry = ({ log }) => {
    const [isDataOpen, setIsDataOpen] = useState(false);
    const { level, tag, message, data } = log;
    const levelColor = { CRITICAL: 'text-red-400', WARN: 'text-yellow-400', SUCCESS: 'text-green-400', INFO: 'text-gray-400', DEBUG: 'text-blue-400', }[level] || 'text-gray-400';
    const tagColor = { SYSTEM: 'bg-gray-600 text-white', PHASE: 'bg-indigo-500 text-white', HTTP: 'bg-blue-500 text-white', LLM: 'bg-purple-500 text-white', LLM_PROMPT: 'bg-purple-800 text-white', DATA: 'bg-green-700 text-white', CALC: 'bg-yellow-600 text-black', MARKET_RUN: 'bg-orange-500 text-white', CHECKLIST: 'bg-teal-600 text-white', FIREBASE: 'bg-amber-500 text-black', }[tag] || 'bg-gray-400 text-black';
    const formattedTime = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    return (
        <div className={`flex items-start space-x-3 py-1 px-2 text-xs flex-wrap`}>
            <span className="text-gray-500 flex-shrink-0">{formattedTime}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${tagColor} flex-shrink-0`}>{tag}</span>
            <span className={`${levelColor} flex-grow min-w-0 break-words`}>{message}</span>
            {data && (<button onClick={() => setIsDataOpen(!isDataOpen)} className="flex-shrink-0 text-blue-400 hover:text-blue-300 ml-auto">{isDataOpen ? <ChevronsDown size={14} /> : <ChevronRight size={14} />}</button>)}
            {isDataOpen && data && (<div className="w-full bg-gray-800 p-2 mt-1 rounded"><pre className="text-gray-300 whitespace-pre-wrap text-xs">{JSON.stringify(data, null, 2)}</pre></div>)}
        </div>
    );
};

export default LogEntry;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


