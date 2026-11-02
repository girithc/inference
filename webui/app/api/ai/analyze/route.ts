import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_MODEL = "accounts/fireworks/routers/glm-5p3-flash-us";

const SYSTEM = [
  "You review Modal inference deployment code for an inference engineer.",
  "Answer in exactly three sections, terse and technical, no preamble:",
  "WHAT IT DOES — 2-3 sentences.",
  "PIPELINE STAGE — name the stage(s) this code covers (image/env setup, weight ingestion, model build/compile, serving/gateway, batching/scheduling, post-processing, client callout) and one line on why.",
  "IMPROVEMENTS — 3-5 concrete bullets ranked by impact (cost, latency, reliability).",
].join(" ");

/** Analyze the opened file with Fireworks AI (OpenAI-compatible endpoint). */
export async function POST(req: NextRequest) {
  try {
    const { path, content } = (await req.json()) as {
      path?: string;
      content?: string;
    };
    if (!content) {
      return NextResponse.json({ error: "file content required" }, { status: 400 });
    }

    const baseUrl = (getSetting("ai_base_url") || "https://api.fireworks.ai/inference/v1").replace(
      /\/+$/,
      "",
    );
    const key = getSetting("ai_api_key") || process.env.FIREWORKS_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "no API key — set it in AI SETTINGS (gear icon) or FIREWORKS_API_KEY in webui/.env.local" },
        { status: 400 },
      );
    }
    const model = getSetting("ai_model") || process.env.FIREWORKS_MODEL || DEFAULT_MODEL;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        // glm/deepseek-class routers spend tokens thinking first — give the
        // answer room so it doesn't stop mid-sentence
        max_tokens: 4096,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `FILE: ${path ?? "unknown"}\n\n\`\`\`\n${content.slice(0, 24_000)}\n\`\`\``,
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `FIREWORKS ${res.status} — ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ANALYZE FAILED" },
      { status: 200 },
    );
  }
}
