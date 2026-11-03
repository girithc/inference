"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listEndpoints } from "@/lib/client";
import type { Endpoint } from "@/lib/types";

const VIEWS = [
  {
    href: "/bench",
    num: "01",
    title: "Bench",
    desc: "Fire prompt sets at one or more deployments — concurrency, TTFT percentiles, token throughput — and compare them side by side.",
  },
  {
    href: "/ocr",
    num: "02",
    title: "OCR",
    desc: "Drop a document image, pick a prompt template, stream the transcription. Latency and token rate on every run.",
  },
  {
    href: "/reasoning",
    num: "03",
    title: "Reason",
    desc: "A chat canvas over the reasoning LLM — thinking blocks separated from the answer, live tokens/s, tunable sampling.",
  },
  {
    href: "/speech",
    num: "04",
    title: "Speech",
    desc: "Speech in, speech out. Record or upload audio for transcription; synthesize speech from text with playback and download.",
  },
];

export default function Home() {
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);

  useEffect(() => {
    listEndpoints()
      .then((r) => setEndpoints(r.endpoints))
      .catch(() => setEndpoints([]));
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <h1>
          A canvas over the
          <br />
          <span className="accent">served models.</span>
        </h1>
        <p>
          Everything this app deploys on Modal is reachable here — benchmark it, read through it,
          talk to it, listen to it. Point the canvas at your endpoints and work.
        </p>
      </header>

      <section>
        <p className="card-title">views</p>
        <div className="launch-grid">
          {VIEWS.map((v) => (
            <Link key={v.href} href={v.href} className="launch-card">
              <span className="num">{v.num}</span>
              <span className="arrow">→</span>
              <h2>{v.title}</h2>
              <p>{v.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <hr className="divider" />

      <section>
        <p className="card-title">
          deployments · <Link href="/endpoints" style={{ color: "var(--accent)" }}>manage</Link>
        </p>
        {endpoints === null ? (
          <div className="empty">LOADING REGISTRY…</div>
        ) : endpoints.length === 0 ? (
          <div className="hint">
            No deployments registered yet.{" "}
            <Link href="/endpoints" className="acc">
              Register one
            </Link>{" "}
            — the <code>baseUrl</code> is the Modal <code>web_server</code> URL (vLLM speaks
            OpenAI-compatible), plus the served model name.
          </div>
        ) : (
          <div className="row wrap">
            {endpoints.map((e) => (
              <span key={e.id} className="chip chip-static">
                <span className="dot" />
                {e.name}
                <span className={`kind-tag k-${e.kind}`}>{e.kind}</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
