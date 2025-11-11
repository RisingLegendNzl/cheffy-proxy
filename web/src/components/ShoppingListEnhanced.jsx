// web/src/components/ShoppingListEnhanced.jsx
import React, { useState, useMemo } from 'react';
import { 
  ShoppingBag, 
  Share2, 
  Copy,
  Printer
} from 'lucide-react';
import { COLORS, SHADOWS, CATEGORY_ICONS } from '../constants';
import { formatGrams, copyToClipboard, groupBy } from '../helpers';
import CategoryCard from './CategoryCard';

/**
 * Enhanced shopping list with CategoryCard components
 * Features: glassmorphism summary, staggered animations, smooth interactions
 */
const ShoppingListEnhanced = ({ 
  ingredients = [], 
  totalCost = 0,
  storeName = 'Woolworths',
  onShowToast 
}) => {
  const [checkedItems, setCheckedItems] = useState({});
  const [expandedCategories, setExpandedCategories] = useState({});

  // Group ingredients by category
  const categorizedIngredients = useMemo(() => {
    return groupBy(ingredients, 'category');
  }, [ingredients]);

  const totalItems = ingredients.length;
  const checkedCount = Object.values(checkedItems).filter(Boolean).length;

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
    text += `Total: $${totalCost.toFixed(2)}\n`;
    text += `Items: ${totalItems}\n`;
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
          text: `My shopping list from Cheffy - ${totalItems} items`,
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      handleCopyList(); // Fallback to copy
    }
  };

  // Get category icon
  const getCategoryIcon = (category) => {
    const categoryLower = category.toLowerCase();
    return CATEGORY_ICONS[categoryLower] || CATEGORY_ICONS.pantry || '🛒';
  };

  // Get category gradient
  const getCategoryGradient = (category) => {
    const categoryLower = category.toLowerCase();
    const gradientMap = {
      produce: [COLORS.success.main, COLORS.success.dark],
      fruit: [COLORS.success.main, COLORS.success.dark],
      vegetables: [COLORS.success.main, COLORS.success.dark],
      meat: [COLORS.error.main, COLORS.error.dark],
      seafood: [COLORS.info.main, COLORS.info.dark],
      dairy: [COLORS.primary[400], COLORS.primary[200]],
      grains: [COLORS.warning.main, COLORS.warning.dark],
      pantry: [COLORS.gray[400], COLORS.gray[300]],
    };
    return gradientMap[categoryLower] || null;
  };

  return (
    <div className="space-y-6">
      {/* Header Card - Moved to GlassmorphismBar, kept simple version here */}
      <div
        className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-2xl p-6 shadow-lg"
        style={{ boxShadow: SHADOWS.lg }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <ShoppingBag size={32} className="mr-3" />
            <div>
              <h2 
                className="text-2xl font-bold"
                style={{ fontFamily: 'var(--font-family-display)' }}
              >
                Shopping List
              </h2>
              <p className="text-indigo-100 text-sm">
                {totalItems} items from {storeName}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums">${totalCost.toFixed(2)}</p>
            <p className="text-indigo-100 text-sm">Total Cost</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-white bg-opacity-20 rounded-full h-2 overflow-hidden mb-2">
          <div
            className="bg-white h-2 transition-all duration-500"
            style={{ width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 0}%` }}
          />
        </div>
        <p className="text-indigo-100 text-sm">
          {checkedCount} of {totalItems} items checked
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleCopyList}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ 
            borderColor: COLORS.gray[300], 
            color: COLORS.gray[700],
            boxShadow: SHADOWS.sm,
          }}
        >
          <Copy size={16} className="mr-2" />
          Copy List
        </button>

        <button
          onClick={handleShare}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ 
            borderColor: COLORS.gray[300], 
            color: COLORS.gray[700],
            boxShadow: SHADOWS.sm,
          }}
        >
          <Share2 size={16} className="mr-2" />
          Share
        </button>

        <button
          onClick={handlePrint}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ 
            borderColor: COLORS.gray[300], 
            color: COLORS.gray[700],
            boxShadow: SHADOWS.sm,
          }}
        >
          <Printer size={16} className="mr-2" />
          Print
        </button>

        <button
          onClick={handleExpandAll}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring ml-auto"
          style={{ 
            borderColor: COLORS.gray[300], 
            color: COLORS.gray[700],
            boxShadow: SHADOWS.sm,
          }}
        >
          Expand All
        </button>

        <button
          onClick={handleCollapseAll}
          className="flex items-center px-4 py-2 bg-white border rounded-lg hover-lift transition-spring"
          style={{ 
            borderColor: COLORS.gray[300], 
            color: COLORS.gray[700],
            boxShadow: SHADOWS.sm,
          }}
        >
          Collapse All
        </button>
      </div>

      {/* Categorized List with CategoryCard */}
      <div className="space-y-4">
        {Object.entries(categorizedIngredients).map(([category, items]) => (
          <CategoryCard
            key={category}
            category={category}
            items={items}
            categoryIcon={getCategoryIcon(category)}
            gradientColors={getCategoryGradient(category)}
            isExpanded={expandedCategories[category]}
            onToggle={() => handleToggleCategory(category)}
            checkedItems={checkedItems}
            onToggleItem={handleToggleItem}
          />
        ))}
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