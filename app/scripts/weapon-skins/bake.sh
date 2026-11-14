#!/bin/sh
# Bakes one gun's skins end to end: bake.sh <rifle|sniper|plasma> [skin ...]
# With skin names, only those skins' maps are recomposed (the mesh, fields,
# normal map and AO are reused from the work directory) and shipped.
# Env: BLENDER (default: Blender.app on macOS, else `blender`), RES (1024),
# WEAPON_SKINS_WORK (default: $TMPDIR/ghosts-weapon-skins).
set -e
gun=$1
[ -n "$gun" ] || { echo "usage: bake.sh <rifle|sniper|plasma> [skin ...]"; exit 2; }
shift
here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$here/../.." && pwd)
work=${WEAPON_SKINS_WORK:-${TMPDIR:-/tmp}/ghosts-weapon-skins}/$gun
res=${RES:-1024}
if [ -z "$BLENDER" ]; then
    BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
    [ -x "$BLENDER" ] || BLENDER=blender
fi
# Heavy stages run one at a time, politely.
run() { nice -n 10 "$@"; }
blend() { run "$BLENDER" --background "$@" 2>&1 | grep -E "^(UVREPORT|FIELDS|NORMAL|SKINS|STENCIL|PIECE|EXPORTED)|Error|Traceback|line [0-9]" || true; }
mkdir -p "$work"
cd "$app"
run node --experimental-strip-types scripts/weapon-skins/source.ts "$gun" "$work"
run node scripts/weapon-skins/decals.mjs "$work/decals" >/dev/null
# Each stage must leave its output behind (Blender exits 0 on script errors).
need() { [ -s "$1" ] || { echo "stage failed: no $1"; exit 1; }; }
if [ $# -eq 0 ]; then
    rm -rf "$work/low_uv.blend" "$work/fields" "$work/geometry.glb" "$work/textures"
    blend --python scripts/weapon-skins/stage_uv.py -- "$work"
    need "$work/low_uv.blend"
    blend "$work/low_uv.blend" --python scripts/weapon-skins/stage_fields.py -- "$work" "$res"
    need "$work/fields/ao.npy"
    blend "$work/low_uv.blend" --python scripts/weapon-skins/export.py -- "$work"
    need "$work/geometry.glb"
fi
blend --factory-startup --python scripts/weapon-skins/skins.py -- "$work" "$@"
need "$work/textures/normal.png"
run node scripts/weapon-skins/assets.mjs "$gun" "$work"
