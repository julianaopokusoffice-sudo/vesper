import type { ProviderInfo, Usage } from '../../shared/types.ts';

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as the model emitted it. */
  arguments: string;
}

export type InvokeMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; /** data URIs, vision input */ images?: string[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ProviderCredentials {
  baseURL: string;
  apiKey: string;
  info: ProviderInfo;
}

export interface ProviderRequest {
  model: string;
  messages: InvokeMessage[];
  tools: ToolDef[];
  temperature: number;
  maxTokens?: number;
  signal: AbortSignal;
  /** Persona name, used only by the offline demo model for flavour. */
  agentName?: string;
  onText: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export interface ProviderResponse {
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string;
}

export class ProviderError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(explain(status, detail));
    this.status = status;
    this.detail = detail;
  }
}

function explain(status: number, detail: string): string {
  const trimmed = detail.slice(0, 500).replace(/\s+/g, ' ').trim();
  const hint =
    status === 401 || status === 403
      ? 'Check that the API key is correct and has access to this model.'
      : status === 404
        ? 'The endpoint or model name looks wrong. Verify the base URL and model id.'
        : status === 429
          ? 'Rate limited by the provider. Wait a moment or switch models.'
          : status >= 500
            ? 'The provider returned a server error. Try again.'
            : '';
  return `${status ? `HTTP ${status}: ` : ''}${trimmed || 'Provider request failed.'}${hint ? ` — ${hint}` : ''}`;
}

/** Read a fetch body as newline-delimited SSE lines. */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}

/** Yield the JSON payload of every `data:` frame in a stream. */
export async function* sseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  for await (const line of sseLines(body)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      yield JSON.parse(payload);
    } catch {
      /* providers occasionally emit keep-alive noise */
    }
  }
}

export async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const msg = json?.error?.message ?? json?.message ?? json?.error;
      if (typeof msg === 'string') return msg;
    } catch {
      /* not json */
    }
    return text;
  } catch {
    return res.statusText;
  }
}
