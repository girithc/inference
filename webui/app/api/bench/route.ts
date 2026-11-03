import { NextRequest, NextResponse } from "next/server";
import { resolveEndpoint, upstreamFetch } from "@/lib/store";
import type { BenchAgg, BenchRequestResult, BenchRun } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/bench — { endpointId, prompt, n, concurrency, maxTokens,
 * temperature, stream }. Runs n chat completions against the deployment from
 * this server (cleaner timing than the browser), measures per-request TTFT /
 * latency / token rate, returns per-request rows + percentiles.
 */

interface Opts {
  endpointId: string;
  prompt: string;
  n: number;
  concurrency: number;
  maxTokens: number;
  temperature: number;
  stream: boolean;
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function runOne(e: NonNullable<Awaited<ReturnType<typeof resolveEndpoint>>>, o: Opts): Promise<BenchRequestResult> {
  const t0 = performance.now();
  const body: Record<string, unknown> = {
    model: e.model,
    messages: [{ role: "user", content: o.prompt }],
    max_tokens: o.maxTokens,
    temperature: o.temperature,
    stream: o.stream,
  };
  if (o.stream) body.stream_options = { include_usage: true };

  try {
    const res = await upstreamFetch(e, "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return {
        i: -1,
        ttftMs: null,
        totalMs: performance.now() - t0,
        outTokens: 0,
        inTokens: null,
        genRate: null,
        ok: false,
        error: `HTTP ${res.status} ${text.slice(0, 200)}`,
      };
    }

    let ttft: number | null = null;
    let inTokens: number | null = null;
    let outTokens: number | null = null;
    let chunks = 0;

    if (o.stream) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") break outer;
          try {
            const j = JSON.parse(data);
            if (ttft == null) ttft = performance.now() - t0;
            if (j.usage) {
              inTokens = j.usage.prompt_tokens ?? null;
              outTokens = j.usage.completion_tokens ?? null;
            } else {
              chunks++;
            }
          } catch {
            /* skip partial frame */
          }
        }
      }
    } else {
      const j = (await res.json()) as any;
      inTokens = j?.usage?.prompt_tokens ?? null;
      outTokens = j?.usage?.completion_tokens ?? null;
    }

    const totalMs = performance.now() - t0;
    const tokens = outTokens ?? chunks; // chunks ≈ tokens as a fallback
    const genMs = totalMs - (ttft ?? 0);
    return {
      i: -1,
      ttftMs: o.stream ? ttft : null,
      totalMs,
      outTokens: tokens,
      inTokens,
      genRate: tokens > 0 && genMs > 0 ? tokens / (genMs / 1000) : null,
      ok: true,
    };
  } catch (err) {
    return {
      i: -1,
      ttftMs: null,
      totalMs: performance.now() - t0,
      outTokens: 0,
      inTokens: null,
      genRate: null,
      ok: false,
      error: err instanceof Error ? err.message : "request failed",
    };
  }
}

export async function POST(req: NextRequest) {
  const o = (await req.json()) as Opts;
  const e = o.endpointId ? resolveEndpoint(o.endpointId) : null;
  if (!e) return NextResponse.json({ error: "unknown endpoint" }, { status: 400 });

  const n = Math.max(1, Math.min(100, Math.floor(o.n || 1)));
  const concurrency = Math.max(1, Math.min(32, Math.floor(o.concurrency || 1)));
  const prompt = String(o.prompt ?? "").trim() || "Say hello.";
  const opts: Opts = {
    ...o,
    prompt,
    n,
    concurrency,
    maxTokens: Math.max(1, Math.min(8192, Math.floor(o.maxTokens || 256))),
    temperature: Number.isFinite(o.temperature) ? o.temperature : 0,
  };

  const wallStart = performance.now();
  const results: BenchRequestResult[] = new Array(n);
  let next = 0;

  const worker = async () => {
    while (next < n) {
      const i = next++;
      const r = await runOne(e!, opts);
      r.i = i;
      results[i] = r;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker));
  const wallMs = performance.now() - wallStart;

  const okRows = results.filter((r) => r.ok);
  const ttfts = okRows.map((r) => r.ttftMs!).filter((v): v is number => v != null).sort((a, b) => a - b);
  const lats = okRows.map((r) => r.totalMs).sort((a, b) => a - b);
  const rates = okRows.map((r) => r.genRate!).filter((v) => Number.isFinite(v));
  const outTokens = results.reduce((a, r) => a + r.outTokens, 0);
  const inTokens = results.every((r) => r.inTokens != null)
    ? results.reduce((a, r) => a + (r.inTokens ?? 0), 0)
    : null;

  const agg: BenchAgg = {
    n,
    ok: okRows.length,
    errors: n - okRows.length,
    ttftP50: pct(ttfts, 50),
    ttftP90: pct(ttfts, 90),
    ttftP99: pct(ttfts, 99),
    latP50: pct(lats, 50),
    latP90: pct(lats, 90),
    genRateMean: mean(rates),
    outTokens,
    inTokens,
    wallMs,
    errRate: (n - okRows.length) / n,
  };

  const run: BenchRun = {
    endpoint: { id: e.id, name: e.name, model: e.model, kind: e.kind },
    prompt,
    params: {
      n,
      concurrency,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      stream: opts.stream,
    },
    requests: results,
    agg,
  };
  return NextResponse.json(run);
}
