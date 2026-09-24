# MSYS2 packages the UnRAR command, not its library. Build the official DLL API
# statically so the worker keeps the same streaming implementation on Windows.
include(FetchContent)
FetchContent_Declare(unrar
    URL https://www.rarlab.com/rar/unrarsrc-7.2.7.tar.gz
    URL_HASH SHA256=01d903a7dcf413cb2925696d7796e48e38d471f79bfe7ef3ad2aebf6c12dbefd
    TIMEOUT 120
    INACTIVITY_TIMEOUT 30
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(unrar)
set(_unrar_sources
    rar strlist strfn pathfn smallfn global file filefn filcreat archive arcread
    unicode system crypt crc rawread encname resource match timefn rdwrfn consio
    options errhnd rarvm secpassword rijndael getbits sha1 sha256 blake2s hash
    extinfo extract volume list find unpack headers threadpool rs16 cmddata ui
    largepage filestr scantree dll qopen isnt motw
)
list(TRANSFORM _unrar_sources PREPEND "${unrar_SOURCE_DIR}/")
list(TRANSFORM _unrar_sources APPEND ".cpp")
add_library(comiscopio-unrar STATIC ${_unrar_sources})
target_compile_definitions(comiscopio-unrar PRIVATE RARDLL UNRAR SILENT)
target_include_directories(comiscopio-unrar PUBLIC "${unrar_SOURCE_DIR}")
target_link_libraries(comiscopio-unrar PUBLIC shlwapi powrprof psapi wbemuuid)
set(UNRAR_LIB comiscopio-unrar)
set(UNRAR_INCLUDE_DIR "${unrar_SOURCE_DIR}")
