# VIP crossed-arms reference

Source: **Cross Arms**, by Umplix, from [Lowpoly Dummy Character (10 Animations)](https://opengameart.org/content/lowpoly-dummy-character10-animations), CC0.
Download: `lowpoly_dummy_character_cross_arms_anim.fbx_.zip` on that page.

The first FBX action contains 120 frames: enter, hold, exit. `source.bin` preserves
its sampled world transforms, bind transforms, FPS and original FBX SHA-256; it
contains no meshes or textures. Source frame 61 (zero-based sample 60) supplies the
sustained hold. The runtime uses its upper-arm and forearm directions, fits wrists
to the native hands, and layers a quiet five-second breathing loop on the planted
civilian legs. It does not loop the entry/exit or claim to be a Mixamo capture.

To regenerate from the original FBX:

```sh
blender --background --python app/scripts/crossed-arms/extract.py -- input.fbx app/scripts/crossed-arms/source.bin
```

The extractor retains the first action (the cross-arms sequence) in the gzipped
`source.bin`. Generate the small runtime reference with:

```sh
node app/scripts/crossed-arms/build-reference.mjs
```

The reference converts the source's -Z-facing stance into native +Z space.
`office-worker.ts` transfers segment directions to the native limb lengths and
preserves the bind rig after generating the pose. Both anatomies share this source.
