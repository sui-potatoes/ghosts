# Equipment pose calibration

Run from `app/`:

```sh
pnpm build:equipment-poses
pnpm test:equipment
pnpm test:pose-audit
```

`references.json` contains native-rig ready and aimed reference rotations for
both sexes. `female-actions.bin` and `male-actions.bin` are gzip JSON authoring
curves for the ten action-specific fits and four unchanged pistol clips. They
contain changed local quaternion tracks, not duplicate copies of the motion
library. These are calibrated asset inputs, like an exported animation file.
The holds preserve root travel and lower-body motion. The aimed holds stabilize
the upper chest relative to the character's heading. Reload, sling, draw,
throw, melee, vault and collapse retain their action-specific arm motion.

`rifle_idle` has a separate compact ready fit in `build.ts`: both wrists move
6 cm toward the torso while retaining their grip spacing and orientation.
The male hold rises 2.5 cm; the female hold rises 5 cm and shifts 8 cm toward
the centerline to keep the stock inside the heavy shoulder plate. This fit is
limited to Rifle ready idle; the other calibrated holds retain their references.

The action curves were fitted offline with two-bone IK, then refined against
actual skinned mesh intersections. The throw's returning arm includes a smooth
4 cm lateral clearance adjustment around 2.18 s (female) / 2.22 s (male).
The male melee recovery also has a smooth 2 cm outward adjustment around 2.30 s
to clear the fitted Spectre carrier. The throw handoff is derived from the throw's own starting frame so its placement
does not depend on which animation preceded it.

`build.ts` combines these inputs with the original clips, normalizes authored
quaternions, optimizes constant tracks, and writes the two public
`*-equipment.bin` files. The runtime applies these same tracks in the frozen
Squad idle, motion preview and combat. No collision solver runs in the browser.
Each file is about 320 KiB compressed and cached once per body type.

The fast tests require all 38 catalog entries, finite normalized tracks,
unchanged positional tracks, deterministic handoff, identical Squad/game idle
holds and current source hashes. Rebuild after modifying source motions,
body/armor meshes, weapon geometry or fitting inputs.

The full audit runs all 38 clips for both sexes with MX-4 and SRS-9 at 30 samples
per second, including clip endpoints. Pistol clips use K-12 instead. It skins
the shipped body, Spectre, Veil, Shade, Wraith and base kit and refits a triangle
BVH at every sampled frame. It checks weapon triangle-edge crossings plus
internal component landmarks to detect wholly enclosed components. Palm/finger
contact is excluded because the weapons are intentionally held; edges shorter
than 6 mm and contacts within 2 mm of an edge endpoint are below the edge test's
resolution. This is a sampled weapon/body/gear check on the default body rigs,
not a proof for arbitrary face morphs or every animation blend.

Reports default to `/tmp/ghosts-pose-audit/`; override `REPORT_DIR` or `FPS` when
needed. `summary.json` gives coverage and failures. Any crossing or missing clip
fails the command. Keep the tests strict when re-authoring assets.

For a silent visual review, start Vite and open `/gear-review.html`. It uses the
production character/equipment/motion loaders and deliberately has no audio
system. Choose a body, armor and weapon, then review individual poses from
front/back/profile or the seven paired-view sheets covering all 38 poses.
