// web/src/components/RecipeModal.jsx
import React from 'react';
import { X, ListChecks, ListOrdered } from 'lucide-react';

/**
 * RecipeModal - Mobile-optimized meal detail view
 * Displays meal name, description, ingredients, and instructions in a scrollable modal
 */
const RecipeModal = ({ meal, onClose }) => {
    if (!meal) return null;

    // Handle backdrop click to close
    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    // Prevent scroll when modal is open
    React.useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    return (
        <div 
            className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center transition-opacity duration-300"
            onClick={handleBackdropClick}
        >
            {/* Modal Container */}
            <div 
                className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-3xl shadow-2xl flex flex-col transform transition-all duration-300 ease-out"
                style={{
                    maxHeight: 'min(90vh, 900px)',
                    animation: 'slideUp 0.3s ease-out',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Fixed Header - Always visible with safe area padding */}
                <div 
                    className="flex-shrink-0 bg-white border-b border-gray-200 rounded-t-3xl sm:rounded-t-2xl"
                    style={{
                        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top) + 0.75rem))',
                        paddingBottom: '1rem',
                        paddingLeft: '1.25rem',
                        paddingRight: '1.25rem',
                    }}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-xl sm:text-2xl font-bold text-gray-900 leading-snug">
                                {meal.name}
                            </h3>
                        </div>
                        <button 
                            onClick={onClose} 
                            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors -mt-1"
                            aria-label="Close"
                        >
                            <X size={20} className="text-gray-600" />
                        </button>
                    </div>
                </div>
                
                {/* Scrollable Body */}
                <div 
                    className="flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6 sm:py-8 space-y-8"
                    style={{
                        WebkitOverflowScrolling: 'touch',
                    }}
                >
                    {/* Description */}
                    <div>
                        <p className="text-gray-700 text-base sm:text-lg leading-relaxed">
                            {meal.description}
                        </p>
                    </div>
                    
                    {/* Ingredients Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                                <ListChecks className="w-5 h-5 text-indigo-600" />
                            </div>
                            <h4 className="text-xl font-bold text-gray-900">
                                Ingredients
                            </h4>
                        </div>
                        <ul className="space-y-3">
                            {meal.items && meal.items.map((item, index) => (
                                <li 
                                    key={index}
                                    className="flex items-start gap-3 text-gray-700"
                                >
                                    <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0 mt-2"></span>
                                    <span className="flex-1 text-base leading-relaxed">
                                        <span className="font-semibold text-gray-900">
                                            {item.qty}{item.unit}
                                        </span>
                                        {' '}
                                        {item.key}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    
                    {/* Instructions Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                                <ListOrdered className="w-5 h-5 text-green-600" />
                            </div>
                            <h4 className="text-xl font-bold text-gray-900">
                                Instructions
                            </h4>
                        </div>
                        <ol className="space-y-4">
                            {meal.instructions && meal.instructions.map((step, index) => (
                                <li 
                                    key={index}
                                    className="flex gap-4 text-gray-700"
                                >
                                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-green-100 text-green-700 font-bold text-sm flex items-center justify-center">
                                        {index + 1}
                                    </span>
                                    <span className="flex-1 text-base leading-relaxed pt-0.5">
                                        {step}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </div>

                    {/* Bottom padding for safe area */}
                    <div 
                        style={{
                            paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
                        }}
                    />
                </div>
            </div>

            {/* Slide-up animation keyframes */}
            <style>{`
                @keyframes slideUp {
                    from {
                        transform: translateY(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
};

export default RecipeModal;