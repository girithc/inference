import { NextResponse } from "next/server";
import { pushAll } from "@/lib/gitops";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Commit everything on disk and push. */
export async function POST() {
  const result = await pushAll();
  return NextResponse.json(result, { status: 200 });
}
