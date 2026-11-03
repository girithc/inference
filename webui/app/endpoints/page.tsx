"use client";

import { useEffect, useState } from "react";
import { deleteEndpoint, healthEndpoint, listEndpoints, saveEndpoint } from "@/lib/client";
import { KINDS, KIND_LABEL, fmtMs } from "@/lib/types";
import type { Endpoint, HealthResult, Kind } from "@/lib/types";

interface FormState {
  id?: string;
  name: string;
  kind: Kind;
  baseUrl: string;
  model: string;
  apiKey: string;
  notes: string;
}

const EMPTY: FormState = { name: "", kind: "reasoning", baseUrl: "", model: "", apiKey: "", notes: "" };

export default function EndpointsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Record<string, HealthResult | "testing">>({});

  async function refresh() {
    try {
      const r = await listEndpoints();
      setEndpoints(r.endpoints);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveEndpoint({
        id: form.id,
        name: form.name,
        kind: form.kind,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey, // blank keeps the stored key
        notes: form.notes,
      });
      setForm(EMPTY);
      setOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function probe(id: string) {
    setHealth((h) => ({ ...h, [id]: "testing" }));
    try {
      const r = await healthEndpoint(id);
      setHealth((h) => ({ ...h, [id]: r }));
    } catch (err) {
      setHealth((h) => ({
        ...h,
        [id]: { ok: false, ms: 0, error: err instanceof Error ? err.message : "probe failed" },
      }));
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this deployment from the registry?")) return;
    await deleteEndpoint(id);
    await refresh();
  }

  const edit = (e: Endpoint) => {
    setForm({
      id: e.id,
      name: e.name,
      kind: e.kind,
      baseUrl: e.baseUrl,
      model: e.model,
      apiKey: "", // write-only: blank = keep
      notes: e.notes ?? "",
    });
    setOpen(true);
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="idx" style={{ color: "var(--faint)" }}>05</span>
        <h1>Endpoints</h1>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setOpen(true); }}>
          + register deployment
        </button>
      </div>
      <p className="page-sub">
        Every view of the canvas points at deployments registered here. The <code className="mono">baseUrl</code>{" "}
        is your Modal <code className="mono">web_server</code> URL (vLLM and friends speak
        OpenAI-compatible HTTP). Keys are stored server-side in{" "}
        <code className="mono">webui/data/endpoints.json</code> (gitignored) and never sent to the browser.
      </p>

      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

      {open && (
        <div className="card" style={{ marginBottom: 18 }}>
          <p className="card-title">{form.id ? "edit deployment" : "register deployment"}</p>
          <div className="row wrap" style={{ gap: 14 }}>
            <div style={{ flex: 2, minWidth: 160 }}>
              <label className="label">name</label>
              <input className="field" placeholder="qwen3.8-27b · h100" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label className="label">kind</label>
              <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 2, minWidth: 220 }}>
              <label className="label">base url</label>
              <input className="field" placeholder="https://xxx.modal.run" value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </div>
          </div>
          <div className="row wrap" style={{ gap: 14, marginTop: 12 }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label className="label">served model name</label>
              <input className="field" placeholder="qwen3.8-27b" value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label className="label">api key (optional, write-only)</label>
              <input className="field" type="password" placeholder={form.id ? "blank keeps stored key" : "none"}
                value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            </div>
            <div style={{ flex: 3, minWidth: 220 }}>
              <label className="label">notes (optional)</label>
              <input className="field" placeholder="2×A100 · tp=2 · 32k ctx" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={save} disabled={busy || !form.name || !form.baseUrl || !form.model}>
              {busy ? "saving…" : "save"}
            </button>
            <button className="btn btn-ghost" onClick={() => { setOpen(false); setForm(EMPTY); }}>
              cancel
            </button>
          </div>
        </div>
      )}

      {endpoints.length === 0 ? (
        <div className="hint">
          Registry is empty. Register your first deployment — e.g. the qwen vLLM service: kind{" "}
          <code>reasoning</code>, baseUrl <code>https://&lt;modal-app&gt;.modal.run</code>, model{" "}
          <code>qwen3.8-27b</code> (the <code>SERVED_MODEL_NAME</code> from its <code>inference.py</code>).
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="t">
            <thead>
              <tr>
                <th>name</th>
                <th>kind</th>
                <th>model</th>
                <th>base url</th>
                <th>key</th>
                <th>health</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => {
                const h = health[e.id];
                return (
                  <tr key={e.id}>
                    <td className="strong">
                      {e.name}
                      {e.notes && (
                        <div className="faint" style={{ fontSize: 10, marginTop: 2 }}>{e.notes}</div>
                      )}
                    </td>
                    <td>
                      <span className={`kind-tag k-${e.kind}`}>{e.kind}</span>
                    </td>
                    <td>{e.model}</td>
                    <td className="faint" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.baseUrl}
                    </td>
                    <td>{e.hasKey ? <span className="ok">●</span> : <span className="faint">—</span>}</td>
                    <td>
                      {h === "testing" ? (
                        <span className="shimmer">probing</span>
                      ) : h ? (
                        h.ok ? (
                          <span className="ok" title={h.models?.join(", ")}>
                            ok · {fmtMs(h.ms)} · via {h.via}
                            {h.models?.length ? ` · ${h.models.length} model${h.models.length > 1 ? "s" : ""}` : ""}
                          </span>
                        ) : (
                          <span className="err" title={h.error}>fail · {h.error?.slice(0, 60)}</span>
                        )
                      ) : (
                        <span className="faint">untested</span>
                      )}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" onClick={() => probe(e.id)}>test</button>
                        <button className="btn btn-sm" onClick={() => edit(e)}>edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(e.id)}>✕</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
