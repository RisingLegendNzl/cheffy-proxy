// web/src/components/DaySlider.js
import React from 'react';

const DaySlider = ({ label, name, value, onChange }) => (
    <div className="flex flex-col mb-4">
        <label className="text-sm font-semibold text-gray-700 mb-1 flex justify-between items-center">
            {label}
            <span className="text-lg font-bold text-indigo-700">{value} Day{value > 1 ? 's' : ''}</span>
        </label>
        <input type="range" name={name} min="1" max="7" step="1" value={value} onChange={(e) => onChange({ target: { name, value: parseInt(e.target.value, 10) } })} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
    </div>
);

export default DaySlider;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


