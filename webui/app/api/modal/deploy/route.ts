import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { REPO_ROOT, modalBin, safeRepoPath } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Spawn `modal deploy <file>` and stream combined output as it happens. */
export async function POST(req: NextRequest) {
  let rel: string;
  try {
    const body = (await req.json()) as { path: string; content?: string };
    rel = body.path;
    const abs = safeRepoPath(rel);
    // deploy exactly what the editor holds — flush unsaved edits to disk first
    if (typeof body.content === "string") {
      await fs.writeFile(abs, body.content, "utf8");
    }
  } catch {
    return NextResponse.json({ error: "valid repo path required" }, { status: 400 });
  }

  const child = spawn(modalBin(), ["deploy", rel], { cwd: REPO_ROOT });
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const push = (chunk: Buffer) => {
        try {
          controller.enqueue(enc.encode(chunk.toString()));
        } catch {
          /* consumer gone */
        }
      };
      child.stdout.on("data", push);
      child.stderr.on("data", push);
      child.on("error", (e) => {
        push(Buffer.from(`\n[SPAWN ERROR] ${e.message}\n`));
        controller.close();
      });
      child.on("close", (code) => {
        push(Buffer.from(`\n[EXIT ${code}]\n`));
        controller.close();
      });
    },
    cancel() {
      child.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
