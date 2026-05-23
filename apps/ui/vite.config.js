import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('posthog-js') || id.includes('@vercel/analytics')) return 'vendor-analytics';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('gsap')) return 'vendor-animation';
          if (id.includes('d3-force') || id.includes('d3-')) return 'vendor-graph';
          return 'vendor';
        },
      },
    },
  },
})
