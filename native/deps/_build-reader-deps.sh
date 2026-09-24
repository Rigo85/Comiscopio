#!/usr/bin/env bash
# Runs only in the builder image. No reader library is installed on the host.
set -euo pipefail
source /opt/comiscopio-build/versions.env
jobs=${COMISCOPIO_BUILD_JOBS:-2}
mkdir -p /tmp/readers /usr/local/share/comiscopio/licenses
cd /tmp/readers
fetch() {
    local url=$1 hash=$2 dir=$3
    curl --fail --location --retry 3 --connect-timeout 30 "$url" -o source.tar
    echo "$hash  source.tar" | sha256sum --check --strict
    mkdir "$dir"
    tar -xf source.tar -C "$dir" --strip-components=1
    rm source.tar
}
fetch "https://libarchive.org/downloads/libarchive-$ARCHIVE_VERSION.tar.xz" "$ARCHIVE_SHA256" archive
cmake -S archive -B archive/build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local \
    -DENABLE_TEST=OFF -DENABLE_TAR=OFF -DENABLE_CPIO=OFF -DENABLE_CAT=OFF -DENABLE_UNZIP=OFF
cmake --build archive/build --parallel "$jobs"
cmake --install archive/build
cp archive/COPYING /usr/local/share/comiscopio/licenses/libarchive.txt
fetch "https://github.com/libvips/libvips/releases/download/v$VIPS_VERSION/vips-$VIPS_VERSION.tar.xz" "$VIPS_SHA256" vips
# Compile optional image readers into libvips rather than host-dependent modules.
PKG_CONFIG_PATH=/usr/local/lib/pkgconfig meson setup vips/build vips --prefix=/usr/local --libdir=lib \
    --buildtype=release -Dmodules=disabled -Dintrospection=disabled -Dvapi=false \
    -Dcplusplus=false -Dexamples=false -Dmagick=enabled -Dheif=enabled \
    -Djpeg=enabled -Dpng=enabled -Dtiff=enabled -Dwebp=enabled
meson compile -C vips/build -j "$jobs"
meson install -C vips/build
cp vips/LICENSE /usr/local/share/comiscopio/licenses/libvips.txt
fetch "https://www.rarlab.com/rar/unrarsrc-$UNRAR_VERSION.tar.gz" "$UNRAR_SHA256" unrar
make -C unrar -j "$jobs" lib
install -m 644 unrar/libunrar.a /usr/local/lib/libunrar.a
mkdir -p /usr/local/include/unrar
cp unrar/*.hpp /usr/local/include/unrar/
cp unrar/license.txt /usr/local/share/comiscopio/licenses/unrar.txt
fetch "https://mupdf.com/downloads/archive/mupdf-$MUPDF_VERSION-source.tar.gz" "$MUPDF_SHA256" mupdf
# Upstream's bundled codec sources travel with the pinned MuPDF archive.
# This avoids mixing the new API with Ubuntu's old mupdf-third library.
make -C mupdf -j "$jobs" build=release HAVE_X11=no HAVE_GLUT=no HAVE_CURL=no \
    HAVE_LIBCRYPTO=no USE_TESSERACT=no USE_LEPTONICA=no USE_ZXINGCPP=no libs
make -C mupdf build=release HAVE_X11=no HAVE_GLUT=no HAVE_CURL=no \
    HAVE_LIBCRYPTO=no USE_TESSERACT=no USE_LEPTONICA=no USE_ZXINGCPP=no prefix=/usr/local install-libs
cp mupdf/COPYING /usr/local/share/comiscopio/licenses/mupdf.txt
mkdir -p /usr/local/share/comiscopio/licenses/mupdf-thirdparty
(cd mupdf/thirdparty && find . -type f \( -iname '*license*' -o -iname '*copying*' \) -exec cp --parents {} /usr/local/share/comiscopio/licenses/mupdf-thirdparty/ \;)
fetch "https://github.com/nlohmann/json/releases/download/v$JSON_VERSION/json.tar.xz" "$JSON_SHA256" json
cmake -S json -B json/build -DJSON_BuildTests=OFF -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --install json/build
cp json/LICENSE.MIT /usr/local/share/comiscopio/licenses/nlohmann-json.txt
ldconfig
dpkg-query -W '-f=${Package} ${Version}\n' > /usr/local/share/comiscopio/package-versions.txt
cp /opt/comiscopio-build/versions.env /usr/local/share/comiscopio/reader-versions.env
rm -rf /tmp/readers
