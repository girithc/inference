import subprocess
import modal

MODEL_ID = "Qwen/Qwen3.6-35B-A3B"
PORT = 8000

# 1. Container image configuration
vllm_image = (
    modal.Image.from_registry("nvidia/cuda:12.8.0-devel-ubuntu22.04", add_python="3.12")
    .pip_install(
        "vllm>=0.10.0",
        "huggingface_hub>=0.28.0",
        "hf_transfer>=0.1.9",
    )
    .env({
        "HF_HUB_ENABLE_HF_TRANSFER": "1",
        "VLLM_WORKER_MULTIPROC_METHOD": "spawn",
        # Extend internal IPC handshake timeout to accommodate startup compilation
        "VLLM_ENGINE_ITERATION_TIMEOUT_S": "300",
    })
)

app = modal.App("qwen-vllm-service")
hf_cache = modal.Volume.from_name("hf-cache", create_if_missing=True)


# 2. Pre-warming download function
@app.function(
    image=vllm_image,
    volumes={"/root/.cache/huggingface": hf_cache},
    timeout=3600,
)
def download_model():
    from huggingface_hub import snapshot_download

    print(f"Verifying {MODEL_ID} weights in cache volume...")
    snapshot_download(
        repo_id=MODEL_ID,
        ignore_patterns=["*.pt", "*.bin"],
    )
    hf_cache.commit()
    print("Snapshot verified and committed.")


# 3. 2-GPU Production Server
@app.function(
    image=vllm_image,
    gpu="A100-80GB:2",  # 2x A100-80GB (160GB VRAM total)
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,
    timeout=1800,
)
@modal.web_server(port=PORT, startup_timeout=900)
def serve():
    cmd = [
        "vllm", "serve", MODEL_ID,
        "--host", "0.0.0.0",
        "--port", str(PORT),
        "--tensor-parallel-size", "2",
        "--max-model-len", "32768",
        "--reasoning-parser", "qwen3",
        "--speculative-config", '{"method": "mtp", "num_speculative_tokens": 2}',
        "--gpu-memory-utilization", "0.90",
        "--enforce-eager",  # Disables JIT/dynamo tracing to prevent startup SHM freezes
    ]
    subprocess.Popen(cmd)