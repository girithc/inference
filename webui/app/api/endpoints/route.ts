import { NextRequest, NextResponse } from "next/server";
import { loadEndpoints, saveEndpoints, sanitize } from "@/lib/store";
import type { EndpointInput } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/endpoints — registry without keys. */
export async function GET() {
  return NextResponse.json({ endpoints: loadEndpoints().map(sanitize) });
}

/** POST /api/endpoints — create (no id) or update (id). Blank apiKey keeps the stored one. */
export async function POST(req: NextRequest) {
  const input = (await req.json()) as EndpointInput;
  const name = String(input.name ?? "").trim();
  const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = String(input.model ?? "").trim();
  if (!name || !/^https?:\/\//.test(baseUrl) || !model) {
    return NextResponse.json({ error: "name, http(s) baseUrl and model are required" }, { status: 400 });
  }

  const list = loadEndpoints();
  const id = input.id ?? crypto.randomUUID();
  const existing = input.id ? list.find((e) => e.id === input.id) : undefined;
  const rec = {
    id,
    name,
    kind: input.kind,
    baseUrl,
    model,
    notes: input.notes?.trim() || undefined,
    apiKey: input.apiKey ? input.apiKey.trim() : existing?.apiKey,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  const next = input.id ? list.map((e) => (e.id === id ? rec : e)) : [...list, rec];
  saveEndpoints(next);
  return NextResponse.json({ endpoint: sanitize(rec) });
}

/** DELETE /api/endpoints?id=... */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  saveEndpoints(loadEndpoints().filter((e) => e.id !== id));
  return NextResponse.json({ ok: true });
}
