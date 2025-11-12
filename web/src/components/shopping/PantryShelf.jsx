// web/src/components/shopping/PantryShelf.jsx
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';
import { COLORS } from '../../constants';
import IngredientIcon from './IngredientIcon';
import { prefersReducedMotion } from '../../utils/animationHelpers';

/**
 * Pantry Shelf - Category shelf component
 * Features:
 * - Wood texture background
 * - Parallax slide-forward effect on expand
 * - Items slide off shelf when checked
 * - Elastic easing animations
 */
const PantryShelf = ({ category, items, checkedItems, onToggleItem }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const checkedCount = items.filter(item => checkedItems[item.key]).length;
    const totalCount = items.length;
    const isAllChecked = checkedCount === totalCount;

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div
            className={`bg-white rounded-xl shadow-lg border overflow-hidden transition-all duration-400 ${
                isExpanded && !prefersReducedMotion() ? 'animate-shelfSlideForward' : ''
            }`}
            style={{
                borderColor: COLORS.gray[200],
            }}
        >
            {/* Shelf Header */}
            <button
                onClick={handleToggle}
                className="w-full p-5 flex items-center justify-between hover:bg-gray-50 transition-fast"
                style={{
                    background: isExpanded
                        ? 'linear-gradient(to bottom, #f9fafb 0%, #f3f4f6 100%)'
                        : '#ffffff',
                }}
            >
                <div className="flex items-center flex-1">
                    {/* Category Icon */}
                    <div className="mr-4">
                        <IngredientIcon ingredient={category} size={40} />
                    </div>

                    {/* Category Info */}
                    <div className="text-left">
                        <h3 className="text-lg font-bold capitalize" style={{ color: COLORS.gray[900] }}>
                            {category}
                        </h3>
                        <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                            {checkedCount} of {totalCount} collected
                        </p>
                    </div>
                </div>

                {/* Progress Badge */}
                <div className="flex items-center space-x-3 mr-4">
                    {isAllChecked && (
                        <div
                            className="px-3 py-1 rounded-full text-xs font-bold"
                            style={{
                                backgroundColor: COLORS.success.light,
                                color: COLORS.success.dark,
                            }}
                        >
                            ✓ Complete
                        </div>
                    )}

                    <div
                        className="w-12 h-12 rounded-full flex items-center justify-center"
                        style={{
                            backgroundColor: isAllChecked ? COLORS.success.light : COLORS.gray[100],
                        }}
                    >
                        <span
                            className="text-sm font-bold"
                            style={{
                                color: isAllChecked ? COLORS.success.main : COLORS.gray[700],
                            }}
                        >
                            {checkedCount}/{totalCount}
                        </span>
                    </div>
                </div>

                {/* Expand/Collapse Icon */}
                <div>
                    {isExpanded ? (
                        <ChevronUp size={24} style={{ color: COLORS.gray[400] }} />
                    ) : (
                        <ChevronDown size={24} style={{ color: COLORS.gray[400] }} />
                    )}
                </div>
            </button>

            {/* Shelf Items */}
            {isExpanded && (
                <div
                    className={`border-t p-4 space-y-2 ${
                        prefersReducedMotion() ? '' : 'animate-fadeIn'
                    }`}
                    style={{
                        borderColor: COLORS.gray[200],
                        background: 'linear-gradient(to bottom, #fefefe 0%, #f9fafb 100%)',
                    }}
                >
                    {items.map((item, index) => {
                        const isChecked = checkedItems[item.key];

                        return (
                            <button
                                key={item.key || index}
                                onClick={() => onToggleItem(item.key)}
                                className={`w-full p-4 rounded-lg border-2 flex items-center transition-all duration-300 ${
                                    isChecked
                                        ? 'bg-green-50 border-green-300 opacity-60'
                                        : 'bg-white border-gray-200 hover-lift hover:border-indigo-300'
                                } ${isChecked && !prefersReducedMotion() ? 'animate-itemOffShelf' : ''}`}
                            >
                                {/* Checkbox */}
                                <div
                                    className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center mr-4 transition-all duration-200 ${
                                        isChecked ? 'bg-green-500 border-green-500' : 'border-gray-300'
                                    }`}
                                >
                                    {isChecked && <Check size={16} className="text-white" />}
                                </div>

                                {/* Item Icon */}
                                <div className="mr-3">
                                    <IngredientIcon ingredient={item.key} size={32} />
                                </div>

                                {/* Item Info */}
                                <div className="flex-1 text-left">
                                    <p
                                        className={`font-semibold ${isChecked ? 'line-through' : ''}`}
                                        style={{
                                            color: isChecked ? COLORS.gray[500] : COLORS.gray[900],
                                        }}
                                    >
                                        {item.key}
                                    </p>
                                    <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                                        Qty: {item.userQuantity || 1}
                                    </p>
                                </div>

                                {/* Price (if available) */}
                                {item.allProducts && item.allProducts.length > 0 && (
                                    <div className="text-right">
                                        <p className="font-bold" style={{ color: COLORS.success.main }}>
                                            ${(item.allProducts[0].price * (item.userQuantity || 1)).toFixed(2)}
                                        </p>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default PantryShelf;