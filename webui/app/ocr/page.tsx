"use client";

import { useEffect, useRef, useState } from "react";
import { EndpointPicker } from "@/app/components/EndpointPicker";
import { listEndpoints, streamChat } from "@/lib/client";
import { fmtMs, fmtRate } from "@/lib/types";
import type { Endpoint, Usage } from "@/lib/types";

const TEMPLATES: Record<string, { label: string; text: string }> = {
  full: {
    label: "full text → markdown",
    text: "Extract all text content from this document. Output clean markdown: headings as #, lists as -, tables as markdown tables. Do not add commentary.",
  },
  tables: {
    label: "tables → markdown",
    text: "Extract every table in this document as markdown tables, preserving row and column structure. If there are no tables, output NONE.",
  },
  exact: {
    label: "exact transcription",
    text: "Transcribe the text in this image exactly as written, preserving line breaks and reading order. Output nothing else.",
  },
  summary: {
    label: "what is this?",
    text: "Describe this document briefly: what it is, its key fields or figures, and any dates visible.",
  },
  custom: { label: "custom", text: "" },
};

interface OcrRun {
  thumb: string;
  output: string;
  ttftMs: number | null;
  totalMs: number;
  usage?: Usage;
  endpoint: string;
  template: string;
}

export default function OcrPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [endpointId, setEndpointId] = useState("");

  const [img, setImg] = useState<{ file: File; url: string } | null>(null);
  const [templateKey, setTemplateKey] = useState("full");
  const [custom, setCustom] = useState("");
  const [maxTokens, setMaxTokens] = useState(2048);

  const [output, setOutput] = useState("");
  const [metrics, setMetrics] = useState<{ ttftMs: number | null; totalMs: number; usage?: Usage } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<OcrRun[]>([]);
  const [drag, setDrag] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listEndpoints().then((r) => {
      setEndpoints(r.endpoints);
      const first = r.endpoints.find((e) => e.kind === "ocr") ?? r.endpoints[0];
      if (first) setEndpointId((v) => v || first.id);
    });
  }, []);

  // clipboard paste of images
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (f) loadImage(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function loadImage(file: File) {
    const url = URL.createObjectURL(file);
    setImg({ file, url });
    setOutput("");
    setMetrics(null);
    setError("");
  }

  async function run() {
    if (!img || !ep || running) return;
    setRunning(true);
    setError("");
    setOutput("");
    setMetrics(null);

    const prompt =
      templateKey === "custom" ? custom.trim() : TEMPLATES[templateKey]?.text ?? TEMPLATES.full.text;

    // image bytes → base64 data URL (read fresh each run)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("failed to read image"));
      r.readAsDataURL(img.file);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "read failed");
      return null;
    });
    if (!dataUrl) {
      setRunning(false);
      return;
    }

    const body = {
      model: ep.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt || TEMPLATES.full.text },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
    };

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";
    try {
      const m = await streamChat(ep.id, body, {
        signal: ctrl.signal,
        onContent: (t) => {
          acc += t;
          setOutput(acc);
        },
        onUsage: (u) => setMetrics((prev) => ({ ...(prev ?? { ttftMs: null, totalMs: 0 }), usage: u })),
      });
      setMetrics((prev) => ({ ttftMs: m.ttftMs, totalMs: m.totalMs, usage: prev?.usage }));
      if (m.error) setError(m.error);
      else if (acc.trim())
        setHistory((h) =>
          [
            {
              thumb: img.url,
              output: acc,
              ttftMs: m.ttftMs,
              totalMs: m.totalMs,
              endpoint: ep.name,
              template: templateKey,
            },
            ...h,
          ].slice(0, 6),
        );
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const ep = endpoints.find((e) => e.id === endpointId);

  return (
    <div className="page">
      <div className="page-head">
        <span className="idx">02</span>
        <h1>OCR</h1>
      </div>
      <p className="page-sub">
        Document understanding over the OCR deployment. Drop, paste, or pick an image; output streams
        as the model reads. Vision requests go through the OpenAI-compatible{" "}
        <code className="mono">image_url</code> content part.
      </p>

      <div className="split">
        {/* ------------------------------------------------ input ----- */}
        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <p className="card-title">deployment</p>
            <EndpointPicker endpoints={endpoints} kind="ocr" value={endpointId} onChange={setEndpointId} />
            {ep && (
              <div className="faint mono" style={{ fontSize: 10, marginTop: 8, wordBreak: "break-all" }}>
                {ep.baseUrl}
              </div>
            )}
          </div>

          <div className="card">
            <p className="card-title">document</p>
            <div
              className={`dropzone ${drag ? "over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
                if (f) loadImage(f);
              }}
            >
              {img ? "SWAP IMAGE — DROP, PASTE OR CLICK" : "DROP IMAGE · PASTE FROM CLIPBOARD · CLICK TO BROWSE"}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadImage(f);
                e.target.value = "";
              }}
            />
            {img && (
              <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "flex-start" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt="document preview"
                  style={{ maxWidth: "100%", maxHeight: 280, border: "1px solid var(--hair)" }}
                />
                <div className="faint mono" style={{ fontSize: 10, lineHeight: 1.8 }}>
                  {img.file.name}
                  <br />
                  {(img.file.size / 1024).toFixed(0)} KB
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <p className="card-title">prompt template</p>
            <div className="row wrap">
              {Object.entries(TEMPLATES).map(([k, t]) => (
                <button
                  key={k}
                  className={`chip ${templateKey === k ? "sel" : ""}`}
                  onClick={() => setTemplateKey(k)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {templateKey === "custom" && (
              <textarea
                className="field"
                rows={3}
                style={{ marginTop: 10 }}
                placeholder="Your instruction for the OCR model…"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <div style={{ width: 140 }}>
                <label className="label">max_tokens</label>
                <input className="field" type="number" min={1} max={8192} value={maxTokens}
                  onChange={(e) => setMaxTokens(Math.max(1, Number(e.target.value)))} />
              </div>
              <div style={{ alignSelf: "flex-end" }} className="row">
                <button className="btn btn-primary" onClick={run} disabled={!img || running || !ep}>
                  {running ? "reading…" : "run ocr"}
                </button>
                {running && (
                  <button className="btn" onClick={() => abortRef.current?.abort()}>
                    stop
                  </button>
                )}
              </div>
            </div>
          </div>

          {history.length > 0 && (
            <div className="card">
              <p className="card-title">this session</p>
              <div className="row wrap">
                {history.map((h, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={h.thumb}
                    alt={`run ${i}`}
                    title={`${h.endpoint} · ${h.template}`}
                    onClick={() => {
                      setOutput(h.output);
                      setMetrics({ ttftMs: h.ttftMs, totalMs: h.totalMs });
                      setError("");
                    }}
                    style={{
                      width: 64,
                      height: 48,
                      objectFit: "cover",
                      border: "1px solid var(--hair)",
                      cursor: "pointer",
                      opacity: 0.75,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------------------------ output ---- */}
        <aside className="card" style={{ display: "flex", flexDirection: "column", minHeight: 480 }}>
          <p className="card-title">
            output
            <span className="row" style={{ gap: 6 }}>
              {output && (
                <>
                  <button
                    className="btn btn-sm"
                    onClick={() => navigator.clipboard.writeText(output)}
                  >
                    copy
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const blob = new Blob([output], { type: "text/markdown" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = "ocr-output.md";
                      a.click();
                    }}
                  >
                    .md
                  </button>
                </>
              )}
            </span>
          </p>

          {error && <div className="error-box" style={{ marginBottom: 10 }}>{error}</div>}

          {output ? (
            <pre
              className={`mono ${running ? "caret" : ""}`}
              style={{
                margin: 0,
                flex: 1,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12.5,
                lineHeight: 1.6,
                color: "var(--text)",
              }}
            >
              {output}
            </pre>
          ) : (
            <div className="empty" style={{ flex: 1, display: "grid", placeItems: "center" }}>
              {running ? "READING…" : "OUTPUT APPEARS HERE"}
            </div>
          )}

          {metrics && (
            <div className="msg-foot" style={{ borderTopColor: "var(--hair)" }}>
              <span>ttft {fmtMs(metrics.ttftMs)}</span>
              <span>total {fmtMs(metrics.totalMs)}</span>
              {metrics.usage?.completion_tokens ? (
                <span>
                  {metrics.usage.completion_tokens} tokens ·{" "}
                  {fmtRate(
                    metrics.totalMs > (metrics.ttftMs ?? 0)
                      ? metrics.usage.completion_tokens /
                          ((metrics.totalMs - (metrics.ttftMs ?? 0)) / 1000)
                      : null,
                  )}
                </span>
              ) : (
                <span>{output.length} chars</span>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
