import type { BenchRun, Endpoint, EndpointInput, HealthResult, Usage } from "./types";

/** Small JSON API helpers for the client views. */

async function toError(res: Response): Promise<Error> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  return new Error(`HTTP ${res.status}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function apiSend<T>(path: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

// ---------------------------------------------------------------------------
// Endpoints registry
// ---------------------------------------------------------------------------

export const listEndpoints = () => apiGet<{ endpoints: Endpoint[] }>("/api/endpoints");
export const saveEndpoint = (input: EndpointInput) =>
  apiSend<{ endpoint: Endpoint }>("/api/endpoints", "POST", input);
export const deleteEndpoint = (id: string) =>
  apiSend<{ ok: true }>(`/api/endpoints?id=${encodeURIComponent(id)}`, "DELETE");
export const healthEndpoint = (id: string) =>
  apiSend<HealthResult>("/api/endpoints/health", "POST", { endpointId: id });

// ---------------------------------------------------------------------------
// Streaming chat (through the server relay)
// ---------------------------------------------------------------------------

export interface StreamHandlers {
  onReasoning?: (t: string) => void;
  onContent?: (t: string) => void;
  onUsage?: (u: Usage) => void;
  signal?: AbortSignal;
}

export interface StreamMetrics {
  ttftMs: number | null;
  totalMs: number;
  error?: string;
}

/**
 * POST an OpenAI-compatible chat completions body through /api/relay and
 * drive the handlers from the SSE frames. Returns wall-clock metrics.
 */
export async function streamChat(
  endpointId: string,
  body: Record<string, unknown>,
  h: StreamHandlers = {},
): Promise<StreamMetrics> {
  const t0 = performance.now();
  let ttft: number | null = null;
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpointId, body }),
    signal: h.signal,
  });

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 400)}` : ""}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let err: string | undefined;

  const handleFrame = (data: string) => {
    if (data === "[DONE]") return;
    let j: any;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.error) err = typeof j.error === "string" ? j.error : j.error?.message ?? "upstream error";
    if (ttft == null) ttft = performance.now() - t0;
    const delta = j.choices?.[0]?.delta;
    if (delta?.reasoning_content) h.onReasoning?.(delta.reasoning_content);
    if (delta?.content) h.onContent?.(delta.content);
    if (j.usage) h.onUsage?.(j.usage);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) handleFrame(line.slice(5).trim());
    }
  }
  if (buf.trim().startsWith("data:")) handleFrame(buf.trim().slice(5).trim());

  return { ttftMs: ttft, totalMs: performance.now() - t0, error: err };
}

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------

export const runBench = (payload: {
  endpointId: string;
  prompt: string;
  n: number;
  concurrency: number;
  maxTokens: number;
  temperature: number;
  stream: boolean;
}) => apiSend<BenchRun>("/api/bench", "POST", payload);
