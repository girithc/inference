import fs from "node:fs";
import path from "node:path";
import type { Kind } from "./types";

/**
 * Server-side registry of deployed endpoints. Persisted to
 * data/endpoints.json (gitignored — keys live here, never in the client).
 */

export interface EndpointRec {
  id: string;
  name: string;
  kind: Kind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  notes?: string;
  createdAt: string;
}

const FILE = path.join(process.cwd(), "data", "endpoints.json");

export function loadEndpoints(): EndpointRec[] {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveEndpoints(list: EndpointRec[]): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

export function resolveEndpoint(id: string): EndpointRec | null {
  return loadEndpoints().find((e) => e.id === id) ?? null;
}

/** Client-safe shape: never ship the key itself. */
export function sanitize(e: EndpointRec): Omit<EndpointRec, "apiKey"> & { hasKey: boolean } {
  const { apiKey, ...rest } = e;
  return { ...rest, hasKey: Boolean(apiKey) };
}

export function joinBase(base: string, path: string): string {
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
}

/**
 * Fetch an upstream deployment. Follows the Modal cold-start redirect dance
 * (303 attempt-token) manually so POST bodies survive, and attaches the
 * stored Bearer key when the entry has one.
 */
export async function upstreamFetch(
  e: EndpointRec,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (e.apiKey) headers.set("Authorization", `Bearer ${e.apiKey}`);
  let url = joinBase(e.baseUrl, path);
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (loc) {
        url = new URL(loc, url).toString();
        continue;
      }
    }
    return res;
  }
  throw new Error("upstream redirected too many times");
}
