import { NextResponse } from "next/server";
import { interrupt } from "@/lib/term";

export const dynamic = "force-dynamic";

/** Ctrl-C — interrupt the running command. */
export async function POST() {
  interrupt();
  return NextResponse.json({ ok: true });
}
