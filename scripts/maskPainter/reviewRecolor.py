"""Reproduce Review.html's recolour (target hue+saturation, original value, blended by mask alpha) and
tile every frame of a sheet at readable size, original on top row / recoloured below.
    AGE=EarlyMedieval python scripts/maskPainter/reviewRecolor.py Unit/sheet.faction-mask.png OUT.png [tint #rrggbb] [frames]
"""
import sys, os, json
import numpy as np
from PIL import Image
B = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'BronzeAge'))
target, out = sys.argv[1], sys.argv[2]
tint = sys.argv[3] if len(sys.argv) > 3 else '#2877eb'
frames = [int(x) for x in sys.argv[4].split(',')] if len(sys.argv) > 4 else None
man = json.load(open(os.path.join(B, 'manifest.json')))
sh = next(s for u in man['units'] for s in u['sheets'] if s['mask'].split('?')[0] == target)
src = np.asarray(Image.open(os.path.normpath(os.path.join(B, sh['source']))).convert('RGBA')).astype(np.float32) / 255
w = np.asarray(Image.open(os.path.join(B, target)))[..., 3].astype(np.float32) / 255
t = [int(tint[i:i + 2], 16) / 255 for i in (1, 3, 5)]
mx, mn = max(t), min(t); d = mx - mn
th = (((t[1] - t[2]) / d + 6) % 6 if mx == t[0] else (t[2] - t[0]) / d + 2 if mx == t[1] else (t[0] - t[1]) / d + 4); ts = d / mx
def hsv2rgb(h, s, v):
    c = v * s; x = c * (1 - np.abs(h % 2 - 1)); m = v - c
    z = np.zeros_like(c)
    if 0 <= h < 1: r, g, b = c, x, z
    elif h < 2: r, g, b = x, c, z
    elif h < 3: r, g, b = z, c, x
    elif h < 4: r, g, b = z, x, c
    elif h < 5: r, g, b = x, z, c
    else: r, g, b = c, z, x
    return np.stack([r + m, g + m, b + m], -1)
v = src[..., :3].max(-1)
nxt = hsv2rgb(th, ts, v)
rgb = src[..., :3] * (1 - w[..., None]) + nxt * w[..., None]
cols = src.shape[1] // 512; rows = src.shape[0] // 512
frames = frames if frames is not None else list(range(cols * rows))
tile = 480
sheet = Image.new('RGB', (len(frames) * tile // 1, tile * 2), (40, 44, 52))
for i, f in enumerate(frames):
    c, r = f % cols, f // cols
    sl = (slice(r * 512, (r + 1) * 512), slice(c * 512, (c + 1) * 512))
    a = src[sl][..., 3]
    ys, xs = np.where(a > .08)
    box = (max(0, xs.min() - 8), max(0, ys.min() - 8), min(512, xs.max() + 8), min(512, ys.max() + 8)) if len(xs) else (0, 0, 512, 512)
    for row, img in enumerate((src[sl][..., :3], rgb[sl])):
        base = Image.new('RGBA', (512, 512), (40, 44, 52, 255))
        base.alpha_composite(Image.fromarray(np.dstack([(img * 255).astype(np.uint8), (a * 255).astype(np.uint8)])))
        fr = base.convert('RGB').crop(box); k = min(tile / fr.width, tile / fr.height)
        fr = fr.resize((int(fr.width * k), int(fr.height * k)), Image.LANCZOS)
        sheet.paste(fr, (i * tile + (tile - fr.width) // 2, row * tile + (tile - fr.height) // 2))
sheet.save(out)
