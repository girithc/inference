import { NextRequest, NextResponse } from "next/server";
import { resolveEndpoint, upstreamFetch } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/tts — { endpointId, input, voice?, speed?, response_format? }
 * → /v1/audio/speech upstream. Audio bytes stream straight through; errors
 * come back as JSON with the upstream status.
 */
export async function POST(req: NextRequest) {
  const { endpointId, input, voice, speed, response_format } = (await req.json()) as {
    endpointId?: string;
    input?: string;
    voice?: string;
    speed?: number;
    response_format?: string;
  };
  const e = endpointId ? resolveEndpoint(endpointId) : null;
  if (!e) return NextResponse.json({ error: "unknown endpoint" }, { status: 400 });
  if (!input?.trim()) return NextResponse.json({ error: "input text required" }, { status: 400 });

  const body: Record<string, unknown> = { model: e.model, input };
  if (voice) body.voice = voice;
  if (typeof speed === "number" && speed !== 1) body.speed = speed;
  if (response_format) body.response_format = response_format;

  try {
    const res = await upstreamFetch(e, "/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return new Response(text || JSON.stringify({ error: `HTTP ${res.status}` }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "tts failed" },
      { status: 502 },
    );
  }
}
