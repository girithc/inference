"""Qwen-Image-2.1 text-to-image inference on Modal.

Model: Qwen/Qwen-Image-2.1 (diffusers pipeline: QwenImage21Pipeline).
Verified: https://huggingface.co/Qwen/Qwen-Image-2.1
Note: ships under the Qwen license (see repo), not Apache-2.0.

Deploy:  modal deploy modal_app/qwen_image.py
"""

import io
from typing import Optional

import modal
from fastapi import Response

from .common import (
    QWEN_IMAGE_ID,
    base_image,
    ensure_model,
    hf_secret,
    volume,
)

app = modal.App("qwen-image")


@app.cls(
    image=base_image,
    gpu="A100-80GB",
    volumes={"/models": volume()},
    secrets=[hf_secret()],
    timeout=900,
)
class QwenImage:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImage21Pipeline

        local_dir = ensure_model(QWEN_IMAGE_ID)
        self.pipe = QwenImage21Pipeline.from_pretrained(
            local_dir, torch_dtype=torch.bfloat16
        )
        # Offload to fit comfortably alongside the text encoder on one GPU.
        self.pipe.enable_model_cpu_offload()

    @modal.method()
    def render(
        self,
        prompt: str,
        negative_prompt: Optional[str] = None,
        width: int = 1024,
        height: int = 1024,
        num_inference_steps: int = 40,
        guidance_scale: float = 4.0,
        seed: Optional[int] = None,
    ) -> bytes:
        import torch

        generator = (
            torch.Generator(device="cuda").manual_seed(seed)
            if seed is not None
            else None
        )
        image = self.pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            generator=generator,
        ).images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()


@app.function(image=base_image)
@modal.web_endpoint(method="POST", docs=True)
def generate(item: dict):
    """POST {"prompt": ...} -> image/png bytes."""
    prompt: Optional[str] = item.get("prompt")
    if not prompt:
        return {"error": "prompt is required"}
    png = QwenImage().render.remote(
        prompt,
        negative_prompt=item.get("negative_prompt"),
        width=int(item.get("width", 1024)),
        height=int(item.get("height", 1024)),
        num_inference_steps=int(item.get("num_inference_steps", 40)),
        guidance_scale=float(item.get("guidance_scale", 4.0)),
        seed=item.get("seed"),
    )
    return Response(content=png, media_type="image/png")
