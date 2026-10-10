"""Zoom on one frame region with a labelled coordinate grid (frame-local pixels).
cyan = in mask, yellow = not in mask but leather-hued.
    AGE=ClassicalAge python scripts/maskPainter/zoomgrid.py Unit/sheet.faction-mask.png FRAME x0 y0 x1 y1 OUT.png [scale] [nocand]
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from buildRussianBronzeAgeLeatherMasks import smooth, rgb_to_hsv
B = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'BronzeAge'))
target, frame = sys.argv[1], int(sys.argv[2]); x0, y0, x1, y1 = (int(v) for v in sys.argv[3:7]); out = sys.argv[7]
scale = int(sys.argv[8]) if len(sys.argv) > 8 else 5; nocand = len(sys.argv) > 9
man = json.load(open(os.path.join(B, 'manifest.json')))
sh = next(s for u in man['units'] for s in u['sheets'] if s['mask'].split('?')[0] == target)
src = Image.open(os.path.normpath(os.path.join(B, sh['source']))).convert('RGBA')
cols = src.width // 512; ox, oy = (frame % cols) * 512, (frame // cols) * 512
m = np.asarray(Image.open(os.path.join(B, target)))[..., 3].astype(np.float32) / 255
a = np.asarray(src).astype(np.float32) / 255
sl = (slice(oy + y0, oy + y1), slice(ox + x0, ox + x1))
a, m = a[sl], m[sl]
h, s, v = rgb_to_hsv(a[..., :3]); h = np.where(h > 180, h - 360, h)
skin = smooth(10, 13, h) * (1 - smooth(23, 27, h)) * smooth(0.60, 0.70, v) * (1 - smooth(0.60, 0.70, s))
cand = (a[..., 3] > .5) & (m < .5) & (h < 16) & (s > .5) & (v > .1) & (skin < .5) & (not nocand)
lum = (a[..., 0] * .3 + a[..., 1] * .59 + a[..., 2] * .11) * 3.2
rgb = np.where(m[..., None] > .5, np.minimum(1, np.array([0, .78, 1]) * lum[..., None]), a[..., :3])
rgb = np.where(cand[..., None], np.array([1, .95, 0]), rgb)
img = Image.fromarray((rgb * 255).astype(np.uint8)); al = Image.fromarray((a[..., 3] * 255).astype(np.uint8))
bg = Image.new('RGBA', img.size, (60, 60, 70, 255)); bg.alpha_composite(Image.merge('RGBA', (*img.split(), al)))
bg = bg.convert('RGB').resize((img.width * scale, img.height * scale), Image.NEAREST)
d = ImageDraw.Draw(bg)
for gx in range((x0 // 20 + 1) * 20, x1, 20):
    X = (gx - x0) * scale; d.line([(X, 0), (X, bg.height)], fill=(255, 255, 255, 60) if gx % 100 else (255, 80, 80), width=1); d.text((X + 2, 2), str(gx), fill=(255, 255, 255))
for gy in range((y0 // 20 + 1) * 20, y1, 20):
    Y = (gy - y0) * scale; d.line([(0, Y), (bg.width, Y)], fill=(255, 255, 255, 60) if gy % 100 else (255, 80, 80), width=1); d.text((2, Y + 2), str(gy), fill=(255, 255, 255))
bg.save(out)
