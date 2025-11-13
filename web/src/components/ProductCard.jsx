// web/src/components/ProductCard.js
import React from 'react';
import { DollarSign, Package, Zap, ExternalLink, ShoppingBag, CheckCircle } from 'lucide-react';

// --- MOCK DATA ---
const MOCK_PRODUCT_TEMPLATE = {
    name: "Placeholder (API DOWN)", brand: "MOCK DATA", price: 15.99, size: "1kg",
    url: "#api_down_mock_product", unit_price_per_100: 1.59,
};

const ProductCard = ({ product, isAbsoluteCheapest = false, onSelect = null, isCurrentSelection = false }) => (
    <div className={`p-4 rounded-xl shadow-lg ${isCurrentSelection ? 'bg-indigo-50 border-2 border-indigo-400' : 'bg-white border'}`}>
        <div className="flex justify-between">
            <h4 className="text-lg font-bold">{product.name}</h4>
            {isCurrentSelection && <CheckCircle className="text-indigo-600 w-6 h-6" />}
        </div>
        <p className="text-sm text-indigo-600 font-semibold mb-2">{product.brand}</p>
        <div className="text-sm space-y-1 mt-2">
            <p><DollarSign className="inline w-4 h-4 mr-1" /> Price: <span className="font-bold text-red-600">${product.price ? product.price.toFixed(2) : 'N/A'}</span></p>
            <p><Package className="inline w-4 h-4 mr-1" /> Size: {product.size || 'N/A'}</p>
            <p className="flex items-center">
                <Zap className="inline w-4 h-4 mr-1" /> Price/100: <span className="font-bold text-green-700">${product.unit_price_per_100 ? product.unit_price_per_100.toFixed(2) : 'N/A'}</span>
                {isAbsoluteCheapest && (<span className="ml-2 px-2 py-0.5 text-xs font-bold bg-green-200 rounded-full">Cheapest</span>)}
            </p>
        </div>
        {product.url && product.url !== MOCK_PRODUCT_TEMPLATE.url && (
            <a href={product.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-sm mt-3 text-blue-600 hover:text-blue-800">
                View Product <ExternalLink className="w-4 h-4 ml-1" />
            </a>
        )}
        {onSelect && !isCurrentSelection && (
            <button onClick={() => onSelect(product)} className="mt-3 w-full flex items-center justify-center py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                <ShoppingBag className="w-4 h-4 mr-2" /> Select
            </button>
        )}
    </div>
);

export default ProductCard;

/* ✅ Migrated without modifications
   ❗ TODO: verify props/state wiring from App.js */


