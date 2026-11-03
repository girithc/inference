"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/bench", num: "01", label: "Bench" },
  { href: "/ocr", num: "02", label: "OCR" },
  { href: "/reasoning", num: "03", label: "Reason" },
  { href: "/speech", num: "04", label: "Speech" },
];

export function Nav() {
  const path = usePathname();
  return (
    <aside className="rail">
      <div className="brand">
        <div className="brand-mark">
          <span className="sq" />
          INFERENCE
        </div>
        <div className="brand-sub">canvas</div>
      </div>

      <nav className="nav">
        {ITEMS.map((it) => (
          <Link key={it.href} href={it.href} className={path.startsWith(it.href) ? "active" : ""}>
            <span className="num">{it.num}</span>
            {it.label}
          </Link>
        ))}
      </nav>

      <nav className="nav" style={{ marginTop: "auto" }}>
        <Link href="/endpoints" className={path.startsWith("/endpoints") ? "active" : ""}>
          <span className="num">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="3" cy="3" r="1.4" fill="currentColor" />
              <circle cx="9" cy="9" r="1.4" fill="currentColor" />
              <path d="M3 5v1.4A1.6 1.6 0 0 0 4.6 8H9" stroke="currentColor" strokeWidth="1" />
            </svg>
          </span>
          Endpoints
        </Link>
      </nav>

      <div className="rail-foot">
        modal · vllm
        <br />
        openai-compatible
        <br />
        <Link href="/endpoints">deployments →</Link>
      </div>
    </aside>
  );
}
