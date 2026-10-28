"""Run Meta SAM 3D Objects on Carmori's saved, alpha-masked vehicle image.

Run inside the *official* SAM 3D Objects Linux/CUDA environment. This produces
a Gaussian-splat PLY, not a model-viewer GLB. It deliberately does not mark the
vehicle's 3D asset ready; a reviewed mesh/GLB export must happen separately.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image


def load_vehicle_image(api_base: str, vehicle_id: str) -> tuple[dict, bytes]:
    with urlopen(f"{api_base.rstrip('/')}/vehicles/{vehicle_id}", timeout=20) as response:
        vehicle = json.load(response)
    data_url = vehicle.get("generated_image_data_url") or ""
    if not data_url.startswith("data:image/") or ";base64," not in data_url:
        raise ValueError("This vehicle has no generated cutout image yet")
    return vehicle, base64.b64decode(data_url.split(",", 1)[1], validate=True)


def run(vehicle_id: str, api_base: str, sam3d_root: Path, output_dir: Path, seed: int) -> Path:
    vehicle, raw = load_vehicle_image(api_base, vehicle_id)
    from io import BytesIO

    rgba = np.asarray(Image.open(BytesIO(raw)).convert("RGBA"), dtype=np.uint8)
    mask = rgba[:, :, 3] > 127
    coverage = float(mask.mean())
    if not 0.01 < coverage < 0.98:
        raise ValueError("Vehicle image needs a clear transparent cutout mask")

    output_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba).save(output_dir / "source.png")
    Image.fromarray((mask * 255).astype(np.uint8)).save(output_dir / "mask.png")

    # Official repo's notebook/inference.py provides the public Inference API.
    sys.path.insert(0, str(sam3d_root / "notebook"))
    from inference import Inference  # type: ignore[import-not-found]

    checkpoint = sam3d_root / "checkpoints" / "hf" / "pipeline.yaml"
    if not checkpoint.is_file():
        raise FileNotFoundError(f"SAM 3D checkpoint config missing: {checkpoint}")
    inference = Inference(str(checkpoint), compile=False)
    result = inference(rgba[:, :, :3], mask, seed=seed)
    splat = output_dir / "vehicle_splat.ply"
    result["gs"].save_ply(str(splat))
    if not splat.is_file() or splat.stat().st_size == 0:
        raise RuntimeError("SAM 3D produced no splat file")
    manifest = {
        "vehicle_id": vehicle_id,
        "identity": {key: vehicle.get(key) for key in ("year", "make", "model", "trim", "exterior_color")},
        "source_image_sha256": hashlib.sha256(raw).hexdigest(),
        "source_model": "facebookresearch/sam-3d-objects",
        "seed": seed,
        "output_format": "gaussian_splat_ply",
        "splat_file": splat.name,
        "viewer_ready": False,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return splat


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vehicle-id", required=True)
    parser.add_argument("--api-base", default="http://127.0.0.1:8000")
    parser.add_argument("--sam3d-root", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    print(run(args.vehicle_id, args.api_base, args.sam3d_root, args.output_dir, args.seed))


if __name__ == "__main__":
    main()
