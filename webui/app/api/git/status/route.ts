import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { REPO_ROOT, APP_PREFIX } from "@/lib/server";

export const dynamic = "force-dynamic";

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: REPO_ROOT }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

/** Local working-tree state vs HEAD — the "source control" list. */
export async function GET() {
  try {
    const out = await run(["status", "--porcelain"]);
    const entries = out
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).trim() }))
      .filter((e) => !e.path.startsWith(APP_PREFIX));
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "STATUS FAILED" },
      { status: 500 },
    );
  }
}
