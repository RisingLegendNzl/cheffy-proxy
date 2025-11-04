// web/src/components/NutritionalInfo.js
import React from 'react';
import { Loader, AlertTriangle } from 'lucide-react';

const NutritionalInfo = ({ data, isLoading }) => {
    if (isLoading) { return <div className="flex items-center justify-center p-4"><Loader className="animate-spin text-indigo-500 w-6 h-6" /> <span className="ml-2">Loading Nutrition...</span></div> }
    if (!data || data.status === 'not_found' || data.source === 'canonical_v1' || data.source === 'input_error') { return <p className="text-sm text-yellow-800 bg-yellow-100 p-2 rounded-md flex items-center"><AlertTriangle className="w-4 h-4 mr-1 inline"/>No detailed nutritional value found {data?.source === 'canonical_v1' ? '(using estimate)' : ''}.</p>; }
    const per100g = data;
    return (
        <div className="text-sm space-y-2">
            <p className="font-bold border-b pb-1">Per {per100g.servingUnit || '100g'} ({per100g.source})</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>Calories: <span className="font-bold">{per100g.calories?.toFixed(0) || 0} kcal</span></span>
                <span>Protein: <span className="font-bold">{per100g.protein?.toFixed(1) || 0}g</span></span>
                <span>Fat: <span className="font-bold">{per100g.fat?.toFixed(1) || 0}g</span></span>
                <span>Carbs: <span className="font-bold">{per100g.carbs?.toFixed(1) || 0}g</span></span>
                <span>Sat Fat: <span className="font-bold">{per100g.saturatedFat?.toFixed(1) || 0}g</span></span>
                <span>Sugars: <span className="font-bold">{per100g.sugars?.toFixed(1) || 0}g</span></span>
                <span>Fiber: <span className="font-bold">{per100g.fiber?.toFixed(1) || 0}g</span></span>
                <span>Sodium: <span className="font-bold">{per100g.sodium ? (per100g.sodium * 1000).toFixed(0) : 0}mg</span></span>
            </div>
        </div>
    );
};

export default NutritionalInfo;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


