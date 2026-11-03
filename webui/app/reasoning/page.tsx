"use client";

import { useEffect, useRef, useState } from "react";
import { EndpointPicker } from "@/app/components/EndpointPicker";
import { listEndpoints, streamChat } from "@/lib/client";
import { Markdownish } from "@/lib/md";
import { fmtMs, fmtRate } from "@/lib/types";
import type { Endpoint, Usage } from "@/lib/types";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  ttftMs?: number | null;
  totalMs?: number;
  usage?: Usage;
  error?: string;
}

const STORE_KEY = "canvas.reasoning.thread";

const PRESETS: Record<string, { label: string; text: string }> = {
  math: {
    label: "proof",
    text: "Prove that √2 is irrational. Walk through the argument carefully.",
  },
  plan: {
    label: "plan",
    text: "I have 2 GPUs (A100 80GB) and need to serve a 27B model with low latency. Compare tensor parallelism vs quantization-only, and recommend one.",
  },
  code: {
    label: "code",
    text: "Write a Python function that computes rolling percentiles over a stream of floats using a fixed-size window, O(n log w). Include a short correctness note.",
  },
};

export default function ReasoningPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [endpointId, setEndpointId] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  // sampling controls
  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.95);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [thinking, setThinking] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listEndpoints().then((r) => {
      setEndpoints(r.endpoints);
      const first = r.endpoints.find((e) => e.kind === "reasoning") ?? r.endpoints[0];
      if (first) setEndpointId((v) => v || first.id);
    });
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const ep = endpoints.find((e) => e.id === endpointId);

  async function send() {
    const text = input.trim();
    if (!text || !ep || streaming) return;

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const history = messages;
    setInput("");
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "assistant" as const, content: "" },
    ]);

    const apiMessages: { role: string; content: string }[] = [];
    if (system.trim()) apiMessages.push({ role: "system", content: system.trim() });
    for (const m of history) {
      if (!m.error) apiMessages.push({ role: m.role, content: m.content });
    }
    apiMessages.push({ role: "user", content: text });

    const body: Record<string, unknown> = {
      model: ep.model,
      messages: apiMessages,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (!thinking) body.chat_template_kwargs = { enable_thinking: false };

    try {
      const metrics = await streamChat(ep.id, body, {
        signal: ctrl.signal,
        onReasoning: (t) =>
          setMessages((m) =>
            m.map((x) => (x.id === assistantId ? { ...x, reasoning: (x.reasoning ?? "") + t } : x)),
          ),
        onContent: (t) =>
          setMessages((m) =>
            m.map((x) => (x.id === assistantId ? { ...x, content: x.content + t } : x)),
          ),
        onUsage: (u) =>
          setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, usage: u } : x))),
      });
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId
            ? { ...x, ttftMs: metrics.ttftMs, totalMs: metrics.totalMs, error: metrics.error }
            : x,
        ),
      );
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setMessages((m) =>
          m.map((x) =>
            x.id === assistantId
              ? { ...x, error: err instanceof Error ? err.message : "request failed" }
              : x,
          ),
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const genRate = (m: ChatMsg): number | null => {
    if (m.usage?.completion_tokens && m.totalMs && m.ttftMs != null) {
      const genMs = m.totalMs - m.ttftMs;
      return genMs > 0 ? m.usage.completion_tokens / (genMs / 1000) : null;
    }
    return null;
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="idx">03</span>
        <h1>Reason</h1>
      </div>
      <p className="page-sub">
        Chat canvas over the reasoning deployment. Thinking is streamed separately from the answer
        (<code className="mono">reasoning_content</code>), tokens/s reported per message.
      </p>

      <div className="grid-2-1">
        {/* ------------------------------------------------ thread ---- */}
        <section>
          <div ref={threadRef} style={{ maxHeight: "62vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
            {messages.length === 0 && (
              <div className="hint">
                Ask anything. Sample prompts:{" "}
                {Object.entries(PRESETS).map(([k, p], i) => (
                  <span key={k}>
                    {i > 0 && " · "}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: 0 }}
                      onClick={() => setInput(p.text)}
                    >
                      {p.label}
                    </button>
                  </span>
                ))}
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="msg user">
                  <div className="who">
                    <span>you</span>
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="msg">
                  <div className="who">
                    <span>{ep ? ep.model : "assistant"}</span>
                  </div>

                  {m.reasoning ? (
                    <details className="think" open={!m.content}>
                      <summary className="think-head">thinking</summary>
                      <div className="think-body">{m.reasoning}</div>
                    </details>
                  ) : streaming && m.content === "" && !m.error ? (
                    <div className="shimmer">thinking…</div>
                  ) : null}

                  {m.content ? (
                    <div className={streaming && !m.usage ? "caret" : ""}>
                      <Markdownish text={m.content} />
                    </div>
                  ) : null}

                  {m.error && <div className="error-box">{m.error}</div>}

                  {(m.ttftMs != null || m.totalMs != null) && (
                    <div className="msg-foot">
                      <span>ttft {fmtMs(m.ttftMs ?? null)}</span>
                      <span>total {fmtMs(m.totalMs ?? null)}</span>
                      {m.usage?.completion_tokens ? (
                        <span>
                          {m.usage.completion_tokens} out · {m.usage.prompt_tokens ?? "?"} in
                        </span>
                      ) : null}
                      <span>{fmtRate(genRate(m))}</span>
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

          {/* composer */}
          <div style={{ marginTop: 14 }}>
            <textarea
              className="field"
              rows={3}
              placeholder="Ask the reasoning model… (⌘/ctrl + enter to send)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <div className="row">
                <button className="btn btn-primary" onClick={send} disabled={!input.trim() || streaming || !ep}>
                  {streaming ? "streaming…" : "send"}
                </button>
                {streaming && (
                  <button className="btn" onClick={() => abortRef.current?.abort()}>
                    stop
                  </button>
                )}
                {messages.length > 0 && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      if (streaming) abortRef.current?.abort();
                      setMessages([]);
                    }}
                  >
                    new thread
                  </button>
                )}
              </div>
              <span className="faint mono" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
                {messages.filter((m) => m.role === "user").length} turns
              </span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ controls -- */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <p className="card-title">deployment</p>
            <EndpointPicker
              endpoints={endpoints}
              kind="reasoning"
              value={endpointId}
              onChange={setEndpointId}
            />
            {ep && (
              <div className="faint mono" style={{ fontSize: 10, marginTop: 8, wordBreak: "break-all" }}>
                {ep.baseUrl}
              </div>
            )}
          </div>

          <div className="card">
            <p className="card-title">sampling</p>

            <label className="label">system prompt</label>
            <textarea
              className="field"
              rows={2}
              placeholder="optional"
              value={system}
              onChange={(e) => setSystem(e.target.value)}
            />

            <div style={{ marginTop: 12 }}>
              <label className="label">temperature · {temperature.toFixed(2)}</label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="label">top_p · {topP.toFixed(2)}</label>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={topP}
                onChange={(e) => setTopP(Number(e.target.value))}
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="label">max_tokens</label>
              <input
                className="field"
                type="number"
                min={1}
                max={32768}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
            </div>

            <label className="check" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.target.checked)} />
              enable thinking (chat_template_kwargs)
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}
