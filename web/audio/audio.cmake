# The game's sound (web/audio/audio.js) : the SPU in an AudioWorklet. spu.wasm is
# platform/native_audio.c built a second time as the worklet's copy (CTR_AUDIO_WORKLET) : a
# standalone wasm (no Emscripten JS, nothing imported), its exports called by spu-worklet.js.
# Always -O2 and no debug info : it mixes on the audio thread, in debug builds too. Included from
# web/emscripten.cmake ; audio/{audio.js,spu-worklet.js,spu.wasm} land next to index.html.
add_executable(ctr_spu platform/native_audio.c)
target_include_directories(ctr_spu PRIVATE ${CMAKE_SOURCE_DIR}/include ${CMAKE_SOURCE_DIR}/externals/SDL/include)
target_compile_definitions(ctr_spu PRIVATE CTR_NATIVE CTR_INTERNAL CTR_AUDIO_WORKLET)
# alone, not in main.c's unity build : SDL's headers before macros.h's `internal`, as there
target_compile_options(ctr_spu PRIVATE -O2 -include SDL3/SDL.h)
target_link_options(ctr_spu PRIVATE -O2 -g0 -sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=4MB -sSTACK_SIZE=256KB
    -sEXPORTED_FUNCTIONS=_NativeAudioWorklet_Alloc,_NativeAudioWorklet_Free,_NativeAudioWorklet_Apply,_NativeAudioWorklet_Render,_NativeAudioWorklet_Feedback)
set_target_properties(ctr_spu PROPERTIES
    C_STANDARD 17
    OUTPUT_NAME spu
    SUFFIX ".wasm"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/audio"
)

set(CTR_WEB_AUDIO_OUTPUTS)
foreach(name audio.js spu-worklet.js)
    add_custom_command(
        OUTPUT "${CMAKE_BINARY_DIR}/audio/${name}"
        COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_SOURCE_DIR}/web/audio/${name}" "${CMAKE_BINARY_DIR}/audio/${name}"
        DEPENDS "${CMAKE_SOURCE_DIR}/web/audio/${name}"
    )
    list(APPEND CTR_WEB_AUDIO_OUTPUTS "${CMAKE_BINARY_DIR}/audio/${name}")
endforeach()
add_custom_target(ctr_web_audio_page ALL DEPENDS ${CTR_WEB_AUDIO_OUTPUTS})
add_dependencies(ctr_native ctr_spu)
