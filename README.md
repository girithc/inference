# inference

Serving open models on Modal. One-command GPU deployments for:

- zai-org/GLM-OCR — OCR
- deepseek-ai/DeepSeek-OCR — OCR
- Qwen/Qwen-Image-2.1 — text to image
- m-a-p/YuE2-3B — music generation
- Qwen/Qwen3.8-27B — chat
- WarmBloodAban/Minimax-h3_Singularity — image to video

## Web canvas

A Next.js TypeScript web UI in [`webui/`](./webui/README.md) — a canvas over the
deployed models, not an editor: **bench** deployments under load (TTFT
percentiles, token throughput, A/B comparison), an **OCR** view (drop a
document, stream the transcription), a **reason** chat canvas (thinking blocks
separated from answers, live tokens/s), and a **speech** view (STT + TTS,
OpenAI-compatible). Deployments are registered in-app with base URL + model +
optional key; all requests proxy through the Next server.
