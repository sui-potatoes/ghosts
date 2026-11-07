# Mixamo Smoking import

The user supplied Adobe Mixamo's `Smoking.fbx`, downloaded at 30 FPS with skin
and no keyframe reduction. `source.bin` preserves all 538 source frames (17.9 s)
as gzip JSON in metres and Y-up, plus the FBX SHA-256 and source URL. It contains
no reference meshes, textures or generated character poses.

Re-extract from the original FBX (from `app/`, using a local Blender executable):

```sh
blender --background --python scripts/smoking/extract.py -- /path/to/Smoking.fbx scripts/smoking/source.bin
pnpm build:smoking
```

The runtime loop uses source seconds **8.2–11.6** (the drag, hand lowering and
exhale), followed by a **1.6-second return blend** to the first pose: **5 seconds**
total. The lighting and discard sections are excluded. The cigarette remains
visible and lit across the seam, and breath emission follows the captured exhale.

The native pelvis and spine stay in their neutral bind rotations throughout the
loop, including the return blend. The smoking gesture uses the captured head and arm orientations
and finger segment directions, fitted around that neutral torso. Copying absolute
source spine orientations into the differently aligned native rig bows the chest.
Clavicles also start from their native bind rotations; only the arm contact solver
can adjust them if needed to reach the mouth.
The free left arm uses a simple relaxed pose with a slight elbow bend. Its wrist,
palm and fingers retain their native bind relationships throughout the loop;
the captured hip gesture and finger transforms are not applied to that hand.
The smoking right arm, hand and fingers receive anatomical roll correction from
the bind palm plane along the whole chain, avoiding a wrist-only twist.
Foot and toe rotations are transferred relative to the two rigs’ bind
orientations; copying their absolute orientations pitched the native soles down.
Both ankles are held at their planted positions with an offline two-bone leg fit,
so native proportions do not leave one foot floating. The recorded weight shift
and knee planes are retained, with pelvis height limited to the available leg reach.
Hand/lip contact is fitted to native proportions while preserving the elbow plane.

Both outputs include input hashes and the source interval, and are rounded to six
decimal places before compression (about 44 KiB each). No runtime IK is needed.
The game's existing coordinate adapter handles the combat rig. `source.bin` still
contains the complete original capture so the trim is reproducible.

VFX timing and loop constants live in `packages/squad/src/motion/smoking.ts`.
Reload an already-open studio after rebuilding the binary assets: its animation
library is cached for the page lifetime. Motion Drills should show **5.0 s**.

Source: Adobe Mixamo, **Smoking / Idle Smoking**.
https://www.mixamo.com/#/?page=1&query=smoking&type=Motion
Adobe Mixamo terms apply to the source animation; it is not covered by the
repository's code license. The original FBX remains outside public assets.
