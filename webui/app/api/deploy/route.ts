import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { findDeployables, endpointsFrom } from "@/lib/deploy";
import { runCommand, isBusy, buffer } from "@/lib/term";
import { getDb, REPO_ROOT } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * The deploy workflow: folder → entry file → `modal deploy` in the terminal
 * session → recorded in SQLite (folder, exit code, endpoints, timestamps).
 * This endpoint IS the workflow — UI and AI agents call the same thing.
 */
export async function POST(req: NextRequest) {
  try {
    const { folder } = (await req.json()) as { folder?: string };
    if (!folder) {
      return NextResponse.json({ ok: false, error: "folder required" }, { status: 400 });
    }

    const deployable = findDeployables().find((d) => d.folder === folder);
    if (!deployable) {
      return NextResponse.json(
        { ok: false, error: `no Modal app found in ${folder}` },
        { status: 404 },
      );
    }
    if (isBusy()) {
      return NextResponse.json(
        { ok: false, error: "terminal busy — interrupt the running command first" },
        { status: 409 },
      );
    }

    const db = getDb();
    const started = Date.now();
    const ins = db
      .prepare("INSERT INTO deploys (folder, entry, started_at, status) VALUES (?, ?, ?, 'RUNNING')")
      .run(deployable.folder, deployable.entry, started);
    const id = Number(ins.lastInsertRowid);

    // absolute path — the session cwd may be anywhere
    const result = await runCommand(`modal deploy ${path.join(REPO_ROOT, deployable.entry)}`, {
      echo: true,
    });

    const code = result.code ?? -1;
    const endpoints = endpointsFrom(buffer().slice(-20_000));
    db.prepare(
      "UPDATE deploys SET finished_at = ?, code = ?, status = ?, endpoints = ? WHERE id = ?",
    ).run(
      Date.now(),
      code,
      code === 0 ? "LIVE" : "FAILED",
      endpoints.join(" "),
      id,
    );

    return NextResponse.json({ ok: code === 0, code, endpoints, id });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DEPLOY FAILED" },
      { status: 500 },
    );
  }
}
