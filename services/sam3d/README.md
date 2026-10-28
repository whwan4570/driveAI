# SAM 3D Objects stage

This is a separate Linux/NVIDIA GPU stage. Set up the [official SAM 3D Objects repository](https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md) and checkpoint first; its documented setup needs at least 32 GB of VRAM. The Carmori backend and web app do not need those GPU dependencies.

```bash
python services/sam3d/generate_splat.py \
  --vehicle-id VEHICLE_ID \
  --api-base http://127.0.0.1:8000 \
  --sam3d-root /path/to/sam-3d-objects \
  --output-dir /path/to/output
```

The script reads Carmori's already generated transparent vehicle cutout. It passes the RGB image and alpha mask to the official `Inference` API and writes `vehicle_splat.ply`, `source.png`, `mask.png`, and a manifest. No raw car photo is required for this path.

**The PLY is not yet a Status asset.** The official quick start exports a Gaussian splat PLY. Carmori's current `<model-viewer>` accepts GLB. A separate, visually reviewed mesh/texture export and orientation step must produce a real GLB before publishing it with `PUT /vehicles/{id}/3d-model` (`Content-Type: model/gltf-binary`). Renaming the PLY does not convert it. The API rejects non-GLB data. Until then, Status retains the labelled illustrative 3D car.
