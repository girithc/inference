"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";

type TreeItem = { path: string; size: number };

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
};

type DockTab = "TERMINAL" | "LOGS" | "TEST";

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  "aria-hidden": true as const,
};

function FileIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 1.5h5l3 3v10H4z" />
      <path d="M9 1.5v3h3" />
    </svg>
  );
}

function GitIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="4" cy="3.5" r="1.8" />
      <circle cx="4" cy="12.5" r="1.8" />
      <circle cx="12" cy="3.5" r="1.8" />
      <path d="M4 5.3v5.4" />
      <path d="M12 5.3v1.7c0 1.5-1.2 2.5-2.7 2.5H5.8" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" />
    </svg>
  );
}

function buildTree(items: TreeItem[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const item of items) {
    const parts = item.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isDir = i < parts.length - 1;
      let next = cur.children.find((c) => c.name === part && c.isDir === isDir);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join("/"), isDir, children: [] };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    );
    for (const n of nodes) sort(n.children);
    return nodes;
  };
  return sort(root.children);
}

function dirPaths(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.isDir) {
      acc.push(n.path);
      dirPaths(n.children, acc);
    }
  }
  return acc;
}

function TreeRows({
  nodes,
  depth,
  open,
  onToggle,
  sel,
  onOpen,
}: {
  nodes: TreeNode[];
  depth: number;
  open: Set<string>;
  onToggle: (path: string) => void;
  sel: string | null;
  onOpen: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.isDir ? (
          <div key={node.path}>
            <button
              type="button"
              className="file-item dir"
              style={{ paddingLeft: 10 + depth * 8 }}
              onClick={() => onToggle(node.path)}
              aria-expanded={open.has(node.path)}
            >
              <span className={`caret ${open.has(node.path) ? "open" : ""}`.trim()} aria-hidden="true">
                {">"}
              </span>
              {node.name}
            </button>
            {open.has(node.path) && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                open={open}
                onToggle={onToggle}
                sel={sel}
                onOpen={onOpen}
              />
            )}
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            className={`file-item ${sel === node.path ? "sel" : ""}`.trim()}
            style={{ paddingLeft: 10 + depth * 8 + 10 }}
            onClick={() => onOpen(node.path)}
          >
            {node.name}
          </button>
        ),
      )}
    </>
  );
}

export default function Workspace() {
  const [repo, setRepo] = useState("");
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [sha, setSha] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployOut, setDeployOut] = useState("");
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [logApp, setLogApp] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [following, setFollowing] = useState(false);
  const [testUrl, setTestUrl] = useState("");
  const [testBody, setTestBody] = useState(
    '{\n  "messages": [{ "role": "user", "content": "Say hi in five words." }]\n}',
  );
  const [testOut, setTestOut] = useState("");
  const [aiResults, setAiResults] = useState<Array<{ id: string; path: string; text: string }>>([]);
  const [aiOpenId, setAiOpenId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>("TERMINAL");
  const [leftView, setLeftView] = useState<"FILES" | "GIT" | "AI">("FILES");
  const [gitEntries, setGitEntries] = useState<Array<{ code: string; path: string }>>([]);
  const [gitBusy, setGitBusy] = useState<string | null>(null);

  const logsAbort = useRef<AbortController | null>(null);
  const dirty = sel !== null && draft !== saved;

  const treeData = useMemo(() => buildTree(tree), [tree]);
  const allDirs = useMemo(() => dirPaths(treeData), [treeData]);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    // expand everything by default; collapsing is the reader's choice
    setOpenDirs(new Set(allDirs));
  }, [allDirs]);

  const toggleDir = (path: string) =>
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const refreshTree = useCallback(async () => {
    setTreeErr(null);
    try {
      const res = await fetch("/api/gh/tree");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRepo(data.repo);
      setTree(data.tree);
    } catch (err) {
      setTreeErr(err instanceof Error ? err.message : "TREE FAILED");
    }
  }, []);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  const openFile = async (path: string) => {
    if (dirty && !window.confirm("Unsaved edits — open anyway?")) return;
    setBusy(path);
    try {
      const res = await fetch(`/api/gh/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSel(path);
      setSha(data.sha);
      setSaved(data.content);
      setDraft(data.content);
    } catch (err) {
      setDeployOut(`[OPEN ERROR] ${err instanceof Error ? err.message : "failed"}\n`);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!sel || !dirty) return;
    setBusy("save");
    try {
      const res = await fetch("/api/gh/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: sel, content: draft, sha }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSha(data.sha);
      setSaved(draft);
    } catch (err) {
      setDeployOut(`[SAVE ERROR] ${err instanceof Error ? err.message : "failed"}\n`);
      setDockOpen(true);
      setDockTab("TERMINAL");
    } finally {
      setBusy(null);
    }
  };

  const loadGit = useCallback(async () => {
    setGitBusy("status");
    try {
      const res = await fetch("/api/git/status");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGitEntries(data.entries);
    } catch (err) {
      setDeployOut(`[GIT ERROR] ${err instanceof Error ? err.message : "failed"}\n`);
      setDockOpen(true);
      setDockTab("TERMINAL");
    } finally {
      setGitBusy(null);
    }
  }, []);

  const commitAll = async () => {
    if (gitBusy) return;
    setGitBusy("push");
    setDockOpen(true);
    setDockTab("TERMINAL");
    setDeployOut((d) => `${d}\n$ git add -A · commit · pull --rebase · push\n`);
    try {
      const res = await fetch("/api/git/push", { method: "POST" });
      const data = await res.json();
      setDeployOut(
        (d) => `${d}${data.output ?? ""}${data.error ? `\n[ERROR] ${data.error}` : "\n[PUSHED ✓]"}`,
      );
      await loadGit();
      await refreshTree();
      // resync the open file's sha after the rebase — but never clobber unsaved edits
      if (sel && draft === saved) {
        const r = await fetch(`/api/gh/file?path=${encodeURIComponent(sel)}`);
        const d = await r.json();
        if (!d.error) {
          setSha(d.sha);
          setSaved(d.content);
          setDraft(d.content);
        }
      }
    } catch (err) {
      setDeployOut((d) => `${d}[PUSH ERROR] ${err instanceof Error ? err.message : "failed"}\n`);
    } finally {
      setGitBusy(null);
    }
  };

  const deploy = async () => {
    if (!sel || deploying) return;
    if (dirty && !window.confirm("Unsaved edits deploy the last saved version. Deploy anyway?"))
      return;
    setDeploying(true);
    setDockOpen(true);
    setDockTab("TERMINAL");
    setDeployOut(`$ modal deploy ${sel}\n`);
    try {
      const res = await fetch("/api/modal/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: sel }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setDeployOut(acc);
      }
      const urls = [...new Set(acc.match(/https:\/\/[^\s"']+\.modal\.run/g) ?? [])];
      if (urls.length) {
        setEndpoints(urls);
        setTestUrl((u) => u || urls[0]);
      }
      const app = acc.match(/[Aa]pp '([^']+)'/)?.[1];
      if (app) setLogApp(app);
    } finally {
      setDeploying(false);
    }
  };

  const followLogs = async () => {
    if (following) {
      logsAbort.current?.abort();
      return;
    }
    if (!logApp) return;
    const controller = new AbortController();
    logsAbort.current = controller;
    setFollowing(true);
    setLogLines([]);
    setDockOpen(true);
    setDockTab("LOGS");
    try {
      const res = await fetch(`/api/modal/logs?app=${encodeURIComponent(logApp)}`, {
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const lines = acc.split("\n");
        acc = lines.pop() ?? "";
        setLogLines((prev) => [...prev.slice(-400), ...lines]);
      }
    } catch {
      /* aborted */
    } finally {
      setFollowing(false);
      logsAbort.current = null;
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTestOut("");
    setDockOpen(true);
    setDockTab("TEST");
    try {
      const res = await fetch("/api/infer/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: testUrl, body: testBody }),
      });
      const data = await res.json();
      setTestOut(
        data.error
          ? `[ERROR] ${data.error}`
          : `[${data.status}]\n\n${data.text}`,
      );
    } catch (err) {
      setTestOut(`[ERROR] ${err instanceof Error ? err.message : "failed"}`);
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!sel || busy === "ai") return;
    setBusy("ai");
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: sel, content: draft }),
      });
      const data = await res.json();
      const id = `${Date.now()}`;
      const text = data.error ? `[ERROR] ${data.error}` : data.text;
      setAiResults((prev) => [{ id, path: sel, text }, ...prev]);
      setAiOpenId(id);
    } catch (err) {
      const id = `${Date.now()}`;
      setAiResults((prev) => [
        { id, path: sel, text: `[ERROR] ${err instanceof Error ? err.message : "failed"}` },
        ...prev,
      ]);
      setAiOpenId(id);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    return () => logsAbort.current?.abort();
  }, []);

  const dockTabs: DockTab[] = ["TERMINAL", "LOGS", "TEST"];

  return (
    <main className="app">
      <div className="ws">
        {/* ---------------- files ---------------- */}
        <aside className="ws-files">
          <div className="pane-head">
            <span className="brand">
              INFERENCE<span className="spin-star orange-text" aria-hidden="true">✳</span> STUDIO
            </span>
            <a
              className="kill"
              href="https://github.com/girithc/inference"
              target="_blank"
              rel="noreferrer"
            >
              GH ↗
            </a>
          </div>

          <div className="seg-row">
            <div className="seg-mini" role="tablist">
              <button
                type="button"
                className={leftView === "FILES" ? "sel" : ""}
                onClick={() => setLeftView("FILES")}
                aria-label="Files"
                title="Files"
              >
                <FileIcon />
              </button>
              <button
                type="button"
                className={leftView === "GIT" ? "sel" : ""}
                onClick={() => {
                  setLeftView("GIT");
                  loadGit();
                }}
                aria-label="Source control"
                title="Source control"
              >
                <GitIcon />
              </button>
              <button
                type="button"
                className={leftView === "AI" ? "sel" : ""}
                onClick={() => setLeftView("AI")}
                aria-label="AI"
                title="AI"
              >
                <AiIcon />
              </button>
            </div>
          </div>

          {leftView === "AI" ? (
            <div className="ai-pane">
              <div className="field-note">
                {sel ?? "NO FILE OPEN — PICK ONE UNDER FILES"}
              </div>
              <button
                type="button"
                className="btn btn-mini"
                onClick={analyze}
                disabled={!sel || busy === "ai"}
              >
                {busy === "ai" ? "ANALYZING…" : "ANALYZE"}
              </button>
              <div className="ai-list">
                {aiResults.map((r, i) => (
                  <div key={r.id} className="ai-item">
                    <button
                      type="button"
                      className="file-item ai-row"
                      style={{ paddingLeft: 10 }}
                      onClick={() => setAiOpenId(aiOpenId === r.id ? null : r.id)}
                      aria-expanded={aiOpenId === r.id}
                      title={r.path}
                    >
                      <span
                        className={`caret ${aiOpenId === r.id ? "open" : ""}`.trim()}
                        aria-hidden="true"
                      >
                        {">"}
                      </span>
                      <span className="ai-row-label">
                        {String(i + 1).padStart(2, "0")} — {r.path.split("/").pop()}
                      </span>
                    </button>
                    {aiOpenId === r.id && <p className="ai-text">{r.text}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : leftView === "FILES" ? (
            <div className="file-list">
              {treeErr ? <p className="field-note" style={{ padding: 12 }}>{treeErr}</p> : null}
              <TreeRows
                nodes={treeData}
                depth={0}
                open={openDirs}
                onToggle={toggleDir}
                sel={sel}
                onOpen={openFile}
              />
            </div>
          ) : (
            <>
              <div className="file-list">
                {gitEntries.length === 0 ? (
                  <div className="field-note" style={{ padding: 12 }}>
                    {gitBusy === "status" ? "READING…" : "WORKING TREE CLEAN"}
                  </div>
                ) : (
                  gitEntries.map((e) => (
                    <button
                      key={e.code + e.path}
                      type="button"
                      className="file-item"
                      style={{ paddingLeft: 10 }}
                      onClick={() => openFile(e.path)}
                    >
                      <span className="git-code">{e.code.trim() || "M"}</span>
                      {e.path}
                    </button>
                  ))
                )}
              </div>
              <div className="git-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={commitAll}
                  disabled={gitEntries.length === 0 || gitBusy !== null}
                >
                  {gitBusy === "push" ? "PUSHING…" : "COMMIT + PUSH ALL →"}
                </button>
              </div>
            </>
          )}
        </aside>

        {/* ---------------- editor ---------------- */}
        <section className="ws-editor">
          <div className="pane-head">
            <span>{sel ?? "OPEN A FILE FROM THE REPO"}</span>
            {sel ? (
              <span className={`ws-state ${dirty ? "orange-text" : ""}`.trim()}>
                <i className={`sq-dot ${dirty ? "" : "sq-ink"}`.trim()} aria-hidden="true" />
                {dirty ? "UNSAVED" : "SYNCED"}
              </span>
            ) : null}
          </div>
          {sel ? (
            <>
              <div className="editor-wrap">
                <CodeMirror
                  value={draft}
                  height="100%"
                  extensions={[python()]}
                  onChange={(v) => setDraft(v)}
                  basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
                />
              </div>
              <div className="editor-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={save}
                  disabled={!dirty || busy === "save"}
                >
                  {busy === "save" ? "COMMITTING…" : "SAVE → LOCAL + GITHUB"}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-press">
              SELECT A FILE — EDIT — DEPLOY — WATCH LOGS
            </div>
          )}
        </section>
      </div>

      {/* ---------------- dock ---------------- */}
      <div className="dock">
        <div className="dock-bar">
          {dockTabs.map((t) => (
            <button
              key={t}
              type="button"
              className={`dock-tab ${dockOpen && dockTab === t ? "sel" : ""}`.trim()}
              onClick={() => {
                if (dockOpen && dockTab === t) setDockOpen(false);
                else {
                  setDockTab(t);
                  setDockOpen(true);
                }
              }}
            >
              {t}
              {t === "TERMINAL" && deploying ? " — RUNNING" : ""}
              {t === "LOGS" && following ? " — LIVE" : ""}
            </button>
          ))}
          <span className="dock-status mono">
            <i className="sq-dot" aria-hidden="true" />
            MODAL COOKBOOK
          </span>
        </div>

        {dockOpen && (
          <div className="dock-body">
            {dockTab === "TERMINAL" && (
              <>
                <div className="dock-toolbar">
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={deploy}
                    disabled={!sel || deploying}
                  >
                    {deploying ? "DEPLOYING…" : "MODAL DEPLOY ↗"}
                  </button>
                  <span className="field-note">{sel ?? "NO FILE SELECTED"}</span>
                </div>
                {endpoints.length > 0 && (
                  <div className="dock-eps">
                    {endpoints.map((u) => (
                      <span key={u} className="ep mono">
                        <a href={u} target="_blank" rel="noreferrer">{u}</a>
                        <button
                          type="button"
                          className="kill"
                          onClick={() => navigator.clipboard.writeText(u)}
                        >
                          COPY
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <pre className="console">{deployOut || "$ —"}</pre>
              </>
            )}

            {dockTab === "LOGS" && (
              <>
                <div className="dock-toolbar">
                  <input
                    className="field mono dock-input"
                    placeholder="APP NAME"
                    value={logApp}
                    onChange={(e) => setLogApp(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={`btn btn-mini ${following ? "" : "btn-ghost"}`.trim()}
                    onClick={followLogs}
                    disabled={!logApp}
                  >
                    {following ? "STOP" : "FOLLOW"}
                  </button>
                </div>
                <pre className="console">
                  {logLines.length > 0 ? logLines.join("\n") : "$ — PRESS FOLLOW TO STREAM LOGS"}
                </pre>
              </>
            )}

            {dockTab === "TEST" && (
              <>
                <div className="dock-toolbar">
                  <input
                    className="field mono dock-input"
                    placeholder="https://…modal.run"
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={runTest}
                    disabled={!testUrl || busy === "test"}
                  >
                    {busy === "test" ? "RUNNING…" : "RUN →"}
                  </button>
                </div>
                <textarea
                  className="field mono dock-body-input"
                  value={testBody}
                  onChange={(e) => setTestBody(e.target.value)}
                  spellCheck={false}
                />
                <pre className="console">{testOut || "$ —"}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
