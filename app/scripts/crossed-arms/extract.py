# Copyright (c) Sui Potatoes
# SPDX-License-Identifier: MIT
# Blender --background --python extract.py -- input.fbx output.bin
import bpy,sys,json,math,hashlib,gzip
from pathlib import Path
from mathutils import Matrix
source,output=map(Path,sys.argv[sys.argv.index('--')+1:])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(source),use_custom_props=False)
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
world=Matrix.Rotation(-math.pi/2,4,'X')@rig.matrix_world
names=['spine','spine.003','spine.006']+[n+s for s in ['.L','.R'] for n in ['shoulder','upper_arm','forearm','hand','hand']]
names=list(dict.fromkeys(names))
def sample(m):
 q=m.to_quaternion().normalized()
 return {'p':[round(v,7) for v in m.translation],'q':[round(v,7) for v in (q.x,q.y,q.z,q.w)]}
rest={n:sample(world@rig.data.bones[n].matrix_local) for n in names}
actions=[]
for action in list(bpy.data.actions)[:1]:
 rig.animation_data.action=action
 start,end=map(round,action.frame_range)
 frames=[]
 for f in range(start,end+1):
  bpy.context.scene.frame_set(f)
  frames.append({n:sample(world@rig.pose.bones[n].matrix) for n in names})
 actions.append({'name':action.name,'frames':frames})
data={'source':'Umplix / Cross Arms','url':'https://opengameart.org/content/lowpoly-dummy-character10-animations','license':'CC0','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'fps':bpy.context.scene.render.fps,'rest':rest,'actions':actions}
with gzip.GzipFile(filename=str(output),mode='wb',mtime=0) as f:
 f.write(json.dumps(data,separators=(',',':')).encode())
for i,a in enumerate(actions):
 print('ACTION',i,len(a['frames']))
 for f in [0,len(a['frames'])//2,len(a['frames'])-1]: print(f,{n:a['frames'][f][n]['p'] for n in ['upper_arm.L','forearm.L','hand.L','hand.R']})
