import { estimateUsage } from './pricing.ts';
import type { InvokeMessage, ProviderCredentials, ProviderRequest, ProviderResponse, ToolCall } from './types.ts';

/**
 * A deterministic, offline "model". It exists so the entire product — streaming,
 * tool calls, council runs, persistence — can be explored and tested before the
 * user adds a single API key. It is clearly labelled `demo` everywhere in the UI
 * and never claims to be a real model.
 */
export async function runDemo(_cred: ProviderCredentials, req: ProviderRequest): Promise<ProviderResponse> {
  const last = req.messages[req.messages.length - 1];
  const userText = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  await pause(140, req.signal);

  // Second pass after a tool result: summarise what came back.
  if (last?.role === 'tool') {
    // A generated document comes back as `[title](vesper://artifact/<file>)`.
    // Replying with that marker outside a code fence is what turns it into a
    // download card, so demo the whole deliverable path, not just the tool.
    const marker = /\[[^\]]+\]\(vesper:\/\/artifact\/[^)]+\)/.exec(last.content);
    const text = marker
      ? `Written and ready to save:\n\n${marker[0]}\n\nThat file is a real deliverable in your artifacts store — open it, print it, or hand it to someone. The document body never had to pass through the chat window, which is the point of asking for a file instead of prose.\n\n**Next:** ask for the same thing as HTML, CSV or a one-page brief and compare.`
      : `Here's what the tool returned, and what I'd do with it.\n\n\`\`\`\n${truncate(last.content, 700)}\n\`\`\`\n\nThat's live data from your machine, not a canned answer — which is the point of the tool loop: the model decides, the runtime executes, the result goes back into the window.\n\n**Next:** ask me a follow-up and I'll keep the trace visible so you can audit every step.`;
    await stream(text, req);
    return done(text, req);
  }

  // First pass: should we reach for a tool? Keep the triggers explicit so the
  // demo is predictable rather than pretending to reason.
  const call = pickToolCall(userText, req.tools.map((t) => t.name));
  if (call) {
    await stream('Checking that against a tool rather than guessing.\n\n', req);
    return {
      text: '',
      toolCalls: [call],
      usage: estimateUsage(req.messages, ''),
      finishReason: 'tool_calls',
    };
  }

  const text = compose(userText, req.agentName ?? 'Vesper');
  await stream(text, req);
  return done(text, req);
}

function done(text: string, req: ProviderRequest): ProviderResponse {
  return { text, toolCalls: [], usage: estimateUsage(req.messages, text), finishReason: 'stop' };
}

function pickToolCall(prompt: string, available: string[]): ToolCall | null {
  const has = (name: string) => available.includes(name);
  if (has('clock') && /(what|current)\s+time|today'?s date|what day/i.test(prompt)) {
    return { id: `call_${rand()}`, name: 'clock', arguments: '{}' };
  }
  if (has('list_files') && /list.*(files|workspace)|what.*in.*(folder|directory)/i.test(prompt)) {
    return { id: `call_${rand()}`, name: 'list_files', arguments: JSON.stringify({ path: '.' }) };
  }
  if (has('load_skill') && /skill|playbook|checklist/i.test(prompt)) {
    return { id: `call_${rand()}`, name: 'load_skill', arguments: JSON.stringify({ name: 'deep-research' }) };
  }
  if (has('web_search') && /search (the )?web|look up|latest news/i.test(prompt)) {
    return { id: `call_${rand()}`, name: 'web_search', arguments: JSON.stringify({ query: truncate(prompt, 90) }) };
  }
  if (has('create_document') && /\b(brief|memo|report|white ?paper|proposal|document|docx)\b/i.test(prompt)) {
    const title = truncate(prompt.replace(/^(write|draft|make|create)\s+(me\s+)?(a|an)?\s*/i, ''), 70) || 'Brief';
    return {
      id: `call_${rand()}`,
      name: 'create_document',
      arguments: JSON.stringify({
        title: title.replace(/[.?!]+$/, ''),
        format: /html/i.test(prompt) ? 'html' : /csv/i.test(prompt) ? 'csv' : 'docx',
        subtitle: 'Prepared offline by the demo model',
        content: [
          `## The question`,
          `What would it take to act on “${truncate(prompt, 200)}” — and how would we know it worked?`,
          '',
          '## What we know',
          '- The constraint that matters is usually unstated; write it down before costing anything.',
          '- One measured vertical slice beats a plan that has never touched the real system.',
          '',
          '## Recommendation',
          '1. Define the success condition, including the failure case.',
          '2. Build the thinnest slice that exercises the real integration.',
          '3. Instrument it before scaling it.',
          '',
          '## Sources',
          '- Offline demo data — replace with citations from `web_search` and `fetch_url`.',
        ].join('\n'),
      }),
    };
  }
  return null;
}

const WANTS_VISUAL = /\b(chart|graph|plot|visuali[sz]e|dashboard|3d|model|scene|diagram|report|brief|compare|comparison|trend|vs\.?)\b|before.*after/i;

const VOICES: Record<string, { open: string; close: string; habit: string }> = {
  Flint: { open: 'Straight answer.', close: 'Ship it, then measure it.', habit: 'Smallest diff that works. No ceremony.' },
  Sage: { open: "Let's take it apart.", close: 'Try explaining it back to me in one sentence.', habit: 'One worked example beats three definitions.' },
  Muse: { open: 'Here is the shape of it.', close: 'Say it out loud once before you commit.', habit: 'Specific nouns, active verbs, no throat-clearing.' },
  Probe: { open: 'Threat model first.', close: 'Assume the input is hostile.', habit: 'Every trust boundary gets a test.' },
  Atlas: { open: 'Pulling the threads together.', close: 'Confidence: medium — verify the load-bearing assumption.', habit: 'Separate what is known from what is inferred.' },
  Ledger: { open: 'Numbers first.', close: 'Show the unit economics or it is a hobby.', habit: 'Per-unit, not totals.' },
  Quill: { open: 'Reading it as an editor.', close: 'Cut the first paragraph; it is warm-up.', habit: 'The argument goes in the topic sentence.' },
  Vesper: { open: "Here's my read.", close: 'Tell me which constraint matters most and I will tighten it.', habit: 'Concrete over abstract; show the working.' },
};

function compose(prompt: string, agentName: string): string {
  const voice = VOICES[agentName] ?? VOICES.Vesper!;
  const topic = truncate(prompt.replace(/\s+/g, ' ').trim(), 130) || 'the problem you brought';
  const wantsCode = /\b(code|react|typescript|function|api|sql|python|component)\b/i.test(prompt);
  const parts: string[] = [];

  // The demo model's job is to prove the harness: when the question has a
  // shape, answer with an artifact the user can touch instead of prose.
  if (WANTS_VISUAL.test(prompt)) {
    parts.push(/compare|\bvs\.?\b|before.*after/i.test(prompt) ? comparisonShowcase(topic) : showcase(topic));
    parts.push(
      `\nBoth blocks are rendered by the console, not by the model: hover the chart for a point, drag the scene to orbit it, and take either one out as SVG, PNG, CSV, GLB or JSON. Ask for an interactive calculator and you get a live HTML block the same way.\n\n> ${voice.close}\n`,
    );
    parts.push(
      `\n*Offline demo model — the visuals are real, the numbers are illustrative. Add a provider key in Settings for live inference.*`,
    );
    return parts.join('');
  }

  parts.push(`${voice.open} On "${topic}" — the useful move is to shrink the question until it has a verifiable answer.\n`);

  parts.push(
    `Most of the difficulty here is not the interesting part. It is the unstated constraint: who consumes this, what happens when it fails, and how you will know it worked. Answer those three in writing and the implementation usually collapses into something small.`,
  );

  parts.push(
    `\n**How I'd approach it**\n1. Write the one-sentence success condition, including the failure case.\n2. Build the thinnest vertical slice that exercises the real integration — not a mock.\n3. Instrument it before you scale it, so "faster" and "correct" are measurable.\n4. ${voice.habit}`,
  );

  if (wantsCode) {
    parts.push(
      `\nA sketch of the seam I would keep:\n\n\`\`\`ts\ntype Result<T> = { ok: true; value: T } | { ok: false; error: string }\n\nasync function run(input: string): Promise<Result<string>> {\n  try {\n    const value = await doTheWork(input);\n    return { ok: true, value };\n  } catch (err) {\n    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };\n  }\n}\n\`\`\`\n\nErrors as values at the boundary, thrown exceptions inside it. That one rule removes most of the ambiguity about who reports failure.`,
    );
  }

  parts.push(`\n> ${voice.close}\n`);
  parts.push(
    `\n*Running on the offline demo model — no network call was made. Add a provider key in Settings to get real inference with the same interface.*`,
  );
  return parts.join('');
}

/** Side-by-side variant: the same measure at two points in time. */
function comparisonShowcase(topic: string): string {
  const pane = (year: string, wind: number, solar: number, hydro: number) =>
    JSON.stringify({
      label: year,
      kind: 'chart',
      spec: {
        type: 'donut',
        title: year,
        format: 'raw',
        unit: 'TWh',
        data: [
          { source: 'Wind', value: wind },
          { source: 'Solar', value: solar },
          { source: 'Hydro', value: hydro },
        ],
      },
    });

  return `Two readings of "${topic}", side by side.\n\n\`\`\`compare
{"title":"Generation mix, Portugal","panes":[${pane('2020', 12.2, 1.6, 7.1)},${pane('2024', 14.3, 6.4, 6.9)}]}
\`\`\`

Solar nearly doubled its share in four years while wind held steady — a mix shift, not just growth. The panes share a scale, so the comparison is honest; drag the chart type in the footer if you prefer bars.\n\n*Offline demo model — visuals are real, numbers are illustrative.*`;
}

/** A worked example of the visual protocol, kept in sync with the skill. */
function showcase(topic: string): string {
  return `Here is "${topic}" as something you can look at.\n\n\`\`\`chart
{"type":"bar","title":"Electricity generation, Portugal","subtitle":"Terawatt-hours","x":"year","unit":"TWh","data":[{"year":"2020","Wind":12.2,"Solar":1.6},{"year":"2021","Wind":13.1,"Solar":2.4},{"year":"2022","Wind":13.5,"Solar":3.6},{"year":"2023","Wind":13.8,"Solar":5.1},{"year":"2024","Wind":14.3,"Solar":6.4}]}
\`\`\`

Wind compounds. Solar roughly quadrupled in five years — which is the sentence the bars exist to support.\n\n\`\`\`scene
{"title":"Wind turbine rotor","autoRotate":12,"grid":true,"objects":[{"type":"cylinder","position":[0,0,0],"radius":0.16,"size":[0.16,2.4,0.16],"color":"#8e8b9c"},{"type":"sphere","position":[0,1.3,0],"radius":0.22,"color":"#efc07a"},{"type":"box","position":[0,1.3,0],"rotation":[0,0,0.35],"size":[0.1,2.4,0.16],"color":"#89d6ea"},{"type":"box","position":[0,1.3,0],"rotation":[0,0,2.44],"size":[0.1,2.4,0.16],"color":"#8fe3b6"},{"type":"box","position":[0,1.3,0],"rotation":[0,0,4.53],"size":[0.1,2.4,0.16],"color":"#bda6f5"}]}
\`\`\`

The third medium is a live page. This one is a compound-interest model — change the sliders and the number moves, because it is real code running in a sandboxed frame.\n\n\`\`\`html
<div style="font:15px/1.6 system-ui;color:#eceaf4">
  <strong style="font:600 15px/1.2 system-ui">Compound interest</strong>
  <label style="display:block;margin:14px 0 4px;color:#9a97a8">Monthly deposit <input id="d" type="range" min="0" max="2000" step="50" value="300"></label>
  <label style="display:block;margin:6px 0 4px;color:#9a97a8">Years <input id="y" type="range" min="1" max="40" value="25"></label>
  <output id="out" style="display:block;margin-top:10px;font:600 30px/1.2 ui-monospace,monospace;color:#efc07a"></output>
  <script>
    const fmt = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
    function render() {
      const d = +document.querySelector('#d').value, y = +document.querySelector('#y').value, r = 0.07 / 12;
      let total = 0;
      for (let i = 0; i < y * 12; i++) total = (total + d) * (1 + r);
      document.querySelector('#out').textContent = fmt.format(total);
    }
    document.querySelectorAll('input').forEach(el => el.addEventListener('input', render));
    render();
  <\/script>
</div>
\`\`\``;
}

async function stream(text: string, req: ProviderRequest) {
  const chunks = text.match(/\s*\S+/g) ?? [text];
  for (const chunk of chunks) {
    if (req.signal.aborted) return;
    req.onText(chunk);
    await pause(chunk.length > 8 ? 18 : 11, req.signal);
  }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function truncate(text: string, max: number) {
  const clean = (text ?? '').trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

function rand() {
  return Math.random().toString(36).slice(2, 9);
}
