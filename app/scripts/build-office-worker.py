"""Office VIP clothing, fitted and weighted to the existing male/female MPFB rigs.

Run with Blender --background --python scripts/build-office-worker.py, then
GEAR_BUILD_DIR=/tmp/ghosts-office-worker node scripts/pack-field-kit.mjs
<gltf-transform toolchain directory> office-worker.
"""
import math
import os
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_gear import NativeGear, material, gv, bv

OUT = Path(os.environ.get('GEAR_BUILD_DIR', '/tmp/ghosts-office-worker'))
OUT.mkdir(parents=True, exist_ok=True)

for sex in ['male', 'female']:
    g = NativeGear(sex)
    shirt = material('Office / ivory cotton', (.63, .68, .65), rough=.89)
    trouser = material('Office / midnight wool', (.026, .043, .065), rough=.94)
    silk = material('Office / burgundy silk', (.19, .025, .038), rough=.64)
    leather = material('Office / oxblood leather', (.039, .018, .015), rough=.4)
    trim = material('Office / brushed hardware', (.27, .29, .28), metal=.65, rough=.38)
    badge = material('Office / badge face', (.83, .85, .79), rough=.6)
    waist = g.bone('Spine').y - .012
    neck = g.bone('Neck').y + .022

    def influence(i, terms):
        return sum(w for n, w in g.weights[i].items() if any(t in n for t in terms))

    def shell(name, predicate, mat, ease):
        selected = [t for t in g.tri if all(predicate(i) for i in t)]
        ids = sorted({i for t in selected for i in t})
        remap = {i: j for j, i in enumerate(ids)}
        data = bpy.data.meshes.new(name)
        data.from_pydata([bv(g.v[i]) for i in ids], [], [tuple(remap[i] for i in t) for t in selected])
        bm = bmesh.new(); bm.from_mesh(data)
        # Relax anatomical details into a cloth surface and finish cut edges.
        for _ in range(12):
            changes = {}
            for v in bm.verts:
                edge = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
                neighbors = edge if len(edge) == 2 else [e.other_vert(v) for e in v.link_edges]
                if neighbors:
                    changes[v] = v.co.lerp(sum((n.co for n in neighbors), Vector()) / len(neighbors), .35)
            for v, p in changes.items(): v.co = p
        bm.normal_update()
        for v in bm.verts: v.co += v.normal * ease
        bm.to_mesh(data); bm.free()
        vs = [gv(v.co) for v in data.vertices]
        o = g.mesh(name, vs, [tuple(p.vertices) for p in data.polygons], mat)
        # Relax weights together with the cloth so nearby armpit vertices cannot
        # retain very different arm/torso influences after surface relaxation.
        ws = [dict(g.weights[i]) for i in ids]
        neighbors = [set() for _ in ids]
        for e in data.edges:
            a,b = e.vertices; neighbors[a].add(b); neighbors[b].add(a)
        for _ in range(16):
            blended=[]
            for i,adj in enumerate(neighbors):
                row={n:w*.65 for n,w in ws[i].items()}
                for j in adj:
                    for n,w in ws[j].items(): row[n]=row.get(n,0)+w*.35/len(adj)
                blended.append(row)
            ws=blended
        o.vertex_groups.clear()
        for v in o.data.vertices:
            assert (gv(v.co)-vs[v.index]).length < 1e-5
            row=dict(sorted(ws[v.index].items(),key=lambda item:-item[1])[:4])
            total=sum(row.values())
            for n, w in row.items():
                group = o.vertex_groups.get(n) or o.vertex_groups.new(name=n)
                group.add([v.index], w/total, 'REPLACE')
        bpy.data.meshes.remove(data)
        return o

    # Tailored quad rings bridge the chest rather than preserving anatomical
    # creases. Independent sleeve caps overlap the shoulder seam like sewn cloth.
    count = 40
    vs = []
    rows = 18
    for r in range(rows):
        y = waist-.012+(neck-waist+.012)*r/(rows-1)
        row = [p for i,p in enumerate(g.v) if abs(p.y-y)<.018 and influence(i,['Hips','Spine','Neck','Shoulder'])>.65]
        width = max((abs(p.x) for p in row),default=.045)+.019
        shoulder=g.bone('LeftArm')
        if y > shoulder.y-.06:
            t=max(0,min(1,(y-shoulder.y-.025)/(neck-shoulder.y-.025)))
            width=max(width,(shoulder.x+.035)*(1-t)+.055*t)
        front_z = max((p.z for p in row),default=.05)+.025
        back_z = min((p.z for p in row),default=-.05)-.023
        center_z = (front_z+back_z)*.5
        for j in range(count):
            angle=j*math.tau/count
            # Squarer weave drape with a softly crowned front and back.
            x=width*math.copysign(abs(math.sin(angle))**.84,math.sin(angle))
            z=center_z+(front_z-back_z)*.5*math.copysign(abs(math.cos(angle))**.84,math.cos(angle))
            vs.append(Vector((x,y,z)))
    fs=[(r*count+j,r*count+(j+1)%count,(r+1)*count+(j+1)%count,(r+1)*count+j) for r in range(rows-1) for j in range(count)]
    g.binding_torso=True
    top=g.mesh('Office / shirt',vs,fs,shirt,subdiv=1,rigid='Spine2')
    top.vertex_groups.clear()
    levels=[(g.bone(n).y,n) for n in ['Hips','Spine','Spine1','Spine2']]
    for v in top.data.vertices:
        y=gv(v.co).y
        lower=next(((a,b) for a,b in zip(levels,levels[1:]) if a[0]<=y<=b[0]),None)
        if lower:
            a,b=lower;t=(y-a[0])/(b[0]-a[0]);row=[(a[1],1-t),(b[1],t)]
        else:row=[('Hips' if y<levels[0][0] else 'Spine2',1)]
        for name,w in row:
            name=g.names['mixamorig'+name]
            group=top.vertex_groups.get(name) or top.vertex_groups.new(name=name)
            group.add([v.index],w,'REPLACE')
    g.binding_torso=False
    for side in ['Left','Right']:
        shoulder, elbow, wrist = [g.bone(side+n) for n in ['Arm','ForeArm','Hand']]
        axis=(wrist-shoulder).normalized()
        cross=axis.cross(Vector((0,0,1))).normalized()
        other=axis.cross(cross).normalized()
        path=[]
        for r in range(17):
            t=r/16
            center=shoulder.lerp(elbow,t*2) if t<=.5 else elbow.lerp(wrist,(t-.5)*2)
            radius=(.079*(1-t)+.043*t) if sex=='male' else (.068*(1-t)+.037*t)
            if r==0: center-=axis*.028;radius*=.6
            path.append((center,radius))
        sleeve_v=[center+radius*(cross*math.cos(j*math.tau/24)+other*math.sin(j*math.tau/24)) for center,radius in path for j in range(24)]
        sleeve_f=[(r*24+j,r*24+(j+1)%24,(r+1)*24+(j+1)%24,(r+1)*24+j) for r in range(16) for j in range(24)]
        sleeve_f.append(tuple(reversed(range(24))))
        g.binding_side=side
        sleeve=g.mesh('Office / '+side+' sleeve',sleeve_v,sleeve_f,shirt,subdiv=1)
        g.binding_side=None
        sleeve.vertex_groups.clear()
        # Continuous elbow weights keep the cuff and cap round through bends.
        for v in sleeve.data.vertices:
            p=gv(v.co)
            along=(p-elbow).dot(axis)
            blend=max(0,min(1,.5+along/.15))
            for joint,w in [(side+'Arm',1-blend),(side+'ForeArm',blend)]:
                group=sleeve.vertex_groups.get(g.names['mixamorig'+joint]) or sleeve.vertex_groups.new(name=g.names['mixamorig'+joint])
                group.add([v.index],w,'REPLACE')
    shell('Office / trousers', lambda i:
        g.v[i].y < waist + .015 and g.v[i].y > .115
        and influence(i, ['Arm', 'Hand']) < .05, trouser, .024)

    top.data.calc_loop_triangles()
    cloth_v = [gv(v.co) for v in top.data.vertices]
    cloth_tree = BVHTree.FromPolygons(cloth_v, [tuple(t.vertices) for t in top.data.loop_triangles], all_triangles=True)
    def front(x, y, offset=.004):
        hit = cloth_tree.ray_cast(Vector((x, y, .7)), Vector((0, 0, -1)), 1.4)[0]
        if hit is None:
            hit = cloth_tree.find_nearest(Vector((x, y, .08)))[0]
        return Vector((x, y, hit.z + offset))

    g.binding_torso = True
    # Sewn placket with pearl buttons; the tie remains a separate soft skin.
    ys = [waist + .02 + (neck-waist-.035)*i/18 for i in range(19)]
    vs = [front(x, y) for y in ys for x in [-.011, .011]]
    g.mesh('Office / button placket', vs, [(2*i,2*i+1,2*i+3,2*i+2) for i in range(18)], shirt, thickness=.002)
    for y in ys[1::3]:
        p = front(0, y, .008)
        g.tube('Office / pearl button', [p, p+Vector((0,0,.002))], .0032, badge)

    # Folded spread collar: two clean points over a raised neck band.
    for sign in [-1, 1]:
        outline = [(sign*.007,neck-.006), (sign*.037,neck+.003),
                   (sign*.083,neck-.021), (sign*.049,neck-.087)]
        g.mesh('Office / folded collar', [front(x,y,.014) for x,y in outline], [(0,1,2,3)], shirt, thickness=.004)
    tie_top, tie_end = neck-.037, waist+.065
    profile = [(tie_top,.011), (tie_top-.026,.008), (tie_end+.055,.026), (tie_end+.022,.029), (tie_end,0)]
    levels=[]
    for (ya,wa),(yb,wb) in zip(profile,profile[1:]):
        steps=max(2,math.ceil((ya-yb)/.012))
        levels.extend((ya+(yb-ya)*i/steps,wa+(wb-wa)*i/steps) for i in range(steps))
    levels.append(profile[-1])
    vs = [front(x,y,.019) for y,w in levels for x in [-w,0,w]]
    for i in range(len(levels)): vs[3*i+1].z += .004
    g.mesh('Office / silk tie blade', vs, [(r*3+j,r*3+j+1,(r+1)*3+j+1,(r+1)*3+j) for r in range(len(levels)-1) for j in range(2)], silk, thickness=.003)
    knot = [(-.015,tie_top+.027),(.015,tie_top+.027),(.010,tie_top),(-.010,tie_top)]
    g.mesh('Office / four-in-hand knot', [front(x,y,.022) for x,y in knot], [(0,1,2,3)], silk, thickness=.012)

    # Breast pocket and clipped photo ID: visible at tactical camera distance.
    px, py = .103, neck-.17
    pocket = [(px-.032,py+.023),(px+.032,py+.023),(px+.029,py-.039),(px,py-.049),(px-.029,py-.039)]
    g.mesh('Office / breast pocket', [front(x,y,.006) for x,y in pocket], [(0,1,2,3,4)], shirt, thickness=.002)
    for a,b in zip(pocket,pocket[1:]+pocket[:1]):
        g.tube('Office / pocket stitching', [front(*a,.008),front(*b,.008)], .0007, badge)
    def card(name,x,y,w,h,mat,lift):
        return g.mesh(name,[front(x+dx*w/2,y+dy*h/2,lift) for dx,dy in [(-1,-1),(1,-1),(1,1),(-1,1)]],[(0,1,2,3)],mat,thickness=.001)
    card('Office / ID card',px,py-.004,.048,.066,badge,.014)
    card('Office / ID portrait',px-.009,py,.016,.022,trouser,.017)
    card('Office / ID access stripe',px,py-.029,.047,.007,silk,.018)
    for y in [py+.016,py-.015,py-.020]: card('Office / ID print',px+.004,y,.026,.0015,trouser,.018)
    card('Office / ID clip',px,py+.033,.013,.017,trim,.018)

    # A narrow civilian belt with a modest metal buckle.
    rings = []
    for y in [waist-.025,waist+.019]:
        ring = []
        for j in range(48):
            angle = j*math.tau/48
            direction = Vector((math.sin(angle),0,math.cos(angle)))
            center = Vector((0,max(y,waist+.004),0))
            hit = cloth_tree.ray_cast(center+direction*.6,-direction,1)[0]
            p=(hit if hit else center+direction*.16)+direction*.007
            p.y=y;ring.append(p)
        rings.append(ring)
    g.mesh('Office / leather belt',rings[0]+rings[1],[(j,(j+1)%48,48+(j+1)%48,48+j) for j in range(48)],leather,thickness=.004)
    card('Office / belt buckle',0,waist+.006,.038,.027,trim,.044)
    card('Office / buckle inset',0,waist+.006,.027,.017,leather,.047)
    g.binding_torso = False

    # Details follow the actual cloth surface, not a different nearby body face.
    # Otherwise chest flexion can pull the shirt through its tie and ID card.
    cloth_tris=[tuple(t.vertices) for t in top.data.loop_triangles]
    top_names={group.index:group.name for group in top.vertex_groups}
    top_weights=[{top_names[w.group]:w.weight for w in v.groups} for v in top.data.vertices]
    for o in g.objects:
        if not any(word in o.name for word in ['placket','button','collar','tie blade','knot','pocket','ID ','buckle']): continue
        o.vertex_groups.clear()
        for vertex in o.data.vertices:
            near,_,ti,_=cloth_tree.find_nearest(gv(vertex.co))
            ids=cloth_tris[ti];a,b,c=[cloth_v[i] for i in ids]
            u=b-a;e=c-a;r=near-a;den=u.dot(u)*e.dot(e)-u.dot(e)**2
            beta=(e.dot(e)*r.dot(u)-u.dot(e)*r.dot(e))/den if abs(den)>1e-12 else 0
            gamma=(u.dot(u)*r.dot(e)-u.dot(e)*r.dot(u))/den if abs(den)>1e-12 else 0
            ws={}
            for i,d in zip(ids,[max(0,1-beta-gamma),max(0,beta),max(0,gamma)]):
                for n,w in top_weights[i].items():ws[n]=ws.get(n,0)+d*w
            ws=dict(sorted(ws.items(),key=lambda pair:-pair[1])[:4]);total=sum(ws.values())
            for n,w in ws.items():
                group=o.vertex_groups.get(n) or o.vertex_groups.new(name=n)
                group.add([vertex.index],w/total,'REPLACE')

    # Low dress shoes and dark ankle socks; all details follow the foot bone.
    for side in ['Left','Right']:
        foot = g.bone(side+'Foot'); toe = g.bone(side+'ToeBase')
        forward = Vector((toe.x-foot.x,0,toe.z-foot.z)).normalized()
        lateral = Vector((forward.z,0,-forward.x))
        center = Vector((foot.x,0,foot.z))
        def point(x,y,z): return center+lateral*x+forward*z+Vector((0,y,0))
        for name, ringspec, mat in [
            ('welted sole',[(.006,.060,.162,-.068),(.022,.061,.164,-.069),(.027,.057,.159,-.065)],leather),
            ('polished upper',[(.026,.057,.159,-.065),(.046,.056,.158,-.064),(.067,.049,.139,-.059),(.094,.040,.067,-.052),(.114,.037,.042,-.045)],leather),
            ('ankle sock',[(.091,.036,.039,-.043),(.155,.038,.038,-.044)],trouser),
        ]:
            vs=[];count=32
            for y,width,front_z,back_z in ringspec:
                for j in range(count):
                    a=j*math.tau/count; z=(front_z if math.cos(a)>0 else -back_z)*math.cos(a)
                    vs.append(point(width*math.sin(a),y,z))
            fs=[(r*count+j,r*count+(j+1)%count,(r+1)*count+(j+1)%count,(r+1)*count+j) for r in range(len(ringspec)-1) for j in range(count)]
            if name=='welted sole': fs.append(tuple(reversed(range(count))))
            g.mesh('Office / '+side+' '+name,vs,fs,mat,rigid=side+'Foot',thickness=.002)
        for z in [.048,.061,.074]:
            g.tube('Office / '+side+' Oxford laces',[point(-.022,.091,z),point(0,.096,z+.004),point(.022,.091,z)],.0018,leather,rigid=side+'Foot')
    g.export(OUT / ('office-worker-'+sex+'.glb'))
