import { NextRequest, NextResponse } from "next/server";
import { resolveEndpoint, upstreamFetch } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/transcribe — multipart { file, endpointId, model?, language? }
 * → /v1/audio/transcriptions upstream. JSON passthrough (OpenAI shape: {text}).
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const endpointId = String(form.get("endpointId") ?? "");
  const e = endpointId ? resolveEndpoint(endpointId) : null;
  if (!e) return NextResponse.json({ error: "unknown endpoint" }, { status: 400 });
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }

  const up = new FormData();
  up.append("file", file, file.name || "audio.webm");
  up.append("model", String(form.get("model") ?? "") || e.model);
  const language = String(form.get("language") ?? "").trim();
  if (language) up.append("language", language);

  try {
    const res = await upstreamFetch(e, "/v1/audio/transcriptions", {
      method: "POST",
      body: up,
      signal: AbortSignal.timeout(300_000),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "transcription failed" },
      { status: 502 },
    );
  }
}
