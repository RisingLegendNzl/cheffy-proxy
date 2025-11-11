// web/src/index.jsx
import './animations.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Note: We are not importing a global CSS file
// Styling is handled by Tailwind CDN linked in index.html

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);

// [FIX] Removed React.StrictMode
// This was causing the SSE fetch stream to be double-invoked in development,
// leading to a "Body is disturbed or locked" error.
root.render(
    <App />
);

