import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getRepo, gh, safeRepoPath } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Read a file from the GitHub repo (content + blob sha). */
export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path");
  if (!rel) return NextResponse.json({ error: "path required" }, { status: 400 });

  try {
    const repo = await getRepo();
    const res = await gh(
      `/repos/${repo}/contents/${rel.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (!res.ok) {
      return NextResponse.json({ error: `GITHUB ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as {
      content?: string;
      sha: string;
      encoding: string;
    };
    if (data.encoding !== "base64") {
      return NextResponse.json({ error: "UNSUPPORTED ENCODING" }, { status: 502 });
    }
    const content = Buffer.from(data.content ?? "", "base64").toString("utf8");
    return NextResponse.json({ path: rel, sha: data.sha, content });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "READ FAILED" },
      { status: 500 },
    );
  }
}

/**
 * Save = write the file to the local checkout (so `modal deploy` runs the
 * edited code immediately) AND commit it to GitHub (so the repo is the truth).
 */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      path: string;
      content: string;
      sha: string;
      message?: string;
    };
    if (!body.path || typeof body.content !== "string" || !body.sha) {
      return NextResponse.json({ error: "path, content, sha required" }, { status: 400 });
    }

    // 1. local disk
    const abs = safeRepoPath(body.path);
    await fs.writeFile(abs, body.content, "utf8");

    // 2. GitHub commit
    const repo = await getRepo();
    const res = await gh(
      `/repos/${repo}/contents/${body.path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: body.message?.trim() || `edit ${body.path} via inference✳ studio`,
          content: Buffer.from(body.content, "utf8").toString("base64"),
          sha: body.sha,
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `GITHUB ${res.status} — ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      content?: { sha: string };
      commit?: { sha: string };
    };

    return NextResponse.json({
      ok: true,
      sha: data.content?.sha ?? body.sha,
      commit: data.commit?.sha ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "SAVE FAILED" },
      { status: 500 },
    );
  }
}
