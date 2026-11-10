---
name: systematic-debugging
description: Find the cause of a bug without guessing. Use when something fails intermittently, a fix did not work, or the stack trace points at the wrong place.
license: MIT
allowed-tools: read_file list_files git_diff git_status
---

# Systematic debugging

## Rule zero

**Reproduce before you theorise.** A bug you cannot reproduce is a bug you cannot verify a fix for. If reproduction is impossible, say what observation would substitute.

## Step 1 — Make the failure small

- Minimal input that still fails. Delete fields until it stops.
- Minimal environment: does it fail on a clean checkout, fresh cache, empty database?
- Minimal timing: always / every other run / only under load / only after a restart. That single answer eliminates whole categories.

## Step 2 — Locate the boundary

Bisect the pipeline, not the code. For each stage, ask what its input *should* look like and what it actually is.

- Binary search the commit history if it used to work.
- Binary search the data if one input fails and a similar one does not.
- Binary search the config if prod fails and local does not.

Instrument at boundaries with values, not with `console.log("here")`. Print the shape of the data: keys, types, counts, first item.

## Step 3 — Hypotheses, ranked and falsifiable

Write them as a numbered list. Each says: **if true, then X will be observed.** Then run the cheapest experiment that can kill the top one.

Common causes worth checking early:

- Stale cache or stale build artifact.
- Two sources of truth disagreeing (env vs. config, client vs. server clock).
- Off-by-one or inclusive/exclusive boundary.
- Missing `await`, unhandled rejection, or a promise resolved twice.
- Mutation of shared state between calls.
- Encoding, timezone, locale, or numeric precision.
- A dependency version resolved differently than you think.

## Step 4 — Fix the cause, not the symptom

- The fix must make the reproduction pass *and* leave the reproduction as a test.
- If you add a guard, explain what could still produce the bad value.
- If the cause was a wrong assumption, write the assumption down where the next person will see it.

## Output

```
Reproduction: <exact steps/input>
Cause: <one sentence>
Evidence: <the observation that proved it>
Fix: <diff or code>
Regression test: <test that fails before, passes after>
```
