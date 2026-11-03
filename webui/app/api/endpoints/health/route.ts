import { NextRequest, NextResponse } from "next/server";
import { joinBase, resolveEndpoint, upstreamFetch } from "@/lib/store";
import type { HealthResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/endpoints/health — probe a deployment. Tries /v1/models first
 * (OpenAI-compatible servers); if the server doesn't implement it, falls
 * back to a plain GET on the root URL.
 */
export async function POST(req: NextRequest) {
  const { endpointId } = (await req.json()) as { endpointId?: string };
  const e = endpointId ? resolveEndpoint(endpointId) : null;
  if (!e) return NextResponse.json({ error: "unknown endpoint" }, { status: 400 });

  const t0 = performance.now();
  try {
    const models = await upstreamFetch(e, "/v1/models", {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });
    if (models.ok) {
      const j = (await models.json().catch(() => null)) as { data?: { id?: string }[] } | null;
      return NextResponse.json({
        ok: true,
        via: "/v1/models",
        ms: Math.round(performance.now() - t0),
        models: (j?.data ?? []).map((m) => m?.id).filter((id): id is string => Boolean(id)).slice(0, 20),
      } satisfies HealthResult);
    }

    // No /v1/models — try the root as a liveness check.
    const root = await fetch(joinBase(e.baseUrl, "/"), {
      method: "GET",
      headers: e.apiKey ? { Authorization: `Bearer ${e.apiKey}` } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const ms = Math.round(performance.now() - t0);
    if (root.ok) return NextResponse.json({ ok: true, via: "/", ms } satisfies HealthResult);
    return NextResponse.json({
      ok: false,
      status: root.status,
      ms,
      error: `probe failed (${root.status})`,
    } satisfies HealthResult);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : "probe failed",
    } satisfies HealthResult);
  }
}
