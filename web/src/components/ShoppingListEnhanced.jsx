// web/src/components/ShoppingListEnhanced.jsx
import React, { useState, useMemo } from ‘react’;
import { ShoppingBag, Download, Printer, CheckCircle } from ‘lucide-react’;
import { COLORS } from ‘../constants’;
import PantryShelf from ‘./shopping/PantryShelf’;
import ShoppingCart from ‘./shopping/ShoppingCart’;

/**

- Shopping List Enhanced - Smart Pantry Concept
- Features:
- - Category shelves with wood texture
- - Parallax depth on tap
- - Items slide off shelf when checked
- - Shopping cart collection at bottom with sway animation
- - Progress ring showing % complete
    */
    const ShoppingListEnhanced = ({ categorizedResults, selectedDay }) => {
    const [checkedItems, setCheckedItems] = useState({});

// Calculate progress
const progress = useMemo(() => {
const categories = Object.keys(categorizedResults);
if (categories.length === 0) return 0;

```
let totalItems = 0;
let checkedCount = 0;

categories.forEach(category => {
  const items = categorizedResults[category] || [];
  totalItems += items.length;
  items.forEach(item => {
    if (checkedItems[item.key]) {
      checkedCount++;
    }
  });
});

return totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;
```

}, [categorizedResults, checkedItems]);

// Get checked items for cart
const cartItems = useMemo(() => {
const items = [];
Object.keys(categorizedResults).forEach(category => {
const categoryItems = categorizedResults[category] || [];
categoryItems.forEach(item => {
if (checkedItems[item.key]) {
items.push({ …item, category });
}
});
});
return items;
}, [categorizedResults, checkedItems]);

const handleToggleItem = (itemKey) => {
setCheckedItems(prev => ({
…prev,
[itemKey]: !prev[itemKey],
}));
};

const handleClearChecked = () => {
setCheckedItems({});
};

const handleExport = () => {
// Create text version of shopping list
let text = `Shopping List - Day ${selectedDay}\n\n`;

```
Object.keys(categorizedResults).forEach(category => {
  const items = categorizedResults[category] || [];
  if (items.length > 0) {
    text += `${category.toUpperCase()}\n`;
    items.forEach(item => {
      const checked = checkedItems[item.key] ? '✓' : '☐';
      text += `${checked} ${item.userQuantity || 1}x ${item.key}\n`;
    });
    text += '\n';
  }
});

// Download as text file
const blob = new Blob([text], { type: 'text/plain' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `shopping-list-day-${selectedDay}.txt`;
a.click();
URL.revokeObjectURL(url);
```

};

const handlePrint = () => {
window.print();
};

const categories = Object.keys(categorizedResults);
const isEmpty = categories.length === 0;

if (isEmpty) {
return (
<div className="flex flex-col items-center justify-center py-12 px-4">
<ShoppingBag size={64} style={{ color: COLORS.gray[300] }} className=“mb-4” />
<h3 className=“text-xl font-bold mb-2” style={{ color: COLORS.gray[700] }}>
No Items Yet
</h3>
<p style={{ color: COLORS.gray[500] }}>
Generate a meal plan to see your shopping list
</p>
</div>
);
}

return (
<div className="space-y-6">
{/* Header with Actions */}
<div className=“bg-white rounded-xl shadow-lg border p-6” style={{ borderColor: COLORS.gray[200] }}>
<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
<div>
<h2 className=“text-2xl font-bold mb-1” style={{ color: COLORS.gray[900] }}>
Smart Pantry
</h2>
<p className=“text-sm” style={{ color: COLORS.gray[600] }}>
{progress}% complete • {cartItems.length} items collected
</p>
</div>

```
      <div className="flex items-center space-x-2">
        <button
          onClick={handleExport}
          className="flex items-center px-4 py-2 rounded-lg border hover-lift transition-spring"
          style={{
            borderColor: COLORS.gray[300],
            color: COLORS.gray[700],
          }}
        >
          <Download size={16} className="mr-2" />
          Export
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center px-4 py-2 rounded-lg border hover-lift transition-spring"
          style={{
            borderColor: COLORS.gray[300],
            color: COLORS.gray[700],
          }}
        >
          <Printer size={16} className="mr-2" />
          Print
        </button>
        {cartItems.length > 0 && (
          <button
            onClick={handleClearChecked}
            className="flex items-center px-4 py-2 rounded-lg hover-lift transition-spring"
            style={{
              backgroundColor: COLORS.error.light,
              color: COLORS.error.dark,
            }}
          >
            Clear Checked
          </button>
        )}
      </div>
    </div>
  </div>

  {/* Pantry Shelves */}
  <div className="space-y-4">
    {categories.map((category) => {
      const items = categorizedResults[category] || [];
      if (items.length === 0) return null;

      return (
        <PantryShelf
          key={category}
          category={category}
          items={items}
          checkedItems={checkedItems}
          onToggleItem={handleToggleItem}
        />
      );
    })}
  </div>

  {/* Shopping Cart */}
  {cartItems.length > 0 && (
    <ShoppingCart
      items={cartItems}
      progress={progress}
      onClear={handleClearChecked}
    />
  )}

  {/* Completion Celebration */}
  {progress === 100 && (
    <div
      className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 text-center animate-bounceIn"
      style={{
        border: `2px solid ${COLORS.success.main}`,
      }}
    >
      <CheckCircle size={48} className="mx-auto mb-3" style={{ color: COLORS.success.main }} />
      <h3 className="text-xl font-bold mb-2" style={{ color: COLORS.success.dark }}>
        Shopping Complete!
      </h3>
      <p style={{ color: COLORS.success.dark }}>
        All items have been collected. Time to cook! 👨‍🍳
      </p>
    </div>
  )}
</div>
```

);
};

export default ShoppingListEnhanced;