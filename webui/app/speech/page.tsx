"use client";

import { useEffect, useRef, useState } from "react";
import { EndpointPicker } from "@/app/components/EndpointPicker";
import { listEndpoints } from "@/lib/client";
import type { Endpoint } from "@/lib/types";

/* ------------------------------------------------------------------ STT -- */

function SttCard({ endpoints }: { endpoints: Endpoint[] }) {
  const [endpointId, setEndpointId] = useState("");
  const [ep, setEp] = useState<Endpoint | null>(null);
  useEffect(() => {
    setEp(endpoints.find((e) => e.id === endpointId) ?? null);
  }, [endpoints, endpointId]);

  const [state, setState] = useState<"idle" | "recording" | "recorded">("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [language, setLanguage] = useState("");

  const [text, setText] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function startRec() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""].find((m) =>
        m === "" ? true : MediaRecorder.isTypeSupported(m),
      ) as string | undefined;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setBlob(b);
        setBlobUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(b);
        });
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start(250);
      recorderRef.current = rec;
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "microphone unavailable");
    }
  }

  function stopRec() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setState("recorded");
  }

  async function submit() {
    if (!ep || (!blob && !fileRef.current?.files?.[0])) return;
    const file =
      blob instanceof Blob && blob.size > 0
        ? new File([blob], `recording.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type })
        : fileRef.current?.files?.[0];
    if (!file) return;

    setBusy(true);
    setError("");
    setText("");
    const t0 = performance.now();
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("endpointId", ep.id);
      if (language.trim()) fd.append("language", language.trim());
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? j?.detail ?? `HTTP ${res.status}`);
      setLatencyMs(performance.now() - t0);
      setText(typeof j?.text === "string" ? j.text : JSON.stringify(j));
    } catch (err) {
      setError(err instanceof Error ? err.message : "transcription failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p className="card-title">speech → text · /v1/audio/transcriptions</p>

      <EndpointPicker endpoints={endpoints} kind="stt" value={endpointId} onChange={setEndpointId} />

      <div className="row wrap">
        {!blob && (
          <button
            className={`btn ${state === "recording" ? "" : "btn-primary"}`}
            onClick={state === "recording" ? stopRec : startRec}
          >
            {state === "recording" ? `■ stop · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : "● record"}
          </button>
        )}
        <button className="btn" onClick={() => fileRef.current?.click()}>
          upload audio
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setBlob(null);
              setBlobUrl((old) => {
                if (old) URL.revokeObjectURL(old);
                return URL.createObjectURL(f);
              });
              setState("recorded");
              setText("");
            }
            e.target.value = "";
          }}
        />
        {blob && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setBlob(null);
              setState("idle");
              setText("");
            }}
          >
            clear recording
          </button>
        )}
      </div>

      {state === "recorded" && blobUrl && (
        <audio controls src={blobUrl} />
      )}

      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="label">language (optional, bcp-47)</label>
          <input className="field" placeholder="en" value={language} onChange={(e) => setLanguage(e.target.value)} />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || state !== "recorded" || !ep}
            title={state !== "recorded" ? "record or upload audio first" : ""}
          >
            {busy ? "transcribing…" : "transcribe"}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {(text || busy) && (
        <div style={{ border: "1px solid var(--hair)", background: "var(--void)", padding: "12px 14px" }}>
          <p className="card-title" style={{ marginBottom: 8 }}>
            transcript
            {text && (
              <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(text)}>
                copy
              </button>
            )}
          </p>
          <div className={busy ? "shimmer" : ""} style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>
            {text || "TRANSCRIBING…"}
          </div>
          {latencyMs != null && text && (
            <div className="msg-foot">
              <span>round trip {(latencyMs / 1000).toFixed(1)}s</span>
              <span>{text.trim() ? text.trim().split(/\s+/).length : 0} words</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ TTS -- */

function TtsCard({ endpoints }: { endpoints: Endpoint[] }) {
  const [endpointId, setEndpointId] = useState("");
  const [input, setInput] = useState("");
  const [voice, setVoice] = useState("af_heart");
  const [format, setFormat] = useState("mp3");
  const [speed, setSpeed] = useState(1);

  const [audioUrl, setAudioUrl] = useState("");
  const [audioType, setAudioType] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!input.trim() || !endpointId || busy) return;
    setBusy(true);
    setError("");
    const t0 = performance.now();
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointId, input: input.trim(), voice, speed, response_format: format }),
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || type.includes("json")) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? j?.detail ?? `HTTP ${res.status}`);
      }
      const b = await res.blob();
      setAudioUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(b);
      });
      setAudioType(type);
      setLatencyMs(performance.now() - t0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "tts failed");
    } finally {
      setBusy(false);
    }
  }

  const ext = format || audioType.split("/")[1]?.split(";")[0] || "mp3";

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p className="card-title">text → speech · /v1/audio/speech</p>

      <EndpointPicker endpoints={endpoints} kind="tts" value={endpointId} onChange={setEndpointId} />

      <div>
        <label className="label">text · {input.length} chars</label>
        <textarea
          className="field"
          rows={5}
          placeholder="Text to speak…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>

      <div className="row wrap" style={{ gap: 14 }}>
        <div style={{ flex: 2, minWidth: 140 }}>
          <label className="label">voice</label>
          <input className="field" value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="server default" />
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <label className="label">format</label>
          <select className="field" value={format} onChange={(e) => setFormat(e.target.value)}>
            {["mp3", "wav", "opus", "flac"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="label">speed · {speed.toFixed(2)}×</label>
          <input type="range" min={0.5} max={2} step={0.05} value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))} />
        </div>
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={generate} disabled={busy || !input.trim() || !endpointId}>
          {busy ? "synthesizing…" : "generate"}
        </button>
        {audioUrl && (
          <a className="btn" href={audioUrl} download={`speech.${ext}`} style={{ textDecoration: "none" }}>
            download .{ext}
          </a>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {audioUrl && (
        <div style={{ border: "1px solid var(--hair)", background: "var(--void)", padding: "12px 14px" }}>
          <audio controls key={audioUrl} src={audioUrl} />
          {latencyMs != null && (
            <div className="msg-foot">
              <span>synthesis {(latencyMs / 1000).toFixed(1)}s</span>
              {audioType && <span>{audioType}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- page -- */

export default function SpeechPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  useEffect(() => {
    listEndpoints().then((r) => setEndpoints(r.endpoints));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <span className="idx">04</span>
        <h1>Speech</h1>
      </div>
      <p className="page-sub">
        Audio in, audio out. Left: record or upload audio and transcribe it over the STT deployment.
        Right: synthesize speech from text over the TTS deployment. OpenAI-compatible request shapes.
      </p>

      <div className="split">
        <SttCard endpoints={endpoints} />
        <TtsCard endpoints={endpoints} />
      </div>
    </div>
  );
}
