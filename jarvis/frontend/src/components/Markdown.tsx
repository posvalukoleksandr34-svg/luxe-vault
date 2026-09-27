import { Fragment, type ReactNode } from "react";

/** Small, safe Markdown renderer (no raw HTML): paragraphs, headings, lists, code, bold/italic, links. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return <div className={className}>{blocks}</div>;
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed">
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push(
        <p key={key++} className="mt-3 mb-1 font-semibold text-text first:mt-0">
          {inline(h[2])}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={key++} className={ordered ? "my-1.5 list-decimal space-y-0.5 pl-5" : "my-1.5 list-disc space-y-0.5 pl-5 marker:text-faint"}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|?\s*:?-{2,}/)) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      const [head, , ...body] = rows;
      out.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="border-b border-line px-2 py-1.5 font-medium text-muted">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, j) => (
                <tr key={j}>{r.map((c, k) => <td key={k} className="border-b border-line/60 px-2 py-1.5">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+|\|)/.test(lines[i])) para.push(lines[i++]);
    out.push(
      <p key={key++} className="my-1.5 first:mt-0 last:mb-0">
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+)/g;

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) parts.push(<code key={k++} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-accent-strong">{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) parts.push(<strong key={k++} className="font-semibold text-text">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("*")) parts.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      const href = m[2];
      parts.push(<a key={k++} href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">{label}</a>);
    } else parts.push(<a key={k++} href={t} target="_blank" rel="noreferrer noopener" className="break-all text-accent underline decoration-accent/30 underline-offset-2">{t}</a>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
