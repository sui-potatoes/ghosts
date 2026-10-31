"""Author Spectre field armor around the native MPFB bind meshes; retain skin weights."""
import bpy, bmesh, math, os, json, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from native_gear import material as surface_material
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.environ.get('GEAR_BUILD_DIR','/tmp/ghosts-field-kit')
os.makedirs(OUT,exist_ok=True)
def bv(v): return Vector((v[0],-v[2],v[1]))
def gv(v): return Vector((v.x,v.z,-v.y))
def material(name,color,metal,rough):
 if name.startswith(("Spectre","Field kit")):return surface_material(name,color,metal,rough)
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
 return m
for sex in ['male','female']:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'public/squad/body',sex,'skin.glb'))
 body=next(o for o in bpy.context.scene.objects if o.type=='MESH');arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
 # The runtime body welds duplicate seam normals; authoring must do the same before extrusion.
 bm=bmesh.new();bm.from_mesh(body.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));print('BODY_TOPOLOGY',sex,len(bm.verts),len(bm.faces),sum(e.is_boundary for e in bm.edges));bm.to_mesh(body.data);bm.free();body.data.update()
 body.data.calc_loop_triangles();verts=[gv(body.matrix_world@v.co) for v in body.data.vertices];tris=[tuple(t.vertices) for t in body.data.loop_triangles];tree=BVHTree.FromPolygons(verts,tris,all_triangles=True)
 names={g.index:g.name for g in body.vertex_groups};weights=[{names[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
 bone_names={b.name.replace(':',''):b.name for b in arm.data.bones};bones={b.name.replace(':',''):gv(arm.matrix_world@b.head_local) for b in arm.data.bones};bone=lambda n:bones['mixamorig'+n]
 neck=bone('Neck').y;hips=bone('Hips').y;chest=bone('Spine2').y;waist=bone('Spine').y
 scale=neck/1.4942;shoulder=abs(bone('LeftArm').x);objects=[]
 # Restrict fitting to the anatomical region: arm/hand surfaces must never catch a torso ray.
 def region_tree(allowed):
  selected=[t for t in tris if all(sum(w for n,w in weights[i].items() if any(k in n for k in allowed))>.45 for i in t)]
  return BVHTree.FromPolygons(verts,selected,all_triangles=True),selected
 torso_tree,torso_tris=region_tree(['Spine','Hips','Neck'])
 fit_tree,fit_tris=torso_tree,torso_tris
 mats=[material('Spectre / ceramic graphite',(.033,.041,.044),.22,.62),material('Spectre / ballistic webbing',(.026,.035,.039),.02,.91),material('Spectre / titanium and markings',(.19,.23,.22),.45,.55),material('Spectre / identification ochre',(.63,.28,.075),.25,.56)]
 def surface(x,y,side=1):
  hit=fit_tree.ray_cast(Vector((x,y,side*.8)),Vector((0,0,-side)),2)[0]
  return hit.z if hit else side*.09
 def bind(o,rigid=None):
  bpy.context.view_layer.objects.active=o;o.select_set(True);anchors=[]
  # Every vertex inherits the native anatomical skin, rather than an old rig's proportions.
  for v in o.data.vertices:
   p=gv(o.matrix_world@v.co)
   if rigid: ws={bone_names[rigid]:1}
   else:
    near,normal,ti,dist=fit_tree.find_nearest(p);ids=fit_tris[ti];a,b,c=[verts[i] for i in ids]
    u=b-a;edge=c-a;r=near-a;den=u.dot(u)*edge.dot(edge)-u.dot(edge)**2
    beta=(edge.dot(edge)*r.dot(u)-u.dot(edge)*r.dot(edge))/den if abs(den)>1e-12 else 0
    gamma=(u.dot(u)*r.dot(edge)-u.dot(edge)*r.dot(u))/den if abs(den)>1e-12 else 0
    ds=[max(0,1-beta-gamma),max(0,beta),max(0,gamma)];ws={}
    for i,d in zip(ids,ds):
     for n,w in weights[i].items():ws[n]=ws.get(n,0)+w*d/max(sum(ds),1e-9)
    if fit_tree is torso_tree:
     ws={n:w for n,w in ws.items() if any(k in n for k in ['Hips','Spine'])}
     if not ws:ws={bone_names['mixamorigSpine2']:1}
    if o.name=='Carrier / fitted ballistic shell':
     # The vest hem rides above the belt. Hip weights pull it apart when the
     # pelvis folds away from the chest during a covered reload or collapse.
     ws={n:w for n,w in ws.items() if 'Spine' in n}
     if not ws:ws={bone_names['mixamorigSpine']:1}
    ws=dict(sorted(ws.items(),key=lambda a:-a[1])[:4]);total=sum(ws.values());ws={n:w/total for n,w in ws.items()}
   near,_,ti,_=fit_tree.find_nearest(p)
   anchors.append({'position':list(p),'weights':ws,'triangle':list(fit_tris[ti]),'surface':list(near)})
   for n,w in ws.items():
    g=o.vertex_groups.get(n) or o.vertex_groups.new(name=n);g.add([v.index],w,'REPLACE')
  o['attachment_anchors']=json.dumps(anchors,separators=(',',':'))
  mod=o.modifiers.new('Native MPFB skeleton','ARMATURE');mod.object=arm;o.parent=arm;o.matrix_parent_inverse=arm.matrix_world.inverted();objects.append(o);o.select_set(False)
 def mesh(name,vs,fs,mat,rigid=None,bevel=0):
  me=bpy.data.meshes.new(name);me.from_pydata([bv(v) for v in vs],[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);me.materials.append(mats[mat])
  if bevel:
   bpy.context.view_layer.objects.active=o
   m=o.modifiers.new('Machined bevel','BEVEL');m.width=bevel;m.segments=1
   bpy.ops.object.modifier_apply(modifier=m.name)
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
  for p in o.data.polygons:p.use_smooth=False
  # Metre-scaled UVs supply woven cloth and a subtle ceramic surface finish.
  uv=o.data.uv_layers.new(name='Surface finish')
  for face in o.data.polygons:
   normal=gv(face.normal);axis=max(range(3),key=lambda k:abs(normal[k]));axes=[k for k in range(3) if k!=axis]
   for li in face.loop_indices:
    p=gv(o.data.vertices[o.data.loops[li].vertex_index].co);uv.data[li].uv=(p[axes[0]]*32,p[axes[1]]*32)
  bind(o,rigid);return o
 plate_profiles={}
 def plate_z(cx,w,x,y,side,offset,depth=0):
  profile=plate_profiles.get((cx,w,side))
  if profile:
   cy,slope,base=profile
   return side*(base+slope*(y-cy)-.006*((x-cx)/(w*.5))**2+offset+depth)
  return surface(x,y,side)+side*(offset+depth)
 def panel(name,cx,cy,w,h,side=1,mat=0,offset=.018,rigid=None,fitted=False):
  # Chamfered shield silhouette, shallow crown and a bevelled perimeter.
  outline=[(-.38,.5),(.38,.5),(.5,.33),(.48,-.32),(.30,-.5),(-.30,-.5),(-.48,-.32),(-.5,.33)]
  vs=[];rings=[(1,0),(.94,.006),(.24,.012)]
  slope=side*(surface(cx,cy+h*.5,side)-surface(cx,cy-h*.5,side))/h
  base=max(side*surface(cx+u*w,cy+v*h,side)-slope*v*h+.006*(u*2)**2 for u in [-.5,-.25,0,.25,.5] for v in [-.5,-.25,0,.25,.5])
  plate_profiles[(cx,w,side)]=(cy,slope,base)
  # Ceramic shells keep one rigid attachment; cloth carries torso flexion.
  if rigid is None and fit_tree is torso_tree:
   joint=min(['Spine','Spine1','Spine2'],key=lambda n:abs(bone(n).y-cy));rigid='mixamorig'+joint
  # One continuous front plane clears both chest contours; no sculpted breast cups.
  central=max(side*surface(cx+u*w,cy+v*h,side) for u,v in outline+[(0,0)])
  for f,depth in rings:
   for u,v in outline:
    x=cx+u*w*f;y=cy+v*h*f;z=plate_z(cx,w,x,y,side,offset,depth*.55)
    vs.append((x,y,z))
  fs=[]
  for ring in range(2):
   for j in range(8):fs.append((ring*8+j,ring*8+(j+1)%8,(ring+1)*8+(j+1)%8,(ring+1)*8+j))
  fs.append(tuple(range(16,24)))
  # Side walls close the plate; a textile backing is separate.
  for u,v in outline:
   x=cx+u*w;y=cy+v*h;vs.append((x,y,plate_z(cx,w,x,y,side,offset-.006)))
  for j in range(8):fs.append((j,24+j,24+(j+1)%8,(j+1)%8))
  fs.append(tuple(reversed(range(24,32))))
  if side<0:fs=[tuple(reversed(f)) for f in fs]
  result=mesh(name,vs,fs,mat,rigid)
  # Recessed edge seal and flush fasteners make the thin plate construction readable.
  if mat==0:
   edge=[]
   for factor in [.91,.895]:
    for u,v in outline:
     x=cx+u*w*factor;y=cy+v*h*factor
     edge.append((x,y,plate_z(cx,w,x,y,side,offset+.0042)))
   mesh(name+' / perimeter seal',edge,[(j,(j+1)%8,8+(j+1)%8,8+j) for j in range(8)],1,rigid)
   for sx in [-1,1]:
    for sy in [-1,1]:
     x=cx+sx*w*.31;y=cy+sy*h*.28
     box(name+' / flush fastener',(x,y,plate_z(cx,w,x,y,side,offset+.007)),(.006,.006,.003),2,rigid,.001)
  return result
 def ribbon(name,points,width,mat=1,rigid=None):
  # Sewn, fitted strips follow the body along shoulder and waist lines.
  vs=[]
  for p in points:
   vs.extend([(p[0]-width/2,p[1],p[2]),(p[0]+width/2,p[1],p[2])])
  fs=[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(points)-1)]
  o=mesh(name,vs,fs,mat,rigid);bpy.context.view_layer.objects.active=o
  sol=o.modifiers.new('Webbing thickness','SOLIDIFY');sol.thickness=.004
  # Evaluate thickness before the armature at export; weights propagate to shell faces.
  bpy.ops.object.modifier_move_up(modifier=sol.name)
  bpy.ops.object.modifier_apply(modifier=sol.name)
  return o
 def box(name,center,dims,mat=1,rigid=None,bevel=.006):
  x,y,z=center;a,b,c=[n/2 for n in dims];vs=[(x+i*a,y+j*b,z+k*c) for i,j,k in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
  return mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],mat,rigid,bevel)
 # Copy anatomical polygons and exact weights, then extrude away from the skin.
 # This avoids rigid bone attachments rotating plates away from mixed-weight shoulders.
 def body_shell(name,predicate,clearance,thickness,mat):
  selected_indices=set()
  for tri in body.data.loop_triangles:
   ids=tuple(tri.vertices);center=sum((verts[i] for i in ids),Vector())/3
   normal=gv(tri.normal).normalized()
   if predicate(center,normal,ids):selected_indices.add(tri.index)
  # Close one-triangle notches and retain a single connected panel.
  edges={}
  for i,face in enumerate(tris):
   for a,b in zip(face,face[1:]+face[:1]):edges.setdefault(tuple(sorted((a,b))),[]).append(i)
  adjacent=[set() for _ in tris]
  for fs in edges.values():
   for i in fs:adjacent[i].update(j for j in fs if j!=i)
  for _ in range(2):
   selected_indices.update(i for i,neighbors in enumerate(adjacent) if i not in selected_indices and len(neighbors & selected_indices)>=2)
  remaining=set(selected_indices);components=[]
  while remaining:
   component={remaining.pop()};stack=list(component)
   while stack:
    for i in adjacent[stack.pop()] & remaining:
     remaining.remove(i);component.add(i);stack.append(i)
   components.append(component)
  selected=[tris[i] for i in sorted(max(components,key=len))] if components else []
  if not selected:raise RuntimeError('Empty anatomical shell: '+name)
  ids=sorted({i for face in selected for i in face});remap={v:i for i,v in enumerate(ids)}
  vs=[tuple(verts[i]+gv(body.data.vertices[i].normal).normalized()*clearance) for i in ids]
  o=mesh(name,vs,[tuple(remap[i] for i in f) for f in selected],mat)
  assert all((gv(o.data.vertices[i].co)-Vector(v)).length<1e-5 for i,v in enumerate(vs)), 'Shell vertex order changed: '+name
  o.vertex_groups.clear()
  for dst,src in enumerate(ids):
   for n,w in weights[src].items():
    g=o.vertex_groups.get(n) or o.vertex_groups.new(name=n);g.add([dst],w,'REPLACE')
  # Clean the cut perimeter: selecting triangles alone leaves a sawtooth edge.
  bm=bmesh.new();bm.from_mesh(o.data)
  boundary=[v for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
  print('SHELL_TOPOLOGY',name,len(bm.verts),len(bm.faces),len(boundary),sum(e.is_boundary for e in bm.edges))
  for iteration in range(8):
   updates={}
   for v in boundary:
    neighbors=[e.other_vert(v) for e in v.link_edges if e.is_boundary]
    if len(neighbors)==2:updates[v]=v.co.lerp((neighbors[0].co+neighbors[1].co)/2,.65)
   for v,p in updates.items():
    near,normal,_,_=tree.find_nearest(gv(p));v.co=bv(near+normal*clearance)
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
  # Refresh only the cut-edge attachment after smoothing it onto the original surface.
  o.vertex_groups.clear()
  for v in o.data.vertices:
   near,normal,ti,_=tree.find_nearest(gv(v.co));ia,ib,ic=tris[ti];a,b,c=[verts[i] for i in [ia,ib,ic]]
   u=b-a;e=c-a;r=near-a;den=u.dot(u)*e.dot(e)-u.dot(e)**2
   beta=(e.dot(e)*r.dot(u)-u.dot(e)*r.dot(e))/den if abs(den)>1e-12 else 0
   gamma=(u.dot(u)*r.dot(e)-u.dot(e)*r.dot(u))/den if abs(den)>1e-12 else 0
   ds=[max(0,1-beta-gamma),max(0,beta),max(0,gamma)];ws={}
   for i,d in zip([ia,ib,ic],ds):
    for n,w in weights[i].items():ws[n]=ws.get(n,0)+w*d
   ws=dict(sorted(ws.items(),key=lambda a:-a[1])[:4]);total=sum(ws.values())
   for n,w in ws.items():
    g=o.vertex_groups.get(n) or o.vertex_groups.new(name=n);g.add([v.index],w/total,'REPLACE')
  bpy.context.view_layer.objects.active=o
  m=o.modifiers.new('Extruded anatomical protection','SOLIDIFY');m.thickness=thickness;m.offset=1
  bpy.ops.object.modifier_move_up(modifier=m.name);bpy.ops.object.modifier_apply(modifier=m.name)
  for poly in o.data.polygons:poly.use_smooth=True
  return o
 # Fitted textile carrier shell, open around arms and neck.
 rings=[];nr=10;ns=24
 for j in range(nr):
  y=waist-.025*scale+(neck-.105*scale-(waist-.025*scale))*j/(nr-1)
  ring=[]
  for i in range(ns):
   a=2*math.pi*i/ns;direction=Vector((math.cos(a),0,math.sin(a)));origin=Vector((0,y,.015));hit=torso_tree.ray_cast(origin,direction,.35)[0]
   if hit is None:hit=origin+direction*.12
   ring.append(tuple(hit+direction*.013))
  rings+=ring
 fs=[]
 for j in range(nr-1):
  for i in range(ns):
   # Leave shoulder/arm openings in the upper side panels.
   if j>=nr-4 and abs(math.cos((i+.5)*2*math.pi/ns))>.76:continue
   fs.append((j*ns+i,j*ns+(i+1)%ns,(j+1)*ns+(i+1)%ns,(j+1)*ns+i))
 mesh('Carrier / fitted ballistic shell',rings,fs,1)
 # Plate stack ends above the hip crease; abdomen flexes between segments.
 upper=neck-.155*scale;w=shoulder*1.55
 panel('Ceramic / upper chest',0,upper,w,.20*scale)
 panel('Ceramic / sternum',0,upper-.185*scale,w*.94,.145*scale)
 panel('Ceramic / abdominal overlap',0,waist+.015*scale,w*.80,.085*scale)
 # Manufactured dorsal plates replace copied skin triangles that pinched in the rifle pose.
 for i in range(3):
  py=upper-.015*scale-i*.095*scale;pw=w*(.86 if i==0 else .78)
  panel('Ceramic / dorsal segment',0,py,pw,.105*scale,side=-1,offset=.023)
  for sign in [-1,1]:
   for row in range(3):
    yy=py+(.022-row*.014)*scale;xx=sign*pw*.27
    box('Dorsal / cooling recess',(xx,yy,plate_z(0,pw,xx,yy,-1,.031)),(.045*scale,.004,.002),1,'mixamorigSpine2' if i==0 else 'mixamorigSpine1',.001)
 for sign in [-1,1]:
  x=sign*w*.36
  side_name='Left' if sign>0 else 'Right'
  sh=bone(side_name+'Arm');el=bone(side_name+'ForeArm');axis=(el-sh).normalized()
  def shoulder_region(p,n,ids,lo,hi):
   t=(p-sh).dot(axis)
   relevant=sum(sum(a for name,a in weights[i].items() if side_name+'Arm' in name or side_name+'Shoulder' in name) for i in ids)/3
   return lo*scale<t<hi*scale and p.x*sign>abs(sh.x)*.72 and (p-sh).length<.15*scale and p.y>sh.y-.08*scale
  # Rigid open deltoid shell: a regular loft avoids jagged skin-derived borders.
  u=Vector((0,0,1));v=axis.cross(u).normalized();rings=[];cols=13
  limb_tree,_=region_tree([side_name+'Arm',side_name+'Shoulder'])
  for k,t in enumerate([-.025,.005,.045,.08]):
   center=sh+axis*t;ring=[]
   for j in range(cols):
    angle=-.30+(math.pi+.60)*j/(cols-1)
    d=(u*math.cos(angle)+v*math.sin(angle)*(-sign)).normalized()
    hit=limb_tree.ray_cast(center,d,.20)[0]
    radius=max(.055*scale,min(.085*scale,(hit-center).dot(d) if hit else .065*scale))
    ring.append(tuple(center+d*(radius+.014)))
   rings+=ring
  fs=[(k*cols+j,k*cols+j+1,(k+1)*cols+j+1,(k+1)*cols+j) for k in range(3) for j in range(cols-1)]
  cap=mesh('Ceramic / rigid deltoid shell',rings,fs,0,'mixamorig'+side_name+'Arm')
  bpy.context.view_layer.objects.active=cap
  sol=cap.modifiers.new('Finished plate rim','SOLIDIFY');sol.thickness=.005
  bpy.ops.object.modifier_move_up(modifier=sol.name);bpy.ops.object.modifier_apply(modifier=sol.name)
  for poly in cap.data.polygons:poly.use_smooth=True
  # Paired low-profile magazine sleeves, outside the weapon stock pocket.
  px=sign*w*.23;py=upper-.185*scale;pz=plate_z(0,w*.94,px,py,1,.018)+.023
  pouch_joint='mixamorig'+min(['Spine','Spine1','Spine2'],key=lambda n:abs(bone(n).y-py))
  box('Load carriage / magazine sleeve',(px,py,pz),(.065*scale,.112*scale,.035),1,pouch_joint)
  box('Load carriage / sleeve tab',(px,py+.045*scale,pz+.022),(.038*scale,.025*scale,.007),2,pouch_joint,.002)
  # Light armor: a rounded knee pad over a fitted sleeve and two retaining straps.
  # No unsupported shin slabs. Each surface follows native mixed knee skin weights.
  side_name='Left' if sign>0 else 'Right'
  knee=bone(side_name+'Leg');hip=bone(side_name+'UpLeg');foot=bone(side_name+'Foot')
  fit_tree,fit_tris=region_tree([side_name+'UpLeg',side_name+'Leg'])
  def leg_center(y):
   a,b=(knee,hip) if y>=knee.y else (foot,knee)
   return a.lerp(b,(y-a.y)/(b.y-a.y))
  def knee_wrap(name,lo,hi,mat,offset):
   vs=[];n=24
   for y in [lo,(lo+hi)/2,hi]:
    origin=leg_center(y)
    for i in range(n):
     angle=2*math.pi*i/n;d=Vector((math.cos(angle),0,math.sin(angle)));hit=fit_tree.ray_cast(origin,d,.22)[0]
     if hit is None:raise RuntimeError('Missing anatomical knee surface')
     vs.append(tuple(hit+d*offset))
   mesh(name,vs,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(2) for i in range(n)],mat)
  knee_wrap('Light / knee sleeve',knee.y-.045*scale,knee.y+.075*scale,1,.004)
  knee_wrap('Light / upper knee strap',knee.y+.042*scale,knee.y+.065*scale,1,.008)
  knee_wrap('Light / lower knee strap',knee.y-.038*scale,knee.y-.015*scale,1,.008)
  panel('Light / compact knee pad',knee.x,knee.y+.018*scale,.095*scale,.105*scale,offset=.013)
  fit_tree,fit_tris=torso_tree,torso_tris
  # Sleeve ID bars and torso strap hardware remain restrained at game scale.
  box('Marking / chest locator',(sign*w*.32,upper+.055*scale,plate_z(0,w,sign*w*.32,upper+.055*scale,1,.026)),(.026,.009,.003),3,None,.001)
 # Central identification panel and asymmetrical service stripe.
 z=plate_z(0,w,0,upper+.02*scale,1,.028)
 box('Marking / callsign plate',(0,upper+.02*scale,z),(.075*scale,.026*scale,.004),2,None,.002)
 for i in range(3):box('Marking / service notch',(-w*.29+i*.012,upper-.025*scale,plate_z(0,w,-w*.29+i*.012,upper-.025*scale,1,.027)),(.005,.037*scale,.003),3,None,.001)
 # Recessed manufacturer mark, real geometry sharing the webbing material.
 bpy.ops.object.text_add(location=bv((-.026*scale,upper+.014*scale,z+.003)))
 label=bpy.context.object;label.name='Marking / BL-07';label.data.body='BL / 07';label.data.size=.011*scale;label.rotation_euler=(math.pi/2,0,0);label.data.materials.append(mats[1]);bpy.ops.object.convert(target='MESH');bind(bpy.context.object)
 # Export armor separately: boots and belt remain equipped even without a vest.
 def export_parts(kind):
  bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
  for o in objects:o.select_set(True)
  bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,f'{kind}-{sex}.glb'),use_selection=True,export_format='GLB',export_animations=False,export_yup=True,export_apply=False,export_extras=False)
 export_parts('spectre')
 if os.environ.get('GEAR_VARIANT')=='spectre':continue
 objects=[]
 # Independent base kit uses three shared finishes with embedded micro-normal maps.
 mats=[material('Field kit / leather',(.024,.027,.026),0,.68),material('Field kit / rubber and webbing',(.015,.018,.017),0,.93),material('Field kit / hardware',(.20,.23,.22),.55,.48)]
 def tube(name,points,radius,mat,rigid=None):
  vs=[];segments=4
  for i,p in enumerate(points):
   p=Vector(p);axis=(Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)])).normalized()
   cross=axis.cross(Vector((0,0,1)))
   if cross.length<.01:cross=axis.cross(Vector((0,1,0)))
   cross.normalize();other=axis.cross(cross)
   for j in range(segments):
    a=j*2*math.pi/segments;vs.append(tuple(p+radius*(cross*math.cos(a)+other*math.sin(a))))
  fs=[(i*segments+j,i*segments+(j+1)%segments,(i+1)*segments+(j+1)%segments,(i+1)*segments+j) for i in range(len(points)-1) for j in range(segments)]
  mesh(name,vs,fs,mat,rigid)
 for side in ['Left','Right']:
  foot=bone(side+'Foot');knee=bone(side+'Leg');toe=bone(side+'ToeBase');rigid='mixamorig'+side+'Foot'
  fit_tree,fit_tris=region_tree([side+'Foot',side+'ToeBase',side+'Leg'])
  footverts=[v for v,w in zip(verts,weights) if sum(a for n,a in w.items() if side+'Foot' in n or side+'ToeBase' in n)>.55]
  lo=min(v.y for v in footverts)-.015;back=min(v.z for v in footverts)-.012;tip=max(v.z for v in footverts)+.015
  cx=foot.x;half=max(abs(v.x-cx) for v in footverts)+.009
  # A continuous boot last: rounded forefoot, narrower heel and a curved vamp.
  # No flat rubber patch over the toe: its normal discontinuity made the old toe faceted.
  N=40
  def footprint(y,inset=0):
   result=[]
   for j in range(N):
    a=2*math.pi*j/N;sn=math.sin(a);cs=math.cos(a)
    # Smoothly narrow the heel; the previous discrete width step created square corners.
    width=half*(.83+.17*(.5+.5*math.tanh(sn*3)))
    z=(tip+back)/2+(tip-back)/2*sn
    x=cx+width*cs
    result.append((x+(cx-x)*inset,y,z+(foot.z-z)*inset))
   return result
  def loft(name,rings,mat,rigid=None,cap=False,smooth=True):
   vs=sum(rings,[]);fs=[(i*N+j,i*N+(j+1)%N,(i+1)*N+(j+1)%N,(i+1)*N+j) for i in range(len(rings)-1) for j in range(N)]
   if cap:fs.extend([tuple(reversed(range(N))),tuple(range((len(rings)-1)*N,len(rings)*N))])
   o=mesh(name,vs,fs,mat,rigid)
   for poly in o.data.polygons:poly.use_smooth=smooth and len(poly.vertices)==4
   return o
  # Low rubber sole follows the last. An arch recess separates heel from forefoot.
  sole=[]
  for height,inset in [(.004,.025),(.008,0),(.024,0),(.028,.035)]:
   row=[]
   for x,y,z in footprint(lo+height,inset):
    arch=math.exp(-((z-(back+(tip-back)*.39))/.033)**4)
    row.append((x,y+(.008*arch if height<.009 else 0),z))
   sole.append(row)
  loft('Boot / contoured rubber outsole',sole,1,rigid,True)
  # A small quad control cage with real surface subdivision, not just interpolated
  # horizontal rings. This smooths the toe silhouette and ankle in both directions.
  N=20
  controls=[footprint(lo+.027,.055),footprint(lo+.042,.055),footprint(lo+.060,.10)]
  controls.append(footprint(lo+.083,.28))
  # More control sections around the actual ankle pivot retain the Achilles
  # hollow instead of lofting one long diagonal from heel to calf.
  for offset in [.022,.045,.075,.110,.145,.175,.205]:
   y=foot.y+offset;center=foot.lerp(knee,(y-foot.y)/(knee.y-foot.y));ring=[]
   for j in range(N):
    a=2*math.pi*j/N;d=Vector((math.cos(a),0,math.sin(a)));hit=fit_tree.ray_cast(center,d,.20)[0]
    if hit is None:raise RuntimeError('Missing boot ankle surface')
    rear=max(0,-math.sin(a))**4
    tendon=math.exp(-((offset-.060)/.045)**2)
    clearance=.011+.005*max(0,math.sin(a))-.006*rear*tendon
    ring.append(hit+d*clearance)
   # Filter small anatomical bumps out of the leather quarter; retain its broad fit.
   for _ in range(3):
    ring=[ring[j]*.5+(ring[(j-1)%N]+ring[(j+1)%N])*.25 for j in range(N)]
   controls.append([tuple(p) for p in ring])
  boot=loft('Boot / continuous leather upper',controls,0)
  bpy.context.view_layer.objects.active=boot
  subdivision=boot.modifiers.new('Smooth leather control cage','SUBSURF');subdivision.levels=1
  bpy.ops.object.modifier_move_up(modifier=subdivision.name)
  bpy.ops.object.modifier_apply(modifier=subdivision.name)
  # Keep the shoe rigid with the foot, then blend the ankle into the calf smoothly.
  # Nearest-triangle weights used to introduce toe/heel dents after posing.
  def boot_weights(o):
   o.vertex_groups.clear()
   foot_group=o.vertex_groups.new(name=bone_names['mixamorig'+side+'Foot'])
   calf_group=o.vertex_groups.new(name=bone_names['mixamorig'+side+'Leg'])
   for v in o.data.vertices:
    y=gv(o.matrix_world@v.co).y
    t=max(0,min(1,(y-foot.y+.005)/.095));t=t*t*(3-2*t)
    if t<1:foot_group.add([v.index],1-t,'REPLACE')
    if t>0:calf_group.add([v.index],t,'REPLACE')
  boot_weights(boot)
  # The actual subdivided upper boundary drives the rolled collar.
  rim=[gv(v.co) for v in boot.data.vertices if abs(gv(v.co).y-(foot.y+.205))<1e-5]
  # Sort around the center, rather than around an individual vertex on the rim.
  center=sum(rim,Vector())/len(rim);rim.sort(key=lambda p:math.atan2(p.z-center.z,p.x-center.x));N=len(rim)
  cuff=[]
  for dy,pad in [(-.017,.001),(-.014,.003),(-.003,.003),(0,0)]:
   row=[]
   for p in rim:
    v=Vector(p);d=Vector((v.x-cx,0,v.z-foot.z)).normalized();row.append(tuple(v+d*pad+Vector((0,dy,0))))
   cuff.append(row)
  collar=loft('Boot / rolled padded collar',cuff,1);boot_weights(collar)
  tube('Boot / welt stitching',footprint(lo+.029,.028)+[footprint(lo+.029,.028)[0]],.0008,0,rigid)
  # Shallow lugs tucked under the outsole, never independent square platforms.
  for k in range(8):
   z=back+.020+(tip-back-.040)*k/7
   if abs(z-(back+(tip-back)*.39))<.024:continue
   sn=(z-(tip+back)/2)/((tip-back)/2)
   edge=half*(.83+.17*(.5+.5*math.tanh(sn*3)))*math.sqrt(max(0,1-sn*sn))
   for sign in [-1,1]:box('Boot / outsole lug',(cx+sign*(edge-.008),lo+.004,z),(.015,.008,.015),1,rigid,.002)
  # Attach detail to the boot skin itself, so tongue/laces share the exact surface deformation.
  saved=(verts,weights,fit_tree,fit_tris)
  boot.data.calc_loop_triangles();verts=[gv(boot.matrix_world@v.co) for v in boot.data.vertices]
  groups={g.index:g.name for g in boot.vertex_groups}
  weights=[{groups[g.group]:g.weight for g in v.groups} for v in boot.data.vertices]
  fit_tris=[tuple(t.vertices) for t in boot.data.loop_triangles];fit_tree=BVHTree.FromPolygons(verts,fit_tris,all_triangles=True)
  def front_point(u,y,lift=.002):
   # u is measured across the tongue, centered on the leg at this height.
   # A fixed global X center allowed the laces to drift onto the side of the ankle.
   t=max(0,min(1,(y-foot.y)/(knee.y-foot.y)))
   center=foot.lerp(knee,t);width=.016+.004*min(1,max(0,(y-foot.y)/.10))
   hit,normal,_,_=fit_tree.ray_cast(Vector((center.x+u*width,y,.7)),Vector((0,0,-1)),1)
   if hit is None:raise RuntimeError('Lace missed boot tongue')
   return hit+normal*lift
  def rear_point(u,y,lift=.0015):
   t=max(0,min(1,(y-foot.y)/(knee.y-foot.y)))
   center=foot.lerp(knee,t)
   center.y=y
   direction=Vector((math.sin(u*.85),0,-math.cos(u*.85)))
   hit,normal,_,_=fit_tree.ray_cast(center,direction,.3)
   if hit is None:raise RuntimeError('Heel counter missed boot')
   return hit+normal*lift
  # Shallow heel counter defines the shoe below the flexible Achilles quarter.
  # Its curved top stops at the ankle; it does not stiffen the whole calf.
  rows=7;columns=11;counter=[]
  for row in range(rows):
   t=row/(rows-1)
   for col in range(columns):
    u=-1+2*col/(columns-1)
    top=foot.y+.021-.012*(1-u*u)
    y=(lo+.033)*(1-t)+top*t
    counter.append(tuple(rear_point(u,y)))
  heel=mesh('Boot / fitted heel counter',counter,[(r*columns+j,r*columns+j+1,(r+1)*columns+j+1,(r+1)*columns+j) for r in range(rows-1) for j in range(columns-1)],1)
  for poly in heel.data.polygons:poly.use_smooth=True
  boot_weights(heel)
  tube('Boot / heel counter seam',counter[-columns:],.0007,0)
  boot_weights(objects[-1])
  # Uniform spacing along the curved tongue, rather than uniform world-space Y.
  # The old spacing stretched the bottom crossings far down and around the vamp.
  start=lo+.095;end=foot.y+.150;steps=80
  centerline=[front_point(0,start+(end-start)*i/steps,0) for i in range(steps+1)]
  lengths=[0]
  for a,b in zip(centerline,centerline[1:]):lengths.append(lengths[-1]+(b-a).length)
  def tongue_y(t):
   distance=t*lengths[-1]
   for i in range(steps):
    if lengths[i+1]>=distance:
     f=(distance-lengths[i])/max(1e-8,lengths[i+1]-lengths[i]);return start+(end-start)*(i+f)/steps
   return end
  def tongue_point(u,t,lift=.002):return tuple(front_point(u,tongue_y(t),lift))
  rows=17;columns=5
  vs=[tongue_point(-1.2+2.4*j/(columns-1),i/(rows-1),.003) for i in range(rows) for j in range(columns)]
  tongue=mesh('Boot / fitted gusset tongue',vs,[(i*columns+j,i*columns+j+1,(i+1)*columns+j+1,(i+1)*columns+j) for i in range(rows-1) for j in range(columns-1)],1)
  for poly in tongue.data.polygons:poly.use_smooth=True
  boot_weights(tongue)
  for sign in [-1,1]:
   tube('Boot / tongue seam',[tongue_point(sign*1.25,i/16,.0035) for i in range(17)],.0008,0)
   boot_weights(objects[-1])
  count=8
  for i in range(count):
   t=i/(count-1);y=tongue_y(t)
   for sign in [-1,1]:
    # Flush eyelets stay inside the front quarter, beside the tongue.
    eyelet=[tuple(front_point(sign+r/.020*math.cos(a*math.pi/3),y+r*math.sin(a*math.pi/3),.0045)) for r in [.0027,.0015] for a in range(6)]
    o=mesh('Boot / flush eyelet',eyelet,[(j,(j+1)%6,6+(j+1)%6,6+j) for j in range(6)],2);boot_weights(o)
   if i<count-1:
    for sign in [-1,1]:
     tube('Boot / front cross lace',[tongue_point(sign*(1-2*k/4),(i+k/4)/(count-1),.006) for k in range(5)],.0013,0)
     for poly in objects[-1].data.polygons:poly.use_smooth=True
     boot_weights(objects[-1])
  verts,weights,fit_tree,fit_tris=saved
  # Fair quad shin guard fitted to the leg's cross-sections. Copying coarse skin
  # triangles and their normals produced long ridges in the previous extrusion.
  columns=17;rows=5;vs=[]
  bottom=foot.y+.170;top=knee.y-.060
  for i in range(rows):
   for j in range(columns):
    angle=-.12*math.pi+1.24*math.pi*j/(columns-1)
    end_round=abs(2*j/(columns-1)-1)**6
    y=bottom+(top-bottom)*i/(rows-1)+.012*end_round*(1-2*i/(rows-1))
    # Derive the center from the skin cross-section: the rig's bone line may
    # sit outside the calf near the knee, especially on the female base.
    section=[]
    for tri in fit_tris:
     points=[verts[k] for k in tri]
     if min(p.y for p in points)>y or max(p.y for p in points)<y:continue
     for a,b in zip(points,points[1:]+points[:1]):
      if (a.y-y)*(b.y-y)<=0 and abs(b.y-a.y)>1e-8:section.append(a.lerp(b,(y-a.y)/(b.y-a.y)))
    if not section:raise RuntimeError('Empty shin cross-section')
    xmin,xmax=min(p.x for p in section),max(p.x for p in section)
    zmin,zmax=min(p.z for p in section),max(p.z for p in section)
    center=Vector(((xmin+xmax)/2,y,(zmin+zmax)/2));rx=(xmax-xmin)/2+.012;rz=(zmax-zmin)/2+.012
    vs.append(tuple(center+Vector((rx*math.cos(angle),0,rz*math.sin(angle)))))
  shin=mesh('Boot / fitted smooth shin guard',vs,[(i*columns+j,i*columns+j+1,(i+1)*columns+j+1,(i+1)*columns+j) for i in range(rows-1) for j in range(columns-1)],0)
  for poly in shin.data.polygons:poly.use_smooth=True
  boot_weights(shin)
  bpy.context.view_layer.objects.active=shin
  thickness=shin.modifiers.new('Shin guard thickness','SOLIDIFY');thickness.thickness=.004;thickness.offset=1
  bpy.ops.object.modifier_move_up(modifier=thickness.name);bpy.ops.object.modifier_apply(modifier=thickness.name)
 # Padded low-waist belt follows the body around the hips, below the carrier.
 fit_tree,fit_tris=tree,tris
 cy=waist-.075*scale;N=48;belt=[]
 for y in [cy-.026,cy+.026]:
  for j in range(N):
   a=2*math.pi*j/N;d=Vector((math.cos(a),0,math.sin(a)));origin=Vector((0,y,.015));hit=tree.ray_cast(origin,d,.4)[0]
   if hit is None:raise RuntimeError('Missing belt fit')
   belt.append(tuple(hit+d*.012))
 mesh('Belt / padded webbing',belt,[(j,(j+1)%N,N+(j+1)%N,N+j) for j in range(N)],1)
 z=surface(0,cy)+.022
 box('Belt / quick release buckle',(0,cy,z),(.065,.043,.014),2,None,.006)
 box('Belt / buckle inset',(0,cy,z+.008),(.039,.023,.004),1,None,.003)
 for sign in [-1,1]:
  # Side pouches leave the front hip crease clear for sitting and crouching.
  for i in range(2):
   angle=sign*(.68+i*.42);d=Vector((math.sin(angle),0,math.cos(angle)));origin=Vector((0,cy,.015));hit=tree.ray_cast(origin,d,.4)[0]
   center=hit+d*.033+Vector((0,-.032,0))
   from mathutils import Matrix
   rot=Matrix.Rotation(angle,3,'Y')
   # One rigid hip attachment for the pouch and its fittings. Rotating the
   # entire assembly keeps flap, retention strap and fastener on its face.
   def pouch_box(name,local,dims,mat=0,bevel=.002):
    o=box(name,center+Vector(local),dims,mat,'mixamorigHips',bevel)
    for v in o.data.vertices:v.co=bv(center+rot@(gv(v.co)-center))
    return o
   pouch_box('Belt / magazine pouch' if sign<0 else 'Belt / utility pouch',(0,0,0),(.056,.105,.045),0,.007)
   pouch_box('Belt / reinforced front gusset',(0,-.005,.024),(.045,.080,.003),1,.004)
   pouch_box('Belt / folded flap',(0,.027,.028),(.052,.037,.006),0,.005)
   pouch_box('Belt / retention webbing',(0,.008,.033),(.014,.055,.003),1)
   pouch_box('Belt / retention buckle',(0,.005,.036),(.020,.018,.004),2)
   pouch_box('Belt / buckle opening',(0,.005,.039),(.012,.009,.001),1,.001)
   for x in [-.020,.020]:
    for j in range(7):pouch_box('Belt / pouch stitching',(x,-.039+j*.009,.027),(.0012,.004,.001),2,.0003)
 # Rear compact medical pouch with perimeter stitching and a zip closure.
 z=surface(0,cy,-1)-.035
 box('Belt / rear medical pouch',(0,cy-.025,z),(.12,.085,.05),0,'mixamorigHips',.010)
 box('Belt / medical front panel',(0,cy-.025,z-.027),(.103,.066,.004),1,'mixamorigHips',.006)
 box('Belt / medical patch',(0,cy-.025,z-.030),(.032,.028,.003),0,'mixamorigHips',.002)
 box('Belt / medical cross horizontal',(0,cy-.025,z-.032),(.023,.006,.002),2,'mixamorigHips',.001)
 box('Belt / medical cross vertical',(0,cy-.025,z-.032),(.006,.023,.002),2,'mixamorigHips',.001)
 for y in [cy-.052,cy+.002]:
  for j in range(12):box('Belt / rear pouch stitching',(-.046+j*.008,y,z-.030),(.003,.001,.001),2,'mixamorigHips',.0002)
 box('Belt / pouch zipper',(0,cy+.017,z),(.087,.002,.004),2,'mixamorigHips',.001)
 box('Belt / zipper pull',(.041,cy+.014,z-.010),(.008,.012,.003),2,'mixamorigHips',.001)
 export_parts('field-kit')
 print('FIELD_KIT',sex,len(objects),'pieces')
 if os.environ.get('GEAR_SAVE_BLEND'):bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,f'field-kit-{sex}.blend'))
