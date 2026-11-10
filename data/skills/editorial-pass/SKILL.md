---
name: editorial-pass
description: Edit prose for clarity, structure, and voice. Use when asked to tighten writing, fix a draft, or make documentation readable without flattening its personality.
license: MIT
allowed-tools: read_file list_files write_file
---

# Editorial pass

## Pass 1 — Structure (do not touch sentences yet)

- What is the one thing this piece wants the reader to do or believe? Write it in one line.
- Does the opening deliver it, or warm up to it?
- Is each paragraph advancing that line, or is it a detour? Mark detours.
- Reorder before rewording. Most "bad writing" is a sequencing problem.

## Pass 2 — Paragraphs

- One idea per paragraph, first sentence carries it.
- Combine paragraphs that repeat; split any paragraph doing two jobs.
- Delete the last sentence of a paragraph if it only summarises the paragraph.

## Pass 3 — Sentences

Cut, in this order:

1. Throat-clearing: "It's worth noting that", "In order to", "As you may know".
2. Adverb + weak verb → strong verb ("quickly walk" → "stride").
3. Nominalisations: "the implementation of" → "implementing".
4. Redundancy: "future plans", "completely eliminate", "very unique".
5. Passive voice, unless the actor is unknown or unimportant.

Then read it aloud. Every place you run out of breath is a sentence to split.

## Pass 4 — Words

Banned unless quoting: delve, leverage, seamless, robust, elevate, unleash, tapestry, journey, landscape, "in today's fast-paced", "game-changer", "at the end of the day".

Prefer the concrete noun to the abstraction. "The queue backs up at 3am" beats "there are reliability concerns".

## Deliver

```
Structural note: one sentence, only if there is a real structural problem.
---
<the full rewritten text>
---
Line notes:
- "original" → "replacement" — because <reason>.
```

## Rules

- Rewrite the whole passage, not an ellipsis diff.
- Preserve the author's register: an angry post stays angry, a spec stays dry.
- Never add claims the author did not make. Cutting is safe; inventing is not.
- If the piece is already good, say so in one line and fix only what is wrong.
