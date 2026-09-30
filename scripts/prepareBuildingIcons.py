"""Prepare runtime building cutouts without changing the artist's originals.

Requires Pillow. Run from any directory with: python scripts/prepareBuildingIcons.py
Prefer corrected top-down artwork. Preserve authored transparency; for opaque
originals, remove only near-black pixels connected to the outside of the canvas.
"""

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "Art" / "Building Icons"
OUTPUT = ART / "_prepared" / "StoneAge"
FOLDERS = {
    "city": "City",
    "factory": "Factory",
    "port": "Port",
    "barracks": "Barracks",
    "archery": "Archery Range",
    "stables": "Stables",
}
BLACK_THRESHOLD = 12
ICON_SIZE = 384


def remove_backdrop(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    red, green, blue, alpha = rgba.split()
    brightest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    eligible = brightest.point(lambda value: 255 if value <= BLACK_THRESHOLD else 0)
    # One padded perimeter connects every exterior region in a single flood fill.
    padded = Image.new("L", (rgba.width + 2, rgba.height + 2), 255)
    padded.paste(eligible, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)
    exterior = padded.crop((1, 1, rgba.width + 1, rgba.height + 1)).point(
        lambda value: 255 if value == 128 else 0
    )
    rgba.putalpha(ImageChops.subtract(alpha, exterior))
    return rgba


def verify_algorithm() -> None:
    sample = Image.new("RGB", (9, 9), (2, 1, 0))
    draw = ImageDraw.Draw(sample)
    draw.rectangle((2, 2, 6, 6), fill=(120, 90, 40))
    draw.rectangle((3, 3, 5, 5), fill=(0, 0, 0))
    result = remove_backdrop(sample)
    assert result.getpixel((0, 0))[3] == 0
    assert result.getpixel((4, 4)) == (0, 0, 0, 255), "Enclosed dark detail lost"
    assert result.getpixel((2, 2)) == (120, 90, 40, 255)


def main() -> None:
    verify_algorithm()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {"size": ICON_SIZE, "blackThreshold": BLACK_THRESHOLD, "icons": {}}
    for kind, folder in FOLDERS.items():
        corrected = ART / folder / "Top-Down-Correction"
        source_folder = corrected if corrected.is_dir() else ART / folder
        sources = sorted(source_folder.glob("*StoneAge*.png"))
        if not sources:
            print(f"{kind}: source not present; existing glyph remains available")
            continue
        if len(sources) != 1:
            raise ValueError(f"Expected one Stone Age source in {folder}, found {sources}")
        source_path = sources[0]
        with Image.open(source_path) as source:
            rgba = source.convert("RGBA")
            authored_transparency = rgba.getchannel("A").getextrema()[0] < 255
            cutout = rgba if authored_transparency else remove_backdrop(rgba)
            bounds = cutout.getchannel("A").getbbox()
            if bounds is None:
                raise ValueError(f"No visible artwork in {source_path}")
            cropped = cutout.crop(bounds)
            # Consistent square canvas, with a small margin and no distortion.
            cropped.thumbnail((ICON_SIZE - 24, ICON_SIZE - 24), Image.Resampling.LANCZOS)
            icon = Image.new("RGBA", (ICON_SIZE, ICON_SIZE))
            icon.paste(cropped, ((ICON_SIZE - cropped.width) // 2, (ICON_SIZE - cropped.height) // 2))
            output_path = OUTPUT / f"{kind}.png"
            icon.save(output_path, optimize=True)
            manifest["icons"][kind] = {
                "source": source_path.relative_to(ROOT).as_posix(),
                "sourceSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
                "transparency": "authored" if authored_transparency else "exterior-black-removed",
                "sourceBounds": list(bounds),
                "outputSha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
            }
            print(f"{kind}: transparent {ICON_SIZE}px icon; source bounds {bounds}")
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
