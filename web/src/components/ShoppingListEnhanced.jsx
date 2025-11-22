// web/src/components/ShoppingListEnhanced.jsx
// Enhanced with Shopping List Summary Card

import React, { useState, useMemo, useEffect } from 'react';
import { 
  ShoppingBag, 
  Download, 
  Share2, 
  Check, 
  ChevronDown, 
  ChevronUp,
  Copy,
  Printer
} from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';
import { formatGrams, copyToClipboard, groupBy } from '../helpers';

/**
 * Enhanced shopping list with checkboxes, summary card, and export features
 */
const ShoppingListEnhanced = ({ 
  ingredients = [], 
  totalCost = 0,
  storeName = 'Woolworths',
  onShowToast = () => {},
  results = {} 
}) => {
  const [checkedItems, setCheckedItems] = useState({});
  const [expandedCategories, setExpandedCategories] = useState({});

  // Initialize all items as checked when ingredients change
  useEffect(() => {
    const initialCheckedState = {};
    ingredients.forEach(item => {
      if (item.originalIngredient) {
        initialCheckedState[item.originalIngredient] = true;
      }
    });
    setCheckedItems(initialCheckedState);
  }, [ingredients]);

  // Group ingredients by category
  const categorizedIngredients = useMemo(() => {
    return groupBy(ingredients, 'category');
  }, [ingredients]);

  const totalItems = ingredients.length;
  const checkedCount = Object.values(checkedItems).filter(Boolean).length;

  // Calculate total cost of selected items
  const selectedTotal = useMemo(() => {
    let total = 0;
    ingredients.forEach(item => {
      const isChecked = checkedItems[item.originalIngredient];
      if (isChecked) {
        // Get the product result for this ingredient
        const normalizedKey = item.originalIngredient?.toLowerCase().trim();
        const result = results[normalizedKey];
        
        if (result && result.products && result.products.length > 0) {
          // Get the selected product
          const selectedProduct = result.selectedIndex !== undefined 
            ? result.products[result.selectedIndex]
            : result.products[0];
          
          if (selectedProduct && selectedProduct.product_price) {
            const price = parseFloat(selectedProduct.product_price);
            const quantity = result.userQuantity || 1;
            if (!isNaN(price)) {
              total += price * quantity;
            }
          }
        }
      }
    });
    return total;
  }, [checkedItems, ingredients, results]);

  // Toggle item checked state
  const handleToggleItem = (ingredientKey) => {
    setCheckedItems(prev => ({
      ...prev,
      [ingredientKey]: !prev[ingredientKey]
    }));
  };

  // Toggle category expansion
  const handleToggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Expand all categories
  const handleExpandAll = () => {
    const allExpanded = {};
    Object.keys(categorizedIngredients).forEach(cat => {
      allExpanded[cat] = true;
    });
    setExpandedCategories(allExpanded);
  };

  // Collapse all categories
  const handleCollapseAll = () => {
    setExpandedCategories({});
  };

  // Export to text
  const handleCopyList = async () => {
    let text = `Shopping List - ${storeName}\n`;
    text += `Total: $${selectedTotal.toFixed(2)}\n`;
    text += `Items: ${totalItems} (${checkedCount} selected)\n`;
    text += '='.repeat(40) + '\n\n';

    Object.entries(categorizedIngredients).forEach(([category, items]) => {
      text += `${category.toUpperCase()}\n`;
      text += '-'.repeat(40) + '\n';
      items.forEach(item => {
        const checked = checkedItems[item.originalIngredient] ? '✓' : '☐';
        text += `${checked} ${item.originalIngredient} - ${formatGrams(item.totalGramsRequired)}\n`;
      });
      text += '\n';
    });

    const success = await copyToClipboard(text);
    if (success && onShowToast) {
      onShowToast('Shopping list copied to clipboard!', 'success');
    }
  };

  // Print list
  const handlePrint = () => {
    window.print();
  };

  // Share (if Web Share API available)
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Cheffy Shopping List',
          text: `My shopping list from Cheffy - ${checkedCount} of ${totalItems} items selected`,
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      handleCopyList();
    }
  };

  // Category icon map
  const getCategoryIcon = (category) => {
    const iconMap = {
      produce: '🥕',
      fruit: '🍎',
      veg: '🥬',
      grains: '🌾',
      meat: '🥩',
      seafood: '🐟',
      dairy: '🥛',
      pantry: '🥫',
      frozen: '❄️',
      bakery: '🍞',
      snacks: '🍿',
    };
    return iconMap[category.toLowerCase()] || '🛒';
  };

  return (
    <div className="space-y-4">
      {/* Shopping List Summary Card - NEW */}
      <div
        className="rounded-2xl p-6 shadow-xl"
        style={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        }}
      >
        {/* Header Row */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center">
            <div className="bg-white bg-opacity-20 rounded-xl p-3 mr-4">
              <ShoppingBag size={32} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Shopping List</h2>
              <p className="text-indigo-100 text-sm">
                {totalItems} items from {storeName}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold text-white mb-1">
              ${selectedTotal.toFixed(2)}
            </p>
            <p className="text-indigo-100 text-sm">Total Cost</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-white bg-opacity-20 rounded-full h-3 overflow-hidden mb-2">
          <div
            className="bg-white h-3 transition-all duration-500 ease-out"
            style={{ 
              width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 0}%` 
            }}
          />
        </div>
        <p className="text-indigo-100 text-sm font-medium">
          {checkedCount} of {totalItems} items checked
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleCopyList}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ borderColor: COLORS.gray[300], color: COLORS.gray[700] }}
        >
          <Copy size={16} className="mr-2" />
          Copy List
        </button>

        <button
          onClick={handleShare}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ borderColor: COLORS.gray[300], color: COLORS.gray[700] }}
        >
          <Share2 size={16} className="mr-2" />
          Share
        </button>

        <button
          onClick={handlePrint}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ borderColor: COLORS.gray[300], color: COLORS.gray[700] }}
        >
          <Printer size={16} className="mr-2" />
          Print
        </button>

        <button
          onClick={handleExpandAll}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring ml-auto"
          style={{ borderColor: COLORS.gray[300], color: COLORS.gray[700] }}
        >
          Expand All
        </button>

        <button
          onClick={handleCollapseAll}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ borderColor: COLORS.gray[300], color: COLORS.gray[700] }}
        >
          Collapse All
        </button>
      </div>

      {/* Categorized List */}
      <div className="space-y-3">
        {Object.entries(categorizedIngredients).map(([category, items]) => {
          const isExpanded = expandedCategories[category];
          const categoryCheckedCount = items.filter(item => 
            checkedItems[item.originalIngredient]
          ).length;

          return (
            <div
              key={category}
              className="bg-white rounded-xl overflow-hidden border"
              style={{ 
                borderColor: COLORS.gray[200],
                boxShadow: SHADOWS.sm 
              }}
            >
              {/* Category Header */}
              <button
                onClick={() => handleToggleCategory(category)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-fast"
              >
                <div className="flex items-center">
                  <span className="text-2xl mr-3">{getCategoryIcon(category)}</span>
                  <div className="text-left">
                    <h3 className="font-bold" style={{ color: COLORS.gray[900] }}>
                      {category}
                    </h3>
                    <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                      {categoryCheckedCount} of {items.length} items
                    </p>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp style={{ color: COLORS.gray[400] }} />
                ) : (
                  <ChevronDown style={{ color: COLORS.gray[400] }} />
                )}
              </button>

              {/* Category Items */}
              {isExpanded && (
                <div className="border-t" style={{ borderColor: COLORS.gray[200] }}>
                  {items.map((item, index) => {
                    const isChecked = checkedItems[item.originalIngredient] || false;

                    return (
                      <div
                        key={item.originalIngredient || index}
                        className={`flex items-center p-4 border-b last:border-b-0 transition-all ${
                          isChecked ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'
                        }`}
                        style={{ borderColor: COLORS.gray[100] }}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={() => handleToggleItem(item.originalIngredient)}
                          className={`w-6 h-6 rounded border-2 flex items-center justify-center mr-3 transition-all ${
                            isChecked ? 'bg-green-500 border-green-500' : 'border-gray-300'
                          }`}
                        >
                          {isChecked && <Check size={16} className="text-white" />}
                        </button>

                        {/* Item Details */}
                        <div className="flex-1 min-w-0">
                          <p
                            className={`font-semibold truncate ${
                              isChecked ? 'line-through' : ''
                            }`}
                            style={{ color: COLORS.gray[900] }}
                          >
                            {item.originalIngredient}
                          </p>
                          <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                            {formatGrams(item.totalGramsRequired)} • {item.quantityUnits || 'units'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {totalItems === 0 && (
        <div className="text-center py-12" style={{ color: COLORS.gray[500] }}>
          <ShoppingBag size={48} className="mx-auto mb-4 opacity-50" />
          <p>No items in your shopping list yet</p>
        </div>
      )}
    </div>
  );
};

export default ShoppingListEnhanced;