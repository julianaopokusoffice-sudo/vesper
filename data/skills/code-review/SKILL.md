---
name: code-review
description: Review a diff or file for correctness, security, and maintainability. Use when asked to review code, check a patch before merge, or explain why something breaks in production.
license: MIT
allowed-tools: read_file list_files git_diff git_status
---

# Code review

## Order of passes — do not mix them

1. **Correctness.** Does this do what it claims, including on empty, null, duplicate, and concurrent input? Trace one real value through the code.
2. **Error paths.** What happens on network failure, timeout, partial write, bad input? Is the error surfaced or swallowed?
3. **Security.** Untrusted input reaching a sink (SQL, shell, path, HTML, deserializer). Authorization checked on the server, not the client. Secrets in logs.
4. **State and lifecycle.** Ordering, races, retries, idempotency, cleanup on abort.
5. **Clarity.** Names, dead code, needless abstraction, comments that restate the code.
6. **Tests.** Do they fail if the behaviour regresses? Is the interesting case covered or only the happy path?

## Severity, honestly applied

- **blocker** — wrong result, data loss, security hole, broken build.
- **major** — works today, fails under a realistic condition.
- **minor** — maintainability, naming, duplicated logic.
- **nit** — style; say so and move on.

Do not inflate nits into blockers to look thorough. Do not bury a blocker under twelve nits.

## Output format

```
**Verdict:** ship / ship with fixes / not yet

1. [blocker] file:line — what breaks, under which input.
   Fix: the smallest concrete change (code, not advice).

2. [major] ...

Only if the list is empty: "No blocking issues. Two nits: ..."
```

## Rules

- Quote the smallest relevant snippet; never paste a whole file back.
- If the approach is wrong, say that in the first line instead of listing symptoms.
- Every finding needs a trigger condition. "This could be cleaner" without a condition is noise.
- If you cannot see the surrounding code, say which file you need before reviewing further.
