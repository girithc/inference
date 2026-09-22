"""Shared Modal infrastructure for the inference repo.

Defines the common GPU image, the shared model-cache volume, the
Hugging Face secret, model IDs, and a snapshot-download helper so every
endpoint below reuses the same caching strategy.
"""

import modal

# ---------------------------------------------------------------------------
# Verified Hugging Face model IDs (all confirmed via the HF API, Sep 2026)
# ---------------------------------------------------------------------------
GLM_OCR_ID = "zai-org/GLM-OCR"
DEEPSEEK_OCR_ID = "deepseek-ai/DeepSeek-OCR"
QWEN_IMAGE_ID = "Qwen/Qwen-Image-2.1"
YUE2_ID = "m-a-p/YuE2-3B"
QWEN_27B_ID = "Qwen/Qwen3.8-27B"
MINIMAX_H3_ID = "WarmBloodAban/Minimax-h3_Singularity"

# Shared resource names (create once; reused by every app)
VOLUME_NAME = "inference-model-cache"
VOLUME_MOUNT = "/models"
HF_SECRET_NAME = "huggingface-secret"  # must contain HF_TOKEN

CUDA_INDEX_URL = "https://download.pytorch.org/whl/cu128"

# ---------------------------------------------------------------------------
# Base image: CUDA torch + the full inference stack.
# Versions pinned against the live PyPI / PyTorch indexes (Sep 2026).
# ---------------------------------------------------------------------------
base_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libsndfile1")
    .pip_install(
        "torch==2.9.0+cu128",
        index_url=CUDA_INDEX_URL,
    )
    .pip_install(
        "transformers==4.57.6",
        "diffusers==0.40.0",
        "accelerate==1.15.0",
        "sentencepiece==0.2.2",
        "safetensors==0.8.0",
        "huggingface_hub[cli]>=0.34",
        "pillow",
        "requests",
        "hf-transfer",
        "einops",
        "addict",
        "easydict",
        "soundfile",
        "numpy",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "HF_HOME": f"{VOLUME_MOUNT}/hf-cache",
            "TOKENIZERS_PARALLELISM": "false",
        }
    )
)


def volume() -> modal.Volume:
    """Shared persistent volume used as the local model cache."""
    return modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)


def hf_secret() -> modal.Secret:
    """Hugging Face token secret (needed for gated models / rate limits)."""
    return modal.Secret.from_name(HF_SECRET_NAME)


def ensure_model(repo_id: str, revision: str | None = None) -> str:
    """Download a snapshot of ``repo_id`` into the shared volume (idempotent).

    Returns the local directory containing the snapshot. Safe to call on
    every request: ``snapshot_download`` skips files that are already cached.
    """
    import os

    from huggingface_hub import snapshot_download

    local_dir = os.path.join(
        VOLUME_MOUNT, "snapshots", repo_id.replace("/", "--")
    )
    snapshot_download(
        repo_id=repo_id,
        revision=revision,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
    )
    return local_dir
