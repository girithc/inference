"use client";

import Link from "next/link";
import type { Endpoint, Kind } from "@/lib/types";

/** Labeled select over the registry, filtered by deployment kind. */
export function EndpointPicker({
  endpoints,
  kind,
  value,
  onChange,
  allowAny = true,
}: {
  endpoints: Endpoint[];
  kind: Kind;
  value: string;
  onChange: (id: string) => void;
  allowAny?: boolean;
}) {
  const matching = endpoints.filter((e) => e.kind === kind);
  const options = matching.length ? matching : allowAny ? endpoints : [];

  return (
    <div>
      <label className="label">
        {kind} endpoint ·{" "}
        <Link href="/endpoints" className="acc" style={{ textDecoration: "none" }}>
          manage
        </Link>
      </label>
      {options.length ? (
        <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
          {matching.length === 0 && allowAny && (
            <option value="" disabled>
              — no {kind} entries, showing all —
            </option>
          )}
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.model}
            </option>
          ))}
        </select>
      ) : (
        <div className="hint">
          No deployments registered yet — <Link href="/endpoints">add one</Link>.
        </div>
      )}
    </div>
  );
}
