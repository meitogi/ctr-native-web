# CLAUDE.md — ctr-native-web

The browser port of CTR Native (the decompiled PS1 game, built to WebAssembly with Emscripten).
What the project is and how to run it : [README.md](README.md).

## Versions

- **Every delivery gets the next version, never a re-tag.** The page shows `git describe`
  (boot screen, bottom right, and Settings), so it is how the user tells whether a build has the
  change. Pre-release while in beta : `v1.0.0-b.2` → `v1.0.0-b.3` → …
- The tag sits on the delivered commit itself : a lightweight local tag, so the version reads
  clean (no `-N-g<sha>` suffix). Rebuild the debug game afterwards (`web/dev.sh build debug`) so
  the running page shows it.

## Git

- `web/main` is the branch ; work happens in worktrees under `.claude/worktrees/<name>` on
  `web/<name>`, fast-forwarded into `web/main` once done.
- Commits are authored as `meitogi` (the repo's local identity). Commit and tag locally ; pushing
  `web/main` and the tags is the maintainer's step.

## Build and run

- `web/dev.sh dev` : Vite on 8090 (hot reload for the page), the game from `build-web-debug`, a
  relay on 8787. `web/dev.sh build [debug|release]` rebuilds the game ; reload the page after.
- Ports are listed once in [web/dev-ports.tsv](web/dev-ports.tsv) (`web/dev.sh ports --check`).
- Native builds : `build.sh` / `CMakePresets.json`. A native build with `-DCTR_ONLINE=ON` and
  `BUILD_TESTING` runs the Online tests of `tests/online/` through ctest.

## Tests

- `node --test` in `web/` : the page's unit tests.
- [web/test/player/](web/test/player/) : the player suites (`*.suite.mjs`), driving real
  browsers over CDP against a build served by `web/test/player/serve.py` (8091–8093) and a relay
  on 8788. A bug gets a scenario that reproduces it, run before and after the fix.
- Solo must stay byte-identical when Online is off : any change under `game/` is checked against
  an Online-off build of the previous commit.

## Code map and gotchas

- `game/` : the decompile. `game/230/` is the main-menu overlay (D230) ; `game/OnlineCTR/` the
  Netplay port. Online code sits under `#ifdef USE_ONLINE`, and retail behaviour stays untouched
  outside it.
- **D230 is never reloaded on native/web** (it is on the PS1) : menu cursors, menu `state` flags,
  the character select's locks and backups outlive every visit. A menu path that jumps over boxes
  must reset what it skips.
- C ↔ page : `EM_JS` hooks in `platform/` call `Module.ctrInput.*`, set by the page
  (`web/online/page.js`, `web/ui/`).
- `relay/` : the WebSocket relay for Share and Netplay rooms ([relay/README.md](relay/README.md)).
- Match the surrounding style : tabs in C, the existing comment density and tone.
