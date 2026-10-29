import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Keep three.js in its own long-cached chunk.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
