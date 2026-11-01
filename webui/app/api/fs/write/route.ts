import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { safeRepoPath } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Local-disk only write (editor auto-save). GitHub commits go through source control. */
export async function POST(req: NextRequest) {
  try {
    const { path: rel, content } = (await req.json()) as { path: string; content: string };
    if (!rel || typeof content !== "string") {
      return NextResponse.json({ error: "path and content required" }, { status: 400 });
    }
    const abs = safeRepoPath(rel);
    await fs.writeFile(abs, content, "utf8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "WRITE FAILED" },
      { status: 500 },
    );
  }
}
