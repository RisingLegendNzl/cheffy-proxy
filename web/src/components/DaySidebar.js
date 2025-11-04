// web/src/components/DaySidebar.js
import React from 'react';

const DaySidebar = ({ days, selectedDay, onSelect }) => (
    <div className="w-full md:w-48 flex md:flex-col overflow-x-auto">
        <h3 className="text-lg font-bold text-gray-800 hidden md:block mb-3 border-b pb-2">Plan Days ({days})</h3>
        <div className="flex md:flex-col space-x-2 md:space-x-0 md:space-y-2 pb-2">
            {Array.from({ length: days }, (_, i) => i + 1).map(day => (
                <button
                    key={day}
                    onClick={() => onSelect(day)}
                    className={`px-4 py-2 text-sm font-medium rounded-full transition-colors whitespace-nowrap ${
                        day === selectedDay
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'bg-white text-gray-700 hover:bg-indigo-100 border border-gray-300'
                    }`}
                >
                    {`Day ${day}`}
                </button>
            ))}
        </div>
    </div>
);

export default DaySidebar;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


