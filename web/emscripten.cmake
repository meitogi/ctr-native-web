# Emscripten (wasm32) build of ctr_native, included from the top-level
# CMakeLists.txt when the Emscripten toolchain is active.
#
# CTR_Main() never returns and paces itself in VSync(): ASYNCIFY lets VSync()
# yield to the browser with emscripten_sleep() instead of inverting the loop.
# The outputs are ctr_native.js / .wasm (+ .data when the disc is preloaded)
# and index.html, the page that loads them.

option(CTR_WEB_PRELOAD_DISC "Dev only: bundle assets/ctr-u.bin into ctr_native.data" OFF)
set(CTR_WEB_ASYNCIFY ON CACHE BOOL "Link with -sASYNCIFY (OFF only to measure its overhead)")

target_link_options(ctr_native PRIVATE
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=64MB
    -sSTACK_SIZE=1MB
    -sMIN_WEBGL_VERSION=2
    -sMAX_WEBGL_VERSION=2
    -sFORCE_FILESYSTEM=1
    -sEXPORTED_RUNTIME_METHODS=FS
    -lidbfs.js
    # Decompiled code calls through function pointers whose type differs from
    # the target's (e.g. u16 MM_Title_ThTick called as a void ThreadFunc).
    # x86 tolerates it, wasm's call_indirect traps : emulate the casts.
    -sEMULATE_FUNCTION_POINTER_CASTS=1
)
# Debug links keep the function names (-g2) and drop DWARF : CMAKE_C_FLAGS_DEBUG's -g carries
# DWARF through every wasm-opt pass, doubling the wasm (13.3 → 6.3 MB) and the link time. The
# objects are still compiled with -g ; no one steps through the C in DevTools.
target_link_options(ctr_native PRIVATE $<$<CONFIG:Debug>:-g2>)
# Release links at -O2, after CMAKE_C_FLAGS_RELEASE's -O3 (the objects are already -O2, set in
# CMakeLists.txt) : the link is ~2 s shorter, the wasm 2 % bigger, and the fps suite measured
# the same presents and main-thread time per frame as -O3 (LOG 18).
target_link_options(ctr_native PRIVATE $<$<CONFIG:Release>:-O2>)
if(CTR_WEB_ASYNCIFY)
    # wasm-opt inlines every function that has a single caller, whatever its size : the whole
    # game loop ended up in main() (605 B → 257 KB), which ASYNCIFY must instrument, and
    # optimizing that one function was ~18 s of the 23 s release link. Capped at 1000 IR nodes :
    # link 23 → 5 s, wasm +0.7 %, the same main-thread time per frame. (Narrowing the
    # instrumented set with ASYNCIFY_IGNORE_INDIRECT gained no link time : LOG 18.)
    target_link_options(ctr_native PRIVATE -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=1048576
        -sBINARYEN_EXTRA_PASSES=--one-caller-inline-max-function-size=1000)
endif()

if(CTR_WEB_PRELOAD_DISC)
    set(CTR_WEB_DISC "${CMAKE_SOURCE_DIR}/assets/ctr-u.bin")
    if(NOT EXISTS "${CTR_WEB_DISC}")
        message(FATAL_ERROR "CTR_WEB_PRELOAD_DISC needs ${CTR_WEB_DISC}")
    endif()
    target_link_options(ctr_native PRIVATE "--preload-file=${CTR_WEB_DISC}@/assets/ctr-u.bin")
    set_property(TARGET ctr_native APPEND PROPERTY LINK_DEPENDS "${CTR_WEB_DISC}")
endif()

# index.html's drop zone needs to know, before ctr_native.js even exists on
# disk, whether this is a CTR_WEB_PRELOAD_DISC dev build: the preloaded disc
# lives in MEMFS, invisible to the page, so on those builds the drop zone
# must get out of the way and boot immediately instead of waiting on OPFS.
if(CTR_WEB_PRELOAD_DISC)
    file(WRITE "${CMAKE_BINARY_DIR}/preload-flag.js" "window.__CTR_WEB_PRELOAD = true;\n")
else()
    file(WRITE "${CMAKE_BINARY_DIR}/preload-flag.js" "window.__CTR_WEB_PRELOAD = false;\n")
endif()

# The version (web/build-web.sh : git describe --tags --match 'v*') : Settings › System reads it
# from the same small file, the Netplay build's title draws it (game/230/MM_MenuFlow.c)
set(CTR_WEB_VERSION "dev" CACHE STRING "The version shown on the page and the title")
file(APPEND "${CMAKE_BINARY_DIR}/preload-flag.js" "window.__CTR_VERSION = \"${CTR_WEB_VERSION}\";\n")
target_compile_definitions(ctr_native PRIVATE CTR_WEB_VERSION=\"${CTR_WEB_VERSION}\")
# The default relay of a fork's own page (web/build-web.sh : CTR_RELAY_URL ; the Pages workflow sets
# it from the repository variable). Empty : no line, the page keeps web/net/relay-default.js's.
set(CTR_WEB_RELAY "" CACHE STRING "The page's default relay (ws:// or wss://) ; empty = the built-in one")
if(CTR_WEB_RELAY)
    if(NOT CTR_WEB_RELAY MATCHES "^wss?://[^ \t\"'\\]+$")
        message(FATAL_ERROR "CTR_WEB_RELAY must be a ws:// or wss:// URL, got '${CTR_WEB_RELAY}'")
    endif()
    file(APPEND "${CMAKE_BINARY_DIR}/preload-flag.js" "window.__CTR_RELAY = \"${CTR_WEB_RELAY}\";\n")
endif()
# Its key (CTR_RELAY_KEY), for a fork whose players should never type one. Built into a public page,
# it is public : anyone reads it in the page's source. Empty : no line, no key (our own site).
set(CTR_WEB_RELAY_KEY "" CACHE STRING "A relay key built into the page (public) ; empty = none")
if(CTR_WEB_RELAY_KEY)
    if(NOT CTR_WEB_RELAY_KEY MATCHES "^[A-Za-z0-9+/=_.~-]+$")
        message(FATAL_ERROR "CTR_WEB_RELAY_KEY may hold letters, digits and + / = _ . ~ - only")
    endif()
    file(APPEND "${CMAKE_BINARY_DIR}/preload-flag.js" "window.__CTR_RELAY_KEY = \"${CTR_WEB_RELAY_KEY}\";\n")
endif()

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/index.html"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_SOURCE_DIR}/web/index.html" "${CMAKE_BINARY_DIR}/index.html"
    DEPENDS "${CMAKE_SOURCE_DIR}/web/index.html"
)
add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/disc.js"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_SOURCE_DIR}/web/disc.js" "${CMAKE_BINARY_DIR}/disc.js"
    DEPENDS "${CMAKE_SOURCE_DIR}/web/disc.js"
)
# The interface (web/ui : Svelte 5 + Vite, see its package.json) : boot screen, disc drop, Settings,
# toasts. Built into ui/ next to index.html (ui.js, ui.css, the font's licence) with the node / npm
# on PATH (emsdk_env.sh puts emsdk's node there). npm ci runs when package-lock.json changes ;
# node_modules stays in web/ui/ (gitignored), shared by every build directory of the tree.
find_program(CTR_WEB_NODE node REQUIRED)
find_program(CTR_WEB_NPM npm REQUIRED)
set(CTR_WEB_UI_DIR "${CMAKE_SOURCE_DIR}/web/ui")
# __CTR_DEV__ in the bundle (vite.config.js) : the debug-only pieces in a Debug build only
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(CTR_WEB_UI_DEV 1)
else()
    set(CTR_WEB_UI_DEV 0)
endif()
file(GLOB_RECURSE CTR_WEB_UI_SOURCES CONFIGURE_DEPENDS "${CTR_WEB_UI_DIR}/src/*")
add_custom_command(
    OUTPUT "${CTR_WEB_UI_DIR}/node_modules/.package-lock.json"
    COMMAND "${CTR_WEB_NPM}" ci --no-audit --no-fund --loglevel=error
    WORKING_DIRECTORY "${CTR_WEB_UI_DIR}"
    DEPENDS "${CTR_WEB_UI_DIR}/package.json" "${CTR_WEB_UI_DIR}/package-lock.json"
    COMMENT "web/ui : npm ci"
)
add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/ui/ui.js" "${CMAKE_BINARY_DIR}/ui/ui.css"
    COMMAND ${CMAKE_COMMAND} -E env "CTR_UI_OUT=${CMAKE_BINARY_DIR}/ui" "CTR_DEV=${CTR_WEB_UI_DEV}"
            "${CTR_WEB_NODE}" node_modules/vite/bin/vite.js build --logLevel warn
    WORKING_DIRECTORY "${CTR_WEB_UI_DIR}"
    DEPENDS ${CTR_WEB_UI_SOURCES} "${CTR_WEB_UI_DIR}/vite.config.js" "${CMAKE_SOURCE_DIR}/web/disc.js"
            # the home page's room code (src/lib/join.js) bundles these
            "${CMAKE_SOURCE_DIR}/web/net/code.js" "${CMAKE_SOURCE_DIR}/web/net/link.js"
            "${CMAKE_SOURCE_DIR}/web/net/signaling.js" "${CMAKE_SOURCE_DIR}/web/net/crypto.js"
            "${CMAKE_SOURCE_DIR}/web/net/events.js" "${CMAKE_SOURCE_DIR}/web/net/relay-default.js"
            "${CTR_WEB_UI_DIR}/node_modules/.package-lock.json"
    COMMENT "web/ui : vite build"
)
add_custom_target(ctr_web_page ALL DEPENDS "${CMAKE_BINARY_DIR}/index.html" "${CMAKE_BINARY_DIR}/disc.js"
    "${CMAKE_BINARY_DIR}/ui/ui.js" "${CMAKE_BINARY_DIR}/ui/ui.css")
include(${CMAKE_SOURCE_DIR}/web/share/share.cmake)
include(${CMAKE_SOURCE_DIR}/web/audio/audio.cmake)
