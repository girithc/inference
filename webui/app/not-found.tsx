import Link from "next/link";

export default function NotFound() {
  return (
    <main className="nf">
      <p className="mono orange-text" style={{ fontSize: 12, letterSpacing: "0.2em" }}>
        ERROR — SHEET NOT FOUND
      </p>
      <h1 className="nf-title">404</h1>
      <p className="serif nf-sub">nothing printed on this page.</p>
      <Link className="btn" href="/">
        BACK TO THE FRONT PAGE ↗
      </Link>
    </main>
  );
}
