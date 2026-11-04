// Builds the page's interface next to index.html : <out>/ui.js (the game page), <out>/guest.js
// (Share's guest page, web/share/guest.html), the modules they share, <out>/ui.css for both (fonts
// inlined), <out>/LilitaOne-OFL.txt. web/emscripten.cmake runs it with CTR_UI_OUT=<build>/ui (the
// whole directory is rewritten : guest.js needs no rule of its own) ; `npm run build` alone writes
// dist/.
// `vite` (serve, web/dev.sh dev) : the dev server with hot reload, rooted at web/ — the page's
// SOURCES (index.html, share/, online/, net/, disc.js), never the build's copies — and the game
// files only the build makes (ctr_native.js / .wasm, preload-flag.js, audio/spu.wasm) from CTR_GAME_DIR.
// __CTR_DEV__ : the debug-only pieces (the home's second window, the Bot switch, Settings › Dev) ;
// true under serve and in a Debug build (emscripten.cmake sets CTR_DEV=1), false in Release, where
// the bundle carries none of them.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const GAME_FILES = { 'ctr_native.js': 'text/javascript', 'ctr_native.wasm': 'application/wasm', 'ctr_native.data': 'application/octet-stream', 'preload-flag.js': 'text/javascript', 'ctr-u.bin': 'application/octet-stream', 'audio/spu.wasm': 'application/wasm' }
// the bundle's names (what index.html and share/guest.html load) → the entries' sources
const ENTRIES = { '/ui/ui.js': '/ui/src/main.js', '/ui/guest.js': '/ui/src/guest.js' }

/** The dev server's game files and entry names, ahead of Vite's own middlewares. */
const devPage = (gameDir) => ({
  name: 'ctr-dev-page',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = req.url.split('?')[0]
      const name = path.slice(1)
      if (ENTRIES[path]) { req.url = ENTRIES[path] + req.url.slice(path.length); return next() }
      // the CSS comes with the entry module in dev
      if (path === '/ui/ui.css') { res.setHeader('Content-Type', 'text/css'); return res.end('') }
      if (!GAME_FILES[name]) return next()
      const file = join(gameDir, name)
      if (!existsSync(file)) { res.statusCode = 404; return res.end(`${name} : not in ${gameDir} — wtf ctr build`) }
      res.setHeader('Content-Type', GAME_FILES[name])
      res.setHeader('Content-Length', statSync(file).size)
      res.setHeader('Cache-Control', 'no-store')
      createReadStream(file).pipe(res)
    })
  },
})

export default defineConfig(({ command }) => ({
  ...(command === 'serve' ? { root: '..', server: { fs: { allow: ['..'] } } } : {}),
  define: { __CTR_DEV__: JSON.stringify(command === 'serve' || process.env.CTR_DEV === '1') },
  plugins: [
    devPage(resolve(process.env.CTR_GAME_DIR || '../../build-web-debug')),
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
}))
