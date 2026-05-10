/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The single-threaded Stockfish "lite" build needs no cross-origin isolation, so we deliberately
// do NOT set Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy here. If you ever switch
// ENGINE_VARIANT to a multi-threaded build (SharedArrayBuffer), add:
//   server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin',
//                        'Cross-Origin-Embedder-Policy': 'require-corp' } }
// and the same headers on your static host.
export default defineConfig({
  plugins: [react()],
  // The engine .wasm is served verbatim from public/engine — keep Vite from trying to inline it.
  assetsInclude: ['**/*.wasm'],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
