import { NextRequest, NextResponse } from "next/server";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { REPO_ROOT, modalBin } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stream `modal app logs <app> -f` — live container logs, until client aborts. */
export async function GET(req: NextRequest) {
  const app = req.nextUrl.searchParams.get("app");
  if (!app) return NextResponse.json({ error: "app required" }, { status: 400 });

  const child: ChildProcessWithoutNullStreams = spawn(
    modalBin(),
    ["app", "logs", app, "-f"],
    { cwd: REPO_ROOT },
  );

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
      child.on("error", (e: Error) => {
        push(Buffer.from(`\n[SPAWN ERROR] ${e.message}\n`));
        controller.close();
      });
      child.on("close", (code: number | null) => {
        push(Buffer.from(`\n[LOGS ENDED — EXIT ${code}]\n`));
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
