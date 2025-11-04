// web/src/components/CollapsibleSection.js
import React, { useState } from 'react';
import { ChevronsDown, ChevronsUp } from 'lucide-react';

// --- [START MODIFICATION] CollapsibleSection ---
// Updated to render the icon prop directly, allowing pre-styled icons
const CollapsibleSection = ({ title, children, onToggle, icon = null, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    // const Icon = icon; // <-- REMOVED
    const handleToggle = () => {
        if (!isOpen && onToggle) {
            onToggle();
        }
        setIsOpen(!isOpen);
    };
    return (
        // --- [MODIFIED] Added border-t, removed border-b for better stacking ---
        <div className="border-t border-gray-200">
            <button className="w-full flex justify-between items-center py-4 px-2 hover:bg-gray-50/50" onClick={handleToggle}>
                <span className="text-xl font-bold flex items-center text-indigo-700">
                    {icon} {/* <-- MODIFIED: Render the icon prop directly */}
                    {title}
                </span>
                {isOpen ? <ChevronsUp className="text-gray-600" /> : <ChevronsDown className="text-gray-500" />}
            </button>
            {/* --- [MODIFIED] Changed background to bg-indigo-50/30 for slight tint --- */}
            {isOpen && (<div className="pb-4 pt-2 px-2 bg-indigo-50/30">{children}</div>)}
        </div>
    );
};
// --- [END MODIFICATION] CollapsibleSection ---

export default CollapsibleSection;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


