#!/usr/bin/env bash
# Rebuilds an AppImage without the display-stack libraries linuxdeploy bundled into
# it. AppRun.wrapped puts $APPDIR/usr/lib ahead of the system directories on
# LD_LIBRARY_PATH, so the 22.04 build host's copies shadow the user's for everything
# loaded into the process — the host's own Mesa included. Mesa 25+ against a 1.20
# libwayland fails to create an EGL display, which aborts the web process before
# WebKit ever picks a renderer, so no WebKit environment variable can heal it and the
# window simply never opens (tauri-apps/tauri#15976).
#
# This makes the host's copies load-bearing: the bundled GTK names libwayland-client,
# libwayland-cursor and libwayland-egl in DT_NEEDED even under the GDK_BACKEND=x11 the
# AppRun hook forces, so a host with no Wayland stack at all now fails to load. That is
# the same bargain libX11 is already on — it was never bundled either — and every host
# new enough for the glibc the bundle requires (2.35) carries all ten, at versions at
# or above the ones dropped here.
set -eo pipefail

appimage=${1:?usage: $0 <path to .AppImage>}

# Sonames, matched with a trailing wildcard for the version suffix. Never a pattern
# loose enough to catch a GTK module beside them (usr/lib/im-wayland.so).
libs=(
  libwayland-client.so libwayland-cursor.so libwayland-egl.so libwayland-server.so
  libxkbcommon.so
  libxcb-randr.so libxcb-render.so libxcb-shm.so
  libXau.so libXdmcp.so
)

# A type 2 AppImage is its runtime ELF with the squashfs appended, so the payload
# starts where the ELF ends. Computed rather than asked for (`--appimage-offset`):
# the step must not depend on executing the bundle it is repacking.
elf_end() {
  local shoff shentsize shnum
  shoff=$(od -An -tu8 -j40 -N8 "$1" | tr -d ' ')
  shentsize=$(od -An -tu2 -j58 -N2 "$1" | tr -d ' ')
  shnum=$(od -An -tu2 -j60 -N2 "$1" | tr -d ' ')
  echo $((shoff + shentsize * shnum))
}

payload_at() {
  [ "$(dd if="$1" bs=1 skip="$2" count=4 2>/dev/null)" = hsqs ]
}

# What ships must carry none of them, whether or not this run removed any: a bundler
# that stopped shipping them is fine, a match that stopped matching is the original
# bug coming back with the step still reporting success.
assert_unbundled() {
  local listing lib
  listing=$(unsquashfs -quiet -no-progress -offset "$2" -ls "$1")
  # Fail closed: a listing that came back empty would clear every name below.
  grep -q '/AppRun$' <<<"$listing" ||
    { echo "$1: could not list the payload" >&2; exit 1; }
  for lib in "${libs[@]}"; do
    if grep -qF "/$lib" <<<"$listing"; then
      echo "$1: still carries $lib" >&2
      exit 1
    fi
  done
}

offset=$(elf_end "$appimage")
payload_at "$appimage" "$offset" ||
  { echo "$appimage: no squashfs at $offset — not a type 2 AppImage" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Keep the runtime the bundler shipped, and pack for it: another runtime would change
# the FUSE version users need, and a compressor it was not built with leaves an
# AppImage that mounts nowhere.
head -c "$offset" "$appimage" >"$work/runtime"
comp=$(unsquashfs -quiet -no-progress -offset "$offset" -s "$appimage" |
       awk '$1 == "Compression" { print $2 }')
[ -n "$comp" ] || { echo "$appimage: could not read the payload's compressor" >&2; exit 1; }

# umask: unsquashfs masks the modes it restores unless it runs as root, and a build
# agent's default 022 would quietly relax every mode the bundle recorded. The work
# directory is already private, so nothing is exposed by dropping it here.
(umask 000 && unsquashfs -quiet -no-progress -dest "$work/AppDir" -offset "$offset" "$appimage")

removed=0
for lib in "${libs[@]}"; do
  while IFS= read -r -d '' path; do
    rm -f "$path"
    echo "  dropped ${path#"$work/AppDir/"}"
    removed=$((removed + 1))
  done < <(find "$work/AppDir" -name "$lib*" -print0)
done

# The search covers the whole AppDir, so nothing found means the bundler stopped
# shipping them — leave the artifact the release built exactly as it is.
if [ "$removed" -eq 0 ]; then
  assert_unbundled "$appimage" "$offset"
  echo "$appimage: no bundled display-stack libraries — left untouched"
  exit 0
fi

appimagetool --runtime-file "$work/runtime" --comp "$comp" --no-appstream \
  "$work/AppDir" "$work/repacked"
mv "$work/repacked" "$appimage"
chmod +x "$appimage"

offset=$(elf_end "$appimage")
payload_at "$appimage" "$offset" ||
  { echo "$appimage: repacked payload is not a squashfs" >&2; exit 1; }
assert_unbundled "$appimage" "$offset"

echo "$appimage: dropped $removed bundled display-stack libraries"
