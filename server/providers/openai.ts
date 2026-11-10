import { estimateUsage } from './pricing.ts';
import {
  ProviderError,
  readError,
  sseJson,
  type InvokeMessage,
  type ProviderCredentials,
  type ProviderRequest,
  type ProviderResponse,
  type ToolCall,
} from './types.ts';

/**
 * One adapter covers every OpenAI-compatible chat-completions endpoint:
 * OpenAI, Groq, OpenRouter, Ollama (/v1), LM Studio, llama.cpp server, vLLM,
 * and any custom gateway. That is the whole point of the local-first design —
 * a new provider is a base URL and a model id, not a code change.
 */
export async function runOpenAI(cred: ProviderCredentials, req: ProviderRequest): Promise<ProviderResponse> {
  const body = {
    model: req.model,
    messages: toOpenAIMessages(req.messages),
    stream: true,
    temperature: req.temperature,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.tools.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: 'auto',
        }
      : {}),
  };

  let res = await post(cred, body, req, true);
  if (!res.ok && res.status === 400) {
    // Some local servers reject `stream_options`; retry once without it.
    const detail = await readError(res);
    if (/stream_options|include_usage/i.test(detail)) {
      res = await post(cred, body, req, false);
    } else {
      throw new ProviderError(res.status, detail);
    }
  }
  if (!res.ok) throw new ProviderError(res.status, await readError(res));
  if (!res.body) throw new ProviderError(0, 'Provider returned an empty response body.');

  let text = '';
  let reasoning = '';
  const calls = new Map<number, ToolCall>();
  let finishReason = 'stop';
  let usage: ProviderResponse['usage'] | null = null;

  for await (const chunk of sseJson(res.body)) {
    const choice = chunk?.choices?.[0];
    if (chunk?.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
      };
    }
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta ?? choice.message;
    if (!delta) continue;

    if (typeof delta.content === 'string' && delta.content.length) {
      text += delta.content;
      req.onText(delta.content);
    }
    const think = delta.reasoning_content ?? delta.reasoning;
    if (typeof think === 'string' && think.length) {
      reasoning += think;
      req.onReasoning?.(think);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        const idx: number = part.index ?? 0;
        const existing = calls.get(idx) ?? { id: part.id ?? `call_${idx}`, name: '', arguments: '' };
        if (part.id) existing.id = part.id;
        if (part.function?.name) existing.name = part.function.name;
        if (part.function?.arguments) existing.arguments += part.function.arguments;
        calls.set(idx, existing);
      }
    }
  }

  const toolCalls = [...calls.values()].filter((c) => c.name);
  return {
    text,
    reasoning: reasoning || undefined,
    toolCalls,
    usage: usage ?? estimateUsage(req.messages, text),
    finishReason,
  };
}

function post(cred: ProviderCredentials, body: unknown, req: ProviderRequest, withUsage: boolean) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cred.apiKey) headers.authorization = `Bearer ${cred.apiKey}`;
  if (cred.info.id === 'openrouter') {
    headers['http-referer'] = 'https://github.com/vesper-agents/vesper';
    headers['x-title'] = 'Vesper';
  }
  const payload = withUsage ? { ...(body as object), stream_options: { include_usage: true } } : body;
  return fetch(`${trimSlash(cred.baseURL)}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: req.signal,
  });
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function toOpenAIMessages(messages: InvokeMessage[]) {
  return messages.map((m) => {
    switch (m.role) {
      case 'assistant':
        return m.toolCalls?.length
          ? {
              role: 'assistant',
              content: m.content || null,
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.arguments || '{}' },
              })),
            }
          : { role: 'assistant', content: m.content };
      case 'tool':
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
      case 'user':
        // Vision: any OpenAI-compatible endpoint takes data URIs in image_url.
        return m.images?.length
          ? {
              role: 'user',
              content: [
                { type: 'text', text: m.content || 'Look at the attached image(s).' },
                ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
              ],
            }
          : { role: 'user', content: m.content };
      default:
        return { role: m.role, content: m.content };
    }
  });
}

/** List models from an OpenAI-compatible `/models` endpoint. */
export async function listOpenAIModels(cred: ProviderCredentials): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (cred.apiKey) headers.authorization = `Bearer ${cred.apiKey}`;
  const res = await fetch(`${trimSlash(cred.baseURL)}/models`, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new ProviderError(res.status, await readError(res));
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
