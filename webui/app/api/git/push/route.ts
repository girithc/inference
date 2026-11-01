import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { REPO_ROOT } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: REPO_ROOT }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`;
      if (err) reject(new Error(out || err.message));
      else resolve(out);
    });
  });
}

/**
 * Commit everything on disk and push. Rebases over remote first — file saves
 * commit straight to GitHub via the API, so local and remote can diverge.
 */
export async function POST() {
  const out: string[] = [];
  const step = async (args: string[], allowFail = false) => {
    out.push(`$ git ${args.join(" ")}`);
    try {
      out.push(await run(args));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push(msg);
      if (!allowFail) return NextResponse.json({ ok: false, output: out.join("\n"), error: msg });
    }
    return null;
  };

  const early = await step(["add", "-A"]);
  if (early) return early;
  const commit = await step(["commit", "-m", "sync via inference✳ studio"], true);
  if (commit) return commit;
  const pull = await step(["pull", "--rebase"]);
  if (pull) return pull;
  const push = await step(["push"]);
  if (push) return push;

  return NextResponse.json({ ok: true, output: out.join("\n") });
}
