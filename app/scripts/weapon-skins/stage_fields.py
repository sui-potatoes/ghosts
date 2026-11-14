"""Stage 2: bake the per-texel fields every skin is evaluated from, onto the
game mesh's atlas, projected from the authored (high) model:
  tnormal  tangent-space normal (parts exploded apart, so no part catches another's rays)
  pos      position (Blender frame, stored * 0.5 + 0.5)
  nrm      object normal
  id       slot / 16, part / 16
  curv     pointiness of the high model (0.5 = flat)
  ao       ambient occlusion (3 cm)
  mask     texels the atlas covers
Blender --background <work>/low_uv.blend --python stage_fields.py -- <work> [RES]
Writes <work>/fields/*.npy."""
import bpy, sys, math, json, time, pathlib, addon_utils
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import common
addon_utils.enable('cycles', default_set=True)
W = common.work_dir()
argv = common.args()
RES = int(argv[1]) if len(argv) > 1 else 1024
OUT = W / 'fields'
OUT.mkdir(exist_ok=True)
# Cage offset per part (m); thin parts get less so rays do not reach a neighbour.
CAGE = {'grip': 0.002, 'barrel': 0.0022, 'magazine': 0.0022, 'lower': 0.0032, 'sight': 0.003,
        'stock': 0.0028, 'cable': 0.0015}
EXPLODE = Vector((1.2, 0, 0))
log = {'res': RES}
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
gun = [o for o in scene.objects if o.type == 'MESH'][0]

# --- the authored model, smoothed like the runtime finish
t0 = time.time()
hcol = bpy.data.collections.new('high')
scene.collection.children.link(hcol)
data, highs = common.load(W / 'source-high.json', hcol)
parts = data['parts']
for o in highs:
    for p in o.data.polygons:
        p.use_smooth = True
    common.select_only([o])
    m = o.modifiers.new('es', 'EDGE_SPLIT'); m.split_angle = math.radians(36)
    bpy.ops.object.modifier_apply(modifier=m.name)
    m = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.keep_sharp = True; m.weight = 30
    bpy.ops.object.modifier_apply(modifier=m.name)

# Field material on the highs: an emission whose colour is the chosen field.
field = bpy.data.materials.new('field')
field.use_nodes = True
nt = field.node_tree
nt.nodes.clear()
outn = nt.nodes.new('ShaderNodeOutputMaterial')
em = nt.nodes.new('ShaderNodeEmission')
nt.links.new(em.outputs[0], outn.inputs[0])
geo = nt.nodes.new('ShaderNodeNewGeometry')
mix_pos = nt.nodes.new('ShaderNodeVectorMath'); mix_pos.operation = 'MULTIPLY_ADD'
mix_pos.inputs[1].default_value = (0.5, 0.5, 0.5); mix_pos.inputs[2].default_value = (0.5, 0.5, 0.5)
nt.links.new(geo.outputs['Position'], mix_pos.inputs[0])
mix_n = nt.nodes.new('ShaderNodeVectorMath'); mix_n.operation = 'MULTIPLY_ADD'
mix_n.inputs[1].default_value = (0.5, 0.5, 0.5); mix_n.inputs[2].default_value = (0.5, 0.5, 0.5)
nt.links.new(geo.outputs['Normal'], mix_n.inputs[0])
sa = nt.nodes.new('ShaderNodeAttribute'); sa.attribute_name = 'slot'
pa = nt.nodes.new('ShaderNodeAttribute'); pa.attribute_name = 'part'
comb = nt.nodes.new('ShaderNodeCombineXYZ')
d1 = nt.nodes.new('ShaderNodeMath'); d1.operation = 'DIVIDE'; d1.inputs[1].default_value = 16
d2 = nt.nodes.new('ShaderNodeMath'); d2.operation = 'DIVIDE'; d2.inputs[1].default_value = 16
nt.links.new(sa.outputs['Fac'], d1.inputs[0]); nt.links.new(pa.outputs['Fac'], d2.inputs[0])
nt.links.new(d1.outputs[0], comb.inputs[0]); nt.links.new(d2.outputs[0], comb.inputs[1])
pt = nt.nodes.new('ShaderNodeCombineXYZ')
nt.links.new(geo.outputs['Pointiness'], pt.inputs[0])
FIELDS = {'pos': mix_pos.outputs[0], 'nrm': mix_n.outputs[0], 'id': comb.outputs[0], 'curv': pt.outputs[0]}
for o in highs:
    o.data.materials.clear()
    o.data.materials.append(field)


def set_field(k):
    nt.links.new(FIELDS[k], em.inputs['Color'])


def new_image(name, fill):
    im = bpy.data.images.new(name, RES, RES, alpha=False, float_buffer=True)
    im.colorspace_settings.name = 'Non-Color'
    px = np.empty((RES, RES, 4), np.float32); px[:] = fill
    im.pixels.foreach_set(px.ravel())
    return im


def px(im):
    a = np.empty(RES * RES * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(RES, RES, 4)


def target_material(obj):
    tmp = bpy.data.materials.new('target')
    tmp.use_nodes = True
    tex = tmp.node_tree.nodes.new('ShaderNodeTexImage')
    e = tmp.node_tree.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (1, 1, 1, 1)
    tmp.node_tree.links.new(e.outputs[0], tmp.node_tree.nodes['Material Output'].inputs[0])
    tmp.node_tree.nodes.active = tex
    obj.data.materials.clear(); obj.data.materials.append(tmp)
    for p in obj.data.polygons:
        p.material_index = 0
    return tmp, tex


timing = {}
# bake copy split at hard edges (the cage follows shading normals)
bake = gun.copy(); bake.data = gun.data.copy(); bake.parent = None
bake.matrix_world = gun.matrix_world.copy(); scene.collection.objects.link(bake)
gun.hide_render = True
common.select_only([bake])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
m = bake.modifiers.new('split', 'EDGE_SPLIT'); m.use_edge_angle = False; m.use_edge_sharp = True
bpy.ops.object.modifier_apply(modifier=m.name)
tmp, tex = target_material(bake)
me = bake.data
fpart = np.zeros(len(me.polygons), np.int32); me.attributes['part'].data.foreach_get('value', fpart)
fvis = np.zeros(len(me.polygons)); me.attributes['vis'].data.foreach_get('value', fvis)
vpart = np.zeros(len(me.vertices), np.int32); vvis = np.ones(len(me.vertices))
for p in me.polygons:
    for v in p.vertices:
        vpart[v] = fpart[p.index]; vvis[v] = min(vvis[v], fvis[p.index])
co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
nv = np.zeros_like(co); me.vertices.foreach_get('normal', nv.ravel())
polys = [list(p.vertices) for p in me.polygons]


def cage_positions(exploded):
    off = np.array([EXPLODE * int(k) for k in vpart]) if exploded else np.zeros_like(co)
    pos = co + off
    tree = BVHTree.FromPolygons([Vector(v) for v in pos], polys)
    out = pos.copy()
    for i in range(len(pos)):
        d = CAGE.get(parts[vpart[i]], 0.0025)
        n = Vector(nv[i])
        hit = tree.ray_cast(Vector(pos[i]) + n * 1e-5, n, d * 2)
        if hit[0] is not None and vvis[i] < 0.35:
            d = max(min(d, hit[3] * 0.5), 0.0003)
        out[i] = pos[i] + nv[i] * d
    return pos, out


def make_cage(name, pos):
    c = bake.copy(); c.data = bake.data.copy(); c.name = name
    scene.collection.objects.link(c)
    c.data.vertices.foreach_set('co', pos.ravel()); c.data.update()
    c.hide_render = True
    return c


def s2a(kind, image, cage, **extra):
    tex.image = image; tmp.node_tree.nodes.active = tex
    common.select_only(highs + [bake], bake)
    t = time.time()
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, use_cage=True, cage_object=cage.name,
                        cage_extrusion=0.0, max_ray_distance=0.012, margin=0, use_clear=False,
                        target='IMAGE_TEXTURES', **extra)
    return round(time.time() - t, 1)


# mask
im = new_image('mask', (0, 0, 0, 1)); tex.image = im
common.select_only([bake]); scene.cycles.samples = 1
bpy.ops.object.bake(type='EMIT', margin=0, use_clear=False, target='IMAGE_TEXTURES')
mask = px(im)[:, :, 0] > 0.5
np.save(OUT / 'mask.npy', mask)
# tangent normal, exploded
pos, cpos = cage_positions(True)
bake.data.vertices.foreach_set('co', pos.ravel()); bake.data.update()
for o in highs:
    o.location = o.location + EXPLODE * int(o['part'])
cage = make_cage('CAGE_x', cpos)
scene.cycles.samples = 16
im = new_image('normal', (1, 0, 1, 1))
timing['t_normal'] = s2a('NORMAL', im, cage, normal_space='TANGENT', normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
n = px(im)
np.save(OUT / 'tnormal.npy', n[:, :, :3])
np.save(OUT / 'miss.npy', mask & (n[:, :, 0] > 0.99) & (n[:, :, 1] < 0.01) & (n[:, :, 2] > 0.99))
# everything else in place
bake.data.vertices.foreach_set('co', co.ravel()); bake.data.update()
for o in highs:
    o.location = o.location - EXPLODE * int(o['part'])
bpy.data.objects.remove(cage)
_, cpos2 = cage_positions(False)
cage = make_cage('CAGE_i', cpos2)
for k in ('pos', 'nrm', 'id', 'curv'):
    set_field(k)
    scene.cycles.samples = 1 if k == 'id' else 4
    im = new_image(k, (0, 0, 0, 1))
    timing['t_' + k] = s2a('EMIT', im, cage)
    np.save(OUT / ('%s.npy' % k), px(im)[:, :, :3])
for attr in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
    setattr(bake, attr, False)
scene.world = scene.world or bpy.data.worlds.new('w')
scene.world.light_settings.distance = 0.03
scene.cycles.samples = 128
im = new_image('ao', (1, 0, 1, 1))
timing['t_ao'] = s2a('AO', im, cage)
np.save(OUT / 'ao.npy', px(im)[:, :, 0])
log.update(timing)
log['t_total'] = round(time.time() - t0, 1)
print('FIELDS', json.dumps(log))
(OUT / 'fields.json').write_text(json.dumps(log, indent=1))
