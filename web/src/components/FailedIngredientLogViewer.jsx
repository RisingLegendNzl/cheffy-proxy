// web/src/components/FailedIngredientLogViewer.js
import React, { useState } from 'react';
import { ListX, Download, ChevronDown, ChevronUp } from 'lucide-react';

const FailedIngredientLogViewer = ({ failedHistory, onDownload }) => {
    const [isOpen, setIsOpen] = useState(true);
    // --- [MODIFIED] Correctly renders only if failedHistory has items ---
    if (!failedHistory || failedHistory.length === 0) { return null; }
    return (
        <div className="w-full bg-red-900/95 text-red-100 font-mono text-xs shadow-inner border-t-2 border-red-700">
            <div className="p-3 bg-red-800/90 border-b border-red-700 flex items-center justify-between">
                <div className="flex items-center"><ListX className="w-5 h-5 mr-3 text-red-300" /><h3 className="font-bold">Failed Ingredient History ({failedHistory.length})</h3></div>
                <div className="flex items-center space-x-4">
                    <button onClick={onDownload} className="flex items-center px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold" title="Download Failed Logs"><Download size={14} className="mr-1" /> Download</button>
                    <button onClick={() => setIsOpen(!isOpen)} className="text-red-300 hover:text-white">{isOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</button>
                </div>
            </div>
            {isOpen && (<div className="max-h-60 overflow-y-auto p-3 space-y-3">
                {failedHistory.map((item, index) => (
                    <div key={index} className="border-b border-red-700/50 pb-2">
                        <p className="font-bold text-white mb-1">{item.originalIngredient}<span className="text-gray-400 text-xs ml-2">({new Date(item.timestamp).toLocaleTimeString()})</span></p>
                        <pre className="text-red-200 whitespace-pre-wrap text-xs bg-black/20 p-1 rounded">
                            Tight Query: {item.tightQuery || 'N/A'}{'\n'}
                            Normal Query: {item.normalQuery || 'N/A'}{'\n'}
                            Wide Query: {item.wideQuery || 'N/A'}{'\n'}
                            {item.error ? `Error: ${item.error}\n` : ''} 
                        </pre>
                    </div>
                ))}
            </div>)}
        </div>
    );
};

export default FailedIngredientLogViewer;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


