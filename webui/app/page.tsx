"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { autocompletion } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";

/* VS Code "Light+" token colors on bone paper */
const vscodeTheme = EditorView.theme(
  {
    "&": { fontSize: "13px", backgroundColor: "transparent", height: "100%" },
    ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-content": { caretColor: "var(--orange)" },
    ".cm-line": { padding: "0 10px" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--ink-faint)",
      paddingRight: "10px",
    },
    ".cm-activeLine": { backgroundColor: "rgba(20, 18, 15, 0.045)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--orange)" },
    ".cm-foldGutter span": { color: "var(--ink-faint)" },
    ".cm-selectionBackground": { backgroundColor: "rgba(255, 77, 0, 0.18) !important" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--orange)" },
    ".cm-tooltip": {
      backgroundColor: "var(--paper)",
      border: "1px solid var(--ink)",
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--ink)",
      color: "var(--paper)",
    },
  },
  { dark: false },
);

const vscodeHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#008000", fontStyle: "italic" },
  { tag: [t.keyword, t.definitionKeyword, t.moduleKeyword, t.controlKeyword], color: "#af00db" },
  { tag: [t.string, t.character, t.regexp], color: "#a31515" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#098658" },
  { tag: [t.definition(t.variableName), t.function(t.variableName), t.self], color: "#795e26" },
  { tag: [t.variableName, t.propertyName, t.labelName], color: "#001080" },
  { tag: [t.typeName, t.className, t.namespace], color: "#267f99" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "#14120f" },
  { tag: [t.meta, t.annotation], color: "#795e26" },
  { tag: t.link, color: "#001080", textDecoration: "underline" },
  { tag: t.invalid, color: "#e45649" },
]);

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

type AiSection = { title: string; body: string[] };

function parseAnalysis(text: string): AiSection[] {
  const sections: AiSection[] = [];
  let cur: AiSection | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (m) {
      cur = { title: m[1].replace(/\*\*/g, "").trim(), body: [] };
      sections.push(cur);
    } else if (cur) {
      cur.body.push(line);
    }
  }
  return sections;
}

function inline(text: string): React.ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((p) => p !== "")
    .map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
      if (p.startsWith("`") && p.endsWith("`"))
        return (
          <code key={i} className="inline-code">
            {p.slice(1, -1)}
          </code>
        );
      return <span key={i}>{p}</span>;
    });
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

const letterOf = (code: string): string => {
  const c = code.trim();
  if (c.startsWith("??")) return "U";
  return c.charAt(0) || "M";
};

function GearIcon() {
  return (
    <svg {...iconProps} width={13} height={13}>
      <path d="M1.5 4.5h13M1.5 11.5h13" />
      <circle cx="10.5" cy="4.5" r="1.8" />
      <circle cx="5.5" cy="11.5" r="1.8" />
    </svg>
  );
}

export default function Workspace() {
  const [repo, setRepo] = useState("");
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<
    Array<{ path: string; sha: string; saved: string; draft: string }>
  >([]);
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
  const [aiOpenSections, setAiOpenSections] = useState<Set<string>>(new Set());

  const toggleSection = (key: string) =>
    setAiOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [aiSettings, setAiSettings] = useState({ baseUrl: "", apiKey: "", model: "" });
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [tabTip, setTabTip] = useState<{ path: string; left: number } | null>(null);
  const tabTipTimer = useRef<number | null>(null);

  const showTabTip = (path: string, el: HTMLElement) => {
    if (tabTipTimer.current) window.clearTimeout(tabTipTimer.current);
    tabTipTimer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const estimated = path.length * 6.2 + 20;
      const left = Math.min(r.left, Math.max(8, window.innerWidth - estimated - 8));
      setTabTip({ path, left });
    }, 2000);
  };

  const hideTabTip = () => {
    if (tabTipTimer.current) {
      window.clearTimeout(tabTipTimer.current);
      tabTipTimer.current = null;
    }
    setTabTip(null);
  };
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>("TERMINAL");
  const [leftView, setLeftView] = useState<"FILES" | "GIT" | "AI">("FILES");
  const [gitEntries, setGitEntries] = useState<Array<{ code: string; path: string }>>([]);
  const [gitBusy, setGitBusy] = useState<string | null>(null);

  const logsAbort = useRef<AbortController | null>(null);

  /* the active file and its dirty state, derived from the open set */
  const active = openFiles.find((f) => f.path === sel) ?? null;
  const draft = active?.draft ?? "";
  const dirty = active ? active.draft !== active.saved : false;

  /* editor auto-save: edits hit the local disk (debounced); GitHub via source control */
  const pendingWrite = useRef<{ path: string; content: string } | null>(null);
  const writeTimer = useRef<number | null>(null);

  const flushWrite = useCallback(async () => {
    const p = pendingWrite.current;
    if (!p) return;
    pendingWrite.current = null;
    if (writeTimer.current) {
      window.clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    try {
      await fetch("/api/fs/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === p.path ? { ...f, saved: p.content } : f)),
      );
    } catch {
      /* disk write failed — draft stays, indicator shows UNSAVED */
    }
  }, []);

  const onEditorChange = (v: string) => {
    if (!sel) return;
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === sel ? { ...f, draft: v } : f)),
    );
    pendingWrite.current = { path: sel, content: v };
    if (writeTimer.current) window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      flushWrite();
    }, 500);
  };

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
    if (openFiles.some((f) => f.path === path)) {
      setSel(path);
      return;
    }
    await flushWrite();
    setBusy(path);
    try {
      const res = await fetch(`/api/gh/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOpenFiles((prev) => [
        ...prev,
        { path, sha: data.sha, saved: data.content, draft: data.content },
      ]);
      setSel(path);
    } catch (err) {
      setDeployOut(`[OPEN ERROR] ${err instanceof Error ? err.message : "failed"}\n`);
    } finally {
      setBusy(null);
    }
  };

  const closeFile = (path: string) => {
    const f = openFiles.find((x) => x.path === path);
    if (f && f.draft !== f.saved) pendingWrite.current = { path, content: f.draft };
    void flushWrite();
    const idx = openFiles.findIndex((x) => x.path === path);
    const next = openFiles.filter((x) => x.path !== path);
    setOpenFiles(next);
    if (sel === path) {
      setSel(next[Math.min(idx, next.length - 1)]?.path ?? null);
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
      if (sel && active && active.draft === active.saved) {
        const r = await fetch(`/api/gh/file?path=${encodeURIComponent(sel)}`);
        const d = await r.json();
        if (!d.error) {
          setOpenFiles((prev) =>
            prev.map((f) =>
              f.path === sel ? { ...f, sha: d.sha, saved: d.content, draft: d.content } : f,
            ),
          );
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
    setDeploying(true);
    setDockOpen(true);
    setDockTab("TERMINAL");
    await flushWrite(); // deploy exactly what the editor shows
    setDeployOut(`$ modal deploy ${sel}\n`);
    try {
      const res = await fetch("/api/modal/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: sel, content: draft }),
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

  useEffect(() => {
    fetch("/api/ai/settings")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setAiSettings({ baseUrl: d.baseUrl ?? "", apiKey: d.apiKey ?? "", model: d.model ?? "" });
      })
      .catch(() => {});
  }, []);

  const saveAiSettings = async () => {
    setBusy("aisave");
    try {
      await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiSettings),
      });
      setAiSaved(true);
      window.setTimeout(() => setAiSaved(false), 1500);
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
              <div className="ai-actions">
                <button
                  type="button"
                  className="btn btn-mini"
                  onClick={analyze}
                  disabled={!sel || busy === "ai"}
                >
                  {busy === "ai" ? "ANALYZING…" : "ANALYZE"}
                </button>
                <button
                  type="button"
                  className={`btn btn-mini ${aiSettingsOpen ? "" : "btn-ghost"}`.trim()}
                  onClick={() => setAiSettingsOpen((v) => !v)}
                  aria-label="AI settings"
                  title="AI settings"
                >
                  <GearIcon />
                </button>
              </div>
              {aiSettingsOpen && (
                <div className="ai-settings">
                  <label className="ai-set-label">
                    BASE URL
                    <input
                      className="field ai-set-input"
                      value={aiSettings.baseUrl}
                      onChange={(e) => setAiSettings((s) => ({ ...s, baseUrl: e.target.value }))}
                      placeholder="https://api.fireworks.ai/inference/v1"
                      spellCheck={false}
                    />
                  </label>
                  <label className="ai-set-label">
                    API KEY
                    <input
                      className="field ai-set-input"
                      type="password"
                      value={aiSettings.apiKey}
                      onChange={(e) => setAiSettings((s) => ({ ...s, apiKey: e.target.value }))}
                      placeholder="fw_…"
                      spellCheck={false}
                    />
                  </label>
                  <label className="ai-set-label">
                    MODEL ID
                    <input
                      className="field ai-set-input"
                      value={aiSettings.model}
                      onChange={(e) => setAiSettings((s) => ({ ...s, model: e.target.value }))}
                      placeholder="accounts/fireworks/routers/glm-5p3-flash-us"
                      spellCheck={false}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={saveAiSettings}
                    disabled={busy === "aisave"}
                  >
                    {aiSaved ? "SAVED" : busy === "aisave" ? "SAVING…" : "SAVE → SQLITE"}
                  </button>
                </div>
              )}
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
                    {aiOpenId === r.id && (
                      <div className="ai-text">
                        {parseAnalysis(r.text).map((s, i) => {
                          const key = `${r.id}-${i}`;
                          const open = aiOpenSections.has(key);
                          return (
                            <div key={key} className="ai-sec">
                              <button
                                type="button"
                                className="ai-sec-head"
                                onClick={() => toggleSection(key)}
                                aria-expanded={open}
                              >
                                <span
                                  className={`caret ${open ? "open" : ""}`.trim()}
                                  aria-hidden="true"
                                >
                                  {">"}
                                </span>
                                {s.title}
                              </button>
                              {open && (
                                <div className="ai-sec-body">
                                  {s.body.map((line, j) => {
                                    const t2 = line.trim();
                                    if (!t2) return null;
                                    if (t2.startsWith("- ") || t2.startsWith("* ")) {
                                      return (
                                        <div key={j} className="ai-bullet">
                                          {inline(t2.slice(2))}
                                        </div>
                                      );
                                    }
                                    return <p key={j}>{inline(t2)}</p>;
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
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
              <div className="git-status-row">
                <span className="field-note">
                  {gitBusy === "status"
                    ? "READING…"
                    : gitEntries.length === 0
                      ? "WORKTREE CLEAN"
                      : `WORKTREE — ${gitEntries.length} CHANGE${gitEntries.length === 1 ? "" : "S"}`}
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
              <div className="file-list sc-list">
                <div className="sc-section">
                  CHANGES
                  <span className="sc-badge">{gitEntries.length}</span>
                </div>
                {gitEntries.map((e) => {
                  const letter = letterOf(e.code);
                  const slash = e.path.lastIndexOf("/");
                  const name = slash === -1 ? e.path : e.path.slice(slash + 1);
                  const dir = slash === -1 ? "" : e.path.slice(0, slash);
                  return (
                    <button
                      key={e.code + e.path}
                      type="button"
                      className={`sc-row ${sel === e.path ? "sel" : ""}`.trim()}
                      onClick={() => openFile(e.path)}
                      title={e.path}
                    >
                      <span className="sc-name">{name}</span>
                      <span className="sc-dir">{dir}</span>
                      <span className={`sc-letter sc-${letter}`}>{letter}</span>
                    </button>
                  );
                })}
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
          {openFiles.length > 0 && (
            <div className="tab-strip">
              {openFiles.map((f) => (
                <div
                  key={f.path}
                  className={`tab ${sel === f.path ? "sel" : ""}`.trim()}
                  onClick={() => {
                    hideTabTip();
                    setSel(f.path);
                  }}
                  onMouseEnter={(e) => showTabTip(f.path, e.currentTarget)}
                  onMouseLeave={hideTabTip}
                >
                  <span className="tab-name">{f.path.split("/").pop()}</span>
                  {sel === f.path && dirty ? (
                    <i className="sq-dot" aria-hidden="true" title="Unsaved edits" />
                  ) : null}
                  <button
                    type="button"
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(f.path);
                    }}
                    aria-label={`Close ${f.path}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {sel ? (
            <div className="editor-wrap">
              <CodeMirror
                key={sel}
                value={active?.draft ?? ""}
                height="100%"
                extensions={[python(), vscodeTheme, syntaxHighlighting(vscodeHighlight), autocompletion()]}
                onChange={onEditorChange}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                  closeBrackets: true,
                  bracketMatching: true,
                  indentOnInput: true,
                  autocompletion: true,
                  history: true,
                  rectangularSelection: true,
                  crosshairCursor: true,
                  allowMultipleSelections: true,
                  drawSelection: true,
                }}
              />
            </div>
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

      {tabTip && (
        <div className="tab-tip" style={{ left: tabTip.left, top: 52 }}>
          {tabTip.path}
        </div>
      )}
    </main>
  );
}
