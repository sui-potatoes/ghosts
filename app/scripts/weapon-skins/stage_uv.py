"""Stage 1: the game mesh. Builds the low-detail source, drops faces no ray can
leave, sets hard edges, cuts seams and packs ONE atlas for the body and the
standard clip and stock. Saves <work>/low_uv.blend.
Blender --background --python stage_uv.py -- <work> [HARD_ANGLE_DEG] [MARGIN]"""
import bpy, bmesh, sys, math, heapq, pathlib, json, hashlib
import numpy as np
from mathutils import Vector
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import common
from common import UP

W = common.work_dir()
argv = common.args()
HARD = math.radians(float(argv[1]) if len(argv) > 1 else 62)
MARGIN = float(argv[2]) if len(argv) > 2 else 0.004

common.clear()
col = bpy.data.collections.new('low')
bpy.context.scene.collection.children.link(col)
data, objs = common.load(W / 'source-low.json', col)

stats = {'islands': 0, 'cuts': 0, 'closed': 0, 'tubes': 0, 'genus': 0}


def seam_cost(e):
    # Prefer seams on the underside, then the sides; avoid the top.
    n = sum((f.normal for f in e.link_faces), Vector()).normalized()
    return e.calc_length() * (0.3 + (1 + n.dot(UP)))


def shortest(bm_verts_src, targets, allowed_edges):
    """Dijkstra over allowed edges from a set of sources to any target; returns edge list."""
    dist = {}
    prev = {}
    heap = []
    for v in bm_verts_src:
        dist[v.index] = 0
        heapq.heappush(heap, (0, v.index, v))
    while heap:
        d, _, v = heapq.heappop(heap)
        if d > dist.get(v.index, 1e9):
            continue
        if v.index in targets:
            path = []
            while v.index in prev:
                e, v = prev[v.index]
                path.append(e)
            return path
        for e in v.link_edges:
            if e.index not in allowed_edges:
                continue
            w = e.other_vert(v)
            nd = d + allowed_edges[e.index]
            if nd < dist.get(w.index, 1e9):
                dist[w.index] = nd
                prev[w.index] = (e, v)
                heapq.heappush(heap, (nd, w.index, w))
    return []


def island_topology(island, fset):
    """Euler characteristic and boundary-loop count of the island cut open along its seams."""
    parent = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    verts = {v for f in island for v in f.verts}
    for v in verts:
        fs = [f for f in v.link_faces if f.index in fset]
        for f in fs:
            parent[(v.index, f.index)] = (v.index, f.index)
        for e in v.link_edges:
            if e.seam:
                continue
            lf = [f for f in e.link_faces if f.index in fset]
            if len(lf) == 2:
                a, b = find((v.index, lf[0].index)), find((v.index, lf[1].index))
                parent[a] = b
    wedges = {find(k) for k in parent}
    edges = {e for f in island for e in f.edges}
    E = 0
    half = []  # boundary half-edges as (wedge a, wedge b)
    for e in edges:
        lf = [f for f in e.link_faces if f.index in fset]
        if len(lf) == 2 and not e.seam:
            E += 1
            continue
        E += len(lf)
        for f in lf:
            half.append((find((e.verts[0].index, f.index)), find((e.verts[1].index, f.index))))
    chi = len(wedges) - E + len(island)
    adj = {}
    for a, b in half:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    loops = []
    left = set(adj)
    while left:
        w = left.pop()
        comp = {w}
        stack = [w]
        while stack:
            x = stack.pop()
            for y in adj[x]:
                if y in left:
                    left.discard(y)
                    comp.add(y)
                    stack.append(y)
        loops.append({k[0] for k in comp})
    return chi, loops


def islands_of(bm):
    seen = set()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        island = []
        stack = [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            island.append(f)
            for e in f.edges:
                if e.seam:
                    continue
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        yield island


def cut_islands(bm):
    """Every island bounded by seams must be a disc (holes allowed). Closed
    islands get a cut between their two farthest-apart points, tubes a cut
    between their two longest boundary loops, both routed along the underside."""
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    bm.faces.index_update()
    bm.edges.index_update()
    bm.verts.index_update()
    for rnd in range(8):
        changed = False
        for island in list(islands_of(bm)):
            fset = {f.index for f in island}
            chi, loops = island_topology(island, fset)
            b = len(loops)
            if rnd == 0:
                stats['islands'] += 1
            genus = (2 - chi - b) // 2
            if chi == 1 and b == 1:
                continue
            if b >= 2 and genus == 0:
                # tube: one cut, in the first round only; later the leftover
                # loops are holes. A flat face with a hole needs no cut.
                n0 = island[0].normal
                if rnd > 0 or all(f.normal.angle(n0, 0) < 0.05 for f in island):
                    continue
            edges = {e for f in island for e in f.edges}
            interior = {e.index: seam_cost(e) for e in edges if not e.seam and
                        sum(1 for g in e.link_faces if g.index in fset) == 2}
            verts = {v for f in island for v in f.verts}
            if b == 0:
                vs = sorted(verts, key=lambda v: v.co.z)
                path = shortest([vs[0]], {vs[-1].index}, interior)
                stats['closed'] += 1
            elif b >= 2:
                def size(l):
                    return len(l)
                loops.sort(key=lambda l: -len(l))
                src = [bm.verts[i] for i in loops[0]]
                path = shortest(src, set(loops[1]), interior)
                stats['tubes'] += 1
            else:
                # one boundary but a handle (genus): cut from the boundary across the handle
                src = [bm.verts[i] for i in loops[0]]
                far = max(verts, key=lambda v: min((v.co - bm.verts[i].co).length for i in loops[0]))
                path = shortest(src, {far.index}, interior)
                stats['genus'] += 1
            for e in path:
                e.seam = True
            if path:
                changed = True
                stats['cuts'] += 1
        if not changed:
            break
    # report what is still not a disc
    for island in islands_of(bm):
        fset = {f.index for f in island}
        chi, loops = island_topology(island, fset)
        if (2 - chi - len(loops)) != 0 or len(loops) == 0:
            stats.setdefault('not_disc', []).append((chi, len(loops), len(island)))
        elif len(loops) > 1:
            stats['with_holes'] = stats.get('with_holes', 0) + 1


# --- Hidden faces: a face no ray can leave (with the standard furniture in place
# for furniture, without it for the body, since fittings replace the furniture)
# is deleted; a face little light reaches gets a quarter of the texel density.
from mathutils.bvhtree import BVHTree
bpy.context.view_layer.update()
def bvh_for(objs):
    vs, ps = [], []
    for o in objs:
        mw = o.matrix_world
        base = len(vs)
        vs += [mw @ v.co for v in o.data.vertices]
        ps += [[base + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(vs, ps)
body = [o for o in objs if o['piece'] == 0]
trees = {k: bvh_for(body + ([o for o in objs if o['piece'] == k] if k else [])) for k in (0, 1, 2)}
DIRS = []
for i in range(48):
    z = (i + 0.5) / 48
    r = math.sqrt(1 - z * z)
    a = i * 2.39996
    DIRS.append(Vector((r * math.cos(a), r * math.sin(a), z)))
removed = 0
for o in objs:
    tree = trees[o['piece']]
    mw = o.matrix_world
    bm = bmesh.new()
    bm.from_mesh(o.data)
    vis = bm.faces.layers.float.new('vis')
    dead = []
    for f in bm.faces:
        n = f.normal.normalized()
        t = n.orthogonal().normalized()
        bt = n.cross(t)
        c = f.calc_center_median()
        # conservative: centroid, near each corner and each edge midpoint, so a
        # long triangle that is visible only near one end is kept
        ws = [v.co for v in f.verts]
        pts = [c] + [c.lerp(w, 0.93) for w in ws] + \
            [c.lerp((ws[i] + ws[(i + 1) % len(ws)]) / 2, 0.93) for i in range(len(ws))]
        hit = total = 0
        for p in pts:
            p = p + n * 2e-5
            for d in DIRS:
                total += 1
                if tree.ray_cast(p, t * d.x + bt * d.y + n * d.z, 3.0)[0] is not None:
                    hit += 1
        esc = 1 - hit / total
        f[vis] = esc
        if esc == 0:
            dead.append(f)
    removed += sum(len(f.verts) - 2 for f in dead)
    bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
stats['hidden_tris_removed'] = removed

for o in objs:
    if True:
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        for e in bm.edges:
            if len(e.link_faces) != 2:
                e.smooth = False
                e.seam = True
                continue
            a = e.link_faces[0].normal.angle(e.link_faces[1].normal, 0)
            hard = a > HARD
            e.smooth = not hard
            e.seam = hard
        for f in bm.faces:
            f.smooth = True
        cut_islands(bm)
        bm.to_mesh(me)
        bm.free()

# ---------------------------------------------------------------------------
# ONE mesh, ONE material, one atlas; piece, slot and part stay as face attributes.
common.select_only(objs)
bpy.ops.object.join()
gun = bpy.context.object
common.select_only([gun])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
gun.name = gun.data.name = 'Gun'
skin = bpy.data.materials.new('Skin')
skin.use_nodes = True
gun.data.materials.clear()
gun.data.materials.append(skin)
for p in gun.data.polygons:
    p.material_index = 0

common.select_only([gun])
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.unwrap(method='CONFORMAL', fill_holes=True, margin=0.0)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
bpy.ops.object.mode_set(mode='OBJECT')

# Orient every island to the gun: long islands run muzzle -> +u (as seen from
# outside: muzzle to the right on the left side, to the left on the right
# side), the rest stand upright (up -> +v). Never mirrored (LSCM keeps winding).
# Scale: receiver flanks x1.4, enclosed faces x0.25.
INTERIOR = 0.06
FLANK_PARTS = {data['parts'].index('upper'), data['parts'].index('lower')}
bm = bmesh.new()
bm.from_mesh(gun.data)
vis = bm.faces.layers.float.get('vis')
part = bm.faces.layers.int.get('part')
uvl = bm.loops.layers.uv.active
bm.faces.index_update()
nflank = 0
for island in islands_of(bm):
    loops = [l for f in island for l in f.loops]
    P = np.array([l.vert.co[:] for l in loops])
    U = np.array([l[uvl].uv[:] for l in loops])
    Uc = U - U.mean(0)
    Pc = P - P.mean(0)
    # least squares 3D = J @ uv  (J: 3x2)
    J, *_ = np.linalg.lstsq(Uc, Pc, rcond=None)  # 2x3
    gz = J[:, 0]  # d(muzzle)/d(u,v)
    gy = J[:, 2]  # d(up)/d(u,v)
    area = sum(f.calc_area() for f in island) or 1e-12
    nrm = sum((f.normal * f.calc_area() for f in island), Vector()) / area
    ext = Pc.max(0) - Pc.min(0)
    if area < 3e-4:
        # small island (teeth, fasteners, caps): long axis horizontal, packs tight
        w, vec = np.linalg.eigh(Uc.T @ Uc)
        target, g = np.array([1.0, 0]), vec[:, 1]
    elif ext[0] >= ext[2] and np.linalg.norm(gz) > 1e-9:
        target = np.array([1.0, 0]) if nrm.y >= -0.2 else np.array([-1.0, 0])
        g = gz
    elif np.linalg.norm(gy) > 1e-9:
        target, g = np.array([0, 1.0]), gy
    else:
        continue
    a = math.atan2(target[1], target[0]) - math.atan2(g[1], g[0])
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    v = sum(f[vis] * f.calc_area() for f in island) / area
    s = 1.0
    if v < INTERIOR:
        s = 0.25
        stats['interior_islands'] = stats.get('interior_islands', 0) + 1
    elif island[0][part] in FLANK_PARTS and abs(nrm.y) > 0.85 and area > 4e-4:
        s = 1.4
        nflank += 1
    Un = (Uc @ R.T) * s + U.mean(0)
    for l, uv in zip(loops, Un):
        l[uvl].uv = uv
stats['flank_islands_boosted'] = nflank
bm.to_mesh(gun.data)
bm.free()
common.select_only([gun])
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=True, rotate_method='CARDINAL', scale=True, margin_method='FRACTION', margin=MARGIN, shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')

me = gun.data
uv = me.uv_layers.active.data
visa = me.attributes['vis'].data
parta = me.attributes['part'].data
dens = {}
a3 = au = 0.0
for p in me.polygons:
    pts = [uv[li].uv for li in p.loop_indices]
    a = sum(abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2 for i in range(1, len(pts) - 1))
    key = 'interior' if visa[p.index].value < INTERIOR else 'visible'
    d = dens.setdefault(key, [0, 0])
    d[0] += p.area
    d[1] += a
uvhash = hashlib.sha256(np.array([x for l in uv for x in l.uv[:]], np.float32).tobytes()).hexdigest()[:16]
nisl = 0
bm = bmesh.new(); bm.from_mesh(me); bm.faces.index_update()
nisl = sum(1 for _ in islands_of(bm)); bm.free()
report = dict(stats, islands=nisl, tris=sum(len(p.vertices) - 2 for p in me.polygons), verts=len(me.vertices),
              uv_used=round(sum(d[1] for d in dens.values()), 4), uv_hash=uvhash, margin=MARGIN,
              px_per_cm={k: {'1024': round(math.sqrt(d[1] / d[0]) * 1024 / 100, 1), '2048': round(math.sqrt(d[1] / d[0]) * 2048 / 100, 1)} for k, d in dens.items()})
print('UVREPORT', json.dumps(report))
(W / 'uv_report.json').write_text(json.dumps(report, indent=1))
bpy.ops.wm.save_as_mainfile(filepath=str(W / 'low_uv.blend'))
