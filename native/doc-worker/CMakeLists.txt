cmake_minimum_required(VERSION 3.16)
project(comiscopio-doc-worker LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Find libvips via pkg-config
find_package(PkgConfig REQUIRED)
pkg_check_modules(VIPS REQUIRED IMPORTED_TARGET vips)
include(${CMAKE_CURRENT_SOURCE_DIR}/../deps/msys-pkg-config.cmake)
comiscopio_normalize_msys_target(PkgConfig::VIPS)

# Find nlohmann/json
find_package(nlohmann_json REQUIRED)
find_package(Threads REQUIRED)

option(MUPDF_BUNDLED_THIRD "Use upstream MuPDF with its bundled static codecs" OFF)
if(MUPDF_BUNDLED_THIRD)
    find_path(MUPDF_INCLUDE_DIR mupdf/fitz.h REQUIRED)
    find_library(MUPDF_LIB mupdf REQUIRED)
    find_library(MUPDF_THIRD_LIB mupdf-third REQUIRED)
elseif(WIN32)
pkg_check_modules(MUPDF REQUIRED IMPORTED_TARGET mupdf)
comiscopio_normalize_msys_target(PkgConfig::MUPDF)
else()
# MuPDF — static libraries + system dependencies
find_library(MUPDF_LIB mupdf REQUIRED)
find_library(MUPDF_THIRD_LIB mupdf-third REQUIRED)

# MuPDF system dependencies (not bundled in mupdf-third on Ubuntu)
find_package(ZLIB REQUIRED)
pkg_check_modules(FREETYPE REQUIRED IMPORTED_TARGET freetype2)
pkg_check_modules(HARFBUZZ REQUIRED IMPORTED_TARGET harfbuzz)
pkg_check_modules(OPENJP2 REQUIRED IMPORTED_TARGET libopenjp2)
pkg_check_modules(LIBJPEG REQUIRED IMPORTED_TARGET libjpeg)

# jbig2dec / gumbo / mujs — static in release builds, dynamic in dev
option(USE_STATIC_DEPS "Link small deps statically (set by Docker release build)" OFF)

if(USE_STATIC_DEPS)
    if(CMAKE_LIBRARY_ARCHITECTURE)
        set(_STATIC_PATHS "/usr/lib/${CMAKE_LIBRARY_ARCHITECTURE}")
    else()
        set(_STATIC_PATHS "/usr/lib")
    endif()
    set(CMAKE_FIND_LIBRARY_SUFFIXES ".a")
    find_library(JBIG2DEC_LIB jbig2dec PATHS ${_STATIC_PATHS} REQUIRED)
    find_library(GUMBO_LIB    gumbo    PATHS ${_STATIC_PATHS} REQUIRED)
    find_library(MUJS_LIB     mujs     PATHS ${_STATIC_PATHS} REQUIRED)
    set(CMAKE_FIND_LIBRARY_SUFFIXES ".so;.a")
    foreach(_lib JBIG2DEC_LIB GUMBO_LIB MUJS_LIB)
        if(NOT ${_lib})
            message(FATAL_ERROR "${_lib} not found — install: sudo apt install libjbig2dec0-dev libgumbo-dev libmujs-dev")
        endif()
    endforeach()
    message(STATUS "jbig2dec/gumbo/mujs: static")
else()
    find_library(JBIG2DEC_LIB jbig2dec PATHS /usr/lib/x86_64-linux-gnu)
    find_library(GUMBO_LIB    gumbo    PATHS /usr/lib/x86_64-linux-gnu)
    find_library(MUJS_LIB     mujs     PATHS /usr/lib/x86_64-linux-gnu)
    message(STATUS "jbig2dec/gumbo/mujs: dynamic")
endif()
endif()

# Sources
set(SOURCES
    src/app/main.cpp
    ../worker/src/app/work_queue.cpp
    src/render/mupdf_renderer.cpp
    ../worker/src/image/image_pipeline.cpp
    ../worker/src/image/placeholder.cpp
    ../worker/src/output/manifest.cpp
    ../worker/src/output/progress.cpp
)

add_executable(comiscopio-doc-worker ${SOURCES})

target_include_directories(comiscopio-doc-worker PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../worker/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(comiscopio-doc-worker PRIVATE
    PkgConfig::VIPS
    nlohmann_json::nlohmann_json
    Threads::Threads
)
if(MUPDF_BUNDLED_THIRD)
    target_include_directories(comiscopio-doc-worker PRIVATE ${MUPDF_INCLUDE_DIR})
    target_link_libraries(comiscopio-doc-worker PRIVATE ${MUPDF_LIB} ${MUPDF_THIRD_LIB} m)
    # MuPDF's bundled JPEG/zlib/etc. must stay private. Exporting their symbols
    # interposes on libvips' shared codecs and can mix incompatible JPEG ABIs.
    target_link_options(comiscopio-doc-worker PRIVATE "-Wl,--exclude-libs,libmupdf.a:libmupdf-third.a")
elseif(WIN32)
    target_link_libraries(comiscopio-doc-worker PRIVATE PkgConfig::MUPDF)
else()
target_link_libraries(comiscopio-doc-worker PRIVATE
    ${MUPDF_LIB}
    ${MUPDF_THIRD_LIB}
    PkgConfig::FREETYPE
    PkgConfig::HARFBUZZ
    PkgConfig::OPENJP2
    PkgConfig::LIBJPEG
    ZLIB::ZLIB
    ${JBIG2DEC_LIB}
    ${GUMBO_LIB}
    ${MUJS_LIB}
    m
)
endif()

# Install target
install(TARGETS comiscopio-doc-worker RUNTIME DESTINATION bin)

if(WIN32)
    enable_language(RC)
    target_sources(comiscopio-doc-worker PRIVATE ../deps/windows.rc)
    target_include_directories(comiscopio-doc-worker PRIVATE ../deps)
    target_compile_definitions(comiscopio-doc-worker PRIVATE NOMINMAX)
    target_link_libraries(comiscopio-doc-worker PRIVATE psapi)
endif()
