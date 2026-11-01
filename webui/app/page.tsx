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
              style={{ paddingLeft: 14 + depth * 12 }}
              onClick={() => onToggle(node.path)}
              aria-expanded={open.has(node.path)}
            >
              <i className={`caret ${open.has(node.path) ? "open" : ""}`.trim()} aria-hidden="true" />
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
            className={`file-item mono ${sel === node.path ? "sel" : ""}`.trim()}
            style={{ paddingLeft: 14 + depth * 12 + 16 }}
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
  const [message, setMessage] = useState("");
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
      setMessage("");
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
        body: JSON.stringify({ path: sel, content: draft, sha, message }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSha(data.sha);
      setSaved(draft);
      setMessage("");
    } catch (err) {
      setDeployOut(`[SAVE ERROR] ${err instanceof Error ? err.message : "failed"}\n`);
    } finally {
      setBusy(null);
    }
  };

  const deploy = async () => {
    if (!sel || deploying) return;
    if (dirty && !window.confirm("Unsaved edits deploy the last saved version. Deploy anyway?"))
      return;
    setDeploying(true);
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
    return () => logsAbort.current?.abort();
  }, []);

  return (
    <main className="ws">
      {/* ---------------- files ---------------- */}
      <aside className="ws-files">
        <div className="pane-head">
          <span>REPO — {repo || "…"}</span>
          <button type="button" className="kill" onClick={refreshTree}>
            SYNC
          </button>
        </div>
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
              <input
                className="field mono"
                placeholder="COMMIT MESSAGE (OPTIONAL)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                spellCheck={false}
              />
              <button type="button" className="btn" onClick={save} disabled={!dirty || busy === "save"}>
                {busy === "save" ? "COMMITTING…" : "SAVE → LOCAL + GITHUB"}
              </button>
            </div>
          </>
        ) : (
          <div className="empty-press">SELECT A FILE — EDIT — DEPLOY — WATCH LOGS</div>
        )}
      </section>

      {/* ---------------- actions ---------------- */}
      <aside className="ws-actions">
        <div className="pane">
          <div className="pane-head">
            <span>DEPLOY</span>
            <button
              type="button"
              className="btn btn-mini"
              onClick={deploy}
              disabled={!sel || deploying}
            >
              {deploying ? "DEPLOYING…" : `MODAL DEPLOY ↗`}
            </button>
          </div>
          <pre className="console">{deployOut || "$ —"}</pre>
          {endpoints.length > 0 && (
            <div className="ep-list">
              {endpoints.map((u) => (
                <span key={u} className="ep mono">
                  <a href={u} target="_blank" rel="noreferrer">{u}</a>
                  <button type="button" className="kill" onClick={() => navigator.clipboard.writeText(u)}>
                    COPY
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="pane">
          <div className="pane-head">
            <span>LOGS</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="field mono"
                style={{ width: 150, padding: "4px 8px", fontSize: 11 }}
                placeholder="APP NAME"
                value={logApp}
                onChange={(e) => setLogApp(e.target.value)}
                spellCheck={false}
              />
              <button
                type="button"
                className={`btn btn-mini ${following ? "" : "btn-ghost"}`}
                onClick={followLogs}
                disabled={!logApp}
              >
                {following ? "STOP" : "FOLLOW"}
              </button>
            </div>
          </div>
          <pre className="console">
            {logLines.length > 0 ? logLines.join("\n") : "$ — PRESS FOLLOW TO STREAM LOGS"}
          </pre>
        </div>

        <div className="pane">
          <div className="pane-head">
            <span>TEST THE ENDPOINT</span>
            <button type="button" className="btn btn-mini" onClick={runTest} disabled={!testUrl || busy === "test"}>
              {busy === "test" ? "RUNNING…" : "RUN →"}
            </button>
          </div>
          <input
            className="field mono"
            style={{ fontSize: 11 }}
            placeholder="https://…modal.run"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            spellCheck={false}
          />
          <textarea
            className="field mono"
            style={{ fontSize: 11, minHeight: 90, marginTop: 8 }}
            value={testBody}
            onChange={(e) => setTestBody(e.target.value)}
            spellCheck={false}
          />
          <pre className="console" style={{ marginTop: 8 }}>
            {testOut || "$ —"}
          </pre>
        </div>
      </aside>
    </main>
  );
}
