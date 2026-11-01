import { NextResponse } from "next/server";
import { getRepo, gh } from "@/lib/server";

export const dynamic = "force-dynamic";

const HIDDEN = ["venv/", "node_modules/", ".next/", "__pycache__/", ".npm-cache/"];
const KEEP_EXT =
  /\.(py|md|toml|yaml|yml|json|txt|cfg|mjs|js|ts|tsx|css|sh|env|gitignore)$/i;

export async function GET() {
  try {
    const repo = await getRepo();
    const res = await gh(`/repos/${repo}/git/trees/HEAD?recursive=1`);
    if (!res.ok) {
      return NextResponse.json({ error: `GITHUB ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as {
      tree?: Array<{ path: string; type: string; size?: number }>;
    };
    const tree = (data.tree ?? [])
      .filter(
        (t) =>
          t.type === "blob" &&
          !HIDDEN.some((h) => t.path.includes(h)) &&
          (KEEP_EXT.test(t.path) || t.path === ".gitignore"),
      )
      .map((t) => ({ path: t.path, size: t.size ?? 0 }));
    return NextResponse.json({ repo, tree });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TREE FAILED" },
      { status: 500 },
    );
  }
}
