import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Exercises the crew against mock CLIs, not the real ones: the point is the
 * process layer (stdin, args, timeout, abort, quoting), the handoff chain, the
 * single-writer rule, parallel read-only stages and cancellation.
 */

const temp = mkdtempSync(join(tmpdir(), 'vesper-crew-'));
process.env.VESPER_HOME = temp;
const workspace = join(temp, 'workspace');
mkdirSync(workspace, { recursive: true });

const mock = join(temp, 'mock-cli.cjs');
writeFileSync(
  mock,
  `const fs = require('node:fs');
const mode = process.argv[2] || 'read';
let input = '';
if (mode === 'slow') {
  setTimeout(() => { console.log('SLOW-DONE'); }, 15000);
} else if (mode === 'delay') {
  setTimeout(() => {
    console.log('MODE=delay');
    console.log('DELAYED=' + (process.argv[3] || '0'));
  }, Number(process.argv[3] || 300));
} else {
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    console.log('MODE=' + mode);
    console.log('STDIN=' + input.trim().slice(0, 4000));
    console.log('ARGV=' + JSON.stringify(process.argv.slice(3)));
    if (mode === 'write') fs.writeFileSync('crew-out.txt', 'written by mock');
    if (mode === 'fail') { console.log('INTENTIONAL FAILURE'); process.exit(3); }
  });
}
`,
);

const shim = join(temp, 'mock-cli.cmd');
writeFileSync(shim, `@echo off\r\nnode "${mock}" %*\r\n`);

writeFileSync(
  join(temp, 'cli.json'),
  JSON.stringify(
    {
      custom: [
        {
          id: 'mock',
          label: 'Mock CLI',
          command: process.execPath,
          promptVia: 'stdin',
          readArgs: [mock, 'read'],
          writeArgs: [mock, 'write'],
          capabilities: ['scout', 'build', 'verify', 'review', 'fix'],
          builtin: false,
        },
        {
          id: 'mockarg',
          label: 'Mock Arg CLI',
          command: process.execPath,
          promptVia: 'arg',
          readArgs: [mock, 'arg', '{prompt}'],
          writeArgs: [mock, 'argwrite', '{prompt}'],
          capabilities: ['scout', 'build', 'verify', 'review', 'fix'],
          builtin: false,
        },
        {
          id: 'slowshell',
          label: 'Slow CLI',
          command: process.execPath,
          promptVia: 'stdin',
          readArgs: [mock, 'slow'],
          writeArgs: [mock, 'slow'],
          capabilities: ['scout', 'review'],
          builtin: false,
        },
        {
          id: 'delayed',
          label: 'Delayed CLI',
          command: process.execPath,
          promptVia: 'stdin',
          readArgs: [mock, 'delay', '400'],
          writeArgs: [mock, 'delay', '400'],
          capabilities: ['verify', 'review'],
          builtin: false,
        },
        {
          id: 'failing',
          label: 'Failing CLI',
          command: process.execPath,
          promptVia: 'stdin',
          readArgs: [mock, 'fail'],
          writeArgs: [mock, 'fail'],
          capabilities: ['build', 'verify', 'review'],
          builtin: false,
        },
      ],
    },
    null,
    2,
  ),
);

const { runStage, stripAnsi, TailBuffer } = await import('../server/cli/runner.ts');
const { adapterInfos, defaultRoles, resetAdapterCache } = await import('../server/cli/adapters.ts');
const { startCrew, awaitRun, cancelCrew, listRuns } = await import('../server/cli/crew.ts');

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// --- process layer -----------------------------------------------------------
stripAnsi('\u001b[31mred\u001b[0m plain');
check('stripAnsi removes SGR sequences', stripAnsi('\u001b[31mred\u001b[0m plain') === 'red plain');

const tail = new TailBuffer(100);
tail.push('A'.repeat(200));
check('TailBuffer keeps head and tail', tail.toString().includes('truncated') && tail.toString().length < 220);

const stdinRun = await runStage({ command: process.execPath, args: [mock, 'read'], cwd: workspace, stdin: 'hello from stdin', timeoutMs: 10_000 });
check('stdin reaches the CLI', stdinRun.output.includes('STDIN=hello from stdin'), stdinRun.output.slice(0, 200));
check('zero exit is reported', stdinRun.exitCode === 0);

const argRun = await runStage({
  command: process.execPath,
  args: [mock, 'arg', 'a & b | c "quoted"'],
  cwd: workspace,
  timeoutMs: 10_000,
});
check('arguments with shell metacharacters survive', argRun.output.includes('a & b | c'), argRun.output.slice(0, 300));

const timeoutRun = await runStage({ command: process.execPath, args: [mock, 'slow'], cwd: workspace, timeoutMs: 900 });
check('timeout is enforced', timeoutRun.timedOut && timeoutRun.durationMs < 8_000, String(timeoutRun.durationMs));

const controller = new AbortController();
const abortPromise = runStage({ command: process.execPath, args: [mock, 'slow'], cwd: workspace, signal: controller.signal });
setTimeout(() => controller.abort(), 400);
const abortRun = await abortPromise;
check('abort stops the process', abortRun.aborted, String(abortRun.durationMs));

if (process.platform === 'win32') {
  const shimRun = await runStage({
    command: shim,
    args: ['a&b', 'quote"inside', 'c|d'],
    cwd: workspace,
    timeoutMs: 10_000,
  });
  check(
    'Windows .cmd shim quoting preserves metacharacters',
    shimRun.output.includes('a&b') && shimRun.output.includes('c|d'),
    shimRun.output.slice(0, 300),
  );
}

// --- adapters ----------------------------------------------------------------
resetAdapterCache();
const infos = await adapterInfos(true);
const mockInfo = infos.find((info) => info.id === 'mock');
check('custom adapters are detected', Boolean(mockInfo?.available), mockInfo?.error);
check('builtin presets are listed', infos.some((info) => info.id === 'claude') && infos.some((info) => info.id === 'codex'));
check('prompt mode is preserved', mockInfo?.promptVia === 'stdin');
const roles = defaultRoles(infos);
check('roles default to distinct adapters', roles.scout !== roles.build, `${roles.scout}/${roles.build}`);

// --- crew --------------------------------------------------------------------
const solo = await startCrew({
  task: 'Prove the crew runs a build stage.',
  workspace,
  shape: 'solo',
  roles: { build: 'mock' },
});
const soloDone = await awaitRun(solo.id, 30_000);
check('solo crew completes', soloDone.status === 'done', soloDone.error);
check('build stage ran with the brief on stdin', soloDone.stages[0].output.includes('Prove the crew runs a build stage'));
check('write stage created a file', existsSync(join(workspace, 'crew-out.txt')));
check('report is generated', Boolean(soloDone.summary?.includes('Crew report')));

const handoff = join(temp, 'crew', solo.id, '01-build.md');
check('handoff transcript is written', existsSync(handoff) && readFileSync(handoff, 'utf8').includes('Build'));

const crewRun = await startCrew({
  task: 'Run the staged chain.',
  workspace,
  shape: 'crew',
  roles: { scout: 'mock', build: 'mockarg', verify: 'delayed', review: 'delayed' },
});
const crewDone = await awaitRun(crewRun.id, 40_000);
check('crew completes', crewDone.status === 'done', crewDone.error);
const verify = crewDone.stages.find((stage) => stage.role === 'verify')!;
const review = crewDone.stages.find((stage) => stage.role === 'review')!;
check(
  'read-only stages run in parallel',
  Boolean(verify.startedAt && review.startedAt && verify.endedAt && review.endedAt && verify.startedAt < review.endedAt && review.startedAt < verify.endedAt),
  `${verify.startedAt}-${verify.endedAt} / ${review.startedAt}-${review.endedAt}`,
);
check('only one stage writes', crewDone.stages.filter((stage) => stage.writes).length === 1);
check('arg-mode builder receives the brief', crewDone.stages[1].output.includes('Run the staged chain'));
check('run is persisted', listRuns().some((run) => run.id === crewDone.id));

const failing = await startCrew({
  task: 'This build must fail.',
  workspace,
  shape: 'pair',
  roles: { build: 'failing', scout: 'mock' },
});
const failingDone = await awaitRun(failing.id, 30_000);
check('failed build marks the run failed', failingDone.status === 'failed', failingDone.status);
check('scout still ran before the failure', failingDone.stages[0].status === 'done');

const slow = await startCrew({
  task: 'Cancel this run.',
  workspace,
  shape: 'solo',
  roles: { build: 'slowshell' },
});
await new Promise((resolve) => setTimeout(resolve, 600));
cancelCrew(slow.id);
const cancelled = await awaitRun(slow.id, 30_000);
check('cancel ends the run', cancelled.status === 'cancelled', cancelled.status);

rmSync(temp, { recursive: true, force: true });
console.log(`\ncli-crew: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
