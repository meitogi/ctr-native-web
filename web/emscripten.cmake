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
if(CTR_WEB_ASYNCIFY)
    target_link_options(ctr_native PRIVATE -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=1048576)
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
    COMMAND ${CMAKE_COMMAND} -E env "CTR_UI_OUT=${CMAKE_BINARY_DIR}/ui"
            "${CTR_WEB_NODE}" node_modules/vite/bin/vite.js build --logLevel warn
    WORKING_DIRECTORY "${CTR_WEB_UI_DIR}"
    DEPENDS ${CTR_WEB_UI_SOURCES} "${CTR_WEB_UI_DIR}/vite.config.js" "${CMAKE_SOURCE_DIR}/web/disc.js"
            "${CTR_WEB_UI_DIR}/node_modules/.package-lock.json"
    COMMENT "web/ui : vite build"
)
add_custom_target(ctr_web_page ALL DEPENDS "${CMAKE_BINARY_DIR}/index.html" "${CMAKE_BINARY_DIR}/disc.js"
    "${CMAKE_BINARY_DIR}/ui/ui.js" "${CMAKE_BINARY_DIR}/ui/ui.css")
include(${CMAKE_SOURCE_DIR}/web/share/share.cmake)
