"""NYX: three complete fitted armor sets, authored offline on the native skeleton."""
import sys,os,math,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from nyx_cuirass import build_cuirass
from nyx_details import torso_details, limb_details, heavy_torso, heavy_limbs
from native_gear import NativeGear,material,gv,bv,bpy,Vector,ROOT
OUT=Path(os.environ.get('GEAR_BUILD_DIR','/tmp/ghosts-field-kit'));OUT.mkdir(exist_ok=True,parents=True)
for sex in ['male','female']:
 for tier,slug in enumerate(['nyx','nyx-mid','nyx-heavy']):
  if os.environ.get("GEAR_VARIANT") and slug not in os.environ["GEAR_VARIANT"].split(","): continue
  g=NativeGear(sex);neck=g.bone('Neck').y;waist=g.bone('Spine').y;chest=g.bone('Spine2').y;head=g.bone('Head');top=max(p.y for p in g.v);scale=neck/1.4942;shoulder=abs(g.bone('LeftArm').x)
  cloth=material('NYX / graphite weave',(.018,.022,.023),0,.93)
  ceramic=material('NYX / carbon ceramic',(.045,.053,.057),.18,.58)
  trim=material('NYX / edge binding',(.085,.10,.10),.25,.66)
  signal=material('NYX / cyan identification',(.045,.28,.29),.15,.38,(.035,.38,.40))
  hardware=material('NYX / titanium hardware',(.20,.23,.23),.7,.38)
  g.detail_materials=(trim,hardware,cloth)
  g.binding_torso=True
  # A fitted torso vest ending at the belt, with complete sides and back.
  rows=10;cols=40;vs=[]
  for i in range(rows):
   y=waist-.035*scale+(neck-.23*scale-waist+.035*scale)*i/(rows-1)
   for j in range(cols):
    a=2*math.pi*j/cols;d=Vector((math.cos(a),0,math.sin(a)));origin=Vector((0,y,.01));hit=g.tree.ray_cast(origin,d,.4)[0]
    if hit is None:raise RuntimeError(f'Missing jacket surface {sex} {y} {j} neck={neck} chest={chest}')
    vs.append(hit+d*.009)
  torso_rings=[vs[i*cols:(i+1)*cols] for i in range(rows)]
  if tier>0:
   # Rib shells are rigid assemblies; hip flexion belongs to the fabric below.
   g.binding_rigid='Spine'
   g.patch('NYX / left rib wrap',torso_rings,[37,38,39,0,1,2,3],ceramic,lift=.008+.002*tier)
   g.patch('NYX / right rib wrap',torso_rings,list(range(17,24)),ceramic,lift=.008+.002*tier)
  g.binding_rigid=None
  g.mesh('NYX / fitted jacket',vs,[(i*cols+j,i*cols+(j+1)%cols,(i+1)*cols+(j+1)%cols,(i+1)*cols+j) for i in range(rows-1) for j in range(cols)],cloth,thickness=.003)
  # Segmented diagonal cuirass: narrow enough to move with the torso.
  width=shoulder*(.78+.055*tier);upper=neck-.05*scale;lower=waist+.115*scale
  for sign in [-1,1]:
   # Flexible oblique bands remain close to the ribs, separated by visible cloth.
   for i in range(3):
    y=lower-.018*scale-i*.037*scale;x=sign*width*.47
    g.panel('NYX / oblique armor segment',[(x-sign*.038,y+.02),(x+sign*.037,y+.038),(x+sign*.040,y+.012),(x-sign*.032,y-.009)],ceramic,offset=.016)
  for i in range(4):
   y=lower-.012-i*.033
   w=.042+.005*tier
   g.panel('NYX / articulated abdominal tile',[(-w,y+.015),(w,y+.015),(w*.8,y-.014),(0,y-.021),(-w*.8,y-.014)],ceramic,offset=.018)
  for sign in [-1,1]:
   w=width*(.85+.1*tier)
   g.panel('NYX / scapular shell',[(sign*.016,upper),(sign*w*.8,upper-.050),(sign*w,upper-.095),(sign*w*.8,chest-.025),(sign*.025,chest-.015)],ceramic,side=-1,offset=.018)
   # Three inset cooling slots on each scapula.
   for i in range(3):
    y=upper-.038-i*.013
    points=[g.front(sign*(.04+t*.045),y-.008*t,-1,.024) for t in [0,.5,1]]
    g.tube('NYX / scapular cooling slot',points,.0017,cloth)
  for i in range(4):
   y=waist+.018*scale+i*.063*scale;w=.075 if i<2 else .090
   g.panel('NYX / dorsal articulated plate',[(-w,y+.025),(0,y+.038),(w,y+.025),(w*.78,y-.018),(0,y-.03),(-w*.78,y-.018)],ceramic,side=-1,offset=.017)
  g.tube('NYX / dorsal signal',[g.front(0,chest-.06+t*.032,-1,.025) for t in [0,.5,1]],.0016,signal)
  build_cuirass(g,tier,upper,lower,width,ceramic,trim,cloth,hardware,signal)
  torso_details(g,tier,upper,lower,waist,width,ceramic,trim,cloth,hardware,signal)
  if tier==2:
   # Housing, heat sinks and indicators share a rigid dorsal attachment.
   g.binding_rigid='Spine1'
   heavy_torso(g,upper,lower,waist,width,ceramic,trim,cloth,hardware,signal)
   g.binding_rigid=None
  # Fitted limb sleeves with short ceramic overlays, never floating bone boxes.
  def sleeve(name,a,b,t0,t1,mat,around=24):
   axis=(b-a).normalized();u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u);rings=[];surface=g.tree if 'shoulder' in name else g.region([side+'Arm',side+'Shoulder',side+'ForeArm',side+'Hand'] if 'arm' in name else [side+'UpLeg',side+'Leg'])
   for k in range(5):
    center=a+axis*(t0+(t1-t0)*k/4);ring=[]
    for j in range(around):
     d=u*math.cos(2*math.pi*j/around)+v*math.sin(2*math.pi*j/around);hit=surface.ray_cast(center+d*.22,-d,.44)[0]
     if hit is None:raise RuntimeError('Missing limb fit: '+name)
     if 'shoulder' in name:
      # Inward rays can hit the rib cage instead of the deltoid. Bound the
      # shoulder section so it cannot grow into a second chest plate.
      # Cast out from the joint: inward casts starting inside the chest
      # returned points behind the joint and inverted sections of the cap.
      outer=surface.ray_cast(center,d,.5)[0]
      if outer is None:raise RuntimeError('Missing outward shoulder fit')
      radius=(outer-center).dot(d)
      if radius<=0:raise RuntimeError('Inverted shoulder section')
      hit=center+d*min(radius,.080*scale)
     ring.append(hit+d*.009)
    # Fair the fitted section before adding manufactured surface details.
    for _ in range(2):ring=[ring[j]*.6+(ring[(j-1)%around]+ring[(j+1)%around])*.2 for j in range(around)]
    rings.append(ring)
   vs=sum(rings,[]);fs=[(k*around+j,k*around+(j+1)%around,(k+1)*around+(j+1)%around,(k+1)*around+j) for k in range(4) for j in range(around)]
   return g.mesh(name,vs,fs,mat,thickness=.003),rings
  g.binding_torso=False
  g.binding_limb=True
  for side in ['Left','Right']:
   g.binding_side=side
   sh=g.bone(side+'Arm');el=g.bone(side+'ForeArm');wrist=g.bone(side+'Hand');hip=g.bone(side+'UpLeg');knee=g.bone(side+'Leg')
   cap,caprings=sleeve('NYX / shoulder cap',sh,el,-.045,.092,cloth)
   g.patch('NYX / deltoid shell',caprings,list(range(2,23)),ceramic,lift=.006+.003*tier)
   # Collar-length shoulder edging gives a clean manufactured boundary.
   g.tube('NYX / shoulder binding',caprings[-1]+[caprings[-1][0]],.0018,trim)
   bracer,brings=sleeve('NYX / forearm bracer',el,wrist,.065,(wrist-el).length-.050,cloth)
   # Inner wrist status strip follows the bracer itself.
   g.tube('NYX / wrist signal',[brings[k][6]+Vector((0,0,.002)) for k in [2,3,4]],.0014,signal)
   # Thigh protection stays on the front/outer leg; no padded shorts silhouette.
   thigh,trings=sleeve('NYX / thigh foundation',hip,knee,.11,.24+.025*tier,cloth)
   if tier==0:thigh.hide_render=True;g.objects.remove(thigh)
   for band in [0,4]:
    g.tube('NYX / thigh retention seam',trings[band]+[trings[band][0]],.0012,trim)
   # Complete front and side surfaces, with a finished rear edge.
   g.patch('NYX / contoured thigh shield',trings,list(range(12,24)),ceramic,lift=.008+.003*tier)
   foot=g.bone(side+'Foot')
   knee_sleeve,krings=sleeve('NYX / articulated knee sleeve',knee,foot,-.035,.045,cloth)
   g.patch('NYX / ceramic knee shield',krings,list(range(12,24)),ceramic,lift=.009)
   # A stepped forearm face, recessed electronics and narrow wrapped retainers.
   for k in [0,4]:g.tube('NYX / bracer edge',brings[k]+[brings[k][0]],.0015,trim)
   g.patch('NYX / dorsal vambrace',brings,list(range(12,24)),ceramic,lift=.009)
   g.patch('NYX / inner forearm shield',brings,list(range(1,11)),ceramic,lift=.006)
   # Long greaves continue the silhouette to the boot cuff, with a rear closure.
   shin,srings=sleeve('NYX / fitted shin wrap',knee,foot,.085,(foot-knee).length-.14,cloth)
   if tier==0:shin.hide_render=True;g.objects.remove(shin)
   g.patch('NYX / contoured shin shield',srings,list(range(12,24)),ceramic,lift=.009+.002*tier)
   if tier==2:
    upper_arm,urings=sleeve('NYX / upper arm flex layer',sh,el,.11,(el-sh).length-.065,cloth)
    g.patch('NYX / upper arm front shell',urings,list(range(13,23)),ceramic,lift=.007)
    g.patch('NYX / upper arm rear shell',urings,list(range(2,11)),ceramic,lift=.007)
   # Recessed external bracer controls use the same fitted skinning as the shell.
   for k in [1,2,3]:
    center=sum(brings[k],Vector())/24;p=brings[k][18];normal=(p-center).normalized();p=p+normal*.013
    direction=(brings[k][19]-brings[k][17]).normalized()
    g.tube('NYX / bracer status', [p-direction*.005,p+direction*.005],.0013,signal)
   if tier>0:
    # Rear and lateral protection wrap the limbs, with flexible articulation gaps.
    g.patch('NYX / rear thigh shell',trings,list(range(1,11)),ceramic,lift=.006)
    g.patch('NYX / rear calf shell',srings,list(range(2,10)),ceramic,lift=.006)
    for band in range(tier):
     # Short lower shoulder lames terminate before the elbow, never on the biceps alone.
     rows=caprings[1+band:4+band]
     g.patch('NYX / shoulder lame',rows,list(range(3,22)),ceramic,lift=.013+band*.005)

   limb_details(g,tier,side,caprings,brings,trings,krings,srings,ceramic,trim,cloth,hardware,signal)
   if tier==2: heavy_limbs(g,side,caprings,brings,trings,srings,ceramic,trim,cloth,hardware,signal)

  g.binding_side=None
  g.binding_torso=True
  # Short split rear jacket tails remain close to the hips, not a cape.
  for sign in [-1,1]:
   g.panel('NYX / rear waist overlap',[(sign*.015,waist-.005),(sign*.115,waist+.005),(sign*.12,waist-.115),(sign*.04,waist-.145)],cloth,side=-1,offset=.013,thickness=.003)
  g.export(OUT/f'{slug}-{sex}.glb')
  if os.environ.get('GEAR_SAVE_BLEND'):bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{slug}-{sex}.blend'))
  print('NYX_COMPLETE',sex,slug)
