"""Deployment setup for Qwen/Qwen3.8-27B on Modal.

This file intentionally keeps infrastructure jargon out of `inference.py`:
credentials, caches, container image, and Modal app metadata live here. The
serving logic remains in `inference.py`.
"""

# ---------------------------------------------------------------------------
# 1. Imports and deployment constants
# ---------------------------------------------------------------------------
# These knobs are used by Modal decorators and passed to vLLM at startup.
import os

import modal


# The repository from the request. `MODEL_REVISION` makes it easy to pin a tag,
# branch, or exact commit once the checkpoint is public/pinned for production.
MODEL_ID = "Qwen/Qwen3.8-27B"
MODEL_REVISION = os.environ.get("MODEL_REVISION", "main")

# Name clients send in the OpenAI `model` field. A short name avoids accidentally
# exposing the exact HF repository path in client configuration.
SERVED_MODEL_NAME = "qwen3.8-27b"

# vLLM opens its OpenAI-compatible server on this port inside the container.
PORT = 8000

# 27B weights in BF16 are roughly 54 GB. One H100 (80 GB) can hold them and still
# leave room for KV cache. Increase to two GPUs only if you need a larger context.
GPU_TYPE = "H100"
GPU_COUNT = 1

# A conservative default that fits comfortably on one H100. If your traces show
# enough free KV-cache memory, this can be raised to 16K or 32K.
MAX_MODEL_LEN = int(os.environ.get("MAX_MODEL_LEN", "8192"))

# Maximum requests processed concurrently by vLLM's scheduler. Modal's proxy can
# queue additional requests while the container is warm.
MAX_CONCURRENT_REQUESTS = 128

# ---------------------------------------------------------------------------
# 2. Hugging Face credentials and persistent model cache
# ---------------------------------------------------------------------------
# Create the Modal secret with a `HF_TOKEN` value if this repository is gated or
# you want to avoid anonymous rate limits:
#   modal secret create huggingface-secret HF_TOKEN=hf_xxx
#
# The Volume persists weights across container restarts. Without it, every cold
# start would download ~54 GB again. With it, later cold starts mount the cache.
hf_secret = modal.Secret.from_name("huggingface-secret")

hf_cache_volume = modal.Volume.from_name(
    "qwen3.8-27b-hf-cache",
    create_if_missing=True,
)

# Mount point also needs to match HF's cache path below.
HF_CACHE_MOUNT = "/root/.cache/huggingface"
hf_cache_volumes = {HF_CACHE_MOUNT: hf_cache_volume}

# ---------------------------------------------------------------------------
# 3. Optimized container image
# ---------------------------------------------------------------------------
# `debian_slim` plus vLLM's CUDA wheels is the clean Modal path: vLLM brings a
# compatible PyTorch/CUDA runtime, and `hf_transfer` accelerates checkpoint
# downloads into the persistent cache on the first cold start.
#
# We deliberately do not install SGLang in the same image. SGLang and vLLM both
# pin overlapping CUDA/PyTorch components, so shipping only one avoids image
# bloat and dependency drift. For this model, vLLM's OpenAI server is the
# dependable production serving path.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm>=0.10.0,<0.12",
        "huggingface_hub[hf_transfer]>=0.30,<1.0",
    )
    # Qwen3.8 uses the new `qwen3_5` model type. The Transformers release
    # pulled in by this vLLM range may predate it, so install Transformers
    # from source as recommended by the runtime error.
    .pip_install("git+https://github.com/huggingface/transformers.git")
    .env(
        {
            "HF_HOME": HF_CACHE_MOUNT,
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "TOKENIZERS_PARALLELISM": "false",
            "PYTHONUNBUFFERED": "1",
        }
    )
    # Modal mounts the decorated `inference.py` automatically, but does not
    # infer this auxiliary module reliably. Explicitly include it so remote
    # containers can execute `from setup import ...`.
    .add_local_python_source("setup")
)

# ---------------------------------------------------------------------------
# 4. Modal application
# ---------------------------------------------------------------------------
# `deploy` creates the web endpoint. The container is allowed a long startup
# timeout because the first cold start may download and inspect the 27B weights.
# After startup, Modal keeps the server alive based on `scaledown_window`.
app = modal.App("qwen3-8-27b-chat")
