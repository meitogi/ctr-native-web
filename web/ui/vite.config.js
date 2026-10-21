// Builds the page's interface into one ES module + one stylesheet, next to index.html :
// <out>/ui.js, <out>/ui.css (fonts inlined), <out>/LilitaOne-OFL.txt. web/emscripten.cmake runs it
// with CTR_UI_OUT=<build>/ui ; `npm run build` alone writes dist/.
import { readFileSync } from 'node:fs'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'font-licence',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'LilitaOne-OFL.txt', source: readFileSync(new URL('./src/assets/LilitaOne-OFL.txt', import.meta.url)) })
      },
    },
  ],
  publicDir: false,
  build: {
    outDir: process.env.CTR_UI_OUT || 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 1 << 20,
    sourcemap: false,
    target: 'es2022',
    lib: {
      entry: 'src/main.js',
      formats: ['es'],
      fileName: () => 'ui.js',
      cssFileName: 'ui',
    },
  },
})
