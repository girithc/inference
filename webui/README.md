# Inference✳ — Web UI

A canvas over the served models. Not an editor, not a deploy tool — the serving
code lives in the repo (Modal, vLLM); the UI is where you *use* what's deployed.

Four views, plus a registry of deployments they all point at:

- **01 / Bench** — fire prompt sets at one or more deployments with configurable
  concurrency; per-request TTFT / latency / token rate, p50–p99 percentiles,
  throughput, error rate, side-by-side comparison.
- **02 / OCR** — drop, paste, or pick a document image, choose a prompt template
  (full text → markdown, tables → markdown, exact transcription, custom), and
  stream the transcription. Latency and token rate on every run.
- **03 / Reason** — chat canvas over the reasoning LLM. Thinking
  (`reasoning_content`) streams into its own collapsible block, answers render
  markdown, per-message TTFT and tokens/s, sampling controls including a
  thinking on/off toggle (`chat_template_kwargs.enable_thinking`).
- **04 / Speech** — record from the mic or upload audio and transcribe it
  (`/v1/audio/transcriptions`); synthesize speech from text
  (`/v1/audio/speech`) with voice, speed, and format controls, playback, and
  download.
- **05 / Endpoints** — the registry: name, kind, base URL, served model name,
  optional API key. Every request is proxied through the Next server, so there
  are no CORS issues and keys never reach the browser. Health probe hits
  `/v1/models` (falls back to a root GET).

## Architecture

- Next.js App Router, TypeScript, zero UI dependencies beyond React.
- `lib/store.ts` — server-side registry persisted to `data/endpoints.json`
  (gitignored, mode 0600; may hold API keys). `upstreamFetch` follows Modal's
  cold-start redirect dance and attaches stored Bearer keys.
- `/api/relay` — streams OpenAI-compatible POST bodies straight through
  (SSE chat completions live here); paths restricted to `/v1/*`.
- `/api/bench` — runs timed requests server-side for clean measurements.
- `/api/transcribe`, `/api/tts` — multipart and audio passthrough.

## Run locally

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>, register a deployment under **Endpoints** —
e.g. the qwen vLLM service: kind `reasoning`, base URL
`https://<modal-app>.modal.run`, model `qwen3.8-27b` (the `SERVED_MODEL_NAME`
from its `inference.py`) — and the views light up.

## Production build

```bash
npm run build
npm start
```

## TypeScript

```bash
npm run typecheck
```
