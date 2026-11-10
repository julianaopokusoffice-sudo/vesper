import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Artifact, isVisualLang } from './Artifact';
import { ArtifactLink, isArtifactHref } from './visuals/ArtifactLink';
import { CodeBlock } from './CodeBlock';
import { Figure } from './Figure';
import { Mermaid } from './Mermaid';

/**
 * react-markdown strips unknown schemes by default, which would silently delete
 * `vesper://artifact/…` download links. Allow the schemes the console actually
 * renders and drop the rest, so a `javascript:` link can never become clickable.
 */
function transformUrl(url: string): string {
  return /^(https?:|mailto:|tel:|data:image\/|\/|#|vesper:\/\/artifact\/)/i.test(url.trim()) ? url : '';
}

export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `prose-v ${className}` : 'prose-v'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={transformUrl}
        components={{
          pre: ({ children }) => {
            const child = (Array.isArray(children) ? children[0] : children) as
              | { props?: { className?: string; children?: ReactNode } }
              | undefined;
            const className = child?.props?.className ?? '';
            const lang = /language-([\w+-]+)/.exec(className)?.[1];
            const code = String(child?.props?.children ?? '').replace(/\n$/, '');
            if (lang === 'mermaid') return <Mermaid code={code} />;
            if (lang && isVisualLang(lang)) return <Artifact lang={lang} code={code} />;
            return <CodeBlock code={code} lang={lang} />;
          },
          code: ({ children }) => <code>{children}</code>,
          img: ({ src, alt, title }) => <Figure src={typeof src === 'string' ? src : undefined} alt={alt} title={title} />,
          a: ({ href, children }) =>
            href && isArtifactHref(href) ? (
              <ArtifactLink href={href}>{children}</ArtifactLink>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-line-soft">
              <table className="border-0">{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
