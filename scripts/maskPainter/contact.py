"""Contact sheets of tinted final masks, frames cropped tight to the sprite.
    [AGE=ClassicalAge] python scripts/maskPainter/contact.py OUTDIR [Unit]
"""
import sys, os, json
import numpy as np
from PIL import Image
B = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'BronzeAge'))
outdir = sys.argv[1]; only = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(outdir, exist_ok=True)
man = json.load(open(os.path.join(B, 'manifest.json')))
for u in man['units']:
    if only and u['name'] != only: continue
    for sh in u['sheets']:
        t = sh['mask'].split('?')[0]
        src = Image.open(os.path.normpath(os.path.join(B, sh['source']))).convert('RGBA')
        m = np.asarray(Image.open(os.path.join(B, t)))[..., 3].astype(np.float32) / 255
        a = np.asarray(src).astype(np.float32)
        lum = (a[..., 0] * .3 + a[..., 1] * .59 + a[..., 2] * .11) / 255 * 3.2
        rgb = a[..., :3] * (1 - m[..., None]) + np.minimum(255, np.array([0, 200, 255], np.float32) * lum[..., None]) * m[..., None]
        full = Image.new('RGBA', src.size, (60, 60, 70, 255))
        full.alpha_composite(Image.merge('RGBA', (*Image.fromarray(rgb.astype(np.uint8)).split(), Image.fromarray(a[..., 3].astype(np.uint8)))))
        W, H = src.size; cols, rows = W // 512, H // 512
        tile = 380; sheet = Image.new('RGB', (cols * tile, rows * tile), (60, 60, 70))
        for r in range(rows):
            for c in range(cols):
                f = full.crop((c * 512, r * 512, c * 512 + 512, r * 512 + 512)).convert('RGB')
                al = a[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512, 3] > 20
                ys, xs = np.where(al)
                if len(xs): f = f.crop((max(0, xs.min() - 6), max(0, ys.min() - 6), min(512, xs.max() + 6), min(512, ys.max() + 6)))
                k = min(tile / f.width, tile / f.height); f = f.resize((int(f.width * k), int(f.height * k)), Image.LANCZOS)
                sheet.paste(f, (c * tile + (tile - f.width) // 2, r * tile + (tile - f.height) // 2))
        sheet.save(os.path.join(outdir, u['name'] + '_' + os.path.basename(t).split('.')[0] + '.png'))
print('done')
