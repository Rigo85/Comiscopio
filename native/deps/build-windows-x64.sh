#!/usr/bin/env bash
# Run in MSYS2 UCRT64. Packages are listed in docs/windows.md.
set -euo pipefail
[[ "${MSYSTEM:-}" == UCRT64 ]] || { echo 'Use the MSYS2 UCRT64 environment' >&2; exit 1; }
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
VENDOR="$ROOT/native/vendor/win32-x64"
STAGING="$ROOT/native/vendor/win32-x64-staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/bin" "$STAGING/licenses"
for component in worker doc-worker; do
    cmake -S "native/$component" -B "native/$component/build-win" -G Ninja \
        -DCMAKE_BUILD_TYPE=Release -DPKG_CONFIG_ARGN=--define-prefix
    cmake --build "native/$component/build-win" --parallel "${COMISCOPIO_BUILD_JOBS:-2}"
    cp "native/$component/build-win/comiscopio-$component.exe" "$STAGING/bin/"
done
ctest --test-dir native/worker/build-win --output-on-failure

# The legacy ACE decoder stays isolated in a POSIX helper. It uses the MSYS2
# runtime, bundled privately; the viewer and other readers are native UCRT64.
command -v /usr/bin/gcc >/dev/null || { echo 'Install MSYS2 gcc to build the ACE helper' >&2; exit 1; }
ACE_BUILD="$ROOT/native/ace-helper/build-win"
mkdir -p "$ACE_BUILD"
mkdir -p "$ACE_BUILD/include"
cp -r /ucrt64/include/nlohmann "$ACE_BUILD/include/"
make -C native/ace-helper/third_party/unace-nonfree \
    CC=/usr/bin/gcc CFLAGS='-O2' EXECS_DIR="$ACE_BUILD/"
cp "$ACE_BUILD/unace.exe" "$STAGING/bin/comiscopio-unace.exe"
/usr/bin/g++ -std=c++17 -D_POSIX_C_SOURCE=200809L -O2 -static-libgcc -static-libstdc++ \
    -I native/ace-helper/include -I "$ACE_BUILD/include" \
    native/ace-helper/src/app/main.cpp native/ace-helper/src/helper_archive_utils.cpp \
    -o "$STAGING/bin/comiscopio-ace-helper.exe"

# BMP and AVIF readers are libvips plugins, absent from executable imports.
# Preserve the layout libvips discovers relative to its DLL in bin/.
vips_abi=$(pkg-config --modversion vips | cut -d. -f1,2)
modules="lib/vips-modules-$vips_abi"
mkdir -p "$STAGING/$modules"
for reader in magick heif; do
    cp "/ucrt64/$modules/vips-$reader.dll" "$STAGING/$modules/"
done
mkdir -p "$STAGING/lib/magick"
for coder in /ucrt64/lib/ImageMagick-*/modules-*/coders/{magick,bmp}.dll; do
    [[ -f "$coder" ]] || { echo 'ImageMagick BMP coder missing' >&2; exit 1; }
    cp "$coder" "${coder%.dll}.la" "$STAGING/lib/magick/"
done

# Resolve imported DLLs recursively, including the dynamically loaded readers.
# Fail on any unresolved import outside Windows system DLLs.
declare -A visited
queue=("$STAGING"/bin/*.exe "$STAGING/$modules"/*.dll "$STAGING/lib/magick"/*.dll)
for ((index = 0; index < ${#queue[@]}; index++)); do
    binary=${queue[index]}
    while read -r dll; do
        key=${dll,,}
        [[ -n "${visited[$key]:-}" ]] && continue
        visited[$key]=1
        source=''
        for directory in /ucrt64/bin /usr/bin; do
            if [[ -f "$directory/$dll" ]]; then source="$directory/$dll"; break; fi
        done
        if [[ -n "$source" ]]; then
            cp "$source" "$STAGING/bin/$dll"
            queue+=("$STAGING/bin/$dll")
        elif [[ "$key" == api-ms-win-* || "$key" == ext-ms-win-* || -f "/c/Windows/System32/$dll" ]]; then
            :
        else
            echo "Unresolved dependency: $dll ($binary)" >&2
            exit 1
        fi
    done < <(objdump -p "$binary" | awk '/DLL Name:/ {print $3}')
done
cp native/ace-helper/third_party/unace-nonfree/licence "$STAGING/licenses/unace.txt"
cp native/worker/build-win/_deps/unrar-src/license.txt "$STAGING/licenses/unrar.txt"
cp -r /ucrt64/share/licenses/. "$STAGING/licenses/"
if [[ -d /usr/share/licenses/msys2-runtime ]]; then cp -r /usr/share/licenses/msys2-runtime "$STAGING/licenses/"; fi
pacman -Q > "$STAGING/package-versions.txt"
pkg-config --modversion vips libarchive mupdf > "$STAGING/reader-versions.txt"
rm -rf "$VENDOR"
mv "$STAGING" "$VENDOR"
echo "Native Windows bundle: $VENDOR"
