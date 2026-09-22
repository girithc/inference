"""YuE2-3B music generation inference on Modal.

Model: m-a-p/YuE2-3B (CC-BY-NC-4.0 license, research/non-commercial use).
Verified: https://huggingface.co/m-a-p/YuE2-3B

Uses the official inference package exactly as documented in the repo
README: install ``yue2_infer-0.1.5-py3-none-any.whl`` from the repo, then
``YuE2Pipeline.from_pretrained("m-a-p/YuE2-3B", device="cuda")`` and call
``pipe(style=..., lyrics=..., cot=..., seed=...)``. The pipeline returns a
song object with ``.save(path)``.

Deploy:  modal deploy modal_app/yue_music.py
"""

import os
import tempfile
from typing import Optional

import modal
from fastapi import Response

from .common import (
    YUE2_ID,
    base_image,
    ensure_model,
    hf_secret,
    volume,
)

app = modal.App("yue-music")

YUE2_WHEEL = "yue2_infer-0.1.5-py3-none-any.whl"

# Install the official YuE2 inference wheel at image build time.
yue_image = base_image.run_commands(
    f"hf download {YUE2_ID} {YUE2_WHEEL} --local-dir /tmp/yue2",
    f"pip install /tmp/yue2/{YUE2_WHEEL}",
)


@app.cls(
    image=yue_image,
    gpu="A100-80GB",  # README requires a 24GB+ BF16-capable GPU
    volumes={"/models": volume()},
    secrets=[hf_secret()],
    timeout=1800,
)
class YuEMusic:
    @modal.enter()
    def load(self):
        from yue2 import YuE2Pipeline

        local_dir = ensure_model(YUE2_ID)
        # progress=False keeps container logs clean.
        self.pipe = YuE2Pipeline.from_pretrained(
            local_dir, device="cuda", progress=False
        )

    @modal.method()
    def compose(
        self,
        style: str,
        lyrics: str,
        cot: str = "full",  # "full" | "melody" | "off"
        seed: Optional[int] = None,
        cfg_scale: float = 1.2,
    ) -> bytes:
        song = self.pipe(
            style=style,
            lyrics=lyrics,
            cot=cot,
            seed=seed if seed is not None else 0,
            cfg_scale=cfg_scale,
        )
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, "song.flac")
            song.save(out_path)
            with open(out_path, "rb") as f:
                return f.read()


@app.function(image=base_image)
@modal.web_endpoint(method="POST", docs=True)
def generate(item: dict):
    """POST {"style": ..., "lyrics": ...} -> audio/flac bytes."""
    style: Optional[str] = item.get("style")
    lyrics: Optional[str] = item.get("lyrics")
    if not style or not lyrics:
        return {"error": "both 'style' and 'lyrics' are required"}
    audio = YuEMusic().compose.remote(
        style,
        lyrics,
        cot=item.get("cot", "full"),
        seed=item.get("seed"),
        cfg_scale=float(item.get("cfg_scale", 1.2)),
    )
    return Response(content=audio, media_type="audio/flac")
