// web/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Configure the React plugin to treat all .js files as .jsx
      // This avoids having to rename all 15 component files.
      include: '**/*.{js,jsx,ts,tsx}',
    }),
  ],
  // We must set the build output directory to 'dist' (which is the default)
  // so that the vercel.json rewrites work correctly.
  build: {
    outDir: 'dist',
  },
});

