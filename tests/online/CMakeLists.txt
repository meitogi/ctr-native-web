# Headless OnlineCTR tests (docs/ONLINECTR_PORT.md, "What session 8
# validates natively", part A). A standalone project: it needs no game
# build, so it runs on any host word size (64-bit included).
#
#   cmake -S tests/online -B build-online && cmake --build build-online
#   ctest --test-dir build-online --output-on-failure
#
# Under Emscripten only the wire-format test is built (run under node).

cmake_minimum_required(VERSION 3.20)
project(ctr-online-tests C)

set(CMAKE_C_STANDARD 11)
set(ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../..)
enable_testing()

# A1 — wire format, with this tree's global.h and with upstream's
add_executable(online_golden_bytes golden_bytes.c)
add_executable(online_golden_bytes_upstream golden_bytes.c)
target_compile_definitions(online_golden_bytes_upstream PRIVATE
    GLOBAL_H="upstream/decompile/General/AltMods/OnlineCTR/global.h")
add_test(NAME online_golden_bytes COMMAND online_golden_bytes)
add_test(NAME online_golden_bytes_upstream COMMAND online_golden_bytes_upstream)

if(EMSCRIPTEN)
    return()
endif()

add_subdirectory(${ROOT}/externals/enet ${CMAKE_BINARY_DIR}/enet EXCLUDE_FROM_ALL)
target_include_directories(enet PUBLIC ${ROOT}/externals/enet/include)

# A2 — the original server, unchanged (upstream's own warning flags)
add_executable(ctr_srv_upstream
    upstream/mods/Windows/OnlineCTR/Network_PC/Server/SV_main.c
    upstream/mods/Windows/OnlineCTR/Network_PC/Server/SV_helper.c)
target_compile_options(ctr_srv_upstream PRIVATE
    -Wno-implicit-function-declaration -Wno-incompatible-pointer-types -Wno-implicit-int
    -Wno-int-conversion -Wno-builtin-declaration-mismatch -Wno-format -Wno-pointer-to-int-cast)
target_link_libraries(ctr_srv_upstream enet)

# D4 — sv_core.c behind ENet
set(SV_CORE ${ROOT}/platform/online_server/sv_core.c ${ROOT}/platform/online_server/sv_enet.c)
add_executable(ctr_srv_core ${SV_CORE} ${ROOT}/platform/online_server/sv_enet_main.c)
target_compile_options(ctr_srv_core PRIVATE -Wall -Wextra)
target_link_libraries(ctr_srv_core enet)

# A3-A5 — scripted clients: the bridge, its backends, a stub game
add_executable(online_test
    online_test.c stub_game.c
    ${ROOT}/platform/native_online.c
    ${ROOT}/platform/native_online_enet.c
    ${ROOT}/platform/native_online_loopback.c
    ${SV_CORE})
target_compile_definitions(online_test PRIVATE NATIVE_ONLINE_HAS_ENET _GNU_SOURCE)
target_compile_options(online_test PRIVATE -Wall -Wextra)
target_link_libraries(online_test enet)

set(TRACES ${CMAKE_BINARY_DIR}/traces)
add_test(NAME online_a2_a3_upstream_server
    COMMAND online_test --server $<TARGET_FILE:ctr_srv_upstream> --trace-dir ${TRACES}/upstream)
add_test(NAME online_a4_core_server
    COMMAND online_test --server $<TARGET_FILE:ctr_srv_core> --trace-dir ${TRACES}/core)
add_test(NAME online_a5_loopback_host
    COMMAND online_test --loopback --trace-dir ${TRACES}/loopback)
add_test(NAME online_a4_traces_core_vs_upstream
    COMMAND online_test --compare ${TRACES}/upstream ${TRACES}/core)
add_test(NAME online_a5_traces_loopback_vs_upstream
    COMMAND online_test --compare ${TRACES}/upstream ${TRACES}/loopback)
set_tests_properties(online_a4_traces_core_vs_upstream PROPERTIES
    DEPENDS "online_a2_a3_upstream_server;online_a4_core_server")
set_tests_properties(online_a5_traces_loopback_vs_upstream PROPERTIES
    DEPENDS "online_a2_a3_upstream_server;online_a5_loopback_host")
set_tests_properties(online_a2_a3_upstream_server online_a4_core_server online_a5_loopback_host
    PROPERTIES RUN_SERIAL TRUE TIMEOUT 180)
