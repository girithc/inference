"use client";

import { useEffect, useState } from "react";
import { listEndpoints, runBench } from "@/lib/client";
import { fmtMs, fmtRate } from "@/lib/types";
import type { BenchRun, Endpoint } from "@/lib/types";

const PRESETS: Record<string, { label: string; text: string }> = {
  short: { label: "short qa", text: "Answer in one sentence: what is the capital of Australia?" },
  long: {
    label: "long gen",
    text: "Write a detailed explanation of how transformer attention works, around 400 words.",
  },
  reason: {
    label: "reasoning",
    text: "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Think step by step.",
  },
};

const HISTORY_KEY = "canvas.bench.history";

export default function BenchPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const [prompt, setPrompt] = useState(PRESETS.short.text);
  const [n, setN] = useState(10);
  const [concurrency, setConcurrency] = useState(4);
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0);
  const [stream, setStream] = useState(true);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<BenchRun[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    listEndpoints().then((r) => setEndpoints(r.endpoints));
    try {
      const saved = sessionStorage.getItem(HISTORY_KEY);
      if (saved) setResults(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (runs: BenchRun[]) => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(-12)));
    } catch {
      /* ignore */
    }
  };

  async function start() {
    const targets = endpoints.filter((e) => selected.includes(e.id));
    if (!targets.length || running) return;
    setRunning(true);
    setError("");
    try {
      for (let i = 0; i < targets.length; i++) {
        setProgress(`${targets[i].name} (${i + 1}/${targets.length}) — firing ${n} requests @ c${concurrency}`);
        const run = await runBench({
          endpointId: targets[i].id,
          prompt,
          n,
          concurrency,
          maxTokens,
          temperature,
          stream,
        });
        setResults((prev) => {
          const next = [...prev, run].slice(-12);
          persist(next);
          return next;
        });
      }
      setProgress("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "bench failed");
      setProgress("");
    } finally {
      setRunning(false);
    }
  }

  const compare = results.slice(-6);

  return (
    <div className="page">
      <div className="page-head">
        <span className="idx">01</span>
        <h1>Bench</h1>
      </div>
      <p className="page-sub">
        Test deployments under load. Requests are fired from the server for clean timing — TTFT and
        token-rate percentiles per run, side-by-side comparison across endpoints.
      </p>

      <div className="grid-2-1">
        {/* ------------------------------------------------ config ---- */}
        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <p className="card-title">targets · {selected.length} selected</p>
            {endpoints.length === 0 ? (
              <div className="hint">No deployments registered — add some under Endpoints.</div>
            ) : (
              <div className="row wrap">
                {endpoints.map((e) => (
                  <button
                    key={e.id}
                    className={`chip ${selected.includes(e.id) ? "sel" : ""}`}
                    onClick={() =>
                      setSelected((s) => (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]))
                    }
                  >
                    <span className={`dot ${selected.includes(e.id) ? "ok" : ""}`} />
                    {e.name}
                    <span className={`kind-tag k-${e.kind}`}>{e.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <p className="card-title">prompt</p>
            <div className="row" style={{ marginBottom: 8 }}>
              {Object.entries(PRESETS).map(([k, p]) => (
                <button key={k} className="btn btn-sm" onClick={() => setPrompt(p.text)}>
                  {p.label}
                </button>
              ))}
            </div>
            <textarea className="field" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>

          <div className="card">
            <p className="card-title">load</p>
            <div className="row wrap" style={{ gap: 18 }}>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label className="label">requests</label>
                <input className="field" type="number" min={1} max={100} value={n}
                  onChange={(e) => setN(Math.max(1, Number(e.target.value)))} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label className="label">concurrency</label>
                <input className="field" type="number" min={1} max={32} value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Number(e.target.value)))} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label className="label">max_tokens</label>
                <input className="field" type="number" min={1} max={8192} value={maxTokens}
                  onChange={(e) => setMaxTokens(Math.max(1, Number(e.target.value)))} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label className="label">temperature · {temperature.toFixed(1)}</label>
                <input type="range" min={0} max={2} step={0.1} value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))} />
              </div>
              <label className="check" style={{ marginTop: 16 }}>
                <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
                stream
              </label>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={start} disabled={running || !selected.length}>
                {running ? "running…" : `run ${n} × ${selected.length || "—"}`}
              </button>
              {running && <span className="shimmer">{progress || "running"}</span>}
            </div>
            {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </section>

        {/* ------------------------------------------------ results --- */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {results.length === 0 ? (
            <div className="empty">NO RUNS YET</div>
          ) : (
            <>
              <div className="card">
                <p className="card-title">compare · last {compare.length}</p>
                <div style={{ overflowX: "auto" }}>
                  <table className="t">
                    <thead>
                      <tr>
                        <th>run</th>
                        <th className="num">p50 ttft</th>
                        <th className="num">p90 ttft</th>
                        <th className="num">tok/s</th>
                        <th className="num">errs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.map((r, i) => {
                        const wall = r.agg.wallMs > 0 ? r.agg.outTokens / (r.agg.wallMs / 1000) : 0;
                        return (
                          <tr key={i}>
                            <td className="strong">{r.endpoint.name}</td>
                            <td className="num">{fmtMs(r.agg.ttftP50)}</td>
                            <td className="num">{fmtMs(r.agg.ttftP90)}</td>
                            <td className="num">{wall.toFixed(1)}</td>
                            <td className={`num ${r.agg.errors ? "err" : ""}`}>{r.agg.errors}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="faint mono" style={{ fontSize: 9.5, marginTop: 8, letterSpacing: "0.1em" }}>
                  tok/s = total output tokens ÷ wall time (includes queueing)
                </div>
              </div>

              {compare
                .slice()
                .reverse()
                .slice(0, 3)
                .map((r, i) => (
                  <div className="card" key={`${r.endpoint.id}-${i}`}>
                    <p className="card-title">
                      {r.endpoint.name} · {r.params.n} req @ c{r.params.concurrency}
                    </p>
                    <div className="stats" style={{ marginBottom: 12 }}>
                      <div className="stat">
                        <div className="v acc">{fmtMs(r.agg.ttftP50)}</div>
                        <div className="k">ttft p50</div>
                      </div>
                      <div className="stat">
                        <div className="v">{fmtMs(r.agg.ttftP99)}</div>
                        <div className="k">ttft p99</div>
                      </div>
                      <div className="stat">
                        <div className="v">{fmtRate(r.agg.genRateMean)}</div>
                        <div className="k">gen rate mean</div>
                      </div>
                      <div className="stat">
                        <div className="v">{r.agg.outTokens}</div>
                        <div className="k">out tokens</div>
                      </div>
                    </div>

                    <div className="bars">
                      {r.requests
                        .slice()
                        .sort((a, b) => a.totalMs - b.totalMs)
                        .map((req) => {
                          const max = Math.max(...r.requests.map((x) => x.totalMs), 1);
                          const w = (req.totalMs / max) * 100;
                          const wt = req.ttftMs != null ? (req.ttftMs / Math.max(req.totalMs, 1)) * 100 : 0;
                          return (
                            <div className="bar-row" key={req.i} title={req.error ?? ""}>
                              <span style={{ width: 22 }}>#{req.i}</span>
                              <div className="bar-track">
                                <div className="bar-fill" style={{ width: `${w}%` }}>
                                  {req.ok && req.ttftMs != null && (
                                    <div className="ttft" style={{ width: `${wt}%` }} />
                                  )}
                                </div>
                              </div>
                              <span style={{ width: 64, textAlign: "right" }}>{fmtMs(req.totalMs)}</span>
                              {!req.ok && <span className="err">✕</span>}
                            </div>
                          );
                        })}
                    </div>
                    <div className="faint mono" style={{ fontSize: 9.5, marginTop: 6, letterSpacing: "0.1em" }}>
                      bar = total request time · bright segment = time to first token · sorted by latency
                    </div>
                  </div>
                ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
