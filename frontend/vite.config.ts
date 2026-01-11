import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-data-files',
      configureServer(server) {
        // Use a higher priority to run before Vite's default static file serving
        server.middlewares.use('/data', (req, res, next) => {
          // Serve files from parent data directory
          // req.url will be like "/data/stock_data/stock_data.csv?t=123456"
          if (!req.url) {
            next();
            return;
          }
          
          // Strip query string first
          const urlPath = req.url.split('?')[0];
          // Remove /data prefix to get relative path like "/stock_data/stock_data.csv"
          const relativePath = urlPath.replace(/^\/data/, '').replace(/^\//, '');
          // Resolve to absolute path: frontend/../data/stock_data/stock_data.csv
          const filePath = resolve(__dirname, '..', 'data', relativePath);
          
          console.log(`[Vite Middleware] Request: ${req.url} -> ${filePath}`);
          
          try {
            const content = readFileSync(filePath, 'utf-8');
            const ext = filePath.split('.').pop()?.toLowerCase();
            const contentType = ext === 'json' ? 'application/json' : 
                               ext === 'csv' ? 'text/csv' : 'text/plain';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            
            // Log file size for debugging
            const lineCount = content.split('\n').length;
            console.log(`[Vite Middleware] Serving ${filePath}: ${content.length} bytes, ${lineCount} lines`);
            res.end(content);
          } catch (err: any) {
            console.error(`[Vite Middleware] Error serving ${filePath}:`, err.message);
            next();
          }
        });
      },
      // Run this plugin before Vite's default static file serving
      enforce: 'pre'
    }
  ],
  server: {
    port: 3000,
    strictPort: true, // Fail if port 3000 is not available instead of trying another port
    hmr: {
      port: 3000, // Use the same port for HMR (Hot Module Replacement)
      clientPort: 3000, // Client-side HMR port
      protocol: 'ws', // Use WebSocket protocol
      overlay: true, // Show error overlay
    },
    open: process.env.CLEAR_CACHE === 'true' ? '/?clearCache=true' : true,
    fs: {
      // Allow serving files from parent directory
      allow: ['..']
    },
    watch: {
      usePolling: false,
    }
  },
  // Disable public directory to prevent conflicts
  publicDir: false
})

