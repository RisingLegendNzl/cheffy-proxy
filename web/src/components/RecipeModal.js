// web/src/components/RecipeModal.js
import React from 'react';
import { X, ListChecks, ListOrdered } from 'lucide-react';

// --- [NEW] Recipe Modal Component ---
const RecipeModal = ({ meal, onClose }) => {
    if (!meal) return null;

    // Handle backdrop click
    const handleBackdropClick = (e) => {
        // Close only if the backdrop itself (the outer div) is clicked
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div 
            className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4 transition-opacity duration-300"
            onClick={handleBackdropClick} // Add backdrop click
        >
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col transform transition-all duration-300 scale-100">
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b">
                    <h3 className="text-2xl font-bold text-indigo-700">{meal.name}</h3>
                    <button 
                        onClick={onClose} 
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X size={24} />
                    </button>
                </div>
                
                {/* Scrollable Body */}
                <div className="p-6 overflow-y-auto space-y-6">
                    {/* Description */}
                    <p className="text-gray-700 text-lg">{meal.description}</p>
                    
                    {/* Ingredients */}
                    <div>
                        <h4 className="text-lg font-semibold flex items-center mb-3">
                            <ListChecks className="w-5 h-5 mr-2 text-indigo-600" />
                            Ingredients
                        </h4>
                        <ul className="list-disc list-inside space-y-1 text-gray-600">
                            {meal.items.map((item, index) => (
                                <li key={index}>
                                    <span className="font-medium">{item.qty}{item.unit}</span> {item.key}
                                </li>
                            ))}
                        </ul>
                    </div>
                    
                    {/* Instructions */}
                    <div>
                        <h4 className="text-lg font-semibold flex items-center mb-3">
                            <ListOrdered className="w-5 h-5 mr-2 text-indigo-600" />
                            Instructions
                        </h4>
                        <ol className="list-decimal list-inside space-y-2 text-gray-700 leading-relaxed">
                            {meal.instructions.map((step, index) => (
                                <li key={index}>{step}</li>
                            ))}
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    );
};
// --- END: New Component ---

export default RecipeModal;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


