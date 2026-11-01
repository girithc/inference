import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Server-side relay: POST any JSON body to a deployed Modal endpoint.
 * Keeps the browser free of CORS problems — the request leaves from here.
 */
export async function POST(req: NextRequest) {
  try {
    const { url, body } = (await req.json()) as { url?: string; body?: string };
    if (!url || !/^https?:\/\//.test(url)) {
      return NextResponse.json({ error: "valid url required" }, { status: 400 });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body && body.trim() ? body : undefined,
      signal: AbortSignal.timeout(120_000),
    });

    const text = await res.text();
    return NextResponse.json(
      { status: res.status, text: text.slice(0, 20_000) },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "REQUEST FAILED" },
      { status: 200 },
    );
  }
}
