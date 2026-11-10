import { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import cssLang from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdownLang from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import diff from 'highlight.js/lib/languages/diff';
import { Check, Copy } from 'lucide-react';
import { cn } from './ui';

const LANGS: Record<string, any> = {
  typescript,
  javascript,
  json,
  bash,
  shell: bash,
  python,
  css: cssLang,
  xml,
  html: xml,
  sql,
  yaml,
  markdown: markdownLang,
  rust,
  go,
  diff,
};

for (const [name, language] of Object.entries(LANGS)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cn('flex items-center gap-1 rounded-md px-1.5 py-1 text-faint transition-colors hover:bg-white/5 hover:text-fg-2', className)}
      aria-label="Copy"
    >
      {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
      <span className="font-mono text-[9.5px] uppercase tracking-wider">{copied ? 'copied' : 'copy'}</span>
    </button>
  );
}

export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const language = lang && LANGS[lang] ? lang : undefined;
  const html = useMemo(() => {
    try {
      if (language) return hljs.highlight(code, { language }).value;
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, language]);

  return (
    <div className={cn('group relative my-3 overflow-hidden rounded-xl border border-line bg-[oklch(0.155_0.009_272)]', className)}>
      <div className="flex items-center justify-between border-b border-line-soft bg-white/[0.018] px-3 py-1.5">
        <span className="font-mono text-[10px] lowercase tracking-[0.08em] text-faint">{language ?? 'text'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="max-h-[520px] overflow-auto px-3.5 py-3 text-[12.5px] leading-[1.65]">
        <code className="hljs mono block" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
