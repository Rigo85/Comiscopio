cmake_minimum_required(VERSION 3.16)
project(comiscopio-worker LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Find libvips via pkg-config
find_package(PkgConfig REQUIRED)
pkg_check_modules(VIPS REQUIRED IMPORTED_TARGET vips)
pkg_check_modules(ARCHIVE REQUIRED IMPORTED_TARGET libarchive)

# Find nlohmann/json
find_package(nlohmann_json REQUIRED)

# Sources
set(SOURCES
    src/app/main.cpp
    src/app/work_queue.cpp
    src/archive/libarchive_base.cpp
    src/archive/rar_backend.cpp
    src/archive/zip_backend.cpp
    src/archive/sevenz_backend.cpp
    src/archive/tar_backend.cpp
    src/image/image_pipeline.cpp
    src/image/placeholder.cpp
    src/output/manifest.cpp
    src/output/progress.cpp
)

add_executable(comiscopio-worker ${SOURCES})

target_include_directories(comiscopio-worker PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    /usr/include/unrar
)

target_link_libraries(comiscopio-worker PRIVATE
    PkgConfig::VIPS
    PkgConfig::ARCHIVE
    nlohmann_json::nlohmann_json
    unrar
)

# Install target
install(TARGETS comiscopio-worker RUNTIME DESTINATION bin)
