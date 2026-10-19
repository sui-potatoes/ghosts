"""Secondary hard-surface forms for NYX. Dimensions are meters, authored in rest pose."""
import math
from mathutils import Vector


def torso_surface(g, side=1, clearance=.026):
    def sample(x, y):
        return Vector(g.front(x, y, side, clearance)), Vector((0, 0, side))
    return sample


def limb_surface(rings, clearance=.014):
    """Continuous coordinates along a fitted limb, preserving its native curvature."""
    def sample(row, column):
        row = max(0, min(len(rings) - 1.00001, row))
        k = int(row)
        t = row - k
        j = math.floor(column)
        u = column - j
        count = len(rings[0])
        a = rings[k][j % count].lerp(rings[k][(j + 1) % count], u)
        b = rings[k + 1][j % count].lerp(rings[k + 1][(j + 1) % count], u)
        p = a.lerp(b, t)
        center = (sum(rings[k], Vector()) / count).lerp(sum(rings[k + 1], Vector()) / count, t)
        n = (p - center).normalized()
        return p + n * clearance, n
    return sample


def relief(g, name, outline, surface, height, face, edge, well=None):
    """A closed stepped extrusion. Optional recessed floor leaves a real open bezel."""
    outline = [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
               for a, b in zip(outline, outline[1:] + outline[:1]) for t in [0, 1/3, 2/3]]
    count = len(outline)
    center = sum((Vector(p) for p in outline), Vector((0, 0))) / count
    # Separate bevel and shoulder create a readable highlight without a pillowy rim.
    # Sink the foot of the extrusion into the original shell. A raised face
    # without this skirt leaves a visible air gap in profile.
    rings = [(1, -.017), (1, height * .72), (.90, height)]
    if well is not None:
        rings += [(.72, height), (.72, height * .32)]
    vertices = []
    for scale, depth in rings:
        for q in outline:
            uv = center + (Vector(q) - center) * scale
            p, normal = surface(*uv)
            vertices.append(p + normal * depth)
    walls = [(r * count + j, r * count + (j + 1) % count,
              (r + 1) * count + (j + 1) % count, (r + 1) * count + j)
             for r in range(len(rings) - 1) for j in range(count)]
    g.mesh(name + ' / chamfered housing', vertices, walls, edge, smooth=False)
    # Project a dense face onto the parent shell so curved chest/thigh surfaces
    # cannot cut through the cap between a handful of corner vertices.
    top_scale = .72 if well is not None else .90
    depth = height * (.32 if well is not None else 1)
    cap = []
    for factor in [top_scale, top_scale * .66, top_scale * .33]:
        for q in outline:
            p, normal = surface(*(center + (Vector(q) - center) * factor))
            cap.append(p + normal * depth)
    point, normal = surface(*center)
    cap.append(point + normal * depth)
    faces = [(r * count + j, r * count + (j + 1) % count,
              (r + 1) * count + (j + 1) % count, (r + 1) * count + j)
             for r in range(2) for j in range(count)]
    faces += [(2 * count + j, 2 * count + (j + 1) % count, len(cap) - 1) for j in range(count)]
    g.mesh(name + (' / recessed bed' if well is not None else ' / raised face'), cap,
           faces, well or face, smooth=True)
    g.mesh(name + ' / mounting base', vertices[:count], [tuple(reversed(range(count)))], edge, smooth=False)


def rail(g, name, points, surface, width, height, material):
    """Extruded rectangular rib with a narrow crown, not a round decorative wire."""
    vertices = []
    for i, uv in enumerate(points):
        uv = Vector(uv)
        direction = Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(i - 1, 0)])
        direction.normalize()
        perpendicular = Vector((-direction.y, direction.x))
        # Width lives in surface coordinates; all normals follow the underlying shell.
        for across, depth in [(-1, -.006), (-.65, height), (.65, height), (1, -.006)]:
            p, normal = surface(*(uv + perpendicular * width * across / 2))
            vertices.append(p + normal * depth)
    faces = [(i * 4 + j, i * 4 + (j + 1) % 4, (i + 1) * 4 + (j + 1) % 4, (i + 1) * 4 + j)
             for i in range(len(points) - 1) for j in range(4)]
    faces += [(3, 2, 1, 0), tuple(range(len(vertices) - 4, len(vertices)))]
    g.mesh(name, vertices, faces, material, smooth=False)


def torso_details(g, tier, upper, lower, waist, width, ceramic, trim, dark, metal, signal):
    back = torso_surface(g, -1)
    for sign in [-1, 1]:
        # Dorsal heat exchanger: open bezel, dark floor and four separate raised louvers.
        cx = sign * .067
        cy = upper - .080
        vent = [(cx - .024, cy + .034), (cx + .020, cy + .034),
                (cx + .026, cy + .025), (cx + .026, cy - .032),
                (cx - .024, cy - .032)]
        relief(g, 'NYX / dorsal heat exchanger', vent, back, .016 + .004 * tier, ceramic, trim, dark)
        for k in range(4):
            y = cy - .018 + k * .012
            rail(g, 'NYX / exchanger louver', [(cx - .016, y), (cx + .017, y + .003)],
                 torso_surface(g, -1, .035), .005, .004, ceramic)
        # Raised oblique splines bridge the abdominal segments without a bulky waist box.
        for k in range(2 + tier):
            y = lower - .005 - k * .028
            rail(g, 'NYX / abdominal reinforcing spline',
                 [(sign * .056, y), (sign * .080, y + .008), (sign * .096, y + .020)],
                 torso_surface(g, 1, .024), .006, .004, trim)
    # Four short keyed vertebrae; small stand-off depth keeps the back close to the body.
    for k in range(4):
        y = waist + .022 + k * .060
        outline = [(-.015, y + .022), (.015, y + .022), (.021, y),
                   (.012, y - .020), (-.012, y - .020), (-.021, y)]
        relief(g, 'NYX / dorsal spine key', outline, back, .014 + .004 * tier, ceramic, trim)


def limb_details(g, tier, side, cap, arm, thigh, knee, shin, ceramic, trim, dark, metal, signal):
    shoulder = limb_surface(cap, .018 + tier * .003)
    relief(g, 'NYX / shoulder crown',
           [(.25, 15), (.50, 20), (1.40, 21), (3.40, 20), (3.55, 16), (2.20, 14.5)],
           shoulder, .010 + tier * .003, ceramic, trim)
    if tier == 0:
        relief(g,'VEIL / angular shoulder inlay',
               [(.35,16),(.50,19.5),(1.3,20.3),(3.1,19.2),(3.7,17.7),(1.8,15.8)],
               limb_surface(cap,.026),.005,ceramic,trim)
        for row in [1.1,1.7,2.3]:
            rail(g,'VEIL / shoulder cut channel',[(row,17),(row+.35,18.7)],
                 limb_surface(cap,.032),.055,.001,dark)
    # A smaller rear louvered cap adds profile depth without projecting into the neck.
    rear = limb_surface(cap, .018 + tier * .003)
    relief(g, 'NYX / shoulder rear intake',
           [(.7, 5), (.7, 9), (2.8, 9.5), (3.2, 8), (2.7, 5)],
           rear, .009, ceramic, trim, dark)
    for k in [1.2, 1.8, 2.4]:
        rail(g, 'NYX / shoulder intake blade', [(k, 5.8), (k, 8.4)],
             limb_surface(cap, .023 + tier * .003), .12, .005, ceramic)
    forearm = limb_surface(arm, .020)
    relief(g, 'NYX / gauntlet dorsal module',
           [(.45, 16), (.65, 20), (2.9, 20.5), (3.7, 19.3), (3.4, 16), (1.6, 15.5)],
           forearm, .012 + tier * .004, ceramic, trim, dark if side == 'Left' else None)
    if side == 'Left':
        for k in [1.2, 1.7, 2.2]:
            rail(g, 'NYX / gauntlet inset indicator', [(k, 17.1), (k, 18.9)],
                 limb_surface(arm, .028), .10, .0025, signal)
    else:
        for col in [16.9, 18.9]:
            rail(g, 'NYX / gauntlet external rib', [(1, col), (2.2, col), (3.1, col - .3)],
                 limb_surface(arm, .035), .22, .006, ceramic)
    relief(g, 'NYX / thigh segmented strike face',
           [(.5, 16), (.3, 19), (1.3, 21), (3.4, 20), (3.8, 17), (2.8, 15.8)],
           limb_surface(thigh, .024 + tier * .003), .008 + tier * .004, ceramic, trim)
    # Actual cut-corner knee boss with an outer bezel, rather than a flat patch.
    relief(g, 'NYX / raised knee impact boss',
           [(.65, 16), (.65, 20), (1.6, 21), (3.1, 20), (3.6, 18), (3.1, 16), (1.6, 15)],
           limb_surface(knee, .021), .018 + tier * .004, ceramic, trim)
    # The long shin ridge tapers to the boot and reads clearly in side silhouette.
    relief(g, 'NYX / greave central keel',
           [(.15, 17.3), (.15, 18.7), (1.2, 19.6), (3.5, 18.7), (3.8, 18), (3.5, 17.3), (1.2, 16.4)],
           limb_surface(shin, .020 + tier * .002), .014 + tier * .004, ceramic, trim)
    for col in [15.1, 20.9]:
        rail(g, 'NYX / greave reinforcement rail', [(1, col), (2.1, col), (3.3, col + (.3 if col < 18 else -.3))],
             limb_surface(shin, .019 + tier * .002), .26, .006, ceramic)


def heavy_torso(g, upper, lower, waist, width, ceramic, trim, dark, metal, signal):
    """Wraith-only breach cuirass and twin dorsal power housings."""
    for sign in [-1, 1]:
        # Separate angular housings run down the back; an open central spine remains visible.
        cx = sign*.073
        cy = (upper + waist)/2
        outline = [(cx-sign*.033,cy+.100), (cx+sign*.019,cy+.094),
                   (cx+sign*.034,cy+.070), (cx+sign*.026,cy-.078),
                   (cx-sign*.020,cy-.098), (cx-sign*.034,cy-.069)]
        relief(g, 'WRAITH / dorsal power housing', outline,
               torso_surface(g,-1,.043), .032, ceramic, trim, dark)
        for k in range(6):
            y=cy-.058+k*.023
            rail(g, 'WRAITH / armored heat sink', [(cx-.019,y),(cx+.018,y+.005)],
                 torso_surface(g,-1,.066), .009, .012, ceramic)
        rail(g, 'WRAITH / power status strip', [(cx,cy-.082),(cx,cy-.068)],
             torso_surface(g,-1,.075), .004, .001, signal)


def heavy_limbs(g, side, cap, arm, thigh, shin, ceramic, trim, dark, metal, signal):
    # Outer shoulder arches wrap from front to rear. Wide stepped surfaces,
    # rather than spikes, give Wraith its heavier shoulder line.
    for column in [1.6, 11.6]:
        relief(g,'WRAITH / shoulder reinforced arch',
               [(.12,column),(.4,column+2.2),(2.5,column+2.3),
                (3.8,column+1.2),(3.4,column-.2),(1.2,column-.6)],
               limb_surface(cap,.027), .026, ceramic, trim)
        rail(g,'WRAITH / shoulder inset identifier',
             [(1.0,column+.6),(2.3,column+.6)],
             limb_surface(cap,.055), .12, .002, signal)
    # Armored lateral cuffs and outer thigh scutes add side protection.
    relief(g,'WRAITH / gauntlet lateral shield',
           [(.3,10),(.3,13),(2.9,13.5),(3.8,12),(3.0,10)],
           limb_surface(arm,.019), .023, ceramic, trim)
    # Columns 12 and 0 point outward on left and right respectively.
    # Reflect around the front axis, preserving the longitudinal coordinate.
    thigh_outer = limb_surface(thigh,.019)
    if side == 'Right':
        left_surface = thigh_outer
        thigh_outer = lambda row, col: left_surface(row, 12-col)
    relief(g,'WRAITH / lateral thigh hardpoint',
           [(.15,10),(.15,13.7),(1.0,14.4),(3.1,13.5),(3.7,11.0),(2.8,9.8)],
           thigh_outer, .017, ceramic, trim)
    thigh_rib = limb_surface(thigh,.037)
    if side == 'Right':
        left_rib = thigh_rib
        thigh_rib = lambda row, col: left_rib(row,12-col)
    for row in [1,2]:
        rail(g,'WRAITH / thigh locking rib',[(row,10.8),(row,13)],
             thigh_rib,.17,.004,metal)
    relief(g,'WRAITH / calf actuator housing',
           [(.35,4.5),(.35,7.5),(1.1,8.2),(3.1,7),(3.6,6),(3.1,5),(1.1,3.8)],
           limb_surface(shin,.021), .022, ceramic, trim)
