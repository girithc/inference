import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, APP_PREFIX } from "./server";

/** Folders to never scan when looking for Modal apps. */
const SKIP = new Set([
  "webui",
  "venv",
  "node_modules",
  ".next",
  "__pycache__",
  "data",
  ".npm-cache",
]);

export type Deployable = { folder: string; entry: string; files: string[] };

/**
 * A deployable = a model subfolder containing a .py file that defines a
 * Modal app (modal.App). The whole folder deploys via its entry file —
 * sibling modules (setup.py etc.) resolve through normal imports.
 */
export function findDeployables(): Deployable[] {
  const out: Deployable[] = [];

  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const pys: Array<{ rel: string; abs: string }> = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "__pycache__") continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        walk(childAbs, childRel);
      } else if (e.name.endsWith(".py")) {
        pys.push({ rel: childRel, abs: childAbs });
      }
    }
    if (!rel) return; // root-level loose files aren't a model folder
    const entry = pys.find((p) => {
      try {
        const src = fs.readFileSync(p.abs, "utf8");
        return src.includes("modal.App") || src.includes("modal.App(");
      } catch {
        return false;
      }
    });
    if (entry) {
      out.push({ folder: rel, entry: entry.rel, files: pys.map((p) => p.rel) });
    }
  };

  walk(REPO_ROOT, "");
  return out;
}

/** Endpoint URLs found in recent terminal scrollback. */
export function endpointsFrom(buffer: string): string[] {
  return [...new Set(buffer.match(/https:\/\/[^\s"']+\.modal\.run/g) ?? [])];
}
