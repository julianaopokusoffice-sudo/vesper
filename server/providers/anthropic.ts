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

const VERSION = '2023-06-01';

export async function runAnthropic(cred: ProviderCredentials, req: ProviderRequest): Promise<ProviderResponse> {
  const system = req.messages
    .filter((m): m is Extract<InvokeMessage, { role: 'system' }> => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature,
    stream: true,
    system,
    messages: toAnthropicMessages(req.messages),
    ...(req.tools.length
      ? {
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
  };

  const res = await fetch(`${cred.baseURL.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cred.apiKey,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new ProviderError(res.status, await readError(res));
  if (!res.body) throw new ProviderError(0, 'Anthropic returned an empty body.');

  let text = '';
  let reasoning = '';
  let finishReason = 'end_turn';
  const usage = { promptTokens: 0, completionTokens: 0 };
  const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();

  for await (const event of sseJson(res.body)) {
    switch (event?.type) {
      case 'message_start':
        usage.promptTokens = event.message?.usage?.input_tokens ?? 0;
        break;
      case 'content_block_start': {
        const block = event.content_block ?? {};
        blocks.set(event.index, { type: block.type, id: block.id, name: block.name, json: '' });
        break;
      }
      case 'content_block_delta': {
        const entry = blocks.get(event.index);
        const delta = event.delta ?? {};
        if (delta.type === 'text_delta' && delta.text) {
          text += delta.text;
          req.onText(delta.text);
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          reasoning += delta.thinking;
          req.onReasoning?.(delta.thinking);
        } else if (delta.type === 'input_json_delta' && entry) {
          entry.json += delta.partial_json ?? '';
        }
        break;
      }
      case 'message_delta':
        usage.completionTokens = event.usage?.output_tokens ?? usage.completionTokens;
        if (event.delta?.stop_reason) finishReason = event.delta.stop_reason;
        break;
      case 'error':
        throw new ProviderError(0, event.error?.message ?? 'Anthropic stream error');
      default:
        break;
    }
  }

  const toolCalls: ToolCall[] = [...blocks.values()]
    .filter((b) => b.type === 'tool_use' && b.name)
    .map((b) => ({ id: b.id ?? `tool_${b.name}`, name: b.name!, arguments: b.json || '{}' }));

  return {
    text,
    reasoning: reasoning || undefined,
    toolCalls,
    usage:
      usage.promptTokens || usage.completionTokens
        ? { ...usage, costUSD: undefined }
        : estimateUsage(req.messages, text),
    finishReason,
  };
}

function toAnthropicMessages(messages: InvokeMessage[]) {
  const out: { role: 'user' | 'assistant'; content: any[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && last.content.some((c) => c.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const content: any[] = [];
      if (m.content.trim()) content.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments || '{}');
        } catch {
          input = {};
        }
        content.push({ type: 'tool_use', id: call.id, name: call.name, input });
      }
      if (content.length) out.push({ role: 'assistant', content });
      continue;
    }

    // Vision: Anthropic takes base64 image blocks with an explicit media type.
    const blocks: any[] = [];
    if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
    for (const image of m.images ?? []) {
      const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(image);
      if (match) blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
    }
    out.push({ role: 'user', content: blocks.length ? blocks : [{ type: 'text', text: m.content }] });
  }
  return out;
}
