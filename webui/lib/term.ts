import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { REPO_ROOT } from "./server";

/**
 * Terminal session: commands run one-at-a-time in their own killable bash
 * process. Working directory + exported environment persist across commands
 * via files under webui/data/term/.
 */

type TermSession = {
  buffer: string;
  subs: Set<(s: string) => void>;
  child: ChildProcessWithoutNullStreams | null;
  interrupted: boolean;
  cwdFile: string;
  envFile: string;
  nextFile: string;
};

const g = globalThis as unknown as { __term?: TermSession };
const DIR = path.join(process.cwd(), "data", "term");

function session(): TermSession {
  if (!g.__term) {
    fs.mkdirSync(DIR, { recursive: true });
    const cwdFile = path.join(DIR, "cwd.txt");
    const envFile = path.join(DIR, "env.sh");
    const nextFile = path.join(DIR, "next.sh");
    if (!fs.existsSync(cwdFile)) fs.writeFileSync(cwdFile, REPO_ROOT);
    if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, "");
    const sess: TermSession = {
      buffer: "",
      subs: new Set(),
      child: null,
      interrupted: false,
      cwdFile,
      envFile,
      nextFile,
    };
    g.__term = sess;
    broadcast(prompt());
  }
  return g.__term;
}

function shortCwd(): string {
  const cwd = fs.readFileSync(session().cwdFile, "utf8").trim() || REPO_ROOT;
  return cwd.startsWith(REPO_ROOT) ? "~" + cwd.slice(REPO_ROOT.length) : cwd;
}

function prompt(): string {
  return `\r\n\x1b[38;2;255;77;0m✳\x1b[0m \x1b[2m${shortCwd()}\x1b[0m \x1b[1m$\x1b[0m `;
}

function broadcast(s: string): void {
  const sess = session();
  sess.buffer = (sess.buffer + s).slice(-60_000);
  for (const sub of sess.subs) {
    try {
      sub(s);
    } catch {
      /* subscriber gone */
    }
  }
}

export function replay(): string {
  return session().buffer;
}

/** Raw scrollback — for scanning deploy output (endpoints etc). */
export function buffer(): string {
  return session().buffer;
}

export function subscribe(sub: (s: string) => void): () => void {
  const sess = session();
  sess.subs.add(sub);
  return () => {
    sess.subs.delete(sub);
  };
}

export function isBusy(): boolean {
  return !!session().child;
}

export function interrupt(): void {
  const sess = session();
  if (!sess.child) return;
  sess.interrupted = true;
  broadcast("^C\r\n");
  try {
    sess.child.kill("SIGINT");
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    try {
      sess.child?.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, 1500);
}

export async function runCommand(
  command: string,
  opts: { echo?: boolean } = {},
): Promise<{ ok: boolean; code?: number; error?: string }> {
  const sess = session();
  const cmd = command.trim();

  if (!cmd) {
    broadcast(prompt());
    return { ok: true };
  }
  if (sess.child) {
    return { ok: false, error: "a command is still running — INTERRUPT it first" };
  }

  if (opts.echo) broadcast(`${prompt()}${cmd}\r\n`);
  fs.writeFileSync(sess.nextFile, cmd);
  sess.interrupted = false;

  const wrapper = [
    `source "${sess.envFile}" 2>/dev/null;`,
    `cd "$(cat "${sess.cwdFile}" 2>/dev/null)" 2>/dev/null;`,
    `source "${sess.nextFile}";`,
    `s=$?;`,
    `declare -px > "${sess.envFile}" 2>/dev/null;`,
    `pwd > "${sess.cwdFile}" 2>/dev/null;`,
    `exit $s`,
  ].join(" ");

  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", wrapper], { cwd: REPO_ROOT, env: process.env });
    sess.child = child;
    const push = (chunk: Buffer) => broadcast(chunk.toString());
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      sess.child = null;
      broadcast(
        sess.interrupted
          ? "\r\n\x1b[2m[interrupted]\x1b[0m"
          : `\r\n\x1b[2m[exit ${code ?? "?"}]\x1b[0m`,
      );
      broadcast(prompt());
      resolve({ ok: true, code: code ?? -1 });
    };
    child.on("close", finish);
  });
}
