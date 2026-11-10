# CLI Crew — making Vesper-orchestrated CLIs work together

Vesper's own agent loop is one worker. But most developers already have several
agentic CLIs installed — Claude Code, Codex, Gemini, Aider, OpenCode, Cursor —
each with a different model, a different tool set, and a different blind spot.
They are silos: they cannot see each other's session, plan, or diff.

The CLI Crew turns those silos into a team without asking any of them to
implement a new protocol. Every one of them already accepts a prompt and works in
a directory. Those two facts are the integration surface.

```
                    ┌──────────────────────────────┐
   user task ─────► │  Vesper crew coordinator     │
                    │  plan · scopes · approval    │
                    └──────┬───────────┬───────────┘
                           │           │
              handoff      │           │      handoff
              brief.md     ▼           ▼      review.md
                    ┌──────────┐   ┌──────────┐
                    │ scout    │   │ builder  │
                    │ CLI A    │   │ CLI B    │
                    │ read-only│   │ write    │
                    └────┬─────┘   └────┬─────┘
                         │              │ git diff
                         └──────► verify / review (CLI C, read-only)
                                        │
                                        ▼
                              fix (CLI B, write) → final report
```

## 1 · Principles

1. **The prompt is the protocol.** CLIs do not share a socket; Vesper passes a
   structured brief from one stage to the next. That is the only interface every
   CLI already supports, and it survives version churn.
2. **One writer at a time.** Concurrent writers corrupt a workspace. Read-only
   stages fan out; write stages take an exclusive lock.
3. **The workspace is the shared memory.** Stages see each other's work through
   the files they changed and through a handoff document, not through chat
   history.
4. **A stage is a process, not a conversation.** Every stage has an exit code, a
   duration, a bounded transcript, and a cancel path. No hidden REPL state.
5. **Third-party code is untrusted.** A CLI can be wrong, hostile, or hung. The
   runner confines it to the workspace, caps its output, times it out, and kills
   the whole process tree.
6. **Nothing happens silently.** Editing stages require approval. Every run is
   recorded with its diffs.

## 2 · Adapters

An adapter is data, not a code path:

```ts
interface CliAdapter {
  id: string;                 // 'claude' | 'codex' | custom
  label: string;
  command: string;            // resolved on PATH
  promptVia: 'stdin' | 'arg';
  readArgs: string[];         // read-only invocation
  writeArgs: string[];        // auto-approving invocation
  capabilities: CliRole[];    // scout | build | verify | review
  install?: string;           // shown when the binary is missing
}
```

Presets ship for Claude Code, Codex CLI, Gemini CLI, Aider, OpenCode, Qwen Code,
Crush, Cursor Agent, plus a **generic** adapter that runs any command template
with `{prompt}` and reads stdout.

Detection runs `command --version` with a short timeout and reports the version
or the reason it is unavailable. Users can override the command/flags or add a
new adapter in `~/.vesper/cli.json`; the built-in presets are only defaults.

Flags for "auto-approve edits" differ per tool and change between releases, so
the adapter is the seam where those differences live — never the scheduler.

## 3 · The runner

`runStage()` is deliberately boring:

- spawn without a shell where possible; resolve `.cmd`/`.bat` shims on Windows
  and quote them explicitly
- `cwd` must resolve inside the run's workspace
- environment is inherited but scrubbed of Vesper secrets and forced to
  `NO_COLOR=1`, `TERM=dumb`, `CI=1`
- stdin receives the prompt in `stdin` mode and is closed afterwards
- stdout and stderr are merged, ANSI-stripped, capped at 400 KB with the tail
  preserved
- a hard timeout (default 10 min) and an abort signal both trigger a
  process-tree kill
- the exit code, duration, and output are returned and streamed as events

A non-zero exit is data, not an exception: the crew decides whether the stage is
recoverable.

## 4 · The crew

A crew run is a DAG of stages, created from one task and a roster:

| Stage     | Default role | Writes | Purpose                                             |
| --------- | ------------ | ------ | --------------------------------------------------- |
| `scout`   | scout        | no     | map the repo, name constraints, propose the plan    |
| `build`   | build        | yes    | implement the plan                                  |
| `verify`  | verify       | no     | run tests, inspect the diff, list concrete failures |
| `review`  | review       | no     | adversarial review of the diff                      |
| `fix`     | build        | yes    | address verify + review findings                    |

Crew shapes:

- **solo** — one CLI, one stage. Useful for comparing models on the same task.
- **pair** — scout with CLI A, build with CLI B. The classic cheap-model
  planner + strong-model executor split.
- **crew** — scout → build → (verify ∥ review) → optional fix. Different CLIs per
  role, which is the point: Aider can hold the build while Claude reviews and
  Gemini runs the tests.

Each stage receives:

1. the original task,
2. its role contract (what it may and may not do),
3. the handoffs it depends on,
4. a path to the full brief on disk,
5. the workspace path, and the rule that it must not leave it.

### Handoffs

Handoffs are markdown files under `~/.vesper/crew/<runId>/`:

```
00-task.md          the user's task, verbatim
01-scout.md         what the repo is, constraints, plan
02-build.diff       git diff produced by the build stage
03-verify.md        test output and failures
04-review.md        findings, severity, file:line
05-final.md         the coordinator's report
```

They are also embedded (bounded) in the next prompt, because a CLI cannot be
relied on to read a path. Files are the durable record; the prompt is the nudge.

### Scheduling

- Stages with no unmet dependency start immediately.
- Read-only stages may run concurrently up to `maxParallel` (default 2).
- Any stage that writes acquires the run's single writer lock; a second writer
  waits, which keeps the diff attributable to one CLI.
- A failed scout does not block build (build gets the raw task), but a failed
  build skips verify/review and goes straight to the report.
- Cancel aborts running stages and marks queued ones cancelled.

## 5 · Cooperation beyond one run

- **Compare mode**: run the same read-only brief through N CLIs in parallel and
  diff their plans. That is model shopping with your own keys.
- **Escalation**: if verify fails twice, the coordinator can hand the failing
  output to a different CLI rather than retrying the same one.
- **Cross-run memory**: finished reports land in the workspace's `.vesper/crew/`
  index, so later crews can cite earlier work. (Not enabled by default: writing
  into the user's repo is opt-in.)
- **Link mesh**: a stage can target a paired machine instead of the local
  workspace. The runner is the same; only the transport changes.

## 6 · Safety model

| Risk                     | Control                                                        |
| ------------------------ | -------------------------------------------------------------- |
| Unwanted edits           | write stages require approval for the whole crew run           |
| Edits outside the repo   | `cwd` resolved inside the workspace; briefs forbid escaping it |
| Secret leakage           | Vesper secrets are removed from the child env                  |
| Runaway process          | timeout + abort + process-tree kill                            |
| Output flood             | 400 KB cap per stage, tail preserved                           |
| Prompt injection         | CLI output is treated as data, never executed by Vesper        |
| Unreviewed commits       | the crew never commits; it leaves a diff for the user          |

The crew does not push, commit, or deploy. It stops at a diff and a report.

## 7 · Surfaces

- **Agent tools**: `cli_agents`, `cli_run`, `cli_crew`. The main agent can hire a
  CLI for a job it is weak at, then read the result back into its own loop.
- **HTTP**: `GET /api/cli/adapters`, `POST /api/cli/run`, `POST /api/cli/crew`,
  `GET /api/cli/runs`, `GET /api/cli/runs/:id`, `POST /api/cli/runs/:id/cancel`,
  `GET /api/cli/events` (SSE).
- **UI**: the Crew view — detected CLIs, role assignment, live stage timeline,
  diffs, and history.
- **CLI**: `vesper crew "task"` and `vesper cli list`, so the same orchestration
  is scriptable.

## 8 · Non-goals

- Emulating a terminal or scraping TUI screens. Adapters must support a
  non-interactive mode.
- Sharing a single conversation between CLIs. They cooperate through artifacts,
  not context windows.
- Hiding failures. Every stage's exit code and stderr are in the report.
