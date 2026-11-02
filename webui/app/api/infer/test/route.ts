import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Server-side relay: POST any JSON body to a deployed Modal endpoint.
 * Handles Modal's cold-start 303 (attempt-token) dance by re-POSTing.
 */
export async function POST(req: NextRequest) {
  try {
    let { url, body } = (await req.json()) as { url?: string; body?: string };
    if (!url || !/^https?:\/\//.test(url)) {
      return NextResponse.json({ error: "valid url required" }, { status: 400 });
    }

    let res: Response | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      res = await fetch(url, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: body && body.trim() ? body : undefined,
        signal: AbortSignal.timeout(240_000),
      });
      if (res.status === 303 || res.status === 307 || res.status === 302) {
        const loc = res.headers.get("location");
        if (loc) {
          url = new URL(loc, url).toString();
          continue;
        }
      }
      break;
    }

    const text = res ? await res.text() : "";
    return NextResponse.json(
      { status: res?.status ?? 0, text: text.slice(0, 20_000) },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "REQUEST FAILED" },
      { status: 200 },
    );
  }
}
