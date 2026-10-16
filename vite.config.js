import { defineConfig } from 'vite';

// STANDALONE=1 builds everything into one chunk, so it can be inlined into a
// single HTML file that opens straight from disk in its own browser tab.
const standalone = !!process.env.STANDALONE;

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    outDir: standalone ? 'dist-standalone' : 'dist',
    rollupOptions: standalone ? { output: { inlineDynamicImports: true } } : {},
  },
});
