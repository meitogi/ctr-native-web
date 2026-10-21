# Share mode (web/share/README.md) : the host panel and the guest page are plain ES modules
# next to index.html — share/*.{js,html} and the network layer they import, net/*.js.
# Included from web/emscripten.cmake ; no link flag, the game reaches the page through two
# EM_JS hooks (platform/native_renderer.c, platform/native_input.c).
file(GLOB CTR_WEB_SHARE_FILES CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/web/share/*.js" "${CMAKE_SOURCE_DIR}/web/share/*.html")
# The CTR_ONLINE build already copies web/net/ (CMakeLists.txt) : one rule per output.
if(NOT TARGET ctr_web_online_page)
    file(GLOB CTR_WEB_NET_FILES CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/web/net/*.js")
    list(APPEND CTR_WEB_SHARE_FILES ${CTR_WEB_NET_FILES})
endif()
set(CTR_WEB_SHARE_OUTPUTS)
foreach(src IN LISTS CTR_WEB_SHARE_FILES)
    file(RELATIVE_PATH rel "${CMAKE_SOURCE_DIR}/web" "${src}")
    add_custom_command(
        OUTPUT "${CMAKE_BINARY_DIR}/${rel}"
        COMMAND ${CMAKE_COMMAND} -E copy "${src}" "${CMAKE_BINARY_DIR}/${rel}"
        DEPENDS "${src}"
    )
    list(APPEND CTR_WEB_SHARE_OUTPUTS "${CMAKE_BINARY_DIR}/${rel}")
endforeach()
add_custom_target(ctr_web_share_page ALL DEPENDS ${CTR_WEB_SHARE_OUTPUTS})
