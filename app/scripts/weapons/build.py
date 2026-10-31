"""Build the game GLBs and editable .blend library with packed, non-overlapping UV0.
Run: Blender --background --python app/scripts/weapons/build.py
Source: pnpm --dir app exec node --experimental-strip-types scripts/weapons/source.ts
"""
import bpy, json, math, pathlib
from mathutils import Vector, Matrix
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'output/weapons-source'
DEST = ROOT / 'app/public/squad/weapons'
DEST.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
report = []

def surface_maps(mat, slot, roughness):
    if slot.startswith(('06_', '07_', '08_')):
        return
    n = 256
    rng = np.random.default_rng(42)
    grain = rng.normal(0, 1, (n, n))
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    pixels = np.ones((n, n, 4), dtype=np.float32)
    variation = 0.026 if slot.startswith('04_') else 0.013
    values = np.clip(roughness + grain * variation, 0, 1)
    pixels[:, :, :3] = values[:, :, None]
    image = bpy.data.images.new(mat.name + '_roughness', width=n, height=n)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    links.new(tex.outputs['Color'], shader.inputs['Roughness'])
    normal = bpy.data.images.new(mat.name + '_normal', width=n, height=n)
    normal.colorspace_settings.name = 'Non-Color'
    pixels[:, :, 0] = 0.5 + rng.normal(0, 0.035, (n,n))
    pixels[:, :, 1] = 0.5 + rng.normal(0, 0.035, (n,n))
    pixels[:, :, 2] = 1
    normal.pixels.foreach_set(pixels.ravel())
    normal.pack()
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = normal
    bump = nodes.new('ShaderNodeNormalMap')
    bump.inputs['Strength'].default_value = 0.22 if slot.startswith('04_') else 0.12
    links.new(tex.outputs['Color'], bump.inputs['Color'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])

def add_markings(asset_id, collection, parent, material):
    # Source labels are actual small meshes: sharp at close range and easy to replace with decals later.
    labels = {
        'rifle': [('SABLE / 04', -0.015, 0.045, 0.028, 0.0045), ('GHOST SYSTEMS', -0.165, 0.028, 0.028, 0.003),
                  ('CAL. 6.8   /   004-271', -0.16, 0.019, 0.028, 0.0024), ('M-LOK / 05', 0.09, 0.068, 0.027, 0.0027)],
        'sniper': [('VANTAGE / 09', -0.155, 0.027, 0.026, 0.004), ('PRECISION SYSTEMS', -0.159, 0.01, 0.028, 0.0027),
                   ('7.62 / MATCH', 0.105, 0.016, 0.029, 0.003)],
        'plasma': [('ION / P-06', -0.149, 0.06, 0.037, 0.004), ('HIGH VOLTAGE', 0.105, 0.074, 0.05, 0.003),
                   ('CAUTION / HOT', 0.24, 0.027, 0.05, 0.0025)],
    }.get(asset_id, [])
    label_objects = []
    for text, x, y, z, size in labels:
        for side in [1, -1]:
            curve = bpy.data.curves.new('Stencil', type='FONT')
            curve.body = text
            curve.size = size * .9
            curve.space_character = 1.1
            curve.extrude = 0.000015
            curve.resolution_u = 2
            curve.align_x = 'LEFT' if side > 0 else 'RIGHT'
            obj = bpy.data.objects.new(text, curve)
            collection.objects.link(obj)
            # Authoring +X forward,+Y up to donor frame, then Blender Z-up.
            obj.location = (-side * z * .9, -.045 + (y + .045) * .9, -.114 + (x + .114) * .9)
            obj.rotation_euler = Matrix(((0,0,-side),(0,1,0),(side,0,0))).to_euler()
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.convert(target='MESH')
            obj.data.materials.append(material)
            label_objects.append(obj)
    if not label_objects:
        return
    bpy.ops.object.select_all(action='DESELECT')
    for obj in label_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = label_objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = asset_id + '_Stencils'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.parent = parent
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')


def coord(p):
    return Vector((p[0], -p[2], p[1]))

for asset_id in json.loads((SOURCE / 'manifest.json').read_text()):
    data = json.loads((SOURCE / (asset_id + '.json')).read_text())
    collection = bpy.data.collections.new(asset_id)
    bpy.context.scene.collection.children.link(collection)
    objects = {}
    materials = {}
    triangles = 0
    for node in data['nodes']:
        if node['material']:
            mat_data = node['material']
            key = mat_data['name']
            if key not in materials:
                mat = bpy.data.materials.new(asset_id + '/' + key)
                mat.use_nodes = True
                bsdf = mat.node_tree.nodes.get('Principled BSDF')
                bsdf.inputs['Base Color'].default_value = (*mat_data['color'], 1)
                bsdf.inputs['Metallic'].default_value = mat_data['metallic']
                bsdf.inputs['Roughness'].default_value = mat_data['roughness']
                bsdf.inputs['Emission Color'].default_value = (*mat_data['emission'], 1)
                bsdf.inputs['Emission Strength'].default_value = mat_data['strength']
                surface_maps(mat, key, mat_data['roughness'])
                mat['texture_slot'] = key
                mat['texture_resolution'] = 2048
                materials[key] = mat
            mesh = bpy.data.meshes.new(node['name'])
            origin = coord(node['position'])
            mesh.from_pydata([coord(v) - origin for v in node['vertices']], [], node['faces'])
            mesh.update()
            obj = bpy.data.objects.new(node['name'], mesh)
            collection.objects.link(obj)
            obj.location = origin
            obj.data.materials.append(materials[key])
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.remove_doubles(threshold=0.000001)
            bpy.ops.mesh.normals_make_consistent(inside=False)
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=0.1, correct_aspect=True, scale_to_bounds=True)
            bpy.ops.object.mode_set(mode='OBJECT')
            # Smooth only continuous curves. Mark sharp edges so receiver planes stay flat.
            for p in mesh.polygons:
                p.use_smooth = True
            bpy.ops.object.modifier_add(type='EDGE_SPLIT')
            modifier = obj.modifiers[-1]
            modifier.split_angle = math.radians(36)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            # Weighted normals keep the bevels polished without swelling large planar surfaces.
            bpy.ops.object.modifier_add(type='WEIGHTED_NORMAL')
            modifier = obj.modifiers[-1]
            modifier.keep_sharp = True
            modifier.weight = 30
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            triangles += sum(len(p.vertices)-2 for p in obj.data.polygons)
        else:
            obj = bpy.data.objects.new(node['name'], None)
            collection.objects.link(obj)
            obj.location = coord(node['position'])
            obj.empty_display_size = 0.015
        for k, v in node.get('extras', {}).items():
            if isinstance(v, (str, int, float, bool, list)):
                obj[k] = v
        obj['asset_id'] = asset_id
        objects[node['id']] = obj
    # Preserve shared mount nodes and replaceable standard furniture as explicit parents.
    for node in data['nodes']:
        if node.get('parent') in objects:
            obj = objects[node['id']]
            obj.parent = objects[node['parent']]
            parent_node = next(n for n in data['nodes'] if n['id'] == node['parent'])
            obj.location = coord(node['position']) - coord(parent_node['position'])
    bpy.context.view_layer.update()
    root = objects[data['nodes'][0]['id']]
    marking = materials.get('08_Markings')
    if not marking:
        marking = bpy.data.materials.new(asset_id + '/08_Markings')
        marking.diffuse_color = (0.6, 0.67, 0.65, 1)
        materials['08_Markings'] = marking
    add_markings(asset_id, collection, root, marking)
    # Pack all meshes that use a material together: no overlaps even between furniture and receiver.
    for material in materials.values():
        bpy.ops.object.select_all(action='DESELECT')
        selected = [o for o in collection.objects if o.type == 'MESH' and o.data.materials[0] == material]
        for obj in selected:
            obj.select_set(True)
        if not selected:
            continue
        bpy.context.view_layer.objects.active = selected[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, margin=0.008)
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[data['nodes'][0]['id']]
    bpy.ops.export_scene.gltf(filepath=str(DEST / (asset_id + '.glb')), use_selection=True,
        export_format='GLB', export_texcoords=True, export_normals=True, export_tangents=True,
        export_materials='EXPORT', export_extras=True, export_yup=True)
    triangles = sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in collection.objects if o.type == 'MESH')
    report.append({'id': asset_id, 'triangles': triangles, 'materials': len(materials),
        'bytes': (DEST / (asset_id + '.glb')).stat().st_size})
    # Display source assets in a spaced library when opened in Blender.
    root = objects[data['nodes'][0]['id']]
    root.location.x += (len(report) - 1) % 3 * 1.3
    root.location.y += (len(report) - 1) // 3 * 0.6
library = ROOT / 'art/weapons'
library.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(library / 'weapons.blend'))
(DEST / 'manifest.json').write_text(json.dumps({'version': 2, 'uv': 'UV0 per material, packed 0–1, 0.8% island gutter', 'assets': report}, indent=2))
print(json.dumps(report, indent=2))
