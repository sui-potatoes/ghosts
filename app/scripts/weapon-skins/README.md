# Weapon skins

Bakes the skinned game mesh and every skin's maps for the long guns (`rifle`,
`sniper`, `plasma`) into `app/public/squad/weapons/skins/`. Rerun it for a gun
whenever its builder (`packages/squad/src/studio/<gun>.ts`, its standard clip
or stock) or a skin recipe changes. The bake never edits a builder: the
equipment-pose calibration hashes those files.

## Commands

From `app/`, with Blender 4.2 (headless) and the app's node modules:

```bash
scripts/weapon-skins/bake.sh rifle            # mesh, fields, maps, shipped files
scripts/weapon-skins/bake.sh sniper
scripts/weapon-skins/bake.sh plasma
scripts/weapon-skins/bake.sh rifle camo urban # recipes only: recompose these skins' maps
```

One gun at a time (each stage runs under `nice`); a full bake is one to two
minutes. A recipe-only run reuses the work directory of a full bake: run the
full bake first on a fresh machine. Environment: `BLENDER` (default
`/Applications/Blender.app/…/Blender`, else `blender` on the path), `RES` (atlas
size, default 1024, what ships), `WEAPON_SKINS_WORK` (default
`$TMPDIR/ghosts-weapon-skins`; one directory per gun).

After a bake: `pnpm test:equipment` (held alignment, within 0.8 mm of the
authored gun per piece) and `node --experimental-strip-types --test
tests/weapon-skins.test.ts` (every listed skin shipped, nothing stale). Bump
`VERSION` in `packages/squad/src/studio/armory-skins.ts` when the shipped
files change, so caches drop the old ones.

## Stages

| Stage  | Script                            | Output (work dir)                                                                                                                                                                             |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source | `source.ts <gun> <work>`          | `source-{high,low}.json` (body, standard clip and stock at both details, in the Armory weapon frame, a builder part per triangle), `gun.json` (factory finish per slot, bore), `recipes.json` |
| Decals | `decals.mjs <dir>`                | stencil, roundels, small text (fictional markings)                                                                                                                                            |
| UV     | `stage_uv.py -- <work>`           | `low_uv.blend`: the low mesh minus faces no ray can leave, hard edges, seams, one packed atlas                                                                                                |
| Fields | `stage_fields.py -- <work> [res]` | `fields/*.npy`: tangent normal (parts exploded apart), position, normal, slot/part ids, curvature and AO, projected from the authored model                                                   |
| Export | `export.py -- <work>`             | `geometry.glb`: `body`, `clip`, `stock` (+ `<piece>-glow` for indicator faces) with tangents                                                                                                  |
| Maps   | `skins.py -- <work> [skin ...]`   | `textures/`: normal, AO and `<skin>_{base,rm}.png`                                                                                                                                            |
| Ship   | `assets.mjs <gun> <work>`         | `<gun>.glb` (normal lossless WebP, AO 512 WebP inside), `<gun>-<skin>-{base,rm}.webp`; removes the gun's stale skin maps                                                                      |

## Recipes

A skin is a recipe in `packages/squad/src/skin-recipes.ts`, applied in the
weapon frame (metres, +X muzzle, +Y up, +Z right), so one recipe fits any gun:

- paint for the shell (`01_Cerakote`) and frame (`02_Graphite`) finishes, and
  the rubber when `rubber` is set;
- a pattern over the paint: `blotch` (thresholded value-noise fbm, 2–4 tones),
  `digital` (the same on a cubic grid), `splinter` (three slanted plane
  families hashed to tones) or `split` (a hard plane);
- mottle, edge wear (from the authored model's curvature), AO grime;
- the receiver stencil on both flanks and, for `livery: "hardtest"`, stripes,
  roundels and small text. Decals are planar projections placed per gun by
  searching the baked fields for a flat patch of the right size on the named
  parts, reading forward on the right flank and rearward on the left (never
  mirrored).

Steel, copper, optics glass, indicators, markings and the plasma rifle's
cables always keep the gun's factory finish, so a skin never paints over what
makes a gun read as itself. Indicator faces stay their own `-glow` meshes,
drawn in the gun's glowing indicator material.

Fittings (scopes, lasers, upgraded clips and stocks) are not baked: they
wear the recipe live through `packages/squad/src/studio/skin-paint.ts`, a
shader that evaluates the same hash, noise, pattern, mottle and wear in the
same frame. `skins.py` and `skin-paint.ts` mirror each other; change both
together.
