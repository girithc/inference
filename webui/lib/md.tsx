import React from "react";

/**
 * Minimal, safe markdown-ish renderer for model output. Escapes all HTML
 * first, then applies a small subset: fenced code blocks, h1–h4, unordered
 * lists, bold / italic / inline code. No dependencies.
 */

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function Markdownish({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="md-code">
          {lang ? <span className="md-lang">{lang}</span> : null}
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = (`h${h[1].length}` as "h1" | "h2" | "h3" | "h4");
      blocks.push(<Tag key={key++}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(
        <ul key={key++}>
          {items.map((it, n) => (
            <li key={n} dangerouslySetInnerHTML={{ __html: inline(it) }} />
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(
        <ol key={key++}>
          {items.map((it, n) => (
            <li key={n} dangerouslySetInnerHTML={{ __html: inline(it) }} />
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])
    )
      para.push(lines[i++]);
    blocks.push(<p key={key++} dangerouslySetInnerHTML={{ __html: inline(para.join(" ")) }} />);
  }

  return <div className="md">{blocks}</div>;
}
