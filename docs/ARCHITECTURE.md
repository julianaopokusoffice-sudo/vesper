# Architecture

Vesper is one Node runtime with four surfaces on top of it: the console, the CLI, the Android app, and the mesh. This document describes how the pieces fit together and where the seams are.

```
                    ┌──────────────────────────────────────────────┐
   console (src/) ──┤  management API   /api/*      loopback only   │
   CLI     (cli/) ──┤  agent runtime    lanes · tools · approvals   │
   Android (WebView)│  skills · plugins · providers                 │
                    │  kernel        SQLite · sealed keys · paths   │
                    │  memory        id + hash + source device      │
                    ├──────────────────────────────────────────────┤
   paired device ───┤  peer protocol   /link/*      signed, LAN     │
                    └──────────────────────────────────────────────┘
```

Two different surfaces for a reason: `/api` is the UI's API and never leaves loopback; `/link` is machine-to-machine and is the only thing a paired device can reach.

---

## 1 · Processes and where state lives

`server/index.ts` starts one Hono app that serves the management API, the peer protocol, and (in production) the built console from `dist/`.

| State | Location | Notes |
| --- | --- | --- |
| Threads, messages, agents, settings, memory, peers, audit | `~/.vesper/vesper.db` | SQLite via Node's built-in `node:sqlite`, WAL on |
| Provider keys | `~/.vesper/.key` + sealed values | encrypted at rest, never returned by the API |
| Skills / plugins / personas | `~/.vesper/{skills,plugins,agents}` | seeds are copied out of `data/` on first run |
| Workspace for tools | `~/.vesper/workspace` or `VESPER_WORKSPACE` | every filesystem/shell call is sandboxed here |
| Node identity | `~/.vesper/node.json` | stable id, display name, device kind, public URL |

`VESPER_HOME` relocates the whole state directory (portable installs, the Android guest, tests), `VESPER_PORT` / `VESPER_HOST` the listener, and `VESPER_PUBLIC_URL` the address a peer should use when you are behind a tunnel.

---

## 2 · The agent pipeline

```
ChatRequest
   → history (last 24 messages, trailing assistant turns trimmed)
   → lanes
        single : 1 persona
        council: N personas in parallel → chair synthesises from the panel
   → per lane: system prompt → provider stream → tool calls → repeat (maxSteps)
   → SSE: run_start · lane_start · delta · reasoning · trace · approval · lane_end · run_end
```

**Prompt assembly** (`buildLanePrompt`) composes: the persona's system text, the settings preamble, the workspace description, the skill index (one-line summaries; bodies load only on `load_skill`), pinned skills, plugin tools, peers in council mode, the **shared memory block**, and — for the chair lane — `CHAIR_PROMPT`.

**Tools** (`server/tools/native.ts`) are a fixed allow-list: `clock`, `calculator`, `web_search`, `fetch_url`, `list_files`, `read_file`, `write_file`, `run_shell`, `load_skill`, `delegate`, plus plugin tools. `write_file` and `run_shell` set `requiresApproval: true`: the orchestrator parks the lane on an approval id, the console shows the exact input, and the run resumes on grant or dies on deny. A tool's sandbox is always `opts.workspace`.

**Council mode** runs lanes concurrently and only synthesises when at least two lanes produced content; the transcript is fed to the chair with `CHAIR_PROMPT` and no tools.

**Headless runs** (`runHeadless`) are the same lane execution without a thread — used by `vesper run`, and by `/link/task` when a peer asks for an agent run. They stream into callbacks instead of SSE.

**Providers** share one interface (`streamProvider`) with implementations for OpenAI-compatible, Anthropic, and a local `demo` model that answers with no network, so the whole product is explorable without a key.

---

## 3 · The device mesh

Implemented in `server/link/` and reachable only at `/link/*`.

### Pairing

`POST /api/link/pairing-code` mints an 8-character code (no `0/O/1/I` — it gets read aloud) with a TTL and a capability set. One code, one exchange, **two keys**:

- the responder generates `inbound` (what the peer will present to us) and `outbound` (what we will present to the peer);
- the responder stores both **sealed** and returns the plaintext exactly once, to the pairing device;
- the responder stores `granted` = what the code allowed, `scopes` = what the requester said *it* grants back.

That is what makes control mutual: after one code, either side can call the other, each using its own outbound key.

Re-pairing with the same code rotates both keys on both sides, so an old secret can never silently drift out of sync.

### Request authentication

Every `/link` POST except `/pair` and `/hello` carries:

```
x-vesper-node   the caller's node id          → which sealed key to use
x-vesper-ts     Date.now()                    → must be within ±5 minutes
x-vesper-nonce  random 24 hex chars           → rejected on replay for 10 minutes
x-vesper-sig    hex HMAC-SHA256(secret, `v1.<ts>.<nonce>.<sha256(rawBody)>`)
```

The body is hashed before parsing, so editing the payload invalidates the signature, and the timestamp plus nonce kill replay. Comparison is constant-time.

### Endpoints

| Endpoint | Guard | Purpose |
| --- | --- | --- |
| `GET /hello` | none | discover protocol version and peer identity |
| `POST /pair` | code, single use | exchange both keys |
| `POST /ping` | signed | presence + `lastSeen` |
| `POST /invoke` | signed + scope | run one tool on the peer |
| `POST /task` | signed + `agents` | run an agent headlessly on the peer |
| `POST /memory/pull` | signed + `memory` | entries newer than `since` |
| `POST /memory/push` | signed + `memory` | merge a batch of entries |

### Capabilities

`memory`, `files`, `shell`, `agents` are evaluated independently on every call (`server/link/tools.ts` maps tool → required scope; harmless tools like `clock` need none). A refusal answers `Peer lacks the "shell" capability`, not a generic error. Revoking a grant is a `PATCH /api/link/nodes/:id` and takes effect on the very next call, because grants are read from the store per request.

Remote tools run without the interactive approval dialog: **the pairing is the grant**. Every call — allowed or refused — is written to the audit log (`/api/link`), with direction, peer, action, ok, detail and duration.

### Failure modes

No relay: both nodes must be reachable (same LAN, or `VESPER_PUBLIC_URL` behind a tunnel). Presence is a soft signal — `online` means "seen within 2 minutes". There is no NAT traversal and no message queueing; a call to a sleeping phone fails loudly instead of waiting.

---

## 4 · Shared memory

`server/memory/index.ts` is deliberately small: titled entries with a kind, tags, a **source device** and a **content hash** (`sha256(kind · title · body)`).

- **Save**: if the same content already exists (even with another id), the save collapses onto the existing row instead of duplicating. Otherwise it upserts with `last-write-wins` on `updatedAt`.
- **Sync** (`syncMemoryWithPeer`): pull entries with `updatedAt > since` (the API currently always starts at `0`, i.e. full converge), keep the newer copy per id, then push our full set. Re-running converges — `npm run test:link` asserts exactly one copy after a second sync.
- **Use**: `memoryContext()` is injected into every system prompt — pinned entries first, then most recent, hard-capped at 10 lines so memory can never crowd out the task.

There is no vector database and no embedding step: entries are read as text, filtered by tag/title in the UI, and the whole set is small by design.

---

## 5 · The Android app

Sources in `android/`, boot screen in `mobile/web/`.

```
MainActivity (Capacitor)                ConsoleActivity (WebView)
  boot screen ── VesperNative plugin ──► full console, any node
        │
        ▼
  NodeSupervisor  (state machine: installing → ready → starting → running)
        │
        ├─ RuntimeInstaller  verify SHA-256 → unpack rootfs / Node / PRoot / payload
        ├─ ProotRuntime      builds the proot command line
        ├─ ProcessBuilder    runs it, pumps output, polls /api/health for 120s
        └─ NodeService       foreground notification so Android keeps it alive
```

The guest command is roughly:

```
proot --link2symlink -0 -r <rootfs> \
  -b /dev -b /proc -b /sys \
  -b <tmp>:/tmp -b <vesper-home>:/root/.vesper -b <workspace>:/root/workspace \
  -w /opt/vesper /usr/bin/env HOME=/root VESPER_HOME=/root/.vesper \
  VESPER_WORKSPACE=/root/workspace VESPER_NODE_KIND=phone ... \
  /opt/node/bin/node /opt/vesper/server/server.mjs
```

Notes that matter:

- **`server/server.mjs` two levels down**: `kernel/paths.ts` resolves `data/` as `../../` from `import.meta.url`, so the bundle's depth *is* the app root. Put it anywhere else and skills/plugins go missing.
- **Runtime artifacts are pinned, not bundled from nowhere.** `npm run mobile:runtime` fetches Ubuntu base, official Node, and Alpine's `proot-static`, hashes them, and writes `runtime.json`; `npm run mobile:payload` packs the bundled server + console + `data/` into APK assets. The installer refuses a hash mismatch or an unset hash — a rootfs that later runs as uid 0 inside PRoot is exactly the thing you do not want unverified.
- **Offline first run**: by default the artifacts ship *in* the APK (≈65 MB); `--remote <base-url>` switches the manifest to downloads instead.
- **targetSdk 28**: from Android 10 the platform refuses `execve` of files written into app storage, which would kill PRoot and everything under it. The same trade-off Termux, UserLAnd and Andronix make. See `android/variables.gradle`.
- The boot screen and the console live in **separate activities**, so the native bridge (start/stop/logs/pair) survives while the console is open.

---

## 6 · The CLI

`cli/vesper.mjs` is a single dependency-free ESM file with a `bin` entry, so `npm i -g .` gives you `vesper` everywhere. It talks to the same management API the console does (`/api/cli/context`, `/api/cli/run`, `/api/link/*`, `/api/memory/*`), which is why `--workspace`, `--agent`, approvals and remote calls behave identically in both.

`run` streams SSE tool traces into the terminal; `--json` emits a transcript instead of ANSI output; `--yes` answers approval prompts with grant; `devices --probe` pings each peer; `remote <device> --shell "cmd"` is `/link/invoke` with `run_shell` (and only works if the peer granted the `shell` capability).

---

## 7 · The console

React + Zustand + Tailwind (`src/`). One store holds bootstrap, threads, link and memory; the API layer normalises SSE run events into tool traces. Views: Threads / Agents / Skills / Plugins / Memory / Devices / Settings. The layout is responsive — desktop rail on wide screens, thumb-reachable bottom bar on phones — which is why the same bundle is the desktop shell and the Android WebView payload.

---

## Verification

| Check | Command |
| --- | --- |
| Types | `npm run typecheck` |
| Production console | `npm run build` |
| Mesh end to end (2 live nodes, 21 assertions) | `npm run test:link` |
| Android payload + Capacitor sync | `npm run mobile:payload && npx cap sync android` |
| APK (needs JDK 21 + Android SDK) | `npm run mobile:apk` |
