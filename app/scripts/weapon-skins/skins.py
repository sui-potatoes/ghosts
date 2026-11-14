"""Stage 3: the maps. From the baked fields: the shared tangent normal map and AO,
then every skin recipe (recipes.json, from packages/squad/src/skin-recipes.ts)
evaluated per texel in the weapon frame, plus the body-only extras: AO grime,
the receiver stencil and liveries, placed per gun by finding flat flanks.

The pattern code (hash, value noise, fbm, blotch, digital, splinter, split,
mottle, edge wear) is mirrored by packages/squad/src/studio/skin-paint.ts,
which paints fittings live: change both together.

Blender --background --factory-startup --python skins.py -- <work> [skin ...]
Writes <work>/textures/{normal,ao,<skin>_base,<skin>_rm}.png"""
import bpy, sys, json, pathlib, time
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import common

W = common.work_dir()
ONLY = common.args()[1:]
F = W / 'fields'
TEX = W / 'textures'
TEX.mkdir(exist_ok=True)
GUN = json.loads((W / 'gun.json').read_text())
RECIPES = json.loads((W / 'recipes.json').read_text())
PARTS = GUN['parts']
SHELL, FRAME, STEEL, RUBBER, COPPER, GLASS, GLOW, MARK = range(8)
# Parts that stay as built under every skin.
FIXED_PARTS = [PARTS.index(p) for p in ('cable',) if p in PARTS]

mask = np.load(F / 'mask.npy')
posr = np.load(F / 'pos.npy')
valid = mask & (posr.sum(-1) > 0.01)
R = mask.shape[0]
idx = np.nonzero(valid)
P = common.to_weapon((posr[idx] - 0.5) * 2)
N = common.to_weapon(np.load(F / 'nrm.npy')[idx] * 2 - 1)
N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
ids = np.load(F / 'id.npy')[idx]
slot = np.round(ids[:, 0] * 16).astype(int)
part = np.round(ids[:, 1] * 16).astype(int)
curv = np.load(F / 'curv.npy')[idx][:, 0]
ao_full = np.minimum(np.load(F / 'ao.npy'), 1.0)
ao = ao_full[idx]
ao = np.where(ao > 0.99, 1.0, ao)
n = len(P)


def srgb(h):
    return np.array([(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255])


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- noise (mirrored in GLSL)
def hash3(ix, iy, iz, seed):
    u = lambda a: (np.asarray(a, np.int64) + 1024).astype(np.uint32)
    with np.errstate(over='ignore'):
        h = (u(ix) * np.uint32(0x8da6b343)) ^ (u(iy) * np.uint32(0xd8163841)) ^ \
            (u(iz) * np.uint32(0xcb1ab31f)) ^ np.uint32((seed * 0x9e3779b9) & 0xffffffff)
        h ^= h >> np.uint32(13)
        h *= np.uint32(0x5bd1e995)
        h ^= h >> np.uint32(15)
    return (h & np.uint32(0xffff)).astype(np.float64) / 65535.0


def vnoise(p, scale, seed):
    q = p / scale
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, scale, octaves, seed):
    s, a, tot = 0, 1.0, 0
    for o in range(octaves):
        s = s + a * vnoise(p, scale / 2 ** o, seed + o)
        tot += a
        a *= 0.5
    return s / tot


THRESHOLDS = {2: [0.6], 3: [0.5, 0.8], 4: [0.4, 0.65, 0.85]}


def blotch(p, scale, count):
    v = fbm(p + np.array([0.31, 0.17, 0.05]), scale, 4, 5)
    w = fbm(p + np.array([0.11, 0.73, 0.4]), scale * 0.67, 4, 9)
    k = np.where(v > 0.53, 1, 0)
    if count > 2:
        k = np.where(w > 0.55, 2, k)
    if count > 3:
        k = np.where((v < 0.45) & (w < 0.5), 3, k)
    return k


def pattern(pt, p):
    kind, tones = pt['kind'], pt['tones']
    if kind == 'blotch':
        return blotch(p, pt['scale'], len(tones))
    if kind == 'digital':
        c = pt['cell']
        return blotch((np.floor(p / c) + 0.5) * c, pt['scale'], len(tones))
    if kind == 'splinter':
        s = pt['scale']
        a = np.floor(p @ np.array([0.83, 0.42, 0.37]) / s)
        b = np.floor(p @ np.array([-0.31, 0.88, -0.36]) / s)
        c = np.floor(p @ np.array([0.22, -0.35, 0.91]) / (s * 0.7))
        h = hash3(a, b, c, 17)
        k = np.zeros(len(p), int)
        for t in THRESHOLDS[len(tones)]:
            k += h > t
        return k
    if kind == 'split':
        return (p @ np.array(pt['normal']) > pt['offset']).astype(int)
    raise ValueError(kind)


# ---------------------------------------------------------------- decals
def load_decal(name):
    im = bpy.data.images.load(str(W / 'decals' / name))
    w, h = im.size
    return np.array(im.pixels[:], np.float32).reshape(h, w, 4)  # bottom-up rows, straight alpha


def decal(img, centre, side, size, max_depth=0.006, facing=0.35):
    """Projects img onto the flank facing `side` (+1 right, -1 left), centred at
    `centre`, reading muzzle-ward on the right and butt-ward on the left: the
    way a stencil reads from either side, never mirrored."""
    axis = np.array([0, 0, -side], float)       # into the surface
    right = np.array([side, 0, 0], float)
    up = np.cross(right, axis)                   # +Y on both sides
    d = P - np.array(centre)
    s = d @ right / size[0] + 0.5
    t = d @ up / size[1] + 0.5
    ok = (s >= 0) & (s < 1) & (t >= 0) & (t < 1) & (np.abs(d @ axis) < max_depth) & (-(N @ axis) > facing)
    h, w = img.shape[:2]
    x = np.clip(s * (w - 1), 0, w - 1.001); y = np.clip(t * (h - 1), 0, h - 1.001)
    x0 = x.astype(int); y0 = y.astype(int); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    smp = (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) +
           img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)
    return smp[:, :3], np.where(ok, smp[:, 3], 0.0)


def find_flat(parts, side, size, prefer_x, facing=0.95, cover=0.97):
    """Centre of a size[0] x size[1] window on the flank facing `side`, over
    `parts`, that is covered by flat texels, nearest prefer_x; None if none."""
    among = np.isin(part, [PARTS.index(p) for p in parts if p in PARTS]) if parts else ~np.isin(part, FIXED_PARTS)
    sel = among & (N[:, 2] * side > facing) & (P[:, 2] * side > 0)
    if sel.sum() < 50:
        return None
    q = P[sel]
    cell = 0.001
    x0, y0 = q[:, 0].min(), q[:, 1].min()
    gx = ((q[:, 0] - x0) / cell).astype(int); gy = ((q[:, 1] - y0) / cell).astype(int)
    occ = np.zeros((gx.max() + 2, gy.max() + 2))
    occ[gx, gy] = 1
    wx, wy = max(1, int(round(size[0] / cell))), max(1, int(round(size[1] / cell)))
    if wx >= occ.shape[0] or wy >= occ.shape[1]:
        return None
    c = np.pad(occ.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    win = c[wx:, wy:] - c[:-wx, wy:] - c[wx:, :-wy] + c[:-wx, :-wy]
    ok = np.argwhere(win >= cover * wx * wy)
    if not len(ok):
        return None
    cx = x0 + (ok[:, 0] + wx / 2) * cell
    cy = y0 + (ok[:, 1] + wy / 2) * cell
    k = np.argmin(np.abs(cx - prefer_x) + 0.2 * np.abs(cy - np.median(cy)))
    near = sel & (np.abs(P[:, 0] - cx[k]) < size[0] / 2) & (np.abs(P[:, 1] - cy[k]) < size[1] / 2)
    return (cx[k], cy[k], float(np.median(P[near, 2])))


def well_x():
    m = part == PARTS.index('magazine')
    return float(np.median(P[m, 0])) if m.any() else 0.0


def blend(col, rough, metal, rgb, a, r=None, m=None):
    col[:] = col * (1 - a[:, None]) + rgb * a[:, None]
    if r is not None:
        rough[:] = rough * (1 - a) + r * a
    if m is not None:
        metal[:] = metal * (1 - a) + m * a


PLACED = {}


def stencils(col, rough, metal, ink):
    img = load_decal('stencil.png')
    for side in (1, -1):
        at = None
        for parts in (['lower', 'upper'], None):
            for k in (1.0, 0.8, 0.65):
                size = (0.052 * k, 0.022 * k)
                at = find_flat(parts, side, size, well_x())
                if at:
                    break
            if at:
                break
        if not at:
            print('STENCIL none on side', side)
            continue
        PLACED['stencil%+d' % side] = [round(v, 4) for v in at] + [round(k, 2)]
        _, a = decal(img, at, side, size)
        blend(col, rough, metal, srgb(ink), a, 0.65, 0.0)


def hardtest(col, rough, metal, paint):
    bore = GUN['bore']
    top = (np.abs(P[:, 2]) < 0.0045) & (N[:, 1] > 0.3)
    pin = (np.abs(np.abs(P[:, 2]) - 0.0062) < 0.0007) & (N[:, 1] > 0.3)
    side = (np.abs(P[:, 1] - bore) < 0.003) & (np.abs(N[:, 2]) > 0.5)
    sedge = (np.abs(np.abs(P[:, 1] - bore) - 0.0042) < 0.0006) & (np.abs(N[:, 2]) > 0.5)
    for m_, h in ((top, 0x111316), (pin, 0xf2efe6), (side, 0x111316), (sedge, 0xf2efe6)):
        col[m_ & paint] = srgb(h)
    for name, s in (('roundel_L.png', -1), ('roundel_R.png', 1)):
        for k in (1.0, 0.8, 0.6):
            at = find_flat(['stock'], s, (0.027 * k, 0.027 * k), -1.0, facing=0.8, cover=0.95)
            if at:
                break
        if at:
            PLACED['roundel%+d' % s] = [round(v, 4) for v in at] + [k]
            rgb, a = decal(load_decal(name), at, s, (0.027 * k, 0.027 * k), facing=0.8)
            blend(col, rough, metal, rgb, a)
    text = load_decal('smalltext.png')
    for s in (1, -1):
        at = find_flat(['handguard', 'magazine'], s, (0.1, 0.004), 1.0, facing=0.6, cover=0.9)
        if at:
            PLACED['smalltext%+d' % s] = [round(v, 4) for v in at]
            rgb, a = decal(text, at, s, (0.1, 0.004), max_depth=0.01)
            blend(col, rough, metal, rgb, a)


# ---------------------------------------------------------------- recipes
def factory():
    col = np.zeros((n, 3)); rough = np.zeros(n); metal = np.zeros(n)
    for k, name in enumerate(GUN['slots']):
        f = GUN['factory'].get(name)
        if f:
            sel = slot == k
            col[sel] = srgb(f['color']); rough[sel] = f['rough']; metal[sel] = f['metal']
    return col, rough, metal


def apply(recipe):
    col, rough, metal = factory()
    paint = np.isin(slot, [SHELL, FRAME] + ([RUBBER] if recipe.get('rubber') else []))
    paint &= ~np.isin(part, FIXED_PARTS)
    for k, key in ((SHELL, 'shell'), (FRAME, 'frame'), (RUBBER, 'shell')):
        sel = paint & (slot == k)
        f = recipe[key]
        col[sel] = srgb(f['color']); rough[sel] = f['rough']; metal[sel] = f['metal']
    pt = recipe.get('pattern')
    if pt:
        k = pattern(pt, P)
        for t, tone in enumerate(pt['tones']):
            sel = paint & (k == t)
            col[sel] = srgb(tone['color']); rough[sel] = tone['rough']; metal[sel] = tone['metal']
    v = fbm(P, 0.03, 3, 11) - 0.5
    col[paint] *= (1 + recipe['mottle'] * v[paint])[:, None]
    rough[paint] += 0.6 * recipe['mottle'] * v[paint]
    wear = recipe.get('wear')
    if wear:
        amount = wear['amount']
        brk = fbm(P, 0.006, 3, 21)
        edge = smoothstep(0.6 - 0.025 * amount, 0.67 - 0.03 * amount, curv + 0.04 * (brk - 0.5))
        e = edge * (0.45 + 0.55 * smoothstep(0.35, 0.65, brk)) * min(1.0, amount) * paint
        blend(col, rough, metal, srgb(wear['color']), e, wear['rough'], wear['metal'])
    stencils(col, rough, metal, recipe['ink'])
    if recipe.get('livery') == 'hardtest':
        hardtest(col, rough, metal, paint)
    c = smoothstep(0.25, 0.85, 1 - ao)
    col *= (1 - recipe['dirt'] * c)[:, None]
    rough += 0.15 * c
    return col, rough, metal


def dilate(img, ok, steps=16):
    img = img.copy(); ok = ok.copy()
    for _ in range(steps):
        acc = np.zeros_like(img); cnt = np.zeros(ok.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx or dy:
                    v = np.roll(np.roll(ok, dy, 0), dx, 1)
                    acc += np.roll(np.roll(img, dy, 0), dx, 1) * v[..., None]
                    cnt += v
        g = (~ok) & (cnt > 0)
        if not g.any():
            break
        img[g] = acc[g] / cnt[g][:, None]
        ok |= g
    return img


def save(name, rgb, srgb_space):
    im = bpy.data.images.new(name, R, R, alpha=False)
    im.colorspace_settings.name = 'sRGB' if srgb_space else 'Non-Color'
    px = np.ones((R, R, 4), np.float32)
    px[..., :3] = np.round(np.clip(rgb, 0, 1) * 255) / 255
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = str(TEX / f'{name}.png'); im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


if not ONLY:
    # Normal map: despeckle against the 8 neighbours, fill misses, dilate.
    nm = np.load(F / 'tnormal.npy') * 2 - 1
    good = mask & ~np.load(F / 'miss.npy')
    nbs = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy]
    ns = np.stack([np.roll(np.roll(nm, dy, 0), dx, 1) for dy, dx in nbs])
    ms = np.stack([np.roll(np.roll(good, dy, 0), dx, 1) for dy, dx in nbs])
    mean = (ns * ms[..., None]).sum(0); mean /= np.maximum(np.linalg.norm(mean, axis=-1, keepdims=True), 1e-9)
    agree = ((ns * mean[None]).sum(-1) * ms).sum(0) / np.maximum(ms.sum(0), 1)
    speck = good & (ms.sum(0) == 8) & (agree > 0.99) & ((nm * mean).sum(-1) < 0.9)
    nm[speck] = mean[speck]
    nm = dilate(nm, good, 32)
    nm = np.where((np.abs(nm).sum(-1) == 0)[..., None], np.array([0, 0, 1.0]), nm)
    nm /= np.maximum(np.linalg.norm(nm, axis=-1, keepdims=True), 1e-9)
    save('normal', nm * 0.5 + 0.5, False)
    save('ao', dilate(np.where(valid, ao_full, 1.0)[..., None].repeat(3, -1), valid), False)
    print('NORMAL misses', int((mask & ~good).sum()), 'specks', int(speck.sum()))

log = {}
for name, recipe in RECIPES.items():
    if ONLY and name not in ONLY:
        continue
    t = time.time()
    col, rough, metal = apply(recipe)
    base = np.zeros((R, R, 3)); base[idx] = np.clip(col, 0, 1)
    # R unused (the AO is its own map), G roughness, B metalness: the glTF channels
    rm = np.zeros((R, R, 3)); rm[idx] = np.stack([np.ones(n), np.clip(rough, 0.04, 1), np.clip(metal, 0, 1)], 1)
    save(f'{name}_base', dilate(base, valid), True)
    save(f'{name}_rm', dilate(rm, valid), False)
    log[name] = round(time.time() - t, 1)
print('SKINS', GUN['gun'], json.dumps(log), 'placed', json.dumps(PLACED))
