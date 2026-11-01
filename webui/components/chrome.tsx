import Link from "next/link";

export function TopBar() {
  return (
    <header className="topbar">
      <Link className="topbar-brand" href="/">
        INFERENCE<span className="topbar-star">✳</span> MODAL STUDIO
      </Link>
      <span className="topbar-cta">
        <a href="https://github.com/girithc/inference" target="_blank" rel="noreferrer">
          GITHUB ↗
        </a>
      </span>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <span>INFERENCE✳ — CONNECT · EDIT · DEPLOY · LOGS</span>
      <span>
        <span className="sq-dot" aria-hidden="true" />
        MODAL COOKBOOK
      </span>
    </footer>
  );
}
