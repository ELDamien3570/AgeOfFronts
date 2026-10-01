"""Audit runtime art without modifying authored sources or generated images."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "Art/Runtime/Ages"
manifest = json.loads((RUNTIME / "manifest.json").read_text())
errors, stale, entries = [], [], []
for key, asset in manifest.items():
    files = set(filter(None, [asset.get("file"), asset.get("poster")]))
    files.update(c["file"] for c in asset.get("clips", {}).values())
    for name in sorted(files):
        path = RUNTIME / name
        if not path.is_file():
            errors.append(f"{key}: missing runtime file {name}")
            continue
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            clip = next((c for c in asset.get("clips", {}).values() if c["file"] == name), None)
            expected = (clip["columns"] * 128, ((clip["frames"] + clip["columns"] - 1) // clip["columns"]) * 128) if clip else (128, 128)
            if image.size != expected or image.mode != "RGBA":
                errors.append(f"{key}: {name} is {image.size}/{image.mode}, expected {expected}/RGBA")
    hashes = dict(asset.get("hashes", {}))
    if asset.get("metadataHash"):
        hashes[asset["source"]] = asset["metadataHash"]
    if asset.get("hash"):
        hashes[asset["source"]] = asset["hash"]
    if asset.get("portraitHash"):
        hashes[asset["portraitSource"]] = asset["portraitHash"]
    for name, expected in hashes.items():
        path = ROOT / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            stale.append(f"{key}: source changed or missing: {name}")
    source = ROOT / asset.get("source", "")
    if source.suffix == ".json" and source.is_file():
        authored = json.loads(source.read_text()).get("animations", {})
        for name, clip in asset.get("clips", {}).items():
            definition = authored.get(name, {})
            if len(definition.get("frames", [])) != clip["frames"]:
                stale.append(f"{key}: {name} frame count changed")
            if definition.get("suggestedFramesPerSecond", 8) != clip["fps"] or definition.get("loop", True) != clip["loop"]:
                stale.append(f"{key}: {name} playback metadata changed")
    entries.append({"id": key, "clips": list(asset.get("clips", {})), "source": asset.get("source"), "files": len(files)})
report = {"definitions": len(entries), "runtimePngMiB": round(sum(p.stat().st_size for p in RUNTIME.glob("*.png")) / 1048576, 2), "errors": errors, "staleSources": stale, "entries": entries}
output = ROOT / "build/review/docs/art-audit.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k:v for k,v in report.items() if k != "entries"}, indent=2))
raise SystemExit(1 if errors or stale else 0)
