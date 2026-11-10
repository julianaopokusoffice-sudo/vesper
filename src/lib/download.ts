/** Saving is a first-class action here: every visual can leave the app. */

export function safeFilename(title: string | undefined, fallback: string, ext: string): string {
  const base = (title || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || fallback}.${ext}`;
}

/**
 * Android's WebView cannot follow a blob: download into shared storage. The
 * native bridge writes one file into Downloads/Vesper; desktop and mobile web
 * keep the normal anchor path.
 */
function saveWithAndroidBridge(blob: Blob, filename: string): boolean {
  const bridge = (window as any).VesperAndroid as { saveBase64?: (name: string, base64: string, mime: string) => string } | undefined;
  if (!bridge?.saveBase64) return false;
  void blob
    .arrayBuffer()
    .then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
      }
      bridge.saveBase64?.(filename, btoa(binary), blob.type || 'application/octet-stream');
    })
    .catch(() => undefined);
  return true;
}

export function downloadBlob(blob: Blob, filename: string) {
  if (saveWithAndroidBridge(blob, filename)) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadJson(value: unknown, filename: string) {
  downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const [head, payload] = dataUrl.split(',');
  if (!payload) return false;
  const isBase64 = /;base64/i.test(head ?? '');
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream';
  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    downloadBlob(new Blob([bytes], { type: mime }), filename);
  } else {
    downloadBlob(new Blob([decodeURIComponent(payload)], { type: mime }), filename);
  }
  return true;
}

/** Copies an image through fetch so cross-origin files still save with a name. */
export async function downloadImage(url: string, filename: string): Promise<boolean> {
  if (url.startsWith('data:')) return downloadDataUrl(url, filename);
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    downloadBlob(blob, filename);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    return false;
  }
}

export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
    const box = svg.getBoundingClientRect();
    const viewBox = svg.getAttribute('viewBox') ?? `0 0 ${box.width || 900} ${box.height || 420}`;
    const [, , w, h] = viewBox.split(/\s+/);
    clone.setAttribute('width', w ?? '900');
    clone.setAttribute('height', h ?? '420');
  }
  return new XMLSerializer().serializeToString(clone);
}

/** Rasterises the SVG at 2x for slides, PDFs and group chats. */
export async function svgToPngBlob(svg: SVGSVGElement, background = '#14141c'): Promise<Blob> {
  const source = serializeSvg(svg);
  const viewBox = (svg.getAttribute('viewBox') ?? '0 0 900 420').split(/\s+/).map(Number);
  const width = (viewBox[2] ?? 900) * 2;
  const height = (viewBox[3] ?? 420) * 2;
  const image = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not rasterise the chart.'));
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this webview.');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))), 'image/png');
  });
}

export function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** Renders standalone HTML artefacts with the app's dark paper, without app CSS leaking in. */
export function wrapHtmlDocument(body: string): string {
  if (/<html[\s>]/i.test(body)) return body;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Artifact</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; background: #14141c; color: #eceaf4;
    font: 15px/1.55 'Instrument Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  h1, h2, h3 { line-height: 1.2; margin: 0 0 .5em; font-weight: 600; letter-spacing: -0.01em; }
  h1 { font-size: 26px; } h2 { font-size: 20px; } h3 { font-size: 16px; }
  a { color: #efc07a; }
  code, pre { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; font-size: 12.5px; }
  pre { background: #1b1b24; padding: 12px; border-radius: 10px; overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #2c2c38; padding: 7px 10px; text-align: left; }
  th { color: #b9b6c6; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  img, svg, canvas { max-width: 100%; height: auto; }
  hr { border: 0; border-top: 1px solid #2c2c38; margin: 20px 0; }
</style></head><body>${body}</body></html>`;
}
