"""Procedural top-down hoplite, 6-frame walk cycle (Pillow only).

Rigged: every body part is drawn in its own layer and moved per frame by a simple
walk cycle. Drawn at 4x and downsampled for clean edges. Red parts (crest, chiton,
shield device) use hues that the team-mask tool in ../make_demo.py can pick up.

FACING = "down" matches the existing Javelinist/Clubman sheets (soldier walks toward
the bottom of the image, light from top-left). "up" gives the conventional north-facing
sprite.  Run:  python make_hoplite.py
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = 6
SIZE = 256            # output cell
SS = 4                # supersample
FACING = "down"
FRAME_MS = 120

# palette ---------------------------------------------------------------
OUTLINE = (34, 22, 16)
SKIN = (214, 160, 122)
SKIN_D = (168, 112, 82)
BRONZE = (205, 150, 62)
BRONZE_D = (120, 78, 28)
BRONZE_L = (255, 224, 140)
RED = (176, 32, 30)
RED_D = (104, 16, 20)
RED_L = (226, 74, 58)
LINEN = (226, 214, 184)
LINEN_D = (160, 146, 118)
LEATHER = (96, 60, 34)
WOOD = (150, 104, 56)
WOOD_D = (92, 60, 30)
STEEL = (196, 202, 210)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


class Canvas:
    """One RGBA layer in supersampled space with 256-unit drawing coordinates."""

    def __init__(self, light):
        self.im = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.light = light  # unit-ish vector pointing TOWARD the light

    def _s(self, v):
        return v * SS

    def ellipse(self, cx, cy, rx, ry, dark, light, outline=True, steps=14, rot=0):
        """Dome-shaded ellipse: concentric rings drifting toward the light."""
        tmp = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(tmp)
        if outline:
            d.ellipse([self._s(cx - rx - 1.6), self._s(cy - ry - 1.6),
                       self._s(cx + rx + 1.6), self._s(cy + ry + 1.6)], fill=OUTLINE + (255,))
        for k in range(steps):
            t = k / (steps - 1)
            f = 1 - t * 0.78
            ox = self.light[0] * t * rx * 0.30
            oy = self.light[1] * t * ry * 0.30
            col = lerp(dark, light, t ** 0.9)
            d.ellipse([self._s(cx + ox - rx * f), self._s(cy + oy - ry * f),
                       self._s(cx + ox + rx * f), self._s(cy + oy + ry * f)], fill=col + (255,))
        if rot:
            tmp = tmp.rotate(rot, center=(self._s(cx), self._s(cy)), resample=Image.BICUBIC)
        self.im.alpha_composite(tmp)

    def capsule(self, x0, y0, x1, y1, w, col, outline=True, hi=None):
        tmp = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(tmp)
        if outline:
            d.line([(self._s(x0), self._s(y0)), (self._s(x1), self._s(y1))],
                   fill=OUTLINE + (255,), width=int(self._s(w + 3.2)))
            for (x, y) in ((x0, y0), (x1, y1)):
                r = (w + 3.2) / 2
                d.ellipse([self._s(x - r), self._s(y - r), self._s(x + r), self._s(y + r)], fill=OUTLINE + (255,))
        d.line([(self._s(x0), self._s(y0)), (self._s(x1), self._s(y1))], fill=col + (255,), width=int(self._s(w)))
        for (x, y) in ((x0, y0), (x1, y1)):
            r = w / 2
            d.ellipse([self._s(x - r), self._s(y - r), self._s(x + r), self._s(y + r)], fill=col + (255,))
        if hi:
            ox, oy = self.light[0] * w * .18, self.light[1] * w * .18
            d.line([(self._s(x0 + ox), self._s(y0 + oy)), (self._s(x1 + ox), self._s(y1 + oy))],
                   fill=hi + (255,), width=max(1, int(self._s(w * .28))))
        self.im.alpha_composite(tmp)

    def polygon(self, pts, col, outline=True):
        tmp = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(tmp)
        p = [(self._s(x), self._s(y)) for x, y in pts]
        if outline:
            d.line(p + [p[0]], fill=OUTLINE + (255,), width=int(self._s(2.6)), joint="curve")
        d.polygon(p, fill=col + (255,))
        self.im.alpha_composite(tmp)


def paste_rot(dst, layer, angle, cx, cy, dx=0, dy=0):
    """Rotate a layer about (cx,cy) in 256-space, offset by (dx,dy), composite onto dst."""
    im = layer.im
    if angle:
        im = im.rotate(angle, center=(cx * SS, cy * SS), resample=Image.BICUBIC)
    if dx or dy:
        shifted = Image.new("RGBA", im.size, (0, 0, 0, 0))
        shifted.paste(im, (int(dx * SS), int(dy * SS)))
        im = shifted
    dst.alpha_composite(im)


# ------------------------------------------------------------ body parts ---
def leg(light, x, foot_y, lift):
    c = Canvas(light)
    hip_y = 134
    c.capsule(x, hip_y, x, foot_y, 19, SKIN, hi=lerp(SKIN, (255, 232, 200), .6))
    # bronze greave over the lower leg
    gy0 = hip_y + (foot_y - hip_y) * 0.62
    c.capsule(x, gy0, x, foot_y - (4 if foot_y > hip_y else -4), 17, BRONZE, outline=False,
              hi=BRONZE_L)
    # sandal / foot, bigger when lifted (closer to camera)
    fs = 1 + 0.14 * lift
    fy = foot_y + (13 if foot_y > hip_y else -13)
    c.ellipse(x, fy, 13 * fs, 18 * fs, LEATHER, lerp(LEATHER, (190, 140, 90), .6))
    return c


def torso(light):
    c = Canvas(light)
    # chiton + cloak (team-red body)
    c.ellipse(128, 130, 52, 29, RED_D, RED_L, steps=18)
    # linen pteruges fringe hint at the hip side
    c.ellipse(128, 142, 40, 14, LINEN_D, LINEN, outline=False, steps=8)
    # bronze breastplate seen from above (centre) with shoulder caps
    c.ellipse(128, 128, 34, 21, BRONZE_D, BRONZE_L, steps=14)
    c.ellipse(80, 128, 17, 17, BRONZE_D, BRONZE_L, steps=10)
    c.ellipse(176, 128, 17, 17, BRONZE_D, BRONZE_L, steps=10)
    return c


def shield(light):
    """Aspis: large round bronze shield with a red-and-white device."""
    c = Canvas(light)
    r = 40
    c.ellipse(64, 64, r, r * 1.04, BRONZE_D, lerp(BRONZE, BRONZE_L, .55), steps=20)
    # inner rim ring
    c.ellipse(64, 64, r * .80, r * .83, lerp(BRONZE_D, BRONZE, .4), lerp(BRONZE, BRONZE_L, .35),
              outline=False, steps=12)
    # device: red field with a white lambda-like chevron
    c.ellipse(64, 64, r * .56, r * .58, RED_D, RED_L, outline=False, steps=10)
    c.polygon([(55, 78), (64, 50), (73, 78), (68, 78), (64, 64), (60, 78)], LINEN, outline=False)
    # boss
    c.ellipse(64, 64, 8, 8, BRONZE_D, BRONZE_L, steps=6)
    return c


def spear(light):
    c = Canvas(light)
    x = 64
    c.capsule(x, 16, x, 232, 6.4, WOOD, hi=lerp(WOOD, (230, 190, 130), .5))
    # steel leaf head at the front (top), butt spike at the back
    c.polygon([(x, 0), (x + 7.5, 20), (x, 26), (x - 7.5, 20)], STEEL)
    c.polygon([(x - 3, 222), (x + 3, 222), (x, 238)], BRONZE_D)
    # grip wrap
    c.capsule(x, 112, x, 128, 7.8, LEATHER, outline=False)
    return c


def arm_right(light, hand_x, hand_y):
    c = Canvas(light)
    c.capsule(166, 126, hand_x, hand_y, 15, RED, hi=RED_L)          # sleeve
    c.capsule(hand_x - 2, hand_y + 2, hand_x, hand_y, 12, SKIN, hi=lerp(SKIN, (255, 232, 200), .6))
    return c


def head(light):
    c = Canvas(light)
    # Corinthian helmet from above: bronze dome with a front-to-back horsehair crest
    c.ellipse(128, 126, 25, 29, BRONZE_D, BRONZE_L, steps=18)
    # brow / neck guard flares
    c.ellipse(128, 100, 17, 8, BRONZE_D, BRONZE, outline=True, steps=6)
    c.ellipse(128, 154, 21, 9, BRONZE_D, BRONZE, outline=True, steps=6)
    # crest
    pts = [(120, 100), (136, 100), (139, 126), (136, 156), (120, 156), (117, 126)]
    c.polygon(pts, RED)
    c.polygon([(124, 102), (132, 102), (133, 126), (132, 154), (124, 154), (123, 126)], RED_L, outline=False)
    # bristle ticks along the crest edges
    d = c.d
    for i in range(10):
        y = 104 + i * 5.2
        d.line([(c._s(117), c._s(y)), (c._s(113), c._s(y + 1.5))], fill=RED_D + (255,), width=c._s(1.8).__int__())
        d.line([(c._s(139), c._s(y)), (c._s(143), c._s(y + 1.5))], fill=RED_D + (255,), width=c._s(1.8).__int__())
    return c


def shadow(frame_light):
    sh = Image.new("L", (SIZE * SS, SIZE * SS), 0)
    d = ImageDraw.Draw(sh)
    ox, oy = -frame_light[0] * 9, -frame_light[1] * 9
    d.ellipse([(128 + ox - 66) * SS, (132 + oy - 62) * SS, (128 + ox + 66) * SS, (132 + oy + 62) * SS], fill=95)
    sh = sh.filter(ImageFilter.GaussianBlur(7 * SS))
    out = Image.new("RGBA", sh.size, (6, 8, 4, 0))
    out.putalpha(sh)
    return out


# ------------------------------------------------------------------ cycle --
def render_frame(i, facing=FACING):
    # Draw "facing up". For facing down we rotate 180 at the end and flip the light
    # vector so the highlight lands top-left in the final image.
    light = (-1, -1) if facing == "up" else (1, 1)
    ph = 2 * math.pi * (i + 0.5) / FRAMES
    s = math.sin(ph)
    c = math.cos(ph)

    stride = 42
    left_y = 134 - stride * s       # left foot forward when s > 0
    right_y = 134 + stride * s
    lift_l = max(0.0, c)            # foot travelling forward is the lifted one
    lift_r = max(0.0, -c)

    frame = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
    frame.alpha_composite(shadow(light))

    # legs (back-most first: the one stepping back is under the body)
    for x, y, lf in sorted([(114, left_y, lift_l), (142, right_y, lift_r)], key=lambda t: -t[1]):
        paste_rot(frame, leg(light, x, y, lf), 0, 128, 134)

    bob = 1.6 * abs(math.sin(ph))                 # body drops a touch on each footfall
    sway = 4.0 * s                                # shoulders counter-rotate against stride
    # shield on the left arm; swings back when left leg is forward
    sh = shield(light)
    paste_rot(frame, sh, -sway * 1.2 + 6, 64, 64, dx=70 - 64 + 3 * s, dy=124 - 64 + 8 * s - bob * .5)

    paste_rot(frame, torso(light), sway, 128, 130, dy=bob * .4)

    # spear arm: hand sways a little forward/back with the right leg
    hand_y = 120 - 7 * s
    hand_x = 188
    paste_rot(frame, arm_right(light, hand_x, hand_y), sway * .8, 166, 126, dy=bob * .4)
    paste_rot(frame, spear(light), 1.8 * s, 64, 120, dx=hand_x - 64, dy=hand_y - 120)
    hand = Canvas(light)
    hand.ellipse(hand_x, hand_y, 9, 9, SKIN_D, lerp(SKIN, (255, 232, 200), .5), steps=6)
    paste_rot(frame, hand, 0, 128, 130, dy=bob * .4)

    paste_rot(frame, head(light), -sway * .55, 128, 128, dy=bob * .8)

    out = frame.resize((SIZE, SIZE), Image.LANCZOS)
    if facing == "down":
        out = out.rotate(180)
    return out


def checker_bg(w, h, c1=(60, 66, 54), c2=(70, 78, 62), cell=16):
    im = Image.new("RGB", (w, h), c1)
    d = ImageDraw.Draw(im)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=c2)
    return im.convert("RGBA")


def main():
    frames = [render_frame(i) for i in range(FRAMES)]
    os.makedirs(os.path.join(HERE, "frames"), exist_ok=True)
    for i, f in enumerate(frames):
        f.save(os.path.join(HERE, "frames", f"walk_{i}.png"))

    # sprite sheet, 6 cells in a row (transparent)
    sheet = Image.new("RGBA", (SIZE * FRAMES, SIZE), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * SIZE, 0))
    sheet.save(os.path.join(HERE, "Hoplite_Walk_Sheet.png"))

    # looping previews
    review = []
    for f in frames:
        bg = checker_bg(SIZE, SIZE)
        bg.alpha_composite(f)
        review.append(bg.convert("RGB").resize((SIZE * 2, SIZE * 2), Image.NEAREST))
    review[0].save(os.path.join(HERE, "Hoplite_Walk_Loop.gif"), save_all=True,
                   append_images=review[1:], duration=FRAME_MS, loop=0, optimize=False)
    frames[0].save(os.path.join(HERE, "Hoplite_Walk_Loop.webp"), save_all=True,
                   append_images=frames[1:], duration=FRAME_MS, loop=0, lossless=True)

    # contact strip with game-size reductions for the "does it read?" test
    strip = Image.new("RGB", (SIZE * FRAMES, SIZE + 140), (46, 52, 40))
    for i, f in enumerate(frames):
        bg = checker_bg(SIZE, SIZE)
        bg.alpha_composite(f)
        strip.paste(bg.convert("RGB"), (i * SIZE, 0))
        for k, px in enumerate((64, 48, 32)):
            sm = f.resize((px, px), Image.LANCZOS)
            strip.paste(sm, (i * SIZE + 10 + [0, 76, 134][k], SIZE + 14), sm)
    strip.save(os.path.join(HERE, "Hoplite_Walk_Strip.png"))
    print("done")


if __name__ == "__main__":
    main()
