"""MiniMax-H3 Singularity image-to-video inference on Modal.

Model: WarmBloodAban/Minimax-h3_Singularity (Apache-2.0).
Verified: https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity

NOTE ON NAMING: this repo was initially scoped as "music generation", but
the verified model card tags the checkpoint as image-to-video
(text-to-video / image-to-video / video-to-video, ComfyUI-format weights),
so this module serves image-to-video. The file is named minimax_video.py
to match what the model actually does.

Implementation: the weights ship as ComfyUI-format safetensors
(Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors), so the endpoint
runs a ComfyUI API server inside the container and drives it through the
standard /prompt + websocket protocol. The workflow JSON below follows the
standard ComfyUI video pattern; validate the sampler node IDs against the
workflow published in the model repo before production use.

Deploy:  modal deploy modal_app/minimax_video.py
"""

import io
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
from typing import Optional

import modal
import requests
from fastapi import Response

from .common import (
    MINIMAX_H3_ID,
    base_image,
    hf_secret,
    volume,
)

app = modal.App("minimax-video")

COMFY_DIR = "/opt/ComfyUI"
CHECKPOINT_FILE = "Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors"
COMFY_HOST = "127.0.0.1"
COMFY_PORT = 8188

comfy_image = (
    base_image.run_commands(
        f"git clone https://github.com/comfyanonymous/ComfyUI {COMFY_DIR}",
        f"pip install -r {COMFY_DIR}/requirements.txt",
    ).pip_install("websocket-client")
)


def _download_checkpoint() -> str:
    """Fetch just the int8 checkpoint into ComfyUI's checkpoints dir."""
    from huggingface_hub import hf_hub_download

    dest_dir = os.path.join(COMFY_DIR, "models", "checkpoints")
    os.makedirs(dest_dir, exist_ok=True)
    return hf_hub_download(
        repo_id=MINIMAX_H3_ID,
        filename=CHECKPOINT_FILE,
        local_dir=dest_dir,
    )


def build_workflow(
    prompt: str,
    negative_prompt: str,
    init_image_name: str,
    width: int,
    height: int,
    frames: int,
    seed: int,
) -> dict:
    """ComfyUI API-format workflow for image-to-video.

    Node IDs mirror the standard ComfyUI video workflow layout; confirm
    sampler node class names against the workflow JSON published with the
    Singularity repo, as MiniMax-H3 nodes may differ from vanilla nodes.
    """
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": CHECKPOINT_FILE},
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["1", 1]},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative_prompt, "clip": ["1", 1]},
        },
        "4": {
            "class_type": "LoadImage",
            "inputs": {"image": init_image_name, "upload": True},
        },
        "5": {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["4", 0], "vae": ["1", 2]},
        },
        "6": {
            "class_type": "VideoSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["5", 0],
                "width": width,
                "height": height,
                "frames": frames,
                "seed": seed,
            },
        },
        "7": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["6", 0], "vae": ["1", 2]},
        },
        "8": {
            "class_type": "SaveVideo",
            "inputs": {"images": ["7", 0], "filename_prefix": "minimax"},
        },
    }


class ComfyClient:
    """Minimal ComfyUI API client (queue_prompt + websocket tracking)."""

    def __init__(self, host: str = COMFY_HOST, port: int = COMFY_PORT):
        self.base = f"http://{host}:{port}"
        self.client_id = str(uuid.uuid4())

    def wait_ready(self, timeout: int = 300) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(
                    f"{self.base}/system_stats", timeout=5
                ) as r:
                    if r.status == 200:
                        return
            except Exception:
                time.sleep(2)
        raise RuntimeError("ComfyUI server did not become ready")

    def upload_image(self, data: bytes, filename: str) -> str:
        import requests as req

        files = {"image": (filename, io.BytesIO(data), "image/png")}
        r = req.post(
            f"{self.base}/upload/image",
            files=files,
            data={"overwrite": "true"},
            timeout=120,
        )
        r.raise_for_status()
        return r.json()["name"]

    def queue(self, workflow: dict) -> str:
        payload = json.dumps(
            {"prompt": workflow, "client_id": self.client_id}
        ).encode()
        req = urllib.request.Request(
            f"{self.base}/prompt",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)["prompt_id"]

    def wait_done(self, prompt_id: str, timeout: int = 3000) -> dict:
        import websocket

        ws = websocket.create_connection(
            f"ws://{COMFY_HOST}:{COMFY_PORT}/ws?clientId={self.client_id}",
            timeout=30,
        )
        try:
            deadline = time.time() + timeout
            while time.time() < deadline:
                msg = json.loads(ws.recv())
                if msg.get("type") == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        break
        finally:
            ws.close()
        with urllib.request.urlopen(
            f"{self.base}/history/{prompt_id}", timeout=60
        ) as r:
            return json.load(r)[prompt_id]

    def fetch_output(self, history: dict) -> bytes:
        for node_id, node_out in history.get("outputs", {}).items():
            for media in node_out.get("gifs", []) + node_out.get("videos", []):
                params = urllib.parse.urlencode(
                    {
                        "filename": media["filename"],
                        "subfolder": media.get("subfolder", ""),
                        "type": media.get("type", "output"),
                    }
                )
                with urllib.request.urlopen(
                    f"{self.base}/view?{params}", timeout=300
                ) as r:
                    return r.read()
        raise RuntimeError("no video output found in ComfyUI history")


@app.cls(
    image=comfy_image,
    gpu="A100-80GB",
    volumes={"/models": volume()},
    secrets=[hf_secret()],
    timeout=3600,
)
class MiniMaxVideo:
    @modal.enter()
    def start(self):
        _download_checkpoint()
        self.proc = subprocess.Popen(
            [
                "python",
                f"{COMFY_DIR}/main.py",
                "--listen",
                COMFY_HOST,
                "--port",
                str(COMFY_PORT),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.client = ComfyClient()
        self.client.wait_ready()

    @modal.exit()
    def stop(self):
        self.proc.terminate()

    @modal.method()
    def render(
        self,
        prompt: str,
        image_url: str,
        negative_prompt: str = "blurry, low quality, watermark",
        width: int = 1280,
        height: int = 720,
        frames: int = 121,
        seed: int = 0,
    ) -> bytes:
        img_bytes = requests.get(image_url, timeout=60).content
        init_name = self.client.upload_image(img_bytes, "init.png")
        workflow = build_workflow(
            prompt, negative_prompt, init_name, width, height, frames, seed
        )
        prompt_id = self.client.queue(workflow)
        history = self.client.wait_done(prompt_id)
        return self.client.fetch_output(history)


@app.function(image=base_image)
@modal.web_endpoint(method="POST", docs=True)
def generate(item: dict):
    """POST {"prompt": ..., "image_url": ...} -> video/mp4 bytes."""
    prompt: Optional[str] = item.get("prompt")
    image_url: Optional[str] = item.get("image_url")
    if not prompt or not image_url:
        return {"error": "both 'prompt' and 'image_url' are required"}
    mp4 = MiniMaxVideo().render.remote(
        prompt,
        image_url,
        negative_prompt=item.get("negative_prompt", "blurry, low quality, watermark"),
        width=int(item.get("width", 1280)),
        height=int(item.get("height", 720)),
        frames=int(item.get("frames", 121)),
        seed=int(item.get("seed", 0)),
    )
    return Response(content=mp4, media_type="video/mp4")
