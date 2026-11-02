import { NextRequest, NextResponse } from "next/server";
import { runCommand } from "@/lib/term";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** Run one command in the persistent terminal session. */
export async function POST(req: NextRequest) {
  try {
    const { command, echo } = (await req.json()) as {
      command?: string;
      echo?: boolean;
    };
    const result = await runCommand(command ?? "", { echo });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "RUN FAILED" },
      { status: 500 },
    );
  }
}
