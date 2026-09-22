"""Qwen3.8-27B chat inference on Modal (OpenAI-compatible).

Model: Qwen/Qwen3.8-27B (Apache-2.0, multimodal image-text-to-text).
Verified: https://huggingface.co/Qwen/Qwen3.8-27B

Serves an OpenAI-style /v1/chat/completions endpoint on transformers
(AutoModelForImageTextToText, device_map=auto). Swap the loader for vLLM
once your vLLM build supports the qwen3_5 architecture.

Deploy:  modal deploy modal_app/qwen3_27b.py
"""

import io
import time
import uuid
from typing import Optional

import modal
import requests
from PIL import Image

from .common import (
    QWEN_27B_ID,
    base_image,
    ensure_model,
    hf_secret,
    volume,
)

app = modal.App("qwen3-27b")


@app.cls(
    image=base_image,
    gpu="A100-80GB",
    volumes={"/models": volume()},
    secrets=[hf_secret()],
    timeout=900,
)
class QwenChat:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        local_dir = ensure_model(QWEN_27B_ID)
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
    def chat(
        self,
        messages: list,
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> str:
        import torch

        # Resolve image_url parts into PIL images for the processor.
        resolved = []
        for m in messages:
            content = m.get("content", "")
            if isinstance(content, list):
                parts = []
                for part in content:
                    if part.get("type") == "image_url":
                        url = part["image_url"]["url"]
                        img = Image.open(
                            io.BytesIO(requests.get(url, timeout=60).content)
                        ).convert("RGB")
                        parts.append({"type": "image", "image": img})
                    else:
                        parts.append(part)
                resolved.append({"role": m.get("role", "user"), "content": parts})
            else:
                resolved.append(m)

        text = self.processor.apply_chat_template(
            resolved, tokenize=False, add_generation_prompt=True
        )
        images = [
            p["image"]
            for m in resolved
            if isinstance(m.get("content"), list)
            for p in m["content"]
            if p.get("type") == "image"
        ] or None
        inputs = self.processor(
            text=[text], images=images, return_tensors="pt"
        ).to(self.model.device)

        do_sample = temperature > 0
        with torch.inference_mode():
            generated = self.model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                do_sample=do_sample,
                temperature=temperature if do_sample else None,
            )
        gen_tokens = generated[0][inputs["input_ids"].shape[1]:]
        return self.processor.decode(gen_tokens, skip_special_tokens=True).strip()


@app.function(image=base_image)
@modal.web_endpoint(method="POST", docs=True)
def chat_completions(item: dict) -> dict:
    """OpenAI-compatible chat completions.

    POST {"messages": [{"role": "user", "content": "..."}],
          "max_tokens": 1024, "temperature": 0.7}
    """
    messages = item.get("messages")
    if not messages:
        return {"error": "'messages' is required"}
    content = QwenChat().chat.remote(
        messages,
        max_tokens=int(item.get("max_tokens", 1024)),
        temperature=float(item.get("temperature", 0.7)),
    )
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": item.get("model", QWEN_27B_ID),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {},
    }


# Alias so clients can POST to a /v1/chat/completions-shaped path too.
@app.function(image=base_image)
@modal.web_endpoint(method="POST", docs=True)
def v1_chat_completions(item: dict) -> dict:
    return chat_completions.local(item)
