import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fsp from "node:fs/promises";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { REPO_ROOT, getSetting, safeRepoPath } from "@/lib/server";
import { pushAll } from "@/lib/gitops";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const DEFAULT_MODEL = "accounts/fireworks/routers/glm-5p3-flash-us";

const SYSTEM = [
  "You restructure Modal inference code into a clean multi-file layout. Return ONLY valid JSON — no markdown fences, no commentary:",
  '{"files": [{"path": "<filename relative to the model folder>", "content": "<full file content>", "action": "write"}]}',
  "Rules:",
  "- Keep the Modal entry file under its EXACT current filename; it must keep the modal.App definition and the serving/web endpoint function.",
  "- Split by concern, one per file: model/weight download, configuration/constants, shared app object, serving.",
  "- Pattern: one module defines the shared `app = modal.App(...)`; function modules import it and register @app.function on it; the entry file imports every function module so a single `modal deploy <entry>` deploys everything.",
  "- Do NOT change behavior, function names, GPU config, CLI flags, image specs, or endpoints. Preserve every decorator and parameter exactly.",
  "- Python 3.10+ compatible. One-line module docstring per file.",
  '- If an original file becomes fully superseded, include it with "action": "delete" and no content.',
].join(" ");

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

function pyCompile(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    const py = fsExists(path.join(REPO_ROOT, "venv", "bin", "python"))
      ? path.join(REPO_ROOT, "venv", "bin", "python")
      : "python3";
    const child = spawn(py, ["-m", "py_compile", file]);
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) => resolve(code === 0 ? null : err.slice(0, 400)));
    child.on("error", (e) => resolve(null)); // no python available — skip check
  });
}

function fsExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

type PlannedFile = { path: string; content?: string; action?: string };

export async function POST(req: NextRequest) {
  try {
    const { folder } = (await req.json()) as { folder?: string };
    if (!folder) {
      return NextResponse.json({ error: "folder required" }, { status: 400 });
    }
    const folderAbs = safeRepoPath(folder);
    if (!fsExists(folderAbs) || !fsExistsStatDir(folderAbs)) {
      return NextResponse.json({ error: `folder not found: ${folder}` }, { status: 404 });
    }

    // 1. read every file in the subfolder
    const names = (await fsp.readdir(folderAbs)).filter(
      (n) => !n.startsWith(".") && n !== "__pycache__" && n.endsWith(".py"),
    );
    if (names.length === 0) {
      return NextResponse.json({ error: "no .py files in folder" }, { status: 400 });
    }
    const contents: string[] = [];
    for (const n of names) {
      const c = await fsp.readFile(path.join(folderAbs, n), "utf8");
      contents.push(`### ${n}\n\`\`\`\n${c.slice(0, 24_000)}\n\`\`\``);
    }

    // 2. ask Fireworks for the restructured layout
    const key = getSetting("ai_api_key") || process.env.FIREWORKS_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "no API key — set it in AI SETTINGS (gear icon) or FIREWORKS_API_KEY in webui/.env.local" },
        { status: 400 },
      );
    }
    const baseUrl = (
      getSetting("ai_base_url") || "https://api.fireworks.ai/inference/v1"
    ).replace(/\/+$/, "");
    const model = getSetting("ai_model") || process.env.FIREWORKS_MODEL || DEFAULT_MODEL;

    const fw = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 8192,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `MODEL FOLDER: ${folder}\n\n${contents.join("\n\n")}` },
        ],
      }),
      signal: AbortSignal.timeout(240_000),
    });
    if (!fw.ok) {
      const detail = await fw.text().catch(() => "");
      return NextResponse.json(
        { error: `FIREWORKS ${fw.status} — ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const fwData = (await fw.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = fwData.choices?.[0]?.message?.content ?? "";

    // 3. validate the plan
    const plan = extractJson(raw) as { files?: PlannedFile[] };
    const files = (plan.files ?? []).filter((f) => f && typeof f.path === "string");
    if (files.length === 0) {
      return NextResponse.json({ error: "model returned no files" }, { status: 502 });
    }
    for (const f of files) {
      if (f.path.startsWith("/") || f.path.includes("..")) {
        return NextResponse.json({ error: `unsafe path in plan: ${f.path}` }, { status: 400 });
      }
    }
    const entryFile = names.includes("inference.py")
      ? "inference.py"
      : names.find((n) => n === "app.py") ?? names[0];
    const entry = files.find((f) => f.path === entryFile);
    if (!entry || entry.action === "delete") {
      return NextResponse.json(
        { error: `plan must keep the entry file (${entryFile}) with the Modal app` },
        { status: 502 },
      );
    }

    // 4. syntax-check every written file in a sandbox dir before touching anything
    const tmp = path.join(REPO_ROOT, "webui", "data", "restructure-tmp");
    await fsp.rm(tmp, { recursive: true, force: true });
    for (const f of files) {
      if (f.action === "delete" || typeof f.content !== "string") continue;
      const target = path.join(tmp, f.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, f.content, "utf8");
    }
    const writtenPlanned = files.filter(
      (f) => f.action !== "delete" && typeof f.content === "string",
    );
    for (const f of writtenPlanned) {
      const err = await pyCompile(path.join(tmp, f.path));
      if (err) {
        await fsp.rm(tmp, { recursive: true, force: true });
        return NextResponse.json(
          { error: `syntax check failed for ${f.path}: ${err}` },
          { status: 502 },
        );
      }
    }

    // 5. apply to the real folder
    const applied: Array<{ path: string; action: string }> = [];
    for (const f of files) {
      const target = safeRepoPath(path.join(folder, f.path));
      if (f.action === "delete") {
        await fsp.rm(target, { force: true });
        applied.push({ path: f.path, action: "DELETED" });
        continue;
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, f.content ?? "", "utf8");
      applied.push({ path: f.path, action: "UPDATED" });
    }
    await fsp.rm(tmp, { recursive: true, force: true });

    // 6. commit + push so the GitHub tree reflects the new layout
    const push = await pushAll(`restructure ${folder} via AI`);
    if (!push.ok) {
      return NextResponse.json(
        { error: `files written but push failed: ${push.error}`, files: applied },
        { status: 200 },
      );
    }

    return NextResponse.json({ ok: true, folder, files: applied, commit: push.commit });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "RESTRUCTURE FAILED" },
      { status: 200 },
    );
  }
}

function fsExistsStatDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
