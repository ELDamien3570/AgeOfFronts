"""Build leather faction masks for the Russian Bronze Age troop sheets.

The mask is the tunic/sleeve/belt leather only, picked by colour: the leather is a
muted red-maroon (hue ~0-14 deg) that is clearly separate from bronze/wood (hue 20+),
fur (low saturation) and skin (bright). Output is white RGBA with coverage in alpha,
same layout and file names as the previous FactionMasks output.

    python scripts/buildRussianBronzeAgeLeatherMasks.py [--preview DIR] [--only Unit/sheet.faction-mask.png]

Hand corrections painted in the mask painter (scripts/maskPainter) live in
FactionMasks/BronzeAge/Corrections/<Unit>/<sheet>.correction.png and are applied on top of the
auto detection: green = force leather, red = force not leather. Painting is limited to the sprite
silhouette. The untouched auto result is kept in FactionMasks/BronzeAge/AutoDetected/.
"""
import argparse, hashlib, json, os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join('Art', 'Cultures', 'Russians')
OUT = os.path.join(ROOT, 'FactionMasks', 'BronzeAge')
AUTO = os.path.join(OUT, 'AutoDetected')
CORR = os.path.join(OUT, 'Corrections')


def correction_path(target):
    return os.path.join(CORR, target.replace('.faction-mask.png', '.correction.png'))


def apply_correction(alpha, src_alpha, target):
    path = correction_path(target)
    if not os.path.exists(path):
        return alpha
    c = np.asarray(Image.open(path).convert('RGBA'))
    if c.shape[:2] != alpha.shape:
        raise SystemExit('Correction size does not match sheet: ' + path)
    on = c[..., 3] > 127
    add = on & (c[..., 1] > 127) & (c[..., 0] < 128)
    erase = on & (c[..., 0] > 127) & (c[..., 1] < 128)
    out = np.where(add, src_alpha, alpha)
    return np.where(erase, 0, out)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def leather_alpha(img):
    a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255
    h, s, v = rgb_to_hsv(a[..., :3])
    h = np.where(h > 180, h - 360, h)           # reds wrap below 0
    hue = 1 - smooth(11, 15, h)                 # leather red; bronze/wood/skin are 20+
    hue *= smooth(-25, -5, h)                   # but not magenta/purple
    sat = smooth(0.56, 0.68, s)                 # fur, skin highlights, steel are lower
    val = smooth(0.12, 0.22, v) * (1 - smooth(0.55, 0.70, v) * smooth(7, 11, h))   # not shadow-black; bright only allowed if clearly red (lit skin is orange)
    alpha = a[..., 3] * hue * sat * val
    # Hysteresis: shadowed leather at the edges fails the strict test; accept looser, still-red pixels that touch a sure one.
    weak = a[..., 3] * (1 - smooth(11, 14, h)) * smooth(0.58, 0.68, s) * smooth(0.05, 0.12, v) * (1 - smooth(0.42, 0.52, v))
    near = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))).astype(np.float32) / 255
    alpha = np.maximum(alpha, weak * (near > 0.5))
    # Opening drops 1px reddish outline fringe around hands/armour; keep it small, belt-line strips are only 3-4px thick.
    im = Image.fromarray((alpha * 255).astype(np.uint8))
    opened = np.asarray(im.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))).astype(np.float32) / 255
    alpha = np.minimum(alpha, opened)
    skin = a[..., 3] * smooth(10, 13, h) * (1 - smooth(23, 27, h)) * smooth(0.60, 0.70, v) * (1 - smooth(0.60, 0.70, s))
    # Fill: worn/rust-coloured leather inside a mostly-leather neighbourhood fails the strict test
    # (hue 13-20, but still saturated, unlike skin; bronze and horse are not surrounded by leather).
    loose = a[..., 3] * (1 - smooth(20, 22, h)) * smooth(0.55, 0.65, s) * smooth(0.10, 0.18, v) * (1 - smooth(0.80, 0.92, v))
    for _ in range(2):
        density = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(4))).astype(np.float32) / 255
        alpha = np.maximum(alpha, loose * smooth(0.55, 0.70, density) * (1 - skin))
    # Dark outline pixels hugging skin are reddish too; drop dark ones within 2px of lit skin.
    skin_near = np.asarray(Image.fromarray((skin * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))).astype(np.float32) / 255
    alpha = alpha * (1 - (skin_near > 0.5) * (1 - smooth(0.28, 0.40, v)))
    # Near skin leather must be thick (a sleeve), not a thin sliver (fingertip shading).
    thick = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))).astype(np.float32) / 255
    near_wide = np.asarray(Image.fromarray((skin * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))).astype(np.float32) / 255
    return np.where(near_wide > 0.5, np.minimum(alpha, thick), alpha)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview')
    ap.add_argument('--only')
    args = ap.parse_args()
    manifest_path = os.path.join(OUT, 'manifest.json')
    man = json.load(open(manifest_path))
    for u in man['units']:
        for sh in u['sheets']:
            target = sh['mask'].split('?')[0]
            if args.only and target != args.only:
                continue
            src = os.path.normpath(os.path.join(OUT, sh['source']))
            img = Image.open(src).convert('RGBA')
            src_alpha = np.asarray(img).astype(np.float32)[..., 3] / 255
            auto = leather_alpha(img)
            alpha = apply_correction(auto, src_alpha, target)
            def save(a, path):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                m = np.dstack([np.full(a.shape, 255, np.uint8)] * 3 + [(a * 255 + .5).astype(np.uint8)])
                Image.fromarray(m, 'RGBA').save(path)
            save(auto, os.path.join(AUTO, target))
            save(alpha, os.path.join(OUT, target))
            sh['maskedPixels'] = int((alpha >= .5).sum())
            if args.preview:
                bg = Image.new('RGBA', img.size, (70, 70, 70, 255)); bg.alpha_composite(img)
                ov = bg.copy(); ov.paste(Image.new('RGBA', img.size, (255, 0, 255, 255)), mask=Image.fromarray((alpha * 255).astype(np.uint8)))
                os.makedirs(args.preview, exist_ok=True)
                ov.convert('RGB').save(os.path.join(args.preview, u['name'] + '_' + os.path.basename(target).split('.')[0] + '.png'))
            print(u['name'], os.path.basename(target), sh['maskedPixels'])
    if not args.only:
        man['revision'] = 'hue-leather-v4'
        man['scope'] = 'Leather tunic, sleeves and belt: colour detection plus hand-painted corrections.'
    with open(manifest_path, 'w') as f:
        json.dump(man, f, indent=2); f.write('\n')


if __name__ == '__main__':
    main()
