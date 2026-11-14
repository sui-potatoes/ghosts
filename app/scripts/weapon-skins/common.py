"""Shared Blender helpers for the weapon-skin bake (imported by the stage scripts).

Frames. The sources (source.ts) are in the Armory weapon frame: +X muzzle,
+Y up, +Z the shooter's right, metres. Blender works Z-up, so a point goes in
as (x, -z, y); the glTF exporter's +Y-up conversion turns that straight back
into the weapon frame. Recipes (skins.py) see weapon-frame positions again.

Every stage takes the gun's work directory as its first argument after `--`.
"""
import bpy, bmesh, json, pathlib, sys
from mathutils import Vector
import numpy as np

UP = Vector((0, 0, 1))
PIECES = ('body', 'clip', 'stock')


def args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def work_dir():
    return pathlib.Path(args()[0])


def to_blender(points):
    """(n, 3) weapon frame -> Blender."""
    p = np.asarray(points, np.float64).reshape(-1, 3)
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], 1)


def to_weapon(points):
    """(n, 3) Blender -> weapon frame."""
    p = np.asarray(points, np.float64).reshape(-1, 3)
    return np.stack([p[:, 0], p[:, 2], -p[:, 1]], 1)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def weld(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    bm.to_mesh(obj.data)
    bm.free()


def load(path, collection):
    """One object per (piece, material slot, builder part), with face
    attributes `piece`, `slot` and `part`. Returns (data, objects)."""
    data = json.loads(pathlib.Path(path).read_text())
    objs = []
    for node in data['nodes']:
        verts = to_blender(node['vertices'])
        parts = np.array(node['parts'])
        piece = PIECES.index(node['piece'])
        for p in sorted(set(parts.tolist())):
            tri = np.nonzero(parts == p)[0]
            idx = (tri[:, None] * 3 + np.arange(3)).ravel()
            name = '%s.%s.%s' % (node['piece'], data['slots'][node['slot']], data['parts'][p])
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata([Vector(v) for v in verts[idx]], [], [[3 * i, 3 * i + 1, 3 * i + 2] for i in range(len(tri))])
            mesh.update()
            obj = bpy.data.objects.new(name, mesh)
            collection.objects.link(obj)
            for attr, value in (('piece', piece), ('slot', node['slot']), ('part', p)):
                a = mesh.attributes.new(attr, 'INT', 'FACE')
                a.data.foreach_set('value', [value] * len(tri))
                obj[attr] = value
            weld(obj)
            objs.append(obj)
    return data, objs


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]
