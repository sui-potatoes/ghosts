"""Offline native-skin authoring helpers. Run from Blender, never in the web bundle."""
import bpy, bmesh, math, zlib, struct
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
def bv(p):return Vector((p[0],-p[2],p[1]))
def gv(p):return Vector((p.x,p.z,-p.y))
def material(name,color,metal=0,rough=.75,emission=None):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
 if name.startswith('NYX') and ('weave' in name or 'ceramic' in name):
  woven='weave' in name;size=128;pixels=bytearray()
  for y in range(size):
   pixels.append(0)
   for x in range(size):
    if woven:
     nx=.16*math.sin(x*math.pi/4);ny=.16*math.sin(y*math.pi/4)
     if (x//8+y//8)%2:nx*=.3
     else:ny*=.3
    else:
     nx=.035*math.sin(x*1.7+y*.7);ny=.035*math.sin(y*1.9-x*.8)
    pixels.extend((round(128+127*nx),round(128+127*ny),round(128+127*math.sqrt(1-nx*nx-ny*ny))))
  def chunk(t,d):return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
  path=Path('/tmp/ghosts-field-kit')/('weave-normal.png' if woven else 'ceramic-normal.png')
  path.parent.mkdir(exist_ok=True,parents=True)
  path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b''))
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(path),check_existing=True);tex.image.colorspace_settings.name='Non-Color'
  normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65
  m.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],bs.inputs['Normal'])
 if emission:bs.inputs['Emission Color'].default_value=(*emission,1);bs.inputs['Emission Strength'].default_value=.65
 return m
class NativeGear:
 def __init__(self,sex):
  bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
  bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/squad/body'/sex/'skin.glb'))
  self.body=next(o for o in bpy.context.scene.objects if o.type=='MESH');self.arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
  bm=bmesh.new();bm.from_mesh(self.body.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-5);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(self.body.data);bm.free()
  self.body.data.calc_loop_triangles();self.v=[gv(self.body.matrix_world@v.co) for v in self.body.data.vertices];self.tri=[tuple(t.vertices) for t in self.body.data.loop_triangles]
  names={g.index:g.name for g in self.body.vertex_groups};self.weights=[{names[g.group]:g.weight for g in v.groups} for v in self.body.data.vertices]
  self.names={b.name.replace(':',''):b.name for b in self.arm.data.bones};self.objects=[]
  self.tree=BVHTree.FromPolygons(self.v,self.tri,all_triangles=True)
  self.binding_side=None;self.binding_surfaces={};self.binding_torso=False;self.binding_limb=False
 def bone(self,name):return gv(self.arm.matrix_world@self.arm.data.bones[self.names['mixamorig'+name]].head_local)
 def region(self,names):
  tris=[t for t in self.tri if all(sum(w for n,w in self.weights[i].items() if any(k in n for k in names))>.4 for i in t)]
  return BVHTree.FromPolygons(self.v,tris,all_triangles=True)
 def bind(self,o,rigid=None):
  tree=self.tree;triangles=self.tri
  if self.binding_side:
   # Adjacent thighs touch in rest pose. Sampling the complete body can bind
   # an outward-offset plate to the opposite leg and tear it across the pelvis.
   other='Right' if self.binding_side=='Left' else 'Left'
   if self.binding_side not in self.binding_surfaces:
    tris=[t for t in self.tri if all(sum(w for n,w in self.weights[i].items() if other in n)<.01 for i in t)]
    self.binding_surfaces[self.binding_side]=(BVHTree.FromPolygons(self.v,tris,all_triangles=True),tris)
   tree,triangles=self.binding_surfaces[self.binding_side]
   # Armor pieces follow one anatomical segment. Inward shoulder vertices
   # must not grab rib-cage weights merely because the arm rests beside it.
   center=sum((gv(v.co) for v in o.data.vertices),Vector())/len(o.data.vertices)
   segments=[('Arm','ForeArm'),('ForeArm','Hand'),('UpLeg','Leg'),('Leg','Foot')]
   def distance(pair):
    a,b=[self.bone(self.binding_side+n) for n in pair];axis=b-a
    return (center-(a+axis*max(0,min(1,(center-a).dot(axis)/axis.length_squared)))).length
   segment=min(segments,key=distance)[0]
   if 'knee' in o.name.lower():segment='Leg'
   if self.binding_limb and not rigid:rigid=self.binding_side+segment
  for vertex in o.data.vertices:
   p=gv(vertex.co)
   if rigid:ws={self.names['mixamorig'+rigid]:1}
   else:
    near,_,ti,_=tree.find_nearest(p);ids=triangles[ti];a,b,c=[self.v[i] for i in ids];u=b-a;e=c-a;r=near-a;den=u.dot(u)*e.dot(e)-u.dot(e)**2
    beta=(e.dot(e)*r.dot(u)-u.dot(e)*r.dot(e))/den if abs(den)>1e-12 else 0;gamma=(u.dot(u)*r.dot(e)-u.dot(e)*r.dot(u))/den if abs(den)>1e-12 else 0
    ws={}
    for i,d in zip(ids,[max(0,1-beta-gamma),max(0,beta),max(0,gamma)]):
     for n,w in self.weights[i].items():ws[n]=ws.get(n,0)+d*w
    if self.binding_torso:
     # Raised back/side panels can be closer to the resting upper arm than
     # the ribs. Never transfer those arm weights onto a torso garment.
     ws={n:w for n,w in ws.items() if any(k in n for k in ['Hips','Spine'])}
     if not ws:ws={self.names['mixamorigSpine2']:1}
    ws=dict(sorted(ws.items(),key=lambda p:-p[1])[:4]);total=sum(ws.values());ws={n:w/total for n,w in ws.items()}
   for n,w in ws.items():
    group=o.vertex_groups.get(n) or o.vertex_groups.new(name=n);group.add([vertex.index],w,'REPLACE')
  m=o.modifiers.new('Native skin','ARMATURE');m.object=self.arm;o.parent=self.arm;o.matrix_parent_inverse=self.arm.matrix_world.inverted();self.objects.append(o)
 def mesh(self,name,vs,fs,mat,rigid=None,subdiv=0,thickness=0,smooth=True,weld=False,thickness_offset=0):
  data=bpy.data.meshes.new(name);data.from_pydata([bv(p) for p in vs],[],fs);data.update();o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);data.materials.append(mat)
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
  bm=bmesh.new();bm.from_mesh(data)
  if weld:bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
  if subdiv:
   m=o.modifiers.new('Tailored surface','SUBSURF');m.levels=subdiv;bpy.ops.object.modifier_apply(modifier=m.name)
  if thickness:
   m=o.modifiers.new('Finished edge','SOLIDIFY');m.thickness=thickness;m.offset=thickness_offset;bpy.ops.object.modifier_apply(modifier=m.name)
  for p in o.data.polygons:p.use_smooth=smooth
  if smooth:o.data.set_sharp_from_angle(angle=math.radians(42))
  # Meter-scaled box projection keeps the woven finish consistent across every plate.
  uv=o.data.uv_layers.new(name='Surface finish')
  for face in o.data.polygons:
   normal=gv(face.normal);axis=max(range(3),key=lambda k:abs(normal[k]));axes=[k for k in range(3) if k!=axis]
   for li in face.loop_indices:
    p=gv(o.data.vertices[o.data.loops[li].vertex_index].co)
    uv.data[li].uv=(p[axes[0]]*32,p[axes[1]]*32)
  self.bind(o,rigid);return o
 def front(self,x,y,side=1,offset=.01):
  hit=self.tree.ray_cast(Vector((x,y,side*.6)),Vector((0,0,-side)),1.2)[0]
  if hit is None:raise RuntimeError(f'Missing torso surface at {x} {y}')
  return (x,y,hit.z+side*offset)
 def panel(self,name,outline,mat,side=1,offset=.014,thickness=.004):
  # A shallow bevel surrounds the body-fitted face; no unsupported flat backplate.
  # Dense, projected rings keep the entire plate above the curved body.
  corners=outline
  outline=[(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t) for a,b in zip(corners,corners[1:]+corners[:1]) for t in [0,.25,.5,.75]]
  cx=sum(p[0] for p in corners)/len(corners);cy=sum(p[1] for p in corners)/len(corners);n=len(outline);vs=[]
  rings=[(1,0),(.96,.0025),(.90,.004),(.7,.004),(.45,.004),(.15,.004)]
  for factor,lift in rings:
   vs.extend(self.front(cx+(x-cx)*factor,cy+(y-cy)*factor,side,offset+lift) for x,y in outline)
  fs=[(r*n+j,r*n+(j+1)%n,(r+1)*n+(j+1)%n,(r+1)*n+j) for r in range(len(rings)-1) for j in range(n)]
  vs.append(self.front(cx,cy,side,offset+.004));fs.extend(((len(rings)-1)*n+j,(len(rings)-1)*n+(j+1)%n,len(vs)-1) for j in range(n))
  result=self.mesh(name,vs,fs,mat,thickness=thickness)
  if hasattr(self,'detail_materials') and 'ceramic' in mat.name:
   trim,metal,dark=self.detail_materials
   edge=[self.front(cx+(x-cx)*.92,cy+(y-cy)*.92,side,offset+.004) for x,y in outline]
   self.tube(name+' / recessed perimeter',edge+[edge[0]],.0009,dark)
   for x,y in corners[::2]:
    point=self.front(cx+(x-cx)*.76,cy+(y-cy)*.76,side,offset+.005)
    self.rivet(point,Vector((0,0,side)),.0027,metal,dark)
  return result
 def patch(self,name,rings,columns,mat,lift=.007,bevel=.003):
  rows=len(rings);cols=len(columns);vs=[]
  for k,ring in enumerate(rings):
   center=sum(ring,Vector())/len(ring)
   for j,col in enumerate(columns):
    p=Vector(ring[col]);normal=(p-center).normalized()
    # Short chamfers cut the four silhouette corners into deliberate plate shapes.
    if k in [0,rows-1] and j in [0,cols-1]:
     neighbor=ring[columns[1 if j==0 else -2]]
     p=p.lerp(neighbor,.42).lerp(rings[1 if k==0 else -2][col],.20)
    vs.append(p+normal*(lift-(bevel if k in [0,rows-1] or j in [0,cols-1] else 0)))
  fs=[(k*cols+j,k*cols+j+1,(k+1)*cols+j+1,(k+1)*cols+j) for k in range(rows-1) for j in range(cols-1)]
  result=self.mesh(name,vs,fs,mat,thickness=.004)
  trim,metal,dark=self.detail_materials
  edge=[vs[j] for j in range(cols)]+[vs[k*cols+cols-1] for k in range(1,rows)]+[vs[(rows-1)*cols+j] for j in range(cols-2,-1,-1)]+[vs[k*cols] for k in range(rows-2,0,-1)]
  self.tube(name+' / edge seal',edge+[edge[0]],.0010,trim)
  for k in [1,rows-2]:
   center=sum(rings[k],Vector())/len(rings[k])
   for j in [1,cols-2]:
    n=(vs[k*cols+j]-center).normalized();self.rivet(vs[k*cols+j]+n*.0015,n,.0028,metal,dark)
  # Offset longitudinal channels catch light at game distance.
  for j in [2,cols-3]:
   self.tube(name+' / inset channel',[vs[k*cols+j]+(vs[k*cols+j]-sum(rings[k],Vector())/len(rings[k])).normalized()*.0015 for k in (range(1,rows-1) if rows>3 else range(rows))],.0018,dark)
  return result
 def rivet(self,point,normal,radius,metal,dark):
  p=Vector(point);n=Vector(normal).normalized();u=n.cross(Vector((0,1,0)))
  if u.length<.01:u=n.cross(Vector((1,0,0)))
  u.normalize();v=n.cross(u);vs=[];count=6
  for radius_scale,lift in [(1,0),(.85,.0012),(.40,.0012),(.40,.0003)]:
   vs.extend(p+n*lift+radius*radius_scale*(u*math.cos(j*math.tau/count)+v*math.sin(j*math.tau/count)) for j in range(count))
  fs=[(r*count+j,r*count+(j+1)%count,(r+1)*count+(j+1)%count,(r+1)*count+j) for r in range(3) for j in range(count)]
  self.mesh('NYX / captive hex fastener',vs,fs,metal,smooth=False)
  self.mesh('NYX / fastener socket',vs[18:],[(0,1,2,3,4,5)],dark,smooth=False)
 def tube(self,name,points,radius,mat,rigid=None):
  if len(points)<2:raise ValueError("A seam needs at least two points: "+name)
  vs=[];n=6
  for i,p in enumerate(points):
   p=Vector(p);closed=(Vector(points[0])-Vector(points[-1])).length<1e-6
   before=points[-2] if closed and i==0 else points[max(0,i-1)];after=points[1] if closed and i==len(points)-1 else points[min(i+1,len(points)-1)]
   axis=(Vector(after)-Vector(before)).normalized();cross=axis.cross(Vector((0,0,1)))
   if cross.length<.01:cross=axis.cross(Vector((0,1,0)))
   cross.normalize();other=axis.cross(cross)
   for j in range(n):vs.append(p+radius*(cross*math.cos(2*math.pi*j/n)+other*math.sin(2*math.pi*j/n)))
  fs=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(points)-1) for j in range(n)]
  return self.mesh(name,vs,fs,mat,rigid=rigid)
 def export(self,path):
  bpy.ops.object.select_all(action='DESELECT');self.arm.select_set(True)
  for o in self.objects:o.select_set(True)
  bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,export_format='GLB',export_animations=False,export_yup=True,export_extras=False)
