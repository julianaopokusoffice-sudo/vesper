/**
 * Rough token counting (≈4 chars/token) and approximate pricing so the UI can
 * show relative cost. Local models are always free. Numbers are indicative and
 * kept in one place so they are easy to correct.
 */
const PRICES: { match: RegExp; in: number; out: number }[] = [
  { match: /^gpt-5(\.\d)?$/i, in: 1.25, out: 10 },
  { match: /^gpt-5.*mini/i, in: 0.25, out: 2 },
  { match: /^o4-mini/i, in: 1.1, out: 4.4 },
  { match: /^gpt-4\.1/i, in: 2, out: 8 },
  { match: /claude.*opus/i, in: 15, out: 75 },
  { match: /claude.*sonnet/i, in: 3, out: 15 },
  { match: /claude.*haiku/i, in: 1, out: 5 },
  { match: /llama|kimi|qwen|deepseek/i, in: 0.6, out: 0.8 },
  { match: /gemini.*pro/i, in: 1.25, out: 10 },
  { match: /gemini.*flash/i, in: 0.3, out: 2.5 },
];

export function costFor(model: string, promptTokens: number, completionTokens: number): number | undefined {
  const row = PRICES.find((p) => p.match.test(model));
  if (!row) return undefined;
  return (promptTokens / 1_000_000) * row.in + (completionTokens / 1_000_000) * row.out;
}

export function countTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateUsage(
  messages: { content: string; role: string }[],
  completion: string,
  model?: string,
) {
  const promptTokens = messages.reduce((sum, m) => sum + countTokens(m.content ?? ''), 0);
  const completionTokens = countTokens(completion);
  return {
    promptTokens,
    completionTokens,
    costUSD: model ? costFor(model, promptTokens, completionTokens) : undefined,
  };
}
