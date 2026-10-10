"""Procedural top-down hoplite walk cycle, v2 (Pillow + numpy, no other deps).

Facing DOWN (walks toward the bottom of the image) with light from the top-left,
matching the existing Russian Javelinist/Clubman sheets.  Six 256 px frames.

Every part is a mask that gets shaded by the gradient of its blurred silhouette,
which gives polygons (crest, spear head, shield device) real form instead of the
concentric-ellipse look of v1.  Red parts (crest, shield field) are the team hue.

Run:  python make_hoplite_v2.py
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE, SS, FRAMES, FRAME_MS = 256, 4, 6, 120
W = SIZE * SS
LIGHT = (-0.707, -0.707)            # unit vector pointing toward the light
CX, CY = 128, 128

BRONZE = (214, 160, 70)
BRONZE_RIM = (236, 198, 108)
RED = (180, 34, 30)
RED_DEEP = (112, 14, 14)
CREAM = (234, 222, 192)
SKIN = (218, 166, 126)
LEATHER = (104, 66, 38)
DARK_LEATHER = (66, 40, 22)
WOOD = (160, 114, 62)
IRON = (204, 210, 218)

_rng = np.random.default_rng(7)
_noise = Image.fromarray((_rng.random((W, W)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
_noise = np.asarray(_noise, np.float32) / 255
_noise = (_noise - _noise.min()) / (_noise.max() - _noise.min() + 1e-6)


# ------------------------------------------------------------ geometry ---
def mask():
    return Image.new("L", (W, W), 0)


def sp(p):
    return (p[0] * SS, p[1] * SS)


def rot_pts(pts, piv, deg):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    px, py = piv
    return [(px + (x - px) * ca - (y - py) * sa, py + (x - px) * sa + (y - py) * ca) for x, y in pts]


def add_poly(m, pts):
    ImageDraw.Draw(m).polygon([sp(p) for p in pts], fill=255)


def add_ellipse(m, c, rx, ry, deg=0, piv=None, n=72):
    pts = [(c[0] + rx * math.cos(2 * math.pi * k / n), c[1] + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]
    if deg:
        pts = rot_pts(pts, piv or c, deg)
    add_poly(m, pts)


def add_capsule(m, a, b, w):
    d = ImageDraw.Draw(m)
    d.line([sp(a), sp(b)], fill=255, width=max(1, int(w * SS)))
    r = w / 2
    for p in (a, b):
        d.ellipse([sp((p[0] - r, p[1] - r)), sp((p[0] + r, p[1] + r))], fill=255)


# ------------------------------------------------------------- shading ---
def blur(m, px):
    return m.filter(ImageFilter.GaussianBlur(px * SS)) if px > 0 else m


def erode(m, px):
    return blur(m, px * 0.9).point(lambda v: 255 if v >= 215 else 0)


def shade(m, base, bevel=6, contrast=.5, ao=.18, spec=0., spec_col=(255, 248, 220),
          outline=1.6, noise=.06, ocol=None, alpha=1.0):
    """Shade a mask: directional bevel from the blurred silhouette + edge AO + outline."""
    a = np.asarray(m, np.float32) / 255
    if not a.any():
        return None
    b = np.asarray(blur(m, bevel), np.float32) / 255
    gy, gx = np.gradient(b)
    mag = np.hypot(gx, gy)
    strength = np.clip(mag * bevel * SS * 2.6, 0, 1)
    lit = np.where(mag > 1e-7, -(gx * LIGHT[0] + gy * LIGHT[1]) / (mag + 1e-9), 0) * strength
    sh = 1 + contrast * lit
    if ao:
        wide = np.asarray(blur(m, bevel * 1.6), np.float32) / 255
        sh = sh * (1 - ao * (1 - wide))
    if noise:
        sh = sh * (1 + noise * (_noise - .5) * 2)
    rgb = np.array(base, np.float32) * sh[..., None]
    if spec:
        rgb += np.array(spec_col, np.float32) * (spec * np.clip(lit, 0, 1) ** 3)[..., None]
    if outline:
        e = np.asarray(erode(m, outline), np.float32) / 255
        rim = np.clip(a - e, 0, 1)[..., None]
        oc = np.array(ocol if ocol else [v * .28 for v in base], np.float32)
        rgb = rgb * (1 - rim) + oc * rim
    out = np.dstack([np.clip(rgb, 0, 255), a * 255 * alpha]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def shadow(m, dx, dy, blur_px, alpha):
    sm = blur(m, blur_px)
    s = Image.new("L", (W, W), 0)
    s.paste(sm, (int(dx * SS), int(dy * SS)))
    arr = np.zeros((W, W, 4), np.uint8)
    arr[..., :3] = (8, 10, 6)
    arr[..., 3] = (np.asarray(s, np.float32) * alpha / 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def downsample(img):
    """LANCZOS with premultiplied alpha so edges don't get dark fringes."""
    a = np.asarray(img, np.float32) / 255
    pm = np.dstack([a[..., :3] * a[..., 3:], a[..., 3:]])
    im = Image.fromarray((pm * 255).astype(np.uint8), "RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    b = np.asarray(im, np.float32) / 255
    al = b[..., 3:]
    rgb = np.where(al > 0, b[..., :3] / np.maximum(al, 1e-4), 0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), al]) * 255).astype(np.uint8), "RGBA")


# --------------------------------------------------------------- frame ---
def render_frame(i):
    ph = 2 * math.pi * (i + .5) / FRAMES
    s, c = math.sin(ph), math.cos(ph)
    sway = 5 * s                        # torso twist, degrees
    bob = 1.2 * math.cos(2 * ph)        # two bobs per cycle
    cy = CY + bob
    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    def put(layer):
        if layer is not None:
            canvas.alpha_composite(layer)

    def R(pts, piv=None, deg=None):
        return rot_pts(pts, piv or (CX, cy), sway if deg is None else deg)

    # ground shadow
    m = mask()
    add_ellipse(m, (CX + 6, CY + 8), 50, 44)
    put(shadow(m, 0, 0, 8, 95))

    # ---- legs: tight stance, feet close under the body ----
    stride = 32
    legs = [(141, CY + stride * s, max(0.0, c)),      # his left (viewer right)
            (115, CY - stride * s, max(0.0, -c))]     # his right
    legs.sort(key=lambda t: t[2])                     # planted first, lifted on top
    for hx, fy, lift in legs:
        sgn = 1 if fy > CY else -1
        knee = (hx, CY + (fy - CY) * .5)
        m = mask(); add_capsule(m, (hx, CY), knee, 16); put(shade(m, SKIN, 4, .45))
        m = mask(); add_capsule(m, knee, (hx, fy), 14); put(shade(m, BRONZE, 4, .5, spec=.5))   # greave
        sc = 1 + .18 * lift
        fm = mask(); add_ellipse(fm, (hx, fy + sgn * 7), 9 * sc, 13 * sc)
        if lift > .05:
            put(shadow(fm, 4 * lift, 5 * lift, 2, int(90 * lift)))
        put(shade(fm, LEATHER, 3, .5))
        st = mask()                                                                            # sandal straps
        for k in (-4, 2):
            add_capsule(st, (hx - 8 * sc, fy + sgn * 7 + k), (hx + 8 * sc, fy + sgn * 7 + k), 1.4)
        put(shade(st, DARK_LEATHER, 1, 0, ao=0, outline=0, noise=0, alpha=.6))

    # ---- pteruges fringe under the cuirass ----
    pc = (CX, cy + 2)
    m = mask(); add_ellipse(m, pc, 37, 27, sway); put(shade(m, CREAM, 3, .4, ao=.3))
    st = mask()
    for k in range(18):
        t = 2 * math.pi * k / 18
        p0 = (CX + 10 * math.cos(t), pc[1] + 7 * math.sin(t))
        p1 = (CX + 37 * math.cos(t), pc[1] + 27 * math.sin(t))
        p0, p1 = R([p0, p1], pc)
        add_capsule(st, p0, p1, 1.6)
    put(shade(st, DARK_LEATHER, 1, 0, ao=0, outline=0, noise=0, alpha=.45))

    # ---- bronze cuirass + shoulder guards ----
    m = mask(); add_ellipse(m, (CX, cy), 31, 21, sway); put(shade(m, BRONZE, 9, .5, spec=.6))
    for sx in (-27, 27):
        p = R([(CX + sx, cy)])[0]
        m = mask(); add_ellipse(m, p, 11, 11); put(shade(m, BRONZE, 5, .55, spec=.6))
    cl = mask(); a_, b_ = R([(CX, cy - 14), (CX, cy + 16)]); add_capsule(cl, a_, b_, 1.8)
    put(shade(cl, (90, 60, 20), 1, 0, ao=0, outline=0, noise=0, alpha=.5))

    # ---- shield arm + aspis (his left = viewer right) ----
    sh_c = (CX + 44, cy + 14 - 4 * s)
    sh_rot = 8 + sway * .6
    m = mask(); add_capsule(m, R([(CX + 27, cy)])[0], sh_c, 13); put(shade(m, SKIN, 4, .45))
    sm = mask(); add_ellipse(sm, sh_c, 42, 42)
    put(shadow(sm, 7, 9, 4, 110))
    put(shade(sm, BRONZE_RIM, 5, .6, spec=.7))                                   # polished rim
    fm = mask(); add_ellipse(fm, sh_c, 35, 35)
    put(shade(fm, RED, 18, .4, ao=.15, spec=.25, outline=1.2))                   # convex red field
    lam = [(0, -23), (-21, 18), (-12, 18), (0, -6), (12, 18), (21, 18)]
    lam = rot_pts([(sh_c[0] + x, sh_c[1] + y) for x, y in lam], sh_c, sh_rot)
    lm = mask(); add_poly(lm, lam); put(shade(lm, CREAM, 2, .3, ao=0, outline=1.0))   # Λ device

    # ---- spear arm + dory (his right = viewer left) ----
    H = (CX - 44, cy - 2 + 5 * s)
    m = mask(); add_capsule(m, R([(CX - 27, cy)])[0], H, 13); put(shade(m, SKIN, 4, .45))
    ang = math.radians(12 + 1.5 * s)
    d = (-math.sin(ang), math.cos(ang))
    n = (d[1], -d[0])
    butt = (H[0] - d[0] * 78, H[1] - d[1] * 78)
    tip = (H[0] + d[0] * 118, H[1] + d[1] * 118)
    sm = mask(); add_capsule(sm, butt, tip, 5)
    put(shadow(sm, 6, 8, 2, 80))
    # sauroter (butt spike)
    bs = mask(); add_poly(bs, [(butt[0] - d[0] * 14, butt[1] - d[1] * 14),
                               (butt[0] + n[0] * 3.2, butt[1] + n[1] * 3.2),
                               (butt[0] - n[0] * 3.2, butt[1] - n[1] * 3.2)])
    put(shade(bs, BRONZE, 2, .5, spec=.5, outline=1.0))
    put(shade(sm, WOOD, 2, .55, spec=.3, outline=1.2))                              # ash shaft
    hb = (tip[0] - d[0] * 26, tip[1] - d[1] * 26)
    wm = (tip[0] - d[0] * 17, tip[1] - d[1] * 17)
    head = [tip, (wm[0] + n[0] * 5, wm[1] + n[1] * 5), (hb[0] + n[0] * 2, hb[1] + n[1] * 2),
            (hb[0] - n[0] * 2, hb[1] - n[1] * 2), (wm[0] - n[0] * 5, wm[1] - n[1] * 5)]
    hm = mask(); add_poly(hm, head); put(shade(hm, IRON, 3, .6, spec=.8, outline=1.2))   # leaf head
    sk = mask(); add_capsule(sk, hb, (hb[0] - d[0] * 6, hb[1] - d[1] * 6), 6.2)
    put(shade(sk, BRONZE, 2, .5, outline=1.0))                                       # socket
    hd = mask(); add_ellipse(hd, H, 8.5, 8.5); put(shade(hd, SKIN, 4, .5))          # hand over shaft

    # ---- Corinthian helmet (dome + cheek flares + nasal as one shape) ----
    hr = sway * .4
    hc = (CX, cy - 2)
    hm = mask()
    add_ellipse(hm, hc, 24, 28, hr)
    for sx in (-15, 15):
        add_ellipse(hm, R([(CX + sx, cy + 17)], hc, hr)[0], 7, 8)
    add_poly(hm, R([(CX - 3, cy + 20), (CX + 3, cy + 20), (CX + 2.5, cy + 32), (CX - 2.5, cy + 32)], hc, hr))
    put(shadow(hm, 5, 6, 3, 70))
    put(shade(hm, BRONZE, 13, .55, spec=.8))
    # brow line / eye-slit shadow on the front edge
    br = mask(); a_, b_ = R([(CX - 13, cy + 18), (CX + 13, cy + 18)], hc, hr); add_capsule(br, a_, b_, 2.2)
    put(shade(br, (60, 36, 10), 1, 0, ao=0, outline=0, noise=0, alpha=.55))

    # ---- horsehair crest: narrow at the brow, flaring and trailing behind ----
    pts = [(CX - 3.2, cy + 12), (CX + 3.2, cy + 12), (CX + 5.5, cy - 8), (CX + 7.5, cy - 30), (CX + 10, cy - 56),
           (CX + 6, cy - 64), (CX, cy - 66), (CX - 6, cy - 64), (CX - 10, cy - 56), (CX - 7.5, cy - 30), (CX - 5.5, cy - 8)]
    cm = mask(); add_poly(cm, R(pts, hc, hr))
    for k in range(34):                                                            # bristle fringe
        t = k / 33
        y = cy + 9 - 75 * t
        half = 3.2 + 6.8 * t
        side = 1 if k % 2 else -1
        a_, b_ = R([(CX + side * (half - 2), y), (CX + side * (half + 3 + 3 * t), y - 5 - 4 * t)], hc, hr)
        add_capsule(cm, a_, b_, 1.5)
    put(shadow(cm, 4, 5, 3, 85))
    put(shade(cm, RED, 3, .5, ao=.2, spec=.15, outline=1.3))
    stm = mask()                                                                   # hair striations
    for k in range(5):
        a_, b_ = R([(CX + (k - 2) * 1.8, cy + 8), (CX + (k - 2) * 3.8, cy - 60)], hc, hr)
        add_capsule(stm, a_, b_, .9)
    put(shade(stm, RED_DEEP, 1, 0, ao=0, outline=0, noise=0, alpha=.5))

    return downsample(canvas)


# ------------------------------------------------------------- outputs ---
def checker_bg(w, h, c1=(60, 66, 54), c2=(70, 78, 62), cell=16):
    im = Image.new("RGB", (w, h), c1)
    d = ImageDraw.Draw(im)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=c2)
    return im.convert("RGBA")


def main():
    frames = []
    for i in range(FRAMES):
        frames.append(render_frame(i))
        print("frame", i)
    os.makedirs(os.path.join(HERE, "frames_v2"), exist_ok=True)
    for i, f in enumerate(frames):
        f.save(os.path.join(HERE, "frames_v2", f"walk_{i}.png"))

    sheet = Image.new("RGBA", (SIZE * FRAMES, SIZE), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * SIZE, 0))
    sheet.save(os.path.join(HERE, "Hoplite_v2_Walk_Sheet.png"))

    review = []
    for f in frames:
        bg = checker_bg(SIZE, SIZE)
        bg.alpha_composite(f)
        review.append(bg.convert("RGB").resize((SIZE * 2, SIZE * 2), Image.NEAREST))
    review[0].save(os.path.join(HERE, "Hoplite_v2_Walk_Loop.gif"), save_all=True,
                   append_images=review[1:], duration=FRAME_MS, loop=0, optimize=False)
    frames[0].save(os.path.join(HERE, "Hoplite_v2_Walk_Loop.webp"), save_all=True,
                   append_images=frames[1:], duration=FRAME_MS, loop=0, lossless=True)

    # contact strip with game-size reductions
    strip = Image.new("RGB", (SIZE * FRAMES, SIZE + 140), (46, 52, 40))
    for i, f in enumerate(frames):
        bg = checker_bg(SIZE, SIZE)
        bg.alpha_composite(f)
        strip.paste(bg.convert("RGB"), (i * SIZE, 0))
        for k, px in enumerate((64, 48, 32)):
            sm = f.resize((px, px), Image.LANCZOS)
            strip.paste(sm, (i * SIZE + 10 + [0, 76, 134][k], SIZE + 14), sm)
    strip.save(os.path.join(HERE, "Hoplite_v2_Walk_Strip.png"))

    # phalanx preview: 4x3 block at 64 px, staggered frames, on a plain field
    ph = Image.new("RGBA", (64 * 4 + 40, 64 * 3 + 40), (72, 92, 54, 255))
    for r in range(3):
        for col in range(4):
            f = frames[(r * 2 + col) % FRAMES].resize((64, 64), Image.LANCZOS)
            ph.alpha_composite(f, (20 + col * 56, 20 + r * 50))
    ph.convert("RGB").resize((ph.width * 2, ph.height * 2), Image.NEAREST).save(
        os.path.join(HERE, "Hoplite_v2_Phalanx_64px.png"))
    print("done")


if __name__ == "__main__":
    main()
