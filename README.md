# inference

Serving open models on Modal. One-command GPU deployments for:

- zai-org/GLM-OCR — OCR
- deepseek-ai/DeepSeek-OCR — OCR
- Qwen/Qwen-Image-2.1 — text to image
- m-a-p/YuE2-3B — music generation
- Qwen/Qwen3.8-27B — chat
- WarmBloodAban/Minimax-h3_Singularity — image to video

## Web playground

A Next.js TypeScript model-first web UI is available in [`webui/`](./webui/README.md). Each model row has **architecture**, **playground**, and **kernels** concept buttons: architecture opens a model architecture code editor, playground opens a cURL request editor, and kernels opens an editable Triton kernel code editor. Run it locally with:

```bash
cd webui
npm install
npm run dev
```

Then open `http://localhost:3000`, select a model, edit its sample cURL request, and run it from the request editor.

Work in progress — I'm building it out piece by piece. Check back soon.
