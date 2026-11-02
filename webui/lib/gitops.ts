import { execFile } from "node:child_process";
import { REPO_ROOT } from "./server";

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
export async function pushAll(
  message = "sync via inference✳ studio",
): Promise<{ ok: boolean; output: string; error?: string; commit?: string }> {
  const out: string[] = [];
  const step = async (args: string[], allowFail = false) => {
    out.push(`$ git ${args.join(" ")}`);
    try {
      out.push(await run(args));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push(msg);
      if (!allowFail) return { ok: false as const, output: out.join("\n"), error: msg };
    }
    return null;
  };

  let res = await step(["add", "-A"]);
  if (res) return res;
  res = await step(["commit", "-m", message], true);
  if (res) return res;
  res = await step(["pull", "--rebase"]);
  if (res) return res;
  res = await step(["push"]);
  if (res) return res;

  let commit: string | undefined;
  try {
    commit = (await run(["rev-parse", "--short", "HEAD"])).trim();
  } catch {
    /* ignore */
  }
  return { ok: true, output: out.join("\n"), commit };
}
