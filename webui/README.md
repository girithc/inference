# Inference✳ — Web UI

A Next.js App Router app in TypeScript. Print-inspired editorial / neo-brutalist poster theme:
**bone paper `#f2efe6` / ink `#14120f` / international orange `#ff4d00` — sharp edges, no radius.**

Three typographic voices: Space Grotesk (display), IBM Plex Mono (technical labels),
Instrument Serif italic (expressive accents).

## Views

- `/` — poster landing: hero, index rows, footer
- `/models` — **01 / Inference** — rate-sheet catalog of three small models (reasoning / TTS / STT) with cURL snippets
- `/post-training` — **02 / Post-training** — job composer (LoRA / QLoRA / full FT) with a live job ledger
- `/playground` — **03 / Playground** — single or A/B prompt runs with TTFT / tok-s / cost metrics
- `/stack` — **04 / The Stack** — compose engine, quantization, kernels, batching; live estimates and a generated config

## Notes

- Playground **SANDBOX** mode streams a deterministic mock at each model's printed speed — no GPU calls.
  **CUSTOM** mode streams from any OpenAI-compatible endpoint (the host must send CORS headers).
- Post-training jobs and the stack config persist in `localStorage`.
- Scroll-drawn ink rail with orange square rider.

## Run locally

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

## Production build

```bash
npm run build
npm start
```

## TypeScript

```bash
npm run typecheck
```
