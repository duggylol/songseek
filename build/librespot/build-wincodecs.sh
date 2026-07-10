#!/bin/bash
set -e
HOST=x86_64-w64-mingw32
SYS=/private/tmp/claude-501/-Users-augustin-songseek/f9c2b564-61f7-4cd3-9f51-ad8b3d4c9bf9/scratchpad/winsys
SRC=/private/tmp/claude-501/-Users-augustin-songseek/f9c2b564-61f7-4cd3-9f51-ad8b3d4c9bf9/scratchpad/codecsrc
mkdir -p "$SYS" "$SRC"
cd "$SRC"

dl() { [ -f "$2" ] || curl -sL -o "$2" "$1"; }
dl https://downloads.xiph.org/releases/ogg/libogg-1.3.5.tar.gz libogg.tar.gz
dl https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.gz libvorbis.tar.gz
dl https://downloads.xiph.org/releases/flac/flac-1.4.3.tar.xz flac.tar.xz

CFG="--host=$HOST --prefix=$SYS --enable-static --disable-shared"

echo "=== libogg ==="
rm -rf libogg-1.3.5 && tar xf libogg.tar.gz && cd libogg-1.3.5
./configure $CFG >/dev/null 2>&1 && make -j4 >/dev/null 2>&1 && make install >/dev/null 2>&1
cd "$SRC"

echo "=== libvorbis ==="
rm -rf libvorbis-1.3.7 && tar xf libvorbis.tar.gz && cd libvorbis-1.3.7
./configure $CFG --with-ogg="$SYS" PKG_CONFIG_PATH="$SYS/lib/pkgconfig" >/dev/null 2>&1 && make -j4 >/dev/null 2>&1 && make install >/dev/null 2>&1
cd "$SRC"

echo "=== flac ==="
rm -rf flac-1.4.3 && tar xf flac.tar.xz && cd flac-1.4.3
./configure $CFG --disable-programs --disable-examples --disable-doxygen-docs --disable-cpplibs \
  --with-ogg="$SYS" PKG_CONFIG_PATH="$SYS/lib/pkgconfig" >/dev/null 2>&1 && make -j4 >/dev/null 2>&1 && make install >/dev/null 2>&1
cd "$SRC"

echo "=== installed libs ==="
ls -1 "$SYS/lib"/*.a
ls -1 "$SYS/lib/pkgconfig"/*.pc
echo "DONE"
