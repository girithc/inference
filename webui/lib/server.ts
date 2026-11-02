import { execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** The Next server runs from webui/ — the repo root is one level up. */
export const REPO_ROOT = path.resolve(process.cwd(), "..");

/** The studio app itself lives here — the editor is scoped to inference code. */
export const APP_PREFIX = "webui/";

let db: DatabaseSync | null = null;

/** SQLite at webui/data/studio.db — persistent app settings. */
export function getDb(): DatabaseSync {
  if (!db) {
    const dir = path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "studio.db"));
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
  }
  return db;
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

let repoCache: string | null = null;

export function ghToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", ["auth", "token"], (err, stdout) => {
      if (err) reject(new Error("gh CLI not authenticated — run `gh auth login`"));
      else resolve(stdout.trim());
    });
  });
}

/** owner/name, parsed from the origin remote. */
export function getRepo(): Promise<string> {
  if (repoCache) return Promise.resolve(repoCache);
  return new Promise((resolve, reject) => {
    execFile("git", ["remote", "get-url", "origin"], { cwd: REPO_ROOT }, (err, stdout) => {
      if (err) return reject(new Error("no git origin remote"));
      const url = stdout.trim().replace(/\.git$/, "");
      const m = url.match(/github\.com[:/](.+?\/.+?)$/);
      if (!m) return reject(new Error(`cannot parse origin: ${url}`));
      repoCache = m[1];
      resolve(repoCache);
    });
  });
}

export async function gh(pathname: string, init?: RequestInit): Promise<Response> {
  const token = await ghToken();
  return fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
}

/** Prefer the repo's venv modal binary; fall back to PATH. */
export function modalBin(): string {
  const local = path.join(REPO_ROOT, "venv", "bin", "modal");
  return fs.existsSync(local) ? local : "modal";
}

/** Resolve a repo-relative path and refuse anything escaping the repo. */
export function safeRepoPath(rel: string): string {
  const abs = path.resolve(REPO_ROOT, rel);
  if (!abs.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`path escapes repo: ${rel}`);
  }
  return abs;
}
