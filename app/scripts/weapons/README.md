# Modular weapon asset pipeline

The game-ready assets are in `app/public/squad/weapons/`: three rifles and twelve interchangeable fittings. The editable Blender library is `scratch/art/weapons/weapons.blend` (scratch material, not in git). `manifest.json` records mesh and file budgets.

## Rebuild

From the repository root:

```sh
pnpm --dir app exec node --experimental-strip-types scripts/weapons/source.ts
/Applications/Blender.app/Contents/MacOS/Blender --background --python app/scripts/weapons/build.py
```

The TypeScript models in `packages/squad/src/studio/long-guns.ts` and `weapon-attachments.ts` are the parametric source. Blender welds, unwraps, packs, generates tangents, and exports the GLBs. The `.blend` includes the finished meshes, material nodes, packed surface maps and all socket empties, arranged as an asset library. Each assembly's root can be moved back to the origin for re-export.

## Mounting and animation

- All dimensions are metres. Authoring coordinates are +X muzzle, +Y up, +Z left side; `WEAPON_BASIS` converts to the existing character's weapon socket.
- Rifles are rigid objects attached to the animated hand. The receiver, grip and attachment meshes must not be skinned to the character's deforming skeleton. The trigger contact remains invariant when sizing the rifles down by 10%. `sizeWeapon` bakes that scale into the meshes and socket positions, keeping attachment transforms at unit scale. The left-hand carry system remains in use.
- `mount_clip`, `mount_stock`, `mount_scope`, and `mount_laser` empties carry stable `interface` extras (`ghosts:<slot>:v1`). Use extras rather than Blender's auto-suffixed names.
- Fittings have their local origin at the mount interface and no weapon-specific scale. Clip and stock replace the standard furniture. Scope and laser mounts start empty on every rifle, including Sharpshooter.
- Arm roll is distributed through the upper arm and forearm by `scripts/equipment-fit/arm-twist.ts`, preserving the hand socket and joint positions without collapsing the wrist skin. Trigger fingers use separate relaxed and firing arcs in `trigger-grip.ts`; the shared pistol grip has thumb-web relief.
- Support grips are baked by `scripts/equipment-fit/support-grip.ts`: the palm cups the fore-end and individual fingers clear its sidewalls. Rebuild with `pnpm --dir app build:equipment-poses` after exporting weapon changes. No runtime IK or bone scaling is used.
- Plasma's side rail is farther from the bore to clear its ceramic shroud; it uses exactly the same laser asset.
- A primary weapon swap transfers the recruit's installed fittings. Returning the primary weapon releases them to shared inventory. Legacy saves default to empty attachment slots.

## Materials and future textures

Every mesh has packed UV0, normals and tangents. UV islands are packed together for each material within an asset, including standard furniture, with 0.8% gutters. Different material slots use independent 0–1 atlases. Exported attachments have their own atlases; their UVs do not depend on which rifle carries them.

Stable material suffixes:

| Slot | Surface | Authoring intent |
| --- | --- | --- |
| `01_Cerakote` | Exterior shells | Coating/base-color variations |
| `02_Graphite` | Receiver cores and rails | Anodized metal |
| `03_Titanium` | Fasteners, bolt and barrel | Brushed/machined metal |
| `04_Elastomer` | Grip, pads and recesses | Low-metalness textured rubber |
| `05_Copper` | Coils and witness marks | Conductive metal |
| `06_OpticalGlass` | Optical faces | Coated lenses |
| `07_Indicator` | Emitters and status strips | Emissive channels |
| `08_Markings` | Small serial and maker marks | Separate stencil material |

The shipped normal and roughness maps are neutral micro-surface foundations, not final painted weapon skins. Replace them with authored base-color, roughness/metallic, normal and AO textures on the same UVs. Use tangent-space OpenGL (+Y) normal maps and sRGB only for base color/emissive. The Blender library retains editable material separation. Suggested working size: 2048² per principal surface, with smaller maps for minor parts.

The squad uses these GLBs for inventory, equipped characters and the orbit/zoom inspection view. The tactical demo still uses its independent scenario stats and procedural weapon constructors; it does not consume the saved squad loadout.

## Verification

```sh
pnpm --filter @ghosts/squad test
pnpm --dir app test:equipment
pnpm --dir app build
```

Tests cover exact packed stats, all 36 attachment/weapon combinations, inventory conservation, legacy/malformed saves, exported socket transforms, UV/normal/tangent availability, trigger-hand alignment through ready, fire, reload and run for both body rigs, and actual skinned intersections of both hands on all three rifles with every laser tier, plus wrist-ring thickness through 24 held animations. Attachment bounds are checked against the parametric sources to catch stale exports.
