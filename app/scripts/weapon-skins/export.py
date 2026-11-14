"""Stage 4: the game mesh as a GLB: one mesh per piece (body, clip, stock) sharing
one material and the atlas, with normals and tangents, in the Armory weapon
frame. Indicator faces (slot 07, they glow) leave the atlas mesh as
`<piece>-glow` meshes, drawn in the gun's own indicator material. Maps are
attached later (assets.mjs).
Blender --background <work>/low_uv.blend --python export.py -- <work>"""
import bpy, bmesh, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import common

W = common.work_dir()
out = W / 'geometry.glb'
GLOW = 6
gun = [o for o in bpy.data.objects if o.type == 'MESH'][0]
common.select_only([gun])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.get('Skin')
nt = mat.node_tree
# a normal-map node so the exporter writes tangents for this material
tex = nt.nodes.new('ShaderNodeTexImage')
img = bpy.data.images.new('n', 4, 4, alpha=False)
img.colorspace_settings.name = 'Non-Color'
tex.image = img
nm = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], nt.nodes['Principled BSDF'].inputs['Normal'])
glow = bpy.data.materials.new('glow')
pieces = []
for k, name in enumerate(common.PIECES):
    for suffix, keep in (('', lambda f, s: s != GLOW), ('-glow', lambda f, s: s == GLOW)):
        o = gun.copy(); o.data = gun.data.copy(); o.name = o.data.name = name + suffix
        bpy.context.scene.collection.objects.link(o)
        bm = bmesh.new(); bm.from_mesh(o.data)
        piece = bm.faces.layers.int.get('piece')
        slot = bm.faces.layers.int.get('slot')
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[piece] != k or not keep(f, f[slot])], context='FACES')
        bm.to_mesh(o.data); bm.free()
        if not o.data.polygons:
            bpy.data.objects.remove(o)
            continue
        for a in ('part', 'vis', 'slot', 'piece'):
            if a in o.data.attributes:
                o.data.attributes.remove(o.data.attributes[a])
        o.data.materials.clear(); o.data.materials.append(glow if suffix else mat)
        pieces.append(o)
bpy.data.objects.remove(gun)
common.select_only(pieces)
bpy.ops.export_scene.gltf(filepath=str(out), use_selection=True, export_format='GLB', export_texcoords=True,
                          export_normals=True, export_tangents=True, export_materials='EXPORT',
                          export_extras=False, export_yup=True, export_image_format='AUTO')
for o in pieces:
    print('PIECE', o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
print('EXPORTED', out, out.stat().st_size)
