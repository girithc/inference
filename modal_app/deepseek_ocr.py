"""DeepSeek-OCR inference on Modal.

Model: deepseek-ai/DeepSeek-OCR (MIT license).
Verified: https://huggingface.co/deepseek-ai/DeepSeek-OCR

Uses the official transformers recipe from the model card:
AutoTokenizer + AutoModel (trust_remote_code=True), then the custom
``model.infer(...)`` entrypoint with the Gundam preset
(base_size=1024, image_size=640, crop_mode=True).

Deploy:  modal deploy modal_app/deepseek_ocr.py
"""

import os
import tempfile
from typing import Optional

import modal
import requests

from .common import (
    DEEPSEEK_OCR_ID,
    base_image,
    ensure_model,
    hf_secret,
    volume,
)

app = modal.App("deepseek-ocr")

# Canonical prompt from the DeepSeek-OCR model card.
DEFAULT_PROMPT = "<image>\n<|grounding|>Convert the document to markdown. "


@app.cls(
    image=base_image,
    gpu="A100",
    volumes={"/models": volume()},
    secrets=[hf_secret()],
    timeout=900,
)
class DeepSeekOCR:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModel, AutoTokenizer

        local_dir = ensure_model(DEEPSEEK_OCR_ID)
        self.tokenizer = AutoTokenizer.from_pretrained(
            local_dir, trust_remote_code=True
        )
        # flash_attention_2 per the official recipe; falls back cleanly if
        # the kernel is unavailable in the container.
        try:
            self.model = AutoModel.from_pretrained(
                local_dir,
                _attn_implementation="flash_attention_2",
                trust_remote_code=True,
                use_safetensors=True,
            )
        except Exception:
            self.model = AutoModel.from_pretrained(
                local_dir, trust_remote_code=True, use_safetensors=True
            )
        self.model = self.model.eval().cuda().to(torch.bfloat16)

    @modal.method()
    def extract(
        self,
        image_url: str,
        prompt: Optional[str] = None,
        base_size: int = 1024,
        image_size: int = 640,
        crop_mode: bool = True,
    ) -> str:
        prompt = prompt or DEFAULT_PROMPT
        with tempfile.TemporaryDirectory() as tmp:
            image_path = os.path.join(tmp, "input.jpg")
            with requests.get(image_url, timeout=60, stream=True) as r:
                r.raise_for_status()
                with open(image_path, "wb") as f:
                    for chunk in r.iter_content(1024 * 256):
                        f.write(chunk)

            # save_results=False: the custom modeling code returns the
            # markdown text directly instead of writing files.
            result = self.model.infer(
                self.tokenizer,
                prompt=prompt,
                image_file=image_path,
                output_path=tmp,
                base_size=base_size,
                image_size=image_size,
                crop_mode=crop_mode,
                save_results=False,
                test_compress=False,
            )
        return result if isinstance(result, str) else str(result)


@app.function(image=base_image)
@modal.web_endpoint(method="POST", docs=True)
def ocr(item: dict) -> dict:
    """POST {"image_url": ..., "prompt": ...} -> {"text": ...}"""
    image_url: Optional[str] = item.get("image_url")
    if not image_url:
        return {"error": "image_url is required"}
    text = DeepSeekOCR().extract.remote(
        image_url,
        prompt=item.get("prompt"),
        base_size=int(item.get("base_size", 1024)),
        image_size=int(item.get("image_size", 640)),
        crop_mode=bool(item.get("crop_mode", True)),
    )
    return {"model": DEEPSEEK_OCR_ID, "text": text}
