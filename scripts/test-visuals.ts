/**
 * Verifies the parts of the visual/document layer that can be checked without a
 * browser: chart/spec coercion, CSV, markdown→HTML, and a real .docx round trip
 * (ZIP structure + the XML a word processor will read).
 *   node --import tsx scripts/test-visuals.ts
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VESPER_HOME = mkdtempSync(join(tmpdir(), 'vesper-visuals-'));

const { normalizeChart, chartToCsv, normalizeScene, parseSpec } = await import('../shared/visuals.ts');
const { createDocument } = await import('../server/tools/docs.ts');
const { markdownToHtml, parseBlocks } = await import('../server/tools/markdown.ts');
const { runHarness } = await import('../server/harness/index.ts');

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('chart specs');
const chart = normalizeChart({
  type: 'bar',
  title: 'Generation',
  data: [
    { year: '2020', wind: '12.2', solar: 1.6 },
    { year: '2021', wind: '13.1', solar: 2.4 },
  ],
});
check('loose string numbers coerce', chart.chart?.rows[0]?.values.wind === 12.2);
check('numeric columns become series', chart.chart?.series.length === 2);
check('non-numeric column becomes x', chart.chart?.xKey === 'year', chart.chart?.xKey);
check('csv keeps header + rows', chartToCsv(chart.chart!).startsWith('year,wind,solar'));
check('csv row count', chartToCsv(chart.chart!).split('\n').length === 3);
check('unknown type is rejected', Boolean(normalizeChart({ type: 'radar' as never, data: [] }).error));
check('prose-wrapped json is found', Boolean(parseSpec('here: {"type":"pie","data":[{"a":1}]}').spec));
check('broken json reports an error', Boolean(parseSpec('{ nope').error));

console.log('scene specs');
const scene = normalizeScene({ objects: [{ type: 'box' }, { type: 'sphere' }, { type: 'nonsense' }] });
check('drawable objects kept', scene.scene?.objects.length === 2);
check('default lights added', (scene.scene?.lights.length ?? 0) === 3);
check('empty scene rejected', Boolean(normalizeScene({ objects: [] }).error));

console.log('markdown');
const markdown = [
  '# Findings',
  '',
  'Solar **quadrupled** since 2020, led by `utility-scale` builds.',
  '',
  '- wind: 14.3 TWh',
  '- solar: 6.4 TWh',
  '',
  '| year | solar |',
  '| --- | --- |',
  '| 2020 | 1.6 |',
  '',
  '```ts',
  'const x = 1;',
  '```',
].join('\n');
const html = markdownToHtml(markdown);
check('heading rendered', html.includes('<h1>Findings</h1>'));
check('bold rendered', html.includes('<strong>quadrupled</strong>'));
check('list rendered', html.includes('<li>wind: 14.3 TWh</li>'));
check('table rendered', html.includes('<th>solar</th>') && html.includes('<td>1.6</td>'));
check('code fence kept as code', html.includes('class="language-ts"'));
check('block count', parseBlocks(markdown).length === 5, String(parseBlocks(markdown).length));

console.log('docx export');
const doc = await createDocument({
  title: 'Solar capacity brief',
  format: 'docx',
  content: markdown,
  subtitle: 'Internal memo',
});
const bytes = readFileSync(doc.file);
check('file written', bytes.length > 1200);
check('zip signature', bytes.subarray(0, 2).toString() === 'PK');
check('end-of-central-directory present', bytes.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])));

/** Minimal stored-ZIP reader: validates CRCs and extracts a member. */
function readZipMember(buffer: Buffer, member: string): string | null {
  let offset = 0;
  const files = new Map<string, { start: number; size: number; crc: number }>();
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const crc = buffer.readUInt32LE(offset + 14);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, { start, size, crc });
    offset = start + size;
  }
  const entry = files.get(member);
  if (!entry) return null;
  const data = buffer.subarray(entry.start, entry.start + entry.size);
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  if ((crc ^ 0xffffffff) >>> 0 !== entry.crc) return `CRC mismatch for ${member}`;
  return data.toString('utf8');
}

const documentXml = readZipMember(bytes, 'word/document.xml');
check('document.xml readable + CRC valid', Boolean(documentXml?.startsWith('<?xml')));
check('title in document body', Boolean(documentXml?.includes('Solar capacity brief')));
check('heading style applied', Boolean(documentXml?.includes('Heading1')));
check('table in docx', Boolean(documentXml?.includes('<w:tbl>')));
check('content types part', Boolean(readZipMember(bytes, '[Content_Types].xml')?.includes('wordprocessingml.document.main')));
check('styles part', Boolean(readZipMember(bytes, 'word/styles.xml')?.includes('Heading1')));

console.log('other formats');
const csv = await createDocument({ title: 'Dataset', format: 'csv', content: 'a,b\n1,2' });
check('csv written verbatim', readFileSync(csv.file, 'utf8') === 'a,b\n1,2');
const htmlDoc = await createDocument({ title: 'Readable brief', format: 'html', content: markdown });
const page = readFileSync(htmlDoc.file, 'utf8');
check('html has print styles', page.includes('@media print'));
check('html has converted body', page.includes('<h1>Findings</h1>'));
const md = await createDocument({ title: 'Notes', format: 'md', content: 'Body only' });
check('md gets a title heading', readFileSync(md.file, 'utf8').startsWith('# Notes'));

console.log('harness safety');
let rejected = false;
try {
  await runHarness({ id: 'definitely-not-installed', prompt: 'hi' });
} catch {
  rejected = true;
}
check('unknown harness rejected', rejected);

console.log('harness execution');
writeFileSync(
  join(process.env.VESPER_HOME!, 'harnesses.json'),
  JSON.stringify([{ id: 'echo', name: 'Echo', bin: process.execPath, args: ['-e', 'console.log("harness-ok")'] }]),
);
const run = await runHarness({ id: 'echo', prompt: 'ignored by this harness', timeoutMs: 20_000 });
check('custom harness is discovered and runs', run.output.includes('harness-ok'), run.output.slice(0, 200));
check('exit code captured', run.code === 0, String(run.code));
check('run is timed', run.ms > 0);

rmSync(process.env.VESPER_HOME!, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall visual checks passed');
process.exit(failures ? 1 : 0);
