// web/src/components/ShoppingListWithDetails.jsx
// FIXED VERSION - Enhanced store name detection

import React, { useState, useMemo, useEffect } from 'react';
import { 
  ShoppingBag, 
  Check,
  ChevronDown, 
  ChevronUp,
  Copy,
  Printer,
  Share2
} from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';
import { formatGrams, copyToClipboard, groupBy } from '../helpers';
import IngredientResultBlock from './IngredientResultBlock';

/**
 * Shopping list with summary card AND detailed product information
 */
const ShoppingListWithDetails = ({ 
  ingredients = [],
  results = {},
  totalCost = 0,
  storeName = 'Woolworths',
  onShowToast = () => {},
  onSelectSubstitute,
  onQuantityChange,
  onFetchNutrition,
  nutritionCache = {},
  loadingNutritionFor = null,
  categorizedResults = {}
}) => {
  const [checkedItems, setCheckedItems] = useState({});
  const [expandedCategories, setExpandedCategories] = useState({});

  // Initialize all items as checked when results change
  useEffect(() => {
    const initialCheckedState = {};
    Object.keys(results).forEach(normalizedKey => {
      initialCheckedState[normalizedKey] = true;
    });
    setCheckedItems(initialCheckedState);
  }, [results]);

  const totalItems = Object.keys(results).length;
  const checkedCount = Object.values(checkedItems).filter(Boolean).length;

  // Detect actual store from products - ENHANCED
  const actualStoreName = useMemo(() => {
    // Strategy 1: Try to extract from product URLs or data
    for (const [key, result] of Object.entries(results)) {
      // Check allProducts array
      const products = result.allProducts || result.products || [];
      
      for (const product of products) {
        if (!product) continue;
        
        // Check if product has a store field
        if (product.store) {
          return product.store;
        }
        
        // Check if URL contains store name
        if (product.url) {
          if (product.url.includes('coles.com')) return 'Coles';
          if (product.url.includes('woolworths.com')) return 'Woolworths';
        }
        
        // Check product name for store prefix
        if (product.product_name || product.name) {
          const name = product.product_name || product.name;
          if (name.toLowerCase().startsWith('coles')) return 'Coles';
          if (name.toLowerCase().startsWith('woolworths')) return 'Woolworths';
        }
      }
    }
    
    // Strategy 2: Check if ingredients have store info
    for (const ingredient of ingredients) {
      if (ingredient.store) {
        return ingredient.store;
      }
    }
    
    // Strategy 3: Use provided storeName (should be correct from formData)
    return storeName;
  }, [results, ingredients, storeName]);

  // Calculate total cost of selected items
  const selectedTotal = useMemo(() => {
    let total = 0;
    
    Object.entries(results).forEach(([normalizedKey, result]) => {
      const isChecked = checkedItems[normalizedKey];
      
      if (!isChecked || !result) return;
      
      // Access products array correctly
      const products = result.allProducts || result.products || [];
      if (products.length === 0) return;
      
      // Get selected product - check multiple possible locations
      let selectedProduct = null;
      
      if (result.currentSelectionURL) {
        selectedProduct = products.find(p => p && p.url === result.currentSelectionURL);
      }
      
      if (!selectedProduct && result.selectedIndex !== undefined) {
        selectedProduct = products[result.selectedIndex];
      }
      
      if (!selectedProduct) {
        selectedProduct = products[0];
      }
      
      if (!selectedProduct) return;
      
      // Get price - try multiple possible field names
      const price = parseFloat(
        selectedProduct.product_price || 
        selectedProduct.price || 
        selectedProduct.current_price || 
        0
      );
      
      if (isNaN(price) || price <= 0) return;
      
      // Get quantity
      const quantity = result.userQuantity || 1;
      
      total += price * quantity;
    });
    
    return total;
  }, [checkedItems, results]);

  // Toggle item checked state
  const handleToggleItem = (normalizedKey) => {
    setCheckedItems(prev => ({
      ...prev,
      [normalizedKey]: !prev[normalizedKey]
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
    Object.keys(categorizedResults).forEach(cat => {
      allExpanded[cat] = true;
    });
    setExpandedCategories(allExpanded);
  };

  // Collapse all categories
  const handleCollapseAll = () => {
    setExpandedCategories({});
  };

  // Copy list to clipboard
  const handleCopyList = async () => {
    let text = `Shopping List - ${actualStoreName}\n`;
    text += `Total (Selected): $${selectedTotal.toFixed(2)}\n`;
    text += `Items: ${checkedCount} of ${totalItems}\n`;
    text += '='.repeat(40) + '\n\n';

    Object.entries(categorizedResults).forEach(([category, items]) => {
      text += `${category.toUpperCase()}\n`;
      text += '-'.repeat(40) + '\n';
      items.forEach(({ normalizedKey, ingredient }) => {
        const checked = checkedItems[normalizedKey] ? '✓' : '☐';
        text += `${checked} ${ingredient}\n`;
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

  // Share list
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

  // Get category icon
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
      condiments: '🧂',
      drinks: '🧃',
    };
    return iconMap[category.toLowerCase()] || '🛒';
  };

  // Debug logging
  useEffect(() => {
    console.log('[ShoppingList] Store Detection:', {
      providedStoreName: storeName,
      detectedStoreName: actualStoreName,
      sampleProduct: results[Object.keys(results)[0]]?.allProducts?.[0] || results[Object.keys(results)[0]]?.products?.[0]
    });
  }, [storeName, actualStoreName, results]);

  return (
    <div className="space-y-4">
      {/* Shopping List Summary Card */}
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
                {totalItems} items from {actualStoreName}
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

      {/* Detailed Product List by Category */}
      <div className="space-y-3">
        {Object.entries(categorizedResults).map(([category, items]) => {
          const isExpanded = expandedCategories[category];
          const categoryCheckedCount = items.filter(item => 
            checkedItems[item.normalizedKey]
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

              {/* Category Items - Full Product Details */}
              {isExpanded && (
                <div className="border-t" style={{ borderColor: COLORS.gray[200] }}>
                  {items.map(({ normalizedKey, ingredient, ...result }) => {
                    const isChecked = checkedItems[normalizedKey] || false;

                    return (
                      <div
                        key={normalizedKey}
                        className={`relative transition-all ${
                          isChecked ? 'opacity-100' : 'opacity-40'
                        }`}
                      >
                        {/* Checkbox Overlay */}
                        <div className="absolute top-4 right-4 z-10">
                          <button
                            onClick={() => handleToggleItem(normalizedKey)}
                            className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all shadow-sm ${
                              isChecked 
                                ? 'bg-green-500 border-green-500' 
                                : 'bg-white border-gray-300'
                            }`}
                          >
                            {isChecked && <Check size={20} className="text-white" />}
                          </button>
                        </div>

                        {/* Full Product Card */}
                        <div className={isChecked ? '' : 'pointer-events-none'}>
                          <IngredientResultBlock
                            ingredientKey={ingredient}
                            normalizedKey={normalizedKey}
                            result={result}
                            onSelectSubstitute={onSelectSubstitute}
                            onQuantityChange={onQuantityChange}
                            onFetchNutrition={onFetchNutrition}
                            nutritionData={nutritionCache[result.allProducts?.[result.selectedIndex || 0]?.url] || nutritionCache[result.products?.[result.selectedIndex || 0]?.url]}
                            isLoadingNutrition={loadingNutritionFor === result.allProducts?.[result.selectedIndex || 0]?.url || loadingNutritionFor === result.products?.[result.selectedIndex || 0]?.url}
                          />
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

export default ShoppingListWithDetails;