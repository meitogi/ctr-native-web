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
)
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

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/index.html"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_SOURCE_DIR}/web/index.html" "${CMAKE_BINARY_DIR}/index.html"
    DEPENDS "${CMAKE_SOURCE_DIR}/web/index.html"
)
add_custom_target(ctr_web_page ALL DEPENDS "${CMAKE_BINARY_DIR}/index.html")
