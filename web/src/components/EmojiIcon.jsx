// web/src/components/EmojiIcon.js
import React from 'react';

// --- [NEW] Emoji Icon Component ---
const EmojiIcon = ({ code, alt }) => {
    // Create a container span to hold the icon and provide a consistent size
    return (
        <span 
            className="w-5 h-5 mr-3 inline-flex items-center justify-center text-xl" // Use text-xl to make fallback emoji large
        >
            <img 
                src={`https://twemoji.maxcdn.com/v/latest/svg/${code}.svg`} 
                alt={alt} 
                className="w-full h-full" // Image fills the container
                // Add a simple fallback: hide the broken image and show alt text
                onError={(e) => { 
                    e.target.style.display = 'none'; // Hide broken image
                    // Create a text node with a generic emoji as a fallback
                    const fallback = document.createTextNode('🛍️');
                    e.target.parentNode.appendChild(fallback);
                }}
            />
        </span>
    );
};
// --- END: New Component ---

export default EmojiIcon;

/* ✅ Migrated without modifications */


