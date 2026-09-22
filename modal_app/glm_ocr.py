"""GLM-OCR inference on Modal.

Model: zai-org/GLM-OCR (0.9B multimodal OCR, MIT license).
Verified: https://huggingface.co/zai-org/GLM-OCR

Serves the transformers path documented for GLM-OCR
(see transformers docs: model_doc/glm_ocr.md). GLM-OCR is prompt-limited:
use one of "Text Recognition:", "Formula Recognition:" or
"Table Recognition:" as the prompt (default: text).

Deploy:  modal deploy modal_app/glm_ocr.py
"""

import io
from typing import Optional

import modal
import requests
from PIL import Image

from .common import (
    GLM_OCR_ID,
    base_image,
    ensure_model,
    hf_secret,
    volume,
)

app = modal.App("glm-ocr")

PROMPTS = {
    "text": "Text Recognition:",
    "formula": "Formula Recognition:",
    "table": "Table Recognition:",
}


@app.cls(
    image=base_image,
    gpu="A100",
    volumes={"/models": volume()},
    secrets=[hf_secret()],
    timeout=600,
)
class GLMOCR:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        local_dir = ensure_model(GLM_OCR_ID)
        self.processor = AutoProcessor.from_pretrained(
            local_dir, trust_remote_code=True
        )
        self.model = AutoModelForImageTextToText.from_pretrained(
            local_dir,
            torch_dtype=torch.bfloat16,
            device_map="auto",
            trust_remote_code=True,
        )
        self.model.eval()

    @modal.method()
    def extract(self, image_url: str, task: str = "text", max_new_tokens: int = 2048) -> str:
        import torch

        prompt_text = PROMPTS.get(task, PROMPTS["text"])
        image = Image.open(
            io.BytesIO(requests.get(image_url, timeout=60).content)
        ).convert("RGB")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image_url},
                    {"type": "text", "text": prompt_text},
                ],
            }
        ]
        text = self.processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = self.processor(
            text=[text], images=[image], return_tensors="pt"
        ).to(self.model.device, torch.bfloat16)

        with torch.inference_mode():
            generated = self.model.generate(
                **inputs, max_new_tokens=max_new_tokens, do_sample=False
            )
        # Strip the prompt tokens from the output.
        gen_tokens = generated[0][inputs["input_ids"].shape[1]:]
        return self.processor.decode(gen_tokens, skip_special_tokens=True).strip()


@app.function(image=base_image)
@modal.web_endpoint(method="POST", docs=True)
def ocr(item: dict) -> dict:
    """POST {"image_url": ..., "task": "text|formula|table"} -> {"text": ...}"""
    image_url: Optional[str] = item.get("image_url")
    if not image_url:
        return {"error": "image_url is required"}
    text = GLMOCR().extract.remote(
        image_url,
        task=item.get("task", "text"),
        max_new_tokens=int(item.get("max_new_tokens", 2048)),
    )
    return {"model": GLM_OCR_ID, "task": item.get("task", "text"), "text": text}
