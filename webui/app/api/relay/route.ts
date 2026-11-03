import { NextRequest, NextResponse } from "next/server";
import { resolveEndpoint, upstreamFetch } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/relay — { endpointId, path?, body } → OpenAI-compatible upstream.
 * Streams the upstream response straight through (SSE chat completions live
 * here). Paths are restricted to /v1/*.
 */
export async function POST(req: NextRequest) {
  const { endpointId, path, body } = (await req.json()) as {
    endpointId?: string;
    path?: string;
    body?: unknown;
  };
  const e = endpointId ? resolveEndpoint(endpointId) : null;
  if (!e) return NextResponse.json({ error: "unknown endpoint" }, { status: 400 });

  const target = path ?? "/v1/chat/completions";
  if (!target.startsWith("/v1/")) {
    return NextResponse.json({ error: "path must start with /v1/" }, { status: 400 });
  }

  try {
    const res = await upstreamFetch(e, target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(600_000),
    });
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "relay failed" },
      { status: 502 },
    );
  }
}
