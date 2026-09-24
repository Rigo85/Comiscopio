cmake_minimum_required(VERSION 3.16)
project(comiscopio-worker LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Find libvips via pkg-config
find_package(PkgConfig REQUIRED)
pkg_check_modules(VIPS REQUIRED IMPORTED_TARGET vips)
pkg_check_modules(ARCHIVE REQUIRED IMPORTED_TARGET libarchive)
include(${CMAKE_CURRENT_SOURCE_DIR}/../deps/msys-pkg-config.cmake)
comiscopio_normalize_msys_target(PkgConfig::VIPS)
comiscopio_normalize_msys_target(PkgConfig::ARCHIVE)
find_package(Threads REQUIRED)

# Find nlohmann/json
find_package(nlohmann_json REQUIRED)

# libunrar — static in release builds (USE_STATIC_DEPS=ON), dynamic in dev
option(USE_STATIC_DEPS "Link small deps statically (set by Docker release build)" OFF)

if(WIN32)
    include(${CMAKE_CURRENT_SOURCE_DIR}/../deps/unrar.cmake)
elseif(USE_STATIC_DEPS)
    if(CMAKE_LIBRARY_ARCHITECTURE)
        set(_STATIC_PATHS "/usr/lib/${CMAKE_LIBRARY_ARCHITECTURE}")
    else()
        set(_STATIC_PATHS "/usr/lib")
    endif()
    set(CMAKE_FIND_LIBRARY_SUFFIXES ".a")
    find_library(UNRAR_LIB unrar PATHS ${_STATIC_PATHS} REQUIRED)
    set(CMAKE_FIND_LIBRARY_SUFFIXES ".so;.a")
    if(NOT UNRAR_LIB)
        message(FATAL_ERROR "libunrar.a not found — install: sudo apt install libunrar-dev")
    endif()
    message(STATUS "libunrar: static ${UNRAR_LIB}")
else()
    find_library(UNRAR_LIB unrar REQUIRED)
    message(STATUS "libunrar: dynamic ${UNRAR_LIB}")
endif()
if(NOT WIN32)
    find_path(UNRAR_INCLUDE_DIR dll.hpp PATH_SUFFIXES unrar REQUIRED)
endif()

# Sources
set(SOURCES
    src/app/main.cpp
    src/app/work_queue.cpp
    src/archive/archive_entry_utils.cpp
    src/archive/ace_backend.cpp
    src/archive/libarchive_base.cpp
    src/archive/rar_backend.cpp
    src/archive/zip_backend.cpp
    src/archive/folder_backend.cpp
    src/archive/sevenz_backend.cpp
    src/archive/tar_backend.cpp
    src/image/image_pipeline.cpp
    src/image/placeholder.cpp
    src/output/manifest.cpp
    src/output/progress.cpp
)

set(SEVEN_Z_SDK_SOURCES
    third_party/7zip-sdk-26.03/C/Bcj2.c
    third_party/7zip-sdk-26.03/C/Bra.c
    third_party/7zip-sdk-26.03/C/Bra86.c
    third_party/7zip-sdk-26.03/C/BraIA64.c
    third_party/7zip-sdk-26.03/C/CpuArch.c
    third_party/7zip-sdk-26.03/C/Delta.c
    third_party/7zip-sdk-26.03/C/Lzma2Dec.c
    third_party/7zip-sdk-26.03/C/LzmaDec.c
    third_party/7zip-sdk-26.03/C/Ppmd7.c
    third_party/7zip-sdk-26.03/C/Ppmd7Dec.c
    third_party/7zip-sdk-26.03/C/7zCrc.c
    third_party/7zip-sdk-26.03/C/7zCrcOpt.c
    third_party/7zip-sdk-26.03/C/7zAlloc.c
    third_party/7zip-sdk-26.03/C/7zArcIn.c
    third_party/7zip-sdk-26.03/C/7zBuf.c
    third_party/7zip-sdk-26.03/C/7zBuf2.c
    third_party/7zip-sdk-26.03/C/7zDec.c
    third_party/7zip-sdk-26.03/C/7zFile.c
    third_party/7zip-sdk-26.03/C/7zStream.c
)

add_executable(comiscopio-worker ${SOURCES} ${SEVEN_Z_SDK_SOURCES})

target_include_directories(comiscopio-worker PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/7zip-sdk-26.03/C
    ${UNRAR_INCLUDE_DIR}
)

target_compile_definitions(comiscopio-worker PRIVATE
    Z7_PPMD_SUPPORT
    Z7_EXTRACT_ONLY
)

target_link_libraries(comiscopio-worker PRIVATE
    PkgConfig::VIPS
    PkgConfig::ARCHIVE
    nlohmann_json::nlohmann_json
    ${UNRAR_LIB}
    Threads::Threads
    ${CMAKE_DL_LIBS}
)

add_executable(archive-entry-utils-test
    tests/archive_entry_utils_test.cpp
    src/archive/archive_entry_utils.cpp
)

target_include_directories(archive-entry-utils-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(archive-entry-utils-test PRIVATE
    PkgConfig::ARCHIVE
)

enable_testing()
add_test(NAME archive-entry-utils-test COMMAND archive-entry-utils-test)

# Install target
install(TARGETS comiscopio-worker RUNTIME DESTINATION bin)

add_executable(work-queue-test tests/work_queue_test.cpp src/app/work_queue.cpp)
target_include_directories(work-queue-test PRIVATE include)
add_test(NAME work-queue-test COMMAND work-queue-test)

add_executable(sevenz-backend-test
    tests/sevenz_backend_test.cpp
    src/archive/sevenz_backend.cpp
    src/archive/archive_entry_utils.cpp
    ${SEVEN_Z_SDK_SOURCES}
)
target_include_directories(sevenz-backend-test PRIVATE include third_party/7zip-sdk-26.03/C)
target_compile_definitions(sevenz-backend-test PRIVATE Z7_PPMD_SUPPORT Z7_EXTRACT_ONLY)
target_link_libraries(sevenz-backend-test PRIVATE PkgConfig::ARCHIVE)
add_test(NAME sevenz-backend-test COMMAND sevenz-backend-test
    ${CMAKE_CURRENT_SOURCE_DIR}/../../test/fixtures/archive)
if(WIN32)
    enable_language(RC)
    target_sources(comiscopio-worker PRIVATE ../deps/windows.rc)
    target_include_directories(comiscopio-worker PRIVATE ../deps)
    target_compile_definitions(comiscopio-worker PRIVATE NOMINMAX)
    target_link_libraries(comiscopio-worker PRIVATE psapi)
endif()
