// Builds the page's interface next to index.html : <out>/ui.js (the game page), <out>/guest.js
// (Share's guest page, web/share/guest.html), the modules they share, <out>/ui.css for both (fonts
// inlined), <out>/LilitaOne-OFL.txt. web/emscripten.cmake runs it with CTR_UI_OUT=<build>/ui (the
// whole directory is rewritten : guest.js needs no rule of its own) ; `npm run build` alone writes
// dist/.
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
      entry: { ui: 'src/main.js', guest: 'src/guest.js' },
      formats: ['es'],
      fileName: (_, name) => `${name}.js`,
      cssFileName: 'ui',
    },
  },
})
