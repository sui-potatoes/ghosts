# Copyright (c) Sui Potatoes
# SPDX-License-Identifier: MIT
# Blender --background --python scripts/smoking/extract.py -- input.fbx output.bin
# Source data only: no mesh, textures, invented poses, or animation edits.
import bpy, sys, math, json, gzip, hashlib
from mathutils import Matrix
from pathlib import Path
source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(source), use_custom_props=False)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
action = rig.animation_data.action
start, end = map(round, action.frame_range)
turn = Matrix.Rotation(-math.pi / 2, 4, 'X')
def name(b): return b.name.replace(':', '')
def quaternion(m):
    q = m.to_quaternion().normalized()
    return [round(v, 7) for v in (q.x, q.y, q.z, q.w)]
def position(m): return [round(v, 7) for v in m.translation]
world = turn @ rig.matrix_world
bones = [b for b in rig.data.bones if b.name.startswith('mixamorig')]
rest = {name(b): {'q': quaternion(world @ b.matrix_local), 'p': position(world @ b.matrix_local)} for b in bones}
frames = []
for frame in range(start, end + 1):
    bpy.context.scene.frame_set(frame)
    frames.append({'hips': position(world @ rig.pose.bones['mixamorig:Hips'].matrix),
                   'rotations': {name(b): quaternion(world @ rig.pose.bones[b.name].matrix) for b in bones}})
data = {'version': 1, 'source': 'Adobe Mixamo / Smoking',
        'url': 'https://www.mixamo.com/#/?page=1&query=smoking&type=Motion',
        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'fps': 30, 'rest': rest, 'frames': frames}
with gzip.GzipFile(filename=str(output), mode='wb', mtime=0) as f:
    f.write(json.dumps(data, separators=(',', ':')).encode())
print('EXTRACTED', len(frames), 'frames;', len(bones), 'bones;', output.stat().st_size, 'bytes')
