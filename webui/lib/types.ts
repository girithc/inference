/** Shared types — safe to import from client and server code. */

export type Kind = "ocr" | "reasoning" | "stt" | "tts";

export const KINDS: Kind[] = ["ocr", "reasoning", "stt", "tts"];

export const KIND_LABEL: Record<Kind, string> = {
  ocr: "OCR",
  reasoning: "Reasoning",
  stt: "Speech → text",
  tts: "Text → speech",
};

/** What a deployment entry looks like client-side (API key never leaves the server). */
export interface Endpoint {
  id: string;
  name: string;
  kind: Kind;
  baseUrl: string;
  model: string;
  notes?: string;
  hasKey: boolean;
  createdAt: string;
}

/** What the client sends to create/update one. */
export interface EndpointInput {
  id?: string;
  name: string;
  kind: Kind;
  baseUrl: string;
  model: string;
  apiKey?: string; // empty string → keep existing key on update
  notes?: string;
}

export interface HealthResult {
  ok: boolean;
  ms: number;
  via?: string;
  models?: string[];
  status?: number;
  error?: string;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Aggregate over one bench run (one endpoint, n requests). */
export interface BenchAgg {
  n: number;
  ok: number;
  errors: number;
  ttftP50: number | null;
  ttftP90: number | null;
  ttftP99: number | null;
  latP50: number | null;
  latP90: number | null;
  genRateMean: number | null; // tokens/s after first token
  outTokens: number;
  inTokens: number | null;
  wallMs: number;
  errRate: number;
}

export interface BenchRequestResult {
  i: number;
  ttftMs: number | null;
  totalMs: number;
  outTokens: number;
  inTokens: number | null;
  genRate: number | null;
  ok: boolean;
  error?: string;
}

export interface BenchRun {
  endpoint: { id: string; name: string; model: string; kind: Kind };
  prompt: string;
  params: { n: number; concurrency: number; maxTokens: number; temperature: number; stream: boolean };
  requests: BenchRequestResult[];
  agg: BenchAgg;
}

export const fmtMs = (v: number | null | undefined): string =>
  v == null ? "—" : v >= 10_000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;

export const fmtRate = (v: number | null | undefined): string =>
  v == null ? "—" : `${v.toFixed(1)} tok/s`;
