# ENet as a plain C static library, target `enet`, for CTR_ONLINE builds and
# tests/online. ENet's own CMakeLists.txt declares a C++ project, which fails
# where no C++ compiler is installed (the i686 build image); this file runs
# the same feature checks for C only. externals/enet stays unchanged.

set(ENET_DIR ${CMAKE_CURRENT_LIST_DIR}/enet)

add_library(enet STATIC
    ${ENET_DIR}/callbacks.c
    ${ENET_DIR}/compress.c
    ${ENET_DIR}/host.c
    ${ENET_DIR}/list.c
    ${ENET_DIR}/packet.c
    ${ENET_DIR}/peer.c
    ${ENET_DIR}/protocol.c
    ${ENET_DIR}/unix.c
    ${ENET_DIR}/win32.c
)
target_include_directories(enet PUBLIC ${ENET_DIR}/include)

if(WIN32)
    target_link_libraries(enet PUBLIC ws2_32 winmm)
else()
    include(CheckFunctionExists)
    include(CheckStructHasMember)
    include(CheckTypeSize)
    foreach(fn fcntl poll getaddrinfo getnameinfo gethostbyname_r gethostbyaddr_r inet_pton inet_ntop)
        string(TOUPPER "HAS_${fn}" var)
        check_function_exists(${fn} ENET_${var})
        if(ENET_${var})
            target_compile_definitions(enet PRIVATE ${var}=1)
        endif()
    endforeach()
    check_struct_has_member("struct msghdr" "msg_flags" "sys/types.h;sys/socket.h" ENET_HAS_MSGHDR_FLAGS)
    if(ENET_HAS_MSGHDR_FLAGS)
        target_compile_definitions(enet PRIVATE HAS_MSGHDR_FLAGS=1)
    endif()
    set(CMAKE_EXTRA_INCLUDE_FILES "sys/types.h" "sys/socket.h")
    check_type_size("socklen_t" ENET_HAS_SOCKLEN_T BUILTIN_TYPES_ONLY)
    unset(CMAKE_EXTRA_INCLUDE_FILES)
    if(ENET_HAS_SOCKLEN_T)
        target_compile_definitions(enet PRIVATE HAS_SOCKLEN_T=1)
    endif()
endif()
