import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { obfuscatorPlugin } from "./vite-plugin-obfuscator";
import { stripConsolePlugin } from "./vite-plugin-console-strip";

export default defineConfig({
  cacheDir: 'node_modules/.vite',
  plugins: [
    react(),
    stripConsolePlugin(),
    tailwindcss(),
    // ✅ SECURITY: Obfuscate critical modules in production
    ...(process.env.NODE_ENV === 'production' ? [obfuscatorPlugin()] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    
    // ✅ PERFORMANCE: Optimize bundle
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug', 'console.info', 'console.warn'],
      },
    },
    
    // ✅ CRITICAL OPTIMIZATION: More granular chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['wouter'],
          
          // UI Framework - split by usage frequency
          'vendor-ui-core': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          'vendor-ui-forms': [
            '@radix-ui/react-select',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-label',
            '@radix-ui/react-switch',
          ],
          'vendor-ui-extra': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-hover-card',
            '@radix-ui/react-menubar',
            '@radix-ui/react-navigation-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-slot',
            '@radix-ui/react-toast',
            '@radix-ui/react-toggle',
            '@radix-ui/react-toggle-group',
          ],
          
          // Terminal - heavy, load separately
          'vendor-terminal': ['@xterm/xterm', '@xterm/addon-fit'],
          
          // State management
          'vendor-query': ['@tanstack/react-query'],
          'vendor-state': ['zustand'],
          
          // Icons - separate chunk
          'vendor-icons': ['lucide-react'],
          
          // Forms
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          
        },
      },
    },
    
    // ✅ PERFORMANCE: Optimize chunk size
    chunkSizeWarningLimit: 1000,
    
    // Source maps only in dev
    sourcemap: process.env.NODE_ENV === 'development',
  },
  
  // ✅ CRITICAL OPTIMIZATION: Optimize dependencies with tree-shaking
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@xterm/xterm',
      '@tanstack/react-query',
      'zustand',
    ],
    // ✅ Force pre-bundling for faster dev startup
    force: false,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
