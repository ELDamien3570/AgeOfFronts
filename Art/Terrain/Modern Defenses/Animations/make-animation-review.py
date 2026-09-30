"""Create a review GIF from the exported animation frames, using one palette."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
BACKGROUND = (28, 40, 32)
FONT_PATH = 'C:/Windows/Fonts/segoeui.ttf'
TITLE = ImageFont.truetype(FONT_PATH, 23)
LABEL = ImageFont.truetype(FONT_PATH, 16)
SMALL = ImageFont.truetype(FONT_PATH, 13)
PANELS = [('AntiInfantry', 'firing', 'Machine gun · firing'),
          ('AntiAir', 'firing', 'Quad AA · firing'),
          ('AntiInfantry', 'tracking', 'Machine gun · tracking'),
          ('AntiAir', 'tracking', 'Quad AA · tracking')]
catalog = {}
for asset, motion, _ in PANELS:
    metadata = json.loads((ROOT / asset / 'N/animations.json').read_text())
    animation = metadata['animations'][motion]
    catalog[asset, motion] = (animation, Image.open(ROOT / asset / 'N' / animation['file']).convert('RGBA'))
ground = Image.open(ROOT.parent / 'preview-ground.png').convert('RGB')

def review_frame(time_seconds):
    image = Image.new('RGB', (600, 680), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.text((20, 12), 'Modern gun nests', fill='#edf1e9', font=TITLE)
    draw.text((20, 43), 'Original painted layers · stationary pits · north facing', fill='#b6c4b9', font=SMALL)
    for index, (asset, motion, label) in enumerate(PANELS):
        x = 20 + (index % 2) * 292
        y = 78 + (index // 2) * 292
        draw.text((x, y), label, fill='#e2c891', font=LABEL)
        animation, sheet = catalog[asset, motion]
        frame_index = int(time_seconds * animation['suggestedFramesPerSecond']) % animation['frameCount']
        rect = animation['frames'][frame_index]
        sprite = sheet.crop((rect['x'], rect['y'], rect['x'] + rect['width'], rect['y'] + rect['height']))
        tile = ground.resize((256, 256), Image.Resampling.LANCZOS).convert('RGBA')
        tile.alpha_composite(sprite.resize(tile.size, Image.Resampling.LANCZOS))
        image.paste(tile.convert('RGB'), (x, y + 25))
    draw.text((20, 665), 'Firing: 500 rounds/min per barrel  |  Tracking: smooth traverse', fill='#b6c4b9', font=SMALL)
    return image

# A common palette prevents static scenery from changing color between GIF frames.
samples = [review_frame(time) for time in (0, .02, .04, .5, 1.5)]
palette_source = Image.new('RGB', (600, 680 * len(samples)))
for index, sample in enumerate(samples):
    palette_source.paste(sample, (0, index * 680))
palette = palette_source.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
frames = [review_frame(index / 50).quantize(palette=palette, dither=Image.Dither.NONE) for index in range(100)]
frames[0].save(ROOT / 'Gun_Animation_Review.gif', save_all=True, append_images=frames[1:],
               duration=20, loop=0, disposal=1, optimize=False)
samples[0].save(ROOT / 'Gun_Animation_Review.png')
poses = Image.new('RGB', (1200, 680), BACKGROUND)
poses.paste(review_frame(.5), (0, 0))
poses.paste(review_frame(1.5), (600, 0))
poses.save(ROOT / 'Gun_Animation_Pose_Review.png')
with Image.open(ROOT / 'Gun_Animation_Review.gif') as encoded:
    duration = 0
    for index in range(encoded.n_frames):
        encoded.seek(index)
        duration += encoded.info['duration']
    assert duration == 2000 and encoded.info['loop'] == 0
    print(json.dumps({'gif': str(ROOT / 'Gun_Animation_Review.gif'), 'sampledFrames': len(frames),
                      'encodedFrames': encoded.n_frames, 'durationSeconds': duration / 1000,
                      'palette': 'one shared 256-color palette',
                      'note': 'The GIF encoder merges identical consecutive frames, preserving their duration.'}))
