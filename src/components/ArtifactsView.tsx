import { useEffect, useMemo, useState } from 'react';
import { Download, FileJson, FileText, Image as ImageIcon, Loader2, Package, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadText } from '@/lib/download';
import { Markdown } from './Markdown';
import { HtmlArtifact } from './visuals/HtmlArtifact';
import { Chip, PageHeader, cn } from './ui';

type Artifact = { name: string; bytes: number; modified: number };

/**
 * Deliverables, not chat scrollback. Every document the agent produces lands
 * here with a preview — markdown and HTML render, CSV becomes a table, JSON is
 * inspectable, Office files download. This is where a researcher goes to find
 * "the figure I made an hour ago" without scrolling the transcript.
 */
export function ArtifactsView() {
  const [files, setFiles] = useState<Artifact[]>([]);
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const result = await api.artifacts();
      setFiles(result.files);
      setPath(result.path);
      if (!selected && result.files[0]) setSelected(result.files[0].name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list artifacts');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) {
      setBody(null);
      return;
    }
    const ext = extension(selected);
    if (!['md', 'html', 'htm', 'svg', 'csv', 'json', 'txt'].includes(ext)) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetch(api.artifactUrl(selected))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setBody(text.length > 800_000 ? text.slice(0, 800_000) : text);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const current = files.find((file) => file.name === selected);
  const ext = selected ? extension(selected) : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 py-5 sm:px-8">
        <PageHeader
          title="Deliverables"
          subtitle="Documents, datasets and figures the agents produced — previewed here, downloadable anywhere."
          meta={<Chip tone={files.length ? 'ok' : 'accent'}>{files.length} files</Chip>}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => void load()}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-2 hover:border-line-strong"
              >
                <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> refresh
              </button>
            </div>
          }
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 border-t border-line-soft md:grid-cols-[280px_1fr]">
        <div className="max-h-[220px] overflow-y-auto border-b border-line-soft md:max-h-none md:border-b-0 md:border-r">
          {files.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Package size={20} className="mx-auto text-faint" />
              <p className="mt-2 text-[12px] text-muted">Nothing yet.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                Ask an agent for a report, chart export or dataset — it lands here with a download link.
              </p>
            </div>
          ) : (
            <ul className="p-1.5">
              {files.map((file) => (
                <li key={file.name}>
                  <button
                    onClick={() => setSelected(file.name)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                      file.name === selected ? 'bg-white/[0.06] text-fg' : 'text-muted hover:bg-white/[0.035]',
                    )}
                  >
                    <FileGlyph ext={extension(file.name)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px]">{file.name}</span>
                      <span className="block font-mono text-[9.5px] text-faint">
                        {extension(file.name) || 'file'} · {formatBytes(file.bytes)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {path ? <p className="px-3 py-2 font-mono text-[9px] text-faint/70">{path}</p> : null}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {!current ? (
            <div className="grid h-full min-h-[240px] place-items-center px-6 text-center">
              <p className="max-w-sm text-[12px] leading-relaxed text-faint">Select a file to preview it.</p>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2">
                <span className="truncate text-[12.5px] text-fg-2">{current.name}</span>
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">
                  {ext || 'file'} · {formatBytes(current.bytes)}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <a
                    href={api.artifactUrl(current.name)}
                    download={current.name}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 font-mono text-[9.5px] uppercase tracking-wider text-fg-2 hover:border-line-strong"
                  >
                    <Download size={11} /> download
                  </a>
                  {body !== null && textLike(ext) ? (
                    <button
                      onClick={() => downloadText(body, current.name)}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 font-mono text-[9.5px] uppercase tracking-wider text-faint hover:text-fg-2"
                    >
                      <FileText size={11} /> copy file
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {loading ? (
                  <div className="flex items-center gap-2 px-4 py-6 font-mono text-[10px] uppercase tracking-wider text-faint">
                    <Loader2 size={12} className="animate-spin text-accent" /> loading preview
                  </div>
                ) : error ? (
                  <p className="px-4 py-6 text-[12px] text-danger">{error}</p>
                ) : ext === 'md' && body !== null ? (
                  <div className="px-5 py-5">
                    <Markdown>{body}</Markdown>
                  </div>
                ) : (ext === 'html' || ext === 'htm') && body !== null ? (
                  <HtmlArtifact code={body} kind="html" title={current.name} />
                ) : ext === 'svg' && body !== null ? (
                  <HtmlArtifact code={body} kind="svg" title={current.name} />
                ) : ext === 'csv' && body !== null ? (
                  <CsvTable text={body} />
                ) : ext === 'json' && body !== null ? (
                  <pre className="mono whitespace-pre-wrap px-4 py-4 text-[11px] leading-relaxed text-muted">{pretty(body)}</pre>
                ) : ext === 'txt' && body !== null ? (
                  <pre className="mono whitespace-pre-wrap px-4 py-4 text-[11.5px] leading-relaxed text-fg-2">{body}</pre>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <p className="text-[12px] text-muted">
                      {ext === 'docx' ? 'Word document' : ext === 'pdf' ? 'PDF' : 'Binary file'} — download it to open in its native app.
                    </p>
                    <a
                      href={api.artifactUrl(current.name)}
                      download={current.name}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-ink-1000"
                    >
                      <Download size={12} /> Save {current.name}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function textLike(ext: string): boolean {
  return ['md', 'html', 'htm', 'svg', 'csv', 'json', 'txt'].includes(ext);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function FileGlyph({ ext }: { ext: string }) {
  const className = 'shrink-0 text-faint';
  if (['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return <ImageIcon size={13} className={className} />;
  if (ext === 'json') return <FileJson size={13} className={className} />;
  return <FileText size={13} className={className} />;
}

/** Small CSV reader: quoted fields, escaped quotes, comma or semicolon. */
function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text).slice(0, 500), [text]);
  if (!rows.length) return <p className="px-4 py-6 text-[12px] text-faint">Empty dataset.</p>;
  const [head, ...body] = rows;
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 bg-ink-950/95">
          <tr>
            {head?.map((cell, index) => (
              <th key={index} className="border-b border-line px-3 py-1.5 text-left font-mono text-[9.5px] uppercase tracking-wider text-faint">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex % 2 ? 'bg-white/[0.012]' : ''}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="mono border-b border-line-soft/60 px-3 py-1.5 text-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseCsv(text: string): string[][] {
  const separator = text.split('\n')[0]?.includes(';') && !text.split('\n')[0]?.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}
