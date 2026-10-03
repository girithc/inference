"use client";

import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Model } from "@/lib/catalog";
import { architectures } from "@/lib/architectures";
import { kernels } from "@/lib/kernels";
import {
  formatError,
  formatResult,
  parseCurl,
  sampleCurl,
} from "@/lib/inference";

type StatusMode = "ready" | "running" | "success" | "error";
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
export type ModelSection = "architecture" | "playground" | "kernels";

interface ModelCardProps {
  model: Model;
  section: ModelSection | null;
  onOpenSection: (id: string, section: ModelSection) => void;
}

export function ModelCard({ model, section, onOpenSection }: ModelCardProps) {
  const [curl, setCurl] = useState(() => sampleCurl(model));
  const [architectureCode, setArchitectureCode] = useState(() => {
    const architecture = architectures[model.id];
    return architecture ? `# ${architecture.title}\n\n${architecture.code}` : "";
  });
  const [kernelCode, setKernelCode] = useState(() => {
    const kernel = kernels[model.id];
    return kernel ? `# ${kernel.title}\n\n${kernel.code}` : "";
  });
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [statusMode, setStatusMode] = useState<StatusMode>("ready");
  const [latency, setLatency] = useState("");
  const [usage, setUsage] = useState("");
  const [output, setOutput] = useState("Run this request.");
  const [raw, setRaw] = useState("No response yet.");

  const editorId = `${model.id}-curl`;
  const kernelEditorId = `${model.id}-kernel`;
  const architectureEditorId = `${model.id}-architecture`;

  const editorLabel = useMemo(() => `${model.name} cURL request`, [model.name]);
  const kernelLabel = useMemo(() => `${model.name} Triton kernel`, [model.name]);
  const architectureLabel = useMemo(() => `${model.name} architecture`, [model.name]);

  const setStatusState = (text: string, mode: StatusMode) => {
    setStatus(text);
    setStatusMode(mode);
  };

  const setRunningState = (nextRunning: boolean) => {
    setRunning(nextRunning);
    if (nextRunning) setStatusState("Running", "running");
  };

  const renderUsage = (value: Usage) => {
    const parts: string[] = [];
    if (value.prompt_tokens !== undefined) parts.push(`${value.prompt_tokens} in`);
    if (value.completion_tokens !== undefined) parts.push(`${value.completion_tokens} out`);
    if (value.total_tokens !== undefined) parts.push(`${value.total_tokens} total`);
    setUsage(parts.join(" · "));
  };

  async function consumeStream(response: Response): Promise<void> {
    if (!response.body) {
      throw new Error("This browser does not expose a streaming response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoning = "";
    let usageValue: Usage | undefined;
    const rawLines: string[] = [];

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        rawLines.push(trimmed);
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
            }>;
            usage?: Usage;
          };
          const delta = parsed.choices?.[0]?.delta ?? {};
          if (typeof delta.content === "string") content += delta.content;
          if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
          if (parsed.usage) usageValue = parsed.usage;

          let streamOutput = content || "(No text returned.)";
          if (reasoning.trim()) {
            streamOutput += `\n\n--- Reasoning ---\n${reasoning}`;
          }
          setOutput(streamOutput);
          if (usageValue) renderUsage(usageValue);
        } catch {
          // Ignore keep-alive or partial frames.
        }
      }
    }

    setRaw(rawLines.join("\n"));
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = "Run out of modal.com credits. Will be back soon.";
    setStatusState("Unavailable", "error");
    setOutput(message);
    setRaw(message);
    setLatency("");
    setUsage("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  const playgroundPanelId = `${model.id}-playground`;
  const kernelsPanelId = `${model.id}-kernels`;
  const architecturePanelId = `${model.id}-architecture`;
  const open = section !== null;

  return (
    <article className="model-card" data-model-id={model.id} role="listitem">
      <div className="model-header">
        <span className="model-name">{model.name}</span>
        <div className="model-actions">
          <button
            type="button"
            className="concept-button"
            aria-expanded={open && section === "architecture"}
            aria-controls={architecturePanelId}
            onClick={() => onOpenSection(model.id, "architecture")}
          >
            architecture
          </button>
          <button
            type="button"
            className="concept-button"
            aria-expanded={open && section === "playground"}
            aria-controls={playgroundPanelId}
            onClick={() => onOpenSection(model.id, "playground")}
          >
            playground
          </button>
          <button
            type="button"
            className="concept-button"
            aria-expanded={open && section === "kernels"}
            aria-controls={kernelsPanelId}
            onClick={() => onOpenSection(model.id, "kernels")}
          >
            kernels
          </button>
        </div>
      </div>

      <div className="model-panel" id={architecturePanelId} hidden={section !== "architecture"}>
        <div className="architecture-panel">
          <label className="visually-hidden" htmlFor={architectureEditorId}>
            {architectureLabel}
          </label>
          <textarea
            id={architectureEditorId}
            className="architecture-editor"
            value={architectureCode}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setArchitectureCode(event.target.value)}
          />
        </div>
      </div>

      <div className="model-panel" id={playgroundPanelId} hidden={section !== "playground"}>
        <div className="request-response-grid">
          <form className="request-column" onSubmit={run} onKeyDown={onKeyDown}>
            <div className="panel-column-header">
              <h2>cURL request</h2>
              <span className="shortcut">⌘/Ctrl + Enter</span>
            </div>
            <label className="visually-hidden" htmlFor={editorId}>
              {editorLabel}
            </label>
            <textarea
              id={editorId}
              className="curl-editor"
              value={curl}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setCurl(event.target.value)}
            />
            <div className="editor-actions">
              <button className="run" type="submit" disabled={running}>
                Run request
              </button>
            </div>
          </form>

          <section className="response-column">
            <div className="panel-column-header">
              <h2>Response</h2>
              <div className="response-header-meta">
                <span className={`state ${statusMode}`}>{status}</span>
                <span className="metric latency">{latency}</span>
                <span className="metric usage">{usage}</span>
              </div>
            </div>
            <pre className="output-text">{output || "Run this request."}</pre>
            <details className="raw-response">
              <summary>Raw response</summary>
              <pre>{raw}</pre>
            </details>
          </section>
        </div>
      </div>

      <div className="model-panel" id={kernelsPanelId} hidden={section !== "kernels"}>
        <div className="kernel-panel">
          <label className="visually-hidden" htmlFor={kernelEditorId}>
            {kernelLabel}
          </label>
          <textarea
            id={kernelEditorId}
            className="kernel-editor"
            value={kernelCode}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setKernelCode(event.target.value)}
          />
        </div>
      </div>
    </article>
  );
}
