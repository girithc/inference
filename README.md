# inference — Production LLM & Multimodal Model Serving on Modal

GPU inference infrastructure for serving open-weight **LLMs**, **vision-language models**, **diffusion models**, and **generative audio/video models** as autoscaled HTTPS endpoints on [Modal](https://modal.com). Built for AI/ML engineers and research labs who need reproducible, low-ops **model serving** with **MLOps** best practices: pinned CUDA images, shared model-cache volumes, and per-model GPU classes.

**Keywords:** LLM inference, model serving, Modal, GPU inference, vLLM-style serving, diffusion models, text-to-image, OCR, document understanding, multimodal AI, vision-language models, music generation, text-to-video, MLOps, PyTorch, Transformers, Diffusers, Hugging Face.

## Models served

All Hugging Face model IDs below were verified live against the HF API.

| Endpoint module | Model | HF ID | Task | License |
|---|---|---|---|---|
| `modal_app/glm_ocr.py` | GLM-OCR (0.9B) | `zai-org/GLM-OCR` | Document OCR → markdown | MIT |
| `modal_app/deepseek_ocr.py` | DeepSeek-OCR | `deepseek-ai/DeepSeek-OCR` | Document OCR → markdown | MIT |
| `modal_app/qwen_image.py` | Qwen-Image-2.1 | `Qwen/Qwen-Image-2.1` | Text-to-image (diffusers `QwenImage21Pipeline`) | Qwen license |
| `modal_app/yue_music.py` | YuE2-3B | `m-a-p/YuE2-3B` | Song generation (official `yue2` wheel) | CC-BY-NC-4.0 |
| `modal_app/minimax_video.py` | MiniMax-H3 Singularity | `WarmBloodAban/Minimax-h3_Singularity` | Image-to-video via ComfyUI API | Apache-2.0 |
| `modal_app/qwen3_27b.py` | Qwen3.8-27B | `Qwen/Qwen3.8-27B` | OpenAI-compatible chat completions | Apache-2.0 |

> Note: `WarmBloodAban/Minimax-h3_Singularity` is tagged image-to-video (not music), so it is served as an image-to-video endpoint (`minimax_video.py`) to match the actual checkpoint.

## Architecture

- `modal_app/common.py` — shared CUDA base image (pinned `torch==2.9.0+cu128`, `transformers==4.57.6`, `diffusers==0.40.0`, `accelerate==1.15.0`), shared `inference-model-cache` volume, `huggingface-secret`, and an idempotent `ensure_model()` snapshot downloader.
- Each model is an independent Modal `App` with its own GPU class (`A100` for OCR, `A100-80GB` for 27B/diffusion/video/music), container-lifecycle model loading (`@modal.enter()`), and a `@modal.web_endpoint` front door.
- Binary outputs (PNG/FLAC/MP4) stream back as `fastapi.Response`; JSON endpoints return OpenAI-style payloads where applicable.

## Quickstart

```bash
pip install modal
modal setup  # authenticate once

# create the shared resources (one time)
python - <<'EOF'
import modal
modal.Volume.from_name("inference-model-cache", create_if_missing=True)
modal.Secret.from_name("huggingface-secret")  # or: modal secret create huggingface-secret HF_TOKEN=hf_...
EOF

# deploy an app
modal deploy modal_app/qwen3_27b.py
```

`modal deploy` prints the public HTTPS URL for each web endpoint.

## Endpoint usage

**Chat (OpenAI-compatible):**
```bash
curl -X POST https://<app-url>/chat_completions \
  -H 'Content-Type: application/json' \
  -d '{"messages": [{"role": "user", "content": "Explain mixture-of-experts in two sentences."}], "max_tokens": 256}'
```

**OCR (GLM-OCR / DeepSeek-OCR):**
```bash
curl -X POST https://<app-url>/ocr \
  -H 'Content-Type: application/json' \
  -d '{"image_url": "https://example.com/doc.png", "task": "text"}'
# -> {"model": "zai-org/GLM-OCR", "task": "text", "text": "...markdown..."}
```

**Text-to-image:**
```bash
curl -X POST https://<app-url>/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "a lighthouse at dusk, cinematic", "width": 1024, "height": 1024}' \
  --output out.png
```

**Music generation (YuE2):**
```bash
curl -X POST https://<app-url>/generate \
  -H 'Content-Type: application/json' \
  -d '{"style": "Jazz-funk, warm lead vocal, Rhodes piano", "lyrics": "[verse]\nTonight we...", "cot": "full", "seed": 831001}' \
  --output song.flac
```

**Image-to-video (MiniMax-H3 Singularity):**
```bash
curl -X POST https://<app-url>/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "slow cinematic push-in", "image_url": "https://example.com/frame.png", "frames": 121}' \
  --output clip.mp4
```

## CI

`.github/workflows/ci.yml` byte-compiles every module on push/PR.

## License

Apache-2.0. Note that individual model weights carry their own licenses (see table); YuE2-3B is CC-BY-NC-4.0 (non-commercial) and Qwen-Image-2.1 ships under the Qwen license.
