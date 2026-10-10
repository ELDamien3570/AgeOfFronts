"""Classical Age infantry pass: grow each auto mask into solid, leather-hued pixels (hue < 16, saturated,
not skin) that sit within ~10px of confirmed leather. Written as GREEN correction strokes so the painter
shows them and the build re-applies them. Cavalry is NOT processed here (horse/saddle share the hue).
    python scripts/maskPainter/classicalGrow.py [--dry-run] [--cavalry|--fallen|--druzhina|--druzhina-death] [Unit ...]
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from buildRussianBronzeAgeLeatherMasks import smooth, rgb_to_hsv

OUT = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'ClassicalAge'))
UNITS = ('RecurveArcher', 'Pikeman', 'ShieldWarrior')
CAVALRY = ('LightCavalry', 'HorseArcher')   # riding sheets only, short reach, rider-torso box (frame-local)
CAV_REACH, CAV_BOX = 11, (150, 160, 360, 300)


def filt(mask, f):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(f)) > 127


def grow(rgba, auto, reach=21, box=None, hue_max=16, v_max=.8, passes=1):
    a = rgba.astype(np.float32) / 255
    h, s, v = rgb_to_hsv(a[..., :3]); h = np.where(h > 180, h - 360, h)
    skin = smooth(10, 13, h) * (1 - smooth(23, 27, h)) * smooth(0.60, 0.70, v) * (1 - smooth(0.60, 0.70, s))
    cand = (a[..., 3] > .5) & (h < hue_max) & (s > .5) & (v > .1) & (v < v_max) & (skin < .5)
    strong = auto >= .5
    both = strong
    for _ in range(passes):          # each pass reaches `reach` px further from what is confirmed so far
        both = both | (cand & filt(both, ImageFilter.MaxFilter(reach)))
    grown = both & ~strong
    both = strong | grown
    solid = np.asarray(Image.fromarray((both * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))) > 127
    out = grown & solid
    if box is not None:  # (x0, y0, x1, y1) in frame-local pixels, applied to every 512px frame
        keep = np.zeros_like(out)
        for fy in range(0, out.shape[0], 512):
            for fx in range(0, out.shape[1], 512):
                keep[fy + box[1]:fy + box[3], fx + box[0]:fx + box[2]] = True
        out &= keep
    return out


# Early Medieval Druzhina: cloak is wider than the 10px single-pass reach of the build's warm-highlight rule, so grow in passes.
DRUZHINA_ARGS = dict(reach=21, box=(120, 40, 420, 255), hue_max=16, v_max=.92, passes=3)

# Druzhina Death-Together frames 3-5 (rider lying on the horse): close holes in the cloak band.
DRUZHINA_DEATH = dict(frames=(3, 4, 5), args=dict(reach=21, box=(130, 235, 300, 310), hue_max=16, v_max=.92, passes=3))

# Fallen riders: the whole tunic is cloth but half of it is orange-brown; loose rule inside the tunic box only.
FALLEN = {('HorseArcher', 'Death-Together-v1.png'): (3, 4, 5), ('LightCavalry', 'Death-Together-v2.png'): (3, 4, 5)}
FALLEN_BOX = (105, 215, 265, 300)


def fallen_fill(rgba, frames):
    a = rgba.astype(np.float32) / 255
    h, s, v = rgb_to_hsv(a[..., :3]); h = np.where(h > 180, h - 360, h)
    skin = smooth(10, 13, h) * (1 - smooth(23, 27, h)) * smooth(0.60, 0.70, v) * (1 - smooth(0.60, 0.70, s))
    loose = (a[..., 3] > .5) & (h < 21.5) & (s > .55) & (v > .1) & (v < .9) & (skin < .5)
    solid = np.asarray(Image.fromarray((loose * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))) > 127
    out = np.zeros_like(loose)
    cols = rgba.shape[1] // 512
    for f in frames:
        x0, y0 = (f % cols) * 512, (f // cols) * 512
        out[y0 + FALLEN_BOX[1]:y0 + FALLEN_BOX[3], x0 + FALLEN_BOX[0]:x0 + FALLEN_BOX[2]] = True
    keep = loose & solid & out
    # Only large tunic pieces: stray flecks on the saddle strap / weapon shaft inside the box are dropped.
    seen = np.zeros_like(keep); H, W = keep.shape; result = np.zeros_like(keep)
    for sy, sx in zip(*np.nonzero(keep)):
        if seen[sy, sx]: continue
        q = [(int(sy), int(sx))]; seen[sy, sx] = True
        for y, x in q:
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and keep[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; q.append((ny, nx))
        if len(q) >= 500:
            ys, xs = zip(*q); result[ys, xs] = True
    return result


def death_frames(mask, frames):
    keep = np.zeros_like(mask); cols = mask.shape[1] // 512
    for f in frames:
        keep[(f // cols) * 512:(f // cols + 1) * 512, (f % cols) * 512:(f % cols + 1) * 512] = True
    return mask & keep


def main():
    dry = '--dry-run' in sys.argv
    druz = '--druzhina' in sys.argv
    druzdeath = '--druzhina-death' in sys.argv
    fallen = '--fallen' in sys.argv
    cav = '--cavalry' in sys.argv
    only = [x for x in sys.argv[1:] if not x.startswith('--')] or (('Druzhina',) if (druz or druzdeath) else CAVALRY if (cav or fallen) else UNITS)
    man = json.load(open(os.path.join(OUT, 'manifest.json')))
    for u in man['units']:
        if u['name'] not in only or u['name'] not in (('Druzhina',) if (druz or druzdeath) else CAVALRY if (cav or fallen) else UNITS): continue
        for sh in u['sheets']:
            if fallen and (u['name'], sh['file']) not in FALLEN: continue
            if druzdeath and sh['file'] != 'Death-Together-v1.png': continue
            if (cav or druz) and not fallen and not druzdeath and 'death' in sh['file'].lower(): continue
            target = sh['mask'].split('?')[0]
            src = np.asarray(Image.open(os.path.normpath(os.path.join(OUT, sh['source']))).convert('RGBA'))
            auto = np.asarray(Image.open(os.path.join(OUT, 'AutoDetected', target)))[..., 3].astype(np.float32) / 255
            add = (death_frames(grow(src, auto, **DRUZHINA_DEATH['args']), DRUZHINA_DEATH['frames'])) if druzdeath else grow(src, auto, **DRUZHINA_ARGS) if druz else fallen_fill(src, FALLEN[(u['name'], sh['file'])]) if fallen else (grow(src, auto, CAV_REACH, CAV_BOX) if cav else grow(src, auto))
            cpath = os.path.join(OUT, 'Corrections', target.replace('.faction-mask.png', '.correction.png'))
            corr = np.asarray(Image.open(cpath).convert('RGBA')).copy() if os.path.exists(cpath) else np.zeros(src.shape, np.uint8)
            new = add & (corr[..., 3] == 0)
            print(u['name'], sh['file'], 'would add' if dry else 'adding', int(new.sum()))
            if not dry and new.any():
                corr[new] = (0, 255, 0, 255)
                os.makedirs(os.path.dirname(cpath), exist_ok=True)
                Image.fromarray(corr, 'RGBA').save(cpath)


if __name__ == '__main__':
    main()
