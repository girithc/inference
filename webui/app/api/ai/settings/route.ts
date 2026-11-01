import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/server";

export const dynamic = "force-dynamic";

/** AI provider settings, persisted in SQLite. */
export async function GET() {
  return NextResponse.json({
    baseUrl: getSetting("ai_base_url") ?? "",
    apiKey: getSetting("ai_api_key") ?? "",
    model: getSetting("ai_model") ?? "",
  });
}

export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey, model } = (await req.json()) as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };
    setSetting("ai_base_url", (baseUrl ?? "").trim());
    setSetting("ai_api_key", (apiKey ?? "").trim());
    setSetting("ai_model", (model ?? "").trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "SAVE FAILED" },
      { status: 500 },
    );
  }
}
