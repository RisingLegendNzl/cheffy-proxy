// web/src/components/InputField.js
import React from 'react';

const InputField = ({ label, name, type = 'text', value, onChange, options = [], required = false, placeholder = '' }) => (
    <div className="flex flex-col mb-4">
        <label className="text-sm font-semibold text-gray-700 mb-1">{label}</label>
        {type === 'select' ? (
            <select name={name} value={value} onChange={onChange} className="p-3 border border-gray-300 rounded-lg shadow-sm" required={required}>
                {options.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
        ) : (
            <input type={type} name={name} value={value} onChange={onChange} className="p-3 border border-gray-300 rounded-lg shadow-sm" placeholder={placeholder || label} min={type === 'number' ? 0 : undefined} required={required} />
        )}
    </div>
);

export default InputField;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


