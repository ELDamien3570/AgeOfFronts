"""Procedural Pillow demo: wall kit, road kit, and team-colour masks.

Same conventions as Art/Terrain: 256 px tiles, N=1 E=2 S=4 W=8 connection masks.
Every texture is tileable, so same-tier neighbours match exactly at tile edges.
Run:  python make_demo.py
"""
import colorsys
import os
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
T = 256
N, E, S, W = 1, 2, 4, 8


def out(*p):
    path = os.path.join(HERE, *p)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


# ---------------------------------------------------------------- noise ----
def tile_noise(seed, cells, size=T):
    """Seamlessly tileable value noise in [0,1]."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    big = np.tile(g, (3, 3))
    im = Image.fromarray((big * 255).astype(np.uint8)).resize(
        (3 * size, 3 * size), Image.BICUBIC)
    a = np.asarray(im, dtype=np.float32) / 255.0
    return a[size:2 * size, size:2 * size]


def fbm(seed, size=T):
    return (0.55 * tile_noise(seed, 4, size) + 0.3 * tile_noise(seed + 1, 8, size)
            + 0.15 * tile_noise(seed + 2, 16, size))


def to_img(a):
    return Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))


# -------------------------------------------------------------- textures ---
def grass_texture():
    n = fbm(10)
    fine = tile_noise(11, 64)
    base = np.array([74, 98, 48], np.float32)
    dark = np.array([52, 76, 36], np.float32)
    t = np.clip(n * 1.4 + (fine - .5) * .5, 0, 1)[..., None]
    rgb = dark + (base - dark) * t
    rgb += (fine[..., None] - .5) * 26
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert("RGBA")


def ashlar_texture(seed=3, rows=8):
    """Tileable course-laid stone blocks, grey-warm, with mortar and bevels."""
    S2 = T * 2
    rnd = random.Random(seed)
    img = Image.new("RGB", (S2, S2), (70, 66, 62))
    d = ImageDraw.Draw(img)
    rh = S2 // rows
    for r in range(rows):
        y0 = r * rh
        x = -rnd.randint(0, 60)
        while x < S2:
            w = rnd.randint(46, 92)
            if x + w > S2 and S2 - x < 30:
                w = S2 - x
            tone = rnd.uniform(-1, 1)
            warm = rnd.uniform(0, 1)
            base = np.array([150, 144, 134]) + tone * 22 + warm * np.array([10, 2, -8])
            box = [x + 3, y0 + 3, x + w - 3, y0 + rh - 3]
            d.rounded_rectangle(box, 7, fill=tuple(int(v) for v in base))
            # bevel: light top-left, dark bottom-right
            d.line([(box[0] + 5, box[1] + 1), (box[2] - 5, box[1] + 1)],
                   fill=tuple(int(min(255, v + 34)) for v in base), width=2)
            d.line([(box[0] + 5, box[3] - 1), (box[2] - 5, box[3] - 1)],
                   fill=tuple(int(max(0, v - 38)) for v in base), width=2)
            x += w
    # tile-wrap by roll test: draw is done on a 2x canvas whose blocks are
    # laid out to the canvas edge, then downsample.  Grain on top.
    img = img.resize((T, T), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float32)
    grain = (tile_noise(21, 64) - .5) * 30 + (fbm(22) - .5) * 40
    a += grain[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")


def cobble_texture(seed=5, step=T / 12):
    """Tileable cobblestones on dark mortar: jittered grid of shaded domes."""
    rnd = random.Random(seed)
    n = int(round(T / step))
    S3 = T * 3
    img = Image.new("RGB", (S3, S3), (52, 46, 42))
    d = ImageDraw.Draw(img)
    stones = []
    for j in range(n):
        for i in range(n):
            cx = (i + .5) * step + rnd.uniform(-4, 4) + (step / 2 if j % 2 else 0)
            cy = (j + .5) * step + rnd.uniform(-3, 3)
            rx, ry = step * rnd.uniform(.38, .47), step * rnd.uniform(.36, .45)
            tone = rnd.uniform(-1, 1)
            stones.append((cx, cy, rx, ry, tone))
    for oy in range(3):
        for ox in range(3):
            for cx, cy, rx, ry, tone in stones:
                X, Y = cx + ox * T, cy + oy * T
                base = np.array([128, 120, 110]) + tone * 20
                c = tuple(int(v) for v in base)
                d.ellipse([X - rx, Y - ry, X + rx, Y + ry], fill=c)
                lt = tuple(int(min(255, v + 36)) for v in base)
                d.ellipse([X - rx * .7, Y - ry * .8, X + rx * .3, Y + ry * .2], fill=lt)
                dk = tuple(int(max(0, v - 30)) for v in base)
                d.arc([X - rx, Y - ry, X + rx, Y + ry], 20, 150, fill=dk, width=3)
    img = img.filter(ImageFilter.GaussianBlur(.8)).crop((T, T, 2 * T, 2 * T))
    a = np.asarray(img, dtype=np.float32)
    a += ((tile_noise(31, 64) - .5) * 24)[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")


def wrap_pad(img):
    """Pad a tileable texture by wrapping, so padded canvases stay seamless."""
    a = np.asarray(img)
    a = np.pad(a, ((P, P), (P, P), (0, 0)) if a.ndim == 3 else ((P, P), (P, P)), mode="wrap")
    return Image.fromarray(a)


def crop_tile(img):
    return img.crop((P, P, P + T, P + T))


def shift(img, dx, dy):
    """Non-wrapping offset (ImageChops.offset wraps, which smears across tile edges)."""
    out = Image.new(img.mode, img.size, 0)
    out.paste(img, (dx, dy))
    return out


# ----------------------------------------------------------------- walls ---
P = 32  # padding so blur/min filters never see the tile border


def arms_mask(mask, half, ss=2):
    """L mask of centre square + arms running to the edge of a padded canvas."""
    s = (T + 2 * P) * ss
    c = s // 2
    h = half * ss
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    d.rectangle([c - h, c - h, c + h, c + h], fill=255)
    if mask & N: d.rectangle([c - h, -4, c + h, c], fill=255)
    if mask & S: d.rectangle([c - h, c, c + h, s + 4], fill=255)
    if mask & W: d.rectangle([-4, c - h, c, c + h], fill=255)
    if mask & E: d.rectangle([c, c - h, s + 4, c + h], fill=255)
    return m


def shade_wall(shape, tex, battlements):
    """Top-down wall: stone top face, darker rim, contact shadow, merlon notches."""
    ss = shape.size[0] // T
    top = shape.filter(ImageFilter.MinFilter(2 * 9 * ss // 2 * 2 + 1))   # inner face
    rim = ImageChops.subtract(shape, top)
    tex_big = wrap_pad(tex).resize(shape.size, Image.BICUBIC)
    canvas = Image.new("RGBA", shape.size, (0, 0, 0, 0))

    # contact shadow, offset down-right
    sh = shape.filter(ImageFilter.GaussianBlur(5 * ss))
    sh = shift(sh, 9 * ss, 11 * ss).point(lambda v: int(v * .55))
    shadow = Image.new("RGBA", shape.size, (12, 14, 8, 255))
    canvas.paste(shadow, (0, 0), sh)

    # stone body: rim darkened, top lit
    body = tex_big.copy()
    dark = Image.new("RGBA", shape.size, (30, 26, 24, 255))
    body = Image.composite(Image.blend(body, dark, .45), body, rim)
    # light from top-left: lighten top-left rim edges
    lit = shift(top, 3 * ss, 3 * ss)
    hl = ImageChops.subtract(top, lit)
    body = Image.composite(Image.blend(body, Image.new("RGBA", shape.size, (235, 228, 214, 255)), .5),
                           body, hl)
    canvas.paste(body, (0, 0), shape)

    # crisp 1px outline
    outline = ImageChops.subtract(shape, shape.filter(ImageFilter.MinFilter(2 * ss + 1)))
    canvas.paste(Image.new("RGBA", shape.size, (22, 18, 16, 255)), (0, 0), outline)
    return crop_tile(canvas.resize((T + 2 * P, T + 2 * P), Image.LANCZOS))


def make_wall_tile(mask, tex, half=34):
    shape = arms_mask(mask, half)
    # soften outer corners a touch so bends read as masonry, not LEGO
    shape = shape.filter(ImageFilter.GaussianBlur(3)).point(lambda v: 255 if v > 128 else 0)
    return shade_wall(shape, tex, False)


# ----------------------------------------------------------------- roads ---
def make_road_tile(mask, grass, cobbles, half=52):
    ss = 2
    PT = T + 2 * P
    shape = arms_mask(mask, half, ss)
    shape = shape.filter(ImageFilter.GaussianBlur(14 * ss))
    nz = np.pad(fbm(40).astype(np.float32), P, mode="wrap")
    nz2 = np.asarray(to_img(nz).resize(shape.size, Image.BICUBIC), np.float32) / 255
    a = np.asarray(shape, np.float32) / 255
    a = np.where(a + (nz2 - .5) * .55 > .5, 255, 0).astype(np.uint8)
    road = Image.fromarray(a).filter(ImageFilter.GaussianBlur(1.2 * ss)).resize((PT, PT), Image.LANCZOS)

    base = wrap_pad(grass).copy()
    verge = road.filter(ImageFilter.GaussianBlur(9)).point(lambda v: int(v * .65))
    base.paste(Image.new("RGBA", (PT, PT), (96, 82, 58, 255)), (0, 0), verge)
    edge = ImageChops.subtract(road.filter(ImageFilter.GaussianBlur(3)), road)
    base.paste(Image.new("RGBA", (PT, PT), (30, 26, 20, 255)), (0, 0), edge.point(lambda v: min(255, v * 3)))
    base.paste(wrap_pad(cobbles), (0, 0), road)
    inner = ImageChops.subtract(road, road.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(4)))
    base.paste(Image.new("RGBA", (PT, PT), (25, 22, 18, 255)), (0, 0), inner.point(lambda v: int(v * .5)))
    return crop_tile(base)


# ---------------------------------------------------------- team colours ---
def team_mask(img, hue_lo=-0.04, hue_hi=0.012, smin=0.6, vmin=0.25):
    """Grey mask (0-255) of 'player red' pixels, with soft hue falloff.

    A runtime shader would multiply this mask by the player colour; the art
    keeps its shading because the original brightness is untouched.
    """
    rgba = np.asarray(img.convert("RGBA"), dtype=np.float32) / 255
    r, g, b, a = rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3]
    mx, mn = rgba[..., :3].max(-1), rgba[..., :3].min(-1)
    v, s = mx, np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6,
                 np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0
    h = np.where(h > .5, h - 1, h)                       # wrap so red ~ 0
    hue_w = np.clip(1 - np.maximum(np.maximum(hue_lo - h, h - hue_hi), 0) / 0.015, 0, 1)
    sat_w = np.clip((s - smin) / 0.15, 0, 1)
    val_w = np.clip((v - vmin) / 0.1, 0, 1)
    m = hue_w * sat_w * val_w * (a > 0.8)
    return Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(.6))


def apply_team(img, mask, rgb):
    """Replace the masked hue with `rgb` while keeping the sprite's own shading."""
    a = np.asarray(img.convert("RGBA"), dtype=np.float32)
    m = (np.asarray(mask, np.float32) / 255)[..., None]
    lum = (a[..., :3] @ np.array([.299, .587, .114], np.float32))[..., None]
    # normalise luminance against the average red luminance (~0.3*255)
    shade = np.clip(lum / (lum[m[..., 0] > .5].mean() if (m > .5).any() else 80), 0, 1.7)
    tinted = np.clip(np.array(rgb, np.float32) * shade, 0, 255)
    a[..., :3] = a[..., :3] * (1 - m) + tinted * m
    return Image.fromarray(a.astype(np.uint8), "RGBA")


# ----------------------------------------------------------------- build ---
def checker(size, c1=(58, 58, 62), c2=(70, 70, 74), cell=16):
    im = Image.new("RGB", size, c1)
    d = ImageDraw.Draw(im)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=c2)
    return im.convert("RGBA")


def atlas(tiles, cols=4):
    rows = (len(tiles) + cols - 1) // cols
    at = Image.new("RGBA", (cols * T, rows * T), (0, 0, 0, 0))
    for i, t in enumerate(tiles):
        at.paste(t, ((i % cols) * T, (i // cols) * T))
    return at


def main():
    grass = grass_texture()
    stone = ashlar_texture()
    cobble = cobble_texture()

    # --- walls ---
    walls = []
    for m in range(16):
        t = make_wall_tile(m, stone)
        t.save(out("wall", "tiles", f"{m}.png"))
        walls.append(t)
    wa = atlas(walls)
    wa.save(out("wall", "Wall_Atlas.png"))

    # --- roads ---
    roads = []
    for m in range(16):
        t = make_road_tile(m, grass, cobble)
        t.convert("RGB").save(out("road", "tiles", f"{m}.png"))
        roads.append(t)
    atlas(roads).save(out("road", "Road_Atlas.png"))

    # --- assembled scene: roads + walled compound ---
    cols, rows = 9, 6
    scene = Image.new("RGBA", (cols * T, rows * T))
    layout_road = {  # (x,y): mask  -- a road running W->E with a branch south
        (0, 4): E, (1, 4): E | W, (2, 4): E | W, (3, 4): E | W | N, (4, 4): E | W,
        (5, 4): E | W, (6, 4): E | W, (7, 4): E | W, (8, 4): W,
        (3, 5): N,
    }
    for y in range(rows):
        for x in range(cols):
            scene.paste(grass, (x * T, y * T))
    for (x, y), m in layout_road.items():
        scene.paste(roads[m], (x * T, y * T))
    # ring wall with a gap on the south side facing the road
    ring = {
        (2, 0): E | S, (3, 0): E | W, (4, 0): E | W, (5, 0): E | W, (6, 0): W | S,
        (2, 1): N | S, (6, 1): N | S,
        (2, 2): N | S, (6, 2): N | S,
        (2, 3): N | E, (3, 3): W | E, (4, 3): W, (5, 3): E, (6, 3): N | W,
    }
    for (x, y), m in ring.items():
        scene.alpha_composite(walls[m], (x * T, y * T))
    scene.convert("RGB").save(out("scene_walls_roads.png"))

    # --- team colour masks on a real sprite ---
    sheet = Image.open(os.path.join(
        ART, "Cultures", "Russians", "Units", "StoneAge", "Javelinist", "Running-v2.png")).convert("RGBA")
    cell = sheet.crop((0, 0, 512, 512))
    mask = team_mask(cell)
    mask.save(out("team", "mask.png"))
    teams = [("original", None), ("blue", (40, 90, 220)), ("green", (40, 170, 70)),
             ("yellow", (235, 195, 40)), ("purple", (140, 60, 190)), ("teal", (30, 175, 170))]
    bg = checker((512, 512))
    panels = []
    for name, rgb in teams:
        spr = cell if rgb is None else apply_team(cell, mask, rgb)
        p = bg.copy()
        p.alpha_composite(spr)
        panels.append(p)
    row = Image.new("RGBA", (512 * 3, 512 * 2))
    for i, p in enumerate(panels):
        row.paste(p, ((i % 3) * 512, (i // 3) * 512))
    row.convert("RGB").save(out("team", "team_variants.png"))
    mpanel = Image.merge("RGB", (mask, mask, mask))
    mpanel.save(out("team", "mask_preview.png"))

    # --- small-size check: the 48 px reality test ---
    review = Image.new("RGB", (1000, 360), (40, 40, 44))
    x = 10
    for lbl, im in [("wall", walls[5]), ("wall bend", walls[3]), ("road", roads[10]), ("road T", roads[7])]:
        for s in (128, 64, 48):
            sm = im.resize((s, s), Image.LANCZOS).convert("RGBA")
            review.paste(sm, (x, 20), sm)
            x += s + 8
        x += 16
    review.save(out("small_size_check.png"))
    print("done")


if __name__ == "__main__":
    main()
