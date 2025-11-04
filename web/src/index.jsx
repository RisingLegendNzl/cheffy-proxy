// web/src/index.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Note: We are not importing a global CSS file
// Styling is handled by Tailwind CDN linked in index.html

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


