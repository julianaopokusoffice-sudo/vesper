import { adapterInfos, defaultRoles } from './adapters.ts';
import { awaitRun, formatRun, listRuns, runSingle, startCrew } from './crew.ts';
import { PATHS } from '../kernel/paths.ts';
import type { NativeTool } from '../tools/native.ts';
import type { CliCrewShape, CliRole } from '../../shared/types.ts';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const SHAPES: CliCrewShape[] = ['solo', 'pair', 'crew'];
const ROLE_IDS: CliRole[] = ['scout', 'build', 'verify', 'review', 'fix'];

/**
 * The crew, exposed to the agent. These tools are how Vesper delegates to the
 * CLIs the user already trusts instead of pretending it is the only worker.
 *
 * Running a third-party CLI can read the workspace and, in a write stage, edit
 * it — so every invocation interrupts for approval. The read-only listing does
 * not.
 */
export const CLI_TOOLS: NativeTool[] = [
  {
    name: 'cli_agents',
    description:
      'List the agentic coding CLIs installed on this machine (Claude Code, Codex, Gemini, Aider, OpenCode and any custom adapter), with version, capabilities and the default role assignment for a crew.',
    parameters: obj({ refresh: { type: 'boolean', description: 'Re-probe PATH instead of using the 30s cache' } }),
    async run(args) {
      const infos = await adapterInfos(Boolean(args.refresh));
      if (!infos.length) return 'No CLI adapters are configured.';
      const rows = infos.map((info) => {
        const state = info.available ? `ready${info.version ? ` · ${info.version}` : ''}` : `missing — ${info.error ?? 'not found'}`;
        return `- **${info.id}** (${info.label}) — ${state}\n  roles: ${info.capabilities.join(', ')} · prompt: ${info.promptVia}${info.install ? `\n  install: ${info.install}` : ''}`;
      });
      const roles = defaultRoles(infos);
      return [
        '# Agentic CLIs on this machine',
        rows.join('\n'),
        '',
        `Default crew roles: ${Object.entries(roles)
          .map(([role, id]) => `${role}=${id}`)
          .join(', ')}`,
        '',
        'Use cli_crew to run a task through several CLIs, or cli_run for a single stage.',
      ].join('\n');
    },
  },
  {
    name: 'cli_run',
    description:
      'Run one installed agentic CLI as a single stage in a workspace. Read-only by default (plan/ask mode); set write=true to let it edit files. Returns the exit code and output.',
    parameters: obj(
      {
        adapter: { type: 'string', description: 'Adapter id from cli_agents, e.g. claude, codex, gemini, aider, opencode' },
        task: { type: 'string', description: 'What the CLI should do. Be specific: this is its whole brief.' },
        workspace: { type: 'string', description: 'Absolute path to work in. Defaults to the Vesper workspace.' },
        write: { type: 'boolean', description: 'Allow edits. Requires approval and defaults to false.' },
      },
      ['adapter', 'task'],
    ),
    requiresApproval: true,
    approvalReason: (args) =>
      `Run ${String(args.adapter)} ${args.write ? 'with permission to edit files' : 'read-only'} in ${
        String(args.workspace ?? PATHS.workspace)
      }`,
    async run(args, ctx) {
      const result = await runSingle({
        adapterId: String(args.adapter ?? ''),
        task: String(args.task ?? ''),
        workspace: String(args.workspace ?? ctx.workspace ?? PATHS.workspace),
        write: Boolean(args.write),
        signal: ctx.signal,
      });
      return [
        `# ${result.adapter.label} · exit ${result.exitCode ?? 'n/a'} · ${Math.round(result.durationMs / 1000)}s`,
        '',
        result.output ? result.output.slice(-14_000) : '(no output)',
      ].join('\n');
    },
  },
  {
    name: 'cli_crew',
    description:
      'Hire several installed CLIs to work on one task in one workspace: a scout plans, a builder edits, read-only verifiers and reviewers inspect the diff, and an optional fix stage addresses findings. Waits for the run and returns the report and diff. The crew never commits.',
    parameters: obj(
      {
        task: { type: 'string', description: 'The task, written for an engineer who has not seen this conversation.' },
        workspace: { type: 'string', description: 'Absolute path to work in. Defaults to the Vesper workspace.' },
        shape: { type: 'string', enum: SHAPES, description: 'solo = one builder, pair = scout + builder, crew = scout + build + verify + review' },
        scout: { type: 'string', description: 'Adapter id for the scout role' },
        build: { type: 'string', description: 'Adapter id for the build role' },
        verify: { type: 'string', description: 'Adapter id for the verify role' },
        review: { type: 'string', description: 'Adapter id for the review role' },
        fix: { type: 'boolean', description: 'Add a fix stage that addresses verify and review findings' },
        budget_minutes: { type: 'number', description: 'Wall-clock budget for the whole run (default 15)' },
      },
      ['task'],
    ),
    requiresApproval: true,
    approvalReason: (args) =>
      `Run a CLI crew (${String(args.shape ?? 'crew')}) in ${String(args.workspace ?? PATHS.workspace)}. The build stage can edit files; the crew does not commit.`,
    async run(args, ctx) {
      const roles: Partial<Record<CliRole, string>> = {};
      for (const role of ROLE_IDS) {
        const value = args[role];
        if (typeof value === 'string' && value.trim()) roles[role] = value.trim();
      }
      const budget = Number(args.budget_minutes);
      const run = await startCrew({
        task: String(args.task ?? ''),
        workspace: args.workspace ? String(args.workspace) : ctx.workspace,
        shape: (SHAPES.includes(args.shape as CliCrewShape) ? args.shape : 'crew') as CliCrewShape,
        roles,
        fix: Boolean(args.fix),
        budgetMs: Number.isFinite(budget) && budget > 0 ? Math.min(budget, 45) * 60_000 : 15 * 60_000,
      });
      const done = await awaitRun(run.id, 45 * 60 * 1000);
      return formatRun(done);
    },
  },
  {
    name: 'cli_crew_status',
    description: 'Recent CLI crew runs: status, stages, and the workspace each one touched.',
    parameters: obj({}),
    async run() {
      const runs = listRuns().slice(0, 8);
      if (!runs.length) return 'No crew runs yet.';
      return runs
        .map((run) => {
          const stages = run.stages.map((stage) => `${stage.role}:${stage.status}`).join(' ');
          return `- ${run.id.slice(0, 8)} · ${run.status} · ${run.shape} · ${new Date(run.createdAt).toLocaleString()}\n  ${run.task.slice(0, 120)}\n  ${stages}`;
        })
        .join('\n');
    },
  },
];
