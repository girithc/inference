import { NextResponse } from "next/server";
import { findDeployables } from "@/lib/deploy";

export const dynamic = "force-dynamic";

/** All model subfolders that contain a Modal app — the agent-readable registry. */
export async function GET() {
  return NextResponse.json({ deployables: findDeployables() });
}
