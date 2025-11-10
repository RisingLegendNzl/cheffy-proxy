// web/src/components/DiagnosticLogViewer.jsx
import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal, ChevronRight, GripVertical, ChevronDown, ChevronUp, Download } from 'lucide-react';

// --- Local Dependencies ---
import LogEntry from './LogEntry';

const DiagnosticLogViewer = ({ logs, height, setHeight, isOpen, setIsOpen, onDownloadLogs }) => {
    const logContainerRef = useRef(null);
    const resizeHandleRef = useRef(null);
    const minHeight = 50;

    useEffect(() => {
        if (isOpen && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, isOpen]);

    const startResizing = useCallback((mouseDownEvent) => {
        mouseDownEvent.preventDefault();
        const startY = mouseDownEvent.clientY;
        const startHeight = height;
        const doDrag = (mouseMoveEvent) => {
            const newHeight = startHeight - (mouseMoveEvent.clientY - startY);
            if (newHeight > minHeight && newHeight < window.innerHeight * 0.9) {
                setHeight(newHeight);
                setIsOpen(true);
            } else if (newHeight <= minHeight) {
                setHeight(minHeight);
                setIsOpen(false);
            }
        };
        const stopDrag = () => {
            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
        };
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    }, [height, setHeight, setIsOpen, minHeight]); // ✅ FIXED: Added all dependencies

    const toggleOpen = () => {
        if (isOpen) {
            setIsOpen(false);
        } else {
            setIsOpen(true);
            if (height <= minHeight) {
                setHeight(250); // Restore to a reasonable height if it was minimized
            }
        }
    };

    const currentDisplayHeight = isOpen ? height : minHeight;

    return (
        <div style={{ height: `${currentDisplayHeight}px`, minHeight: `${minHeight}px` }} className="w-full bg-gray-900 text-white font-mono text-xs shadow-inner flex flex-col transition-all duration-200 border-t-2 border-gray-700">
            <div ref={resizeHandleRef} onMouseDown={startResizing} className="w-full h-2 bg-gray-800 cursor-row-resize flex items-center justify-center group">
                <GripVertical className="text-gray-600 group-hover:text-indigo-400" size={16} />
            </div>
            <div className="p-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center"><Terminal className="w-5 h-5 mr-3 text-green-400" /><h3 className="font-bold">Orchestrator Logs</h3></div>
                <div className="flex items-center space-x-4">
                    {logs && logs.length > 0 && (<button onClick={onDownloadLogs} className="flex items-center px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold" title="Download Logs"><Download size={14} className="mr-1" /> Download</button>)}
                    <button onClick={toggleOpen} className="text-gray-400 hover:text-white">{isOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</button>
                </div>
            </div>
            {isOpen && (<div ref={logContainerRef} className="flex-grow overflow-y-auto p-2">{logs.length > 0 ? logs.map((log, index) => <LogEntry key={index} log={log} />) : <span className="text-gray-500 p-2">Awaiting plan generation...</span>}</div>)}
        </div>
    );
};

export default DiagnosticLogViewer;