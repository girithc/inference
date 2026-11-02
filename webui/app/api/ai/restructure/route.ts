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
    const py = fs.existsSync(path.join(REPO_ROOT, "venv", "bin", "python"))
      ? path.join(REPO_ROOT, "venv", "bin", "python")
      : "python3";
    const child = spawn(py, ["-m", "py_compile", file]);
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) => resolve(code === 0 ? null : err.slice(0, 400)));
    child.on("error", () => resolve(null)); // no python available — skip check
  });
}

export async function POST(req: NextRequest) {
  let folder: string | undefined;
  try {
    ({ folder } = (await req.json()) as { folder?: string });
  } catch {
    /* body parse fail handled below */
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
        } catch {
          /* consumer gone */
        }
      };
      const fail = (m: string) => {
        send({ t: "err", m });
        controller.close();
      };

      try {
        if (!folder) return fail("folder required");
        const folderAbs = safeRepoPath(folder);
        if (!fs.existsSync(folderAbs) || !fs.statSync(folderAbs).isDirectory()) {
          return fail(`folder not found: ${folder}`);
        }

        send({ t: "s", m: `reading ${folder}…` });
        const names = (await fsp.readdir(folderAbs)).filter(
          (n) => !n.startsWith(".") && n !== "__pycache__" && n.endsWith(".py"),
        );
        if (names.length === 0) return fail("no .py files in folder");
        const contents: string[] = [];
        for (const n of names) {
          const c = await fsp.readFile(path.join(folderAbs, n), "utf8");
          contents.push(`### ${n}\n\`\`\`\n${c.slice(0, 24_000)}\n\`\`\``);
        }
        send({ t: "s", m: `${names.length} file(s) read` });

        const key = getSetting("ai_api_key") || process.env.FIREWORKS_API_KEY;
        if (!key)
          return fail("no API key — set it in AI SETTINGS (gear icon) or FIREWORKS_API_KEY in webui/.env.local");
        const baseUrl = (
          getSetting("ai_base_url") || "https://api.fireworks.ai/inference/v1"
        ).replace(/\/+$/, "");
        const model = getSetting("ai_model") || process.env.FIREWORKS_MODEL || DEFAULT_MODEL;

        send({ t: "s", m: `planning with ${model.split("/").pop()}…` });
        const fw = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            max_tokens: 8192,
            stream: true,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: `MODEL FOLDER: ${folder}\n\n${contents.join("\n\n")}` },
            ],
          }),
          signal: AbortSignal.timeout(240_000),
        });
        if (!fw.ok || !fw.body) {
          const detail = await fw.text().catch(() => "");
          return fail(`FIREWORKS ${fw.status} — ${detail.slice(0, 200)}`);
        }

        // stream the model's output as it composes the plan
        const reader = fw.body.getReader();
        const dec = new TextDecoder();
        let raw = "";
        let sse = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          sse += dec.decode(value, { stream: true });
          const lines = sse.split("\n");
          sse = lines.pop() ?? "";
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith("data:")) continue;
            const payload = l.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = j.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                raw += delta;
                send({ t: "c", d: delta });
              }
            } catch {
              /* partial frame */
            }
          }
        }

        send({ t: "s", m: "validating plan…" });
        const plan = extractJson(raw) as {
          files?: Array<{ path?: string; content?: string; action?: string }>;
        };
        const files = (plan.files ?? []).filter(
          (f): f is { path: string; content?: string; action?: string } =>
            !!f && typeof f.path === "string",
        );
        if (files.length === 0) return fail("model returned no files");
        for (const f of files) {
          if (f.path.startsWith("/") || f.path.includes("..")) {
            return fail(`unsafe path in plan: ${f.path}`);
          }
        }
        const entryFile = names.includes("inference.py")
          ? "inference.py"
          : names.includes("app.py")
            ? "app.py"
            : names[0];
        const entry = files.find((f) => f.path === entryFile);
        if (!entry || entry.action === "delete") {
          return fail(`plan must keep the entry file (${entryFile}) with the Modal app`);
        }

        // syntax-check everything in a sandbox before touching the folder
        const tmp = path.join(REPO_ROOT, "webui", "data", "restructure-tmp");
        await fsp.rm(tmp, { recursive: true, force: true });
        const planned = files.filter(
          (f) => f.action !== "delete" && typeof f.content === "string",
        );
        for (const f of planned) {
          const target = path.join(tmp, f.path);
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await fsp.writeFile(target, f.content ?? "", "utf8");
        }
        for (const f of planned) {
          send({ t: "s", m: `syntax check: ${f.path}` });
          const err = await pyCompile(path.join(tmp, f.path));
          if (err) {
            await fsp.rm(tmp, { recursive: true, force: true });
            return fail(`syntax check failed for ${f.path}: ${err}`);
          }
        }

        // apply
        send({ t: "s", m: "writing files…" });
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

        send({ t: "s", m: "commit + push…" });
        const push = await pushAll(`restructure ${folder} via AI`);
        if (!push.ok) {
          send({ t: "err", m: `files written but push failed: ${push.error ?? ""}` });
          send({ t: "done", folder, files: applied });
          controller.close();
          return;
        }

        send({ t: "done", folder, files: applied, commit: push.commit });
        controller.close();
      } catch (err) {
        fail(err instanceof Error ? err.message : "RESTRUCTURE FAILED");
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
}
