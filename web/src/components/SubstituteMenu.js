// web/src/components/SubstituteMenu.js
import React, { useState } from 'react';
import { Replace, ChevronsDown, ChevronsUp } from 'lucide-react';

const SubstituteMenu = ({ children, substituteCount }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="mt-4 border-t-2 border-dashed pt-4">
            <button
                className="w-full flex justify-center items-center py-3 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-bold rounded-lg"
                onClick={() => setIsOpen(!isOpen)}
            >
                <Replace className="w-5 h-5 mr-2" />
                {isOpen ? 'Hide' : `Show ${substituteCount} Alternative(s)`}
                {isOpen ? <ChevronsUp className="ml-2" /> : <ChevronsDown className="ml-2" />}
            </button>
            {isOpen && (<div className="mt-3 p-4 bg-indigo-50 rounded-lg">{children}</div>)}
        </div>
    );
};

export default SubstituteMenu;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


