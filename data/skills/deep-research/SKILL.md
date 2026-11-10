---
name: deep-research
description: Structured multi-source research for questions that need verification, current facts, comparisons, or an evidence-backed recommendation. Use when the answer could be wrong if it came from memory alone.
license: MIT
allowed-tools: web_search fetch_url read_file write_file load_skill
---

# Deep research

## 1. Frame the question

Before searching, write down:

- **The decision** this research informs. "Is X good?" is not a question; "should we adopt X for Y given Z?" is.
- **The falsifier**: what evidence would make you say no?
- **The recency window**: does this need to be true today, or is the field stable?

If the question is too broad, name the narrowing you chose and why. Do not silently shrink scope.

## 2. Breadth, then depth

1. **Breadth pass** — 2–3 searches with different vocabulary. Different words surface different communities (official docs vs. practitioners vs. critics).
2. **Source grading** — prefer, in order: primary/official docs, changelogs and specs, first-hand experience reports, reputable secondary coverage, everything else. Note when you only have the last tier.
3. **Depth pass** — actually read the 2–4 strongest pages. A snippet is not a source.
4. **Dissent pass** — deliberately search for the failure case: "<thing> problems", "<thing> postmortem", "<thing> limitations". Findings that survive this are worth reporting.

## 3. Handling contradictions

- Never average two incompatible claims into a middle position.
- Prefer the more recent primary source, but check whether the older one describes a different version or configuration.
- If the sources genuinely conflict, report the conflict with both sides and what would resolve it.

## 4. Output format

```
## Answer
One paragraph. The recommendation, stated plainly.

## Evidence
- Claim — source, date. (only load-bearing claims)
- Claim — source, date.

## What is contested
Only if it exists. Who says what, and why they disagree.

## Confidence
High / Medium / Low, plus the single assumption that could flip it.

## Next step
The cheapest check that would raise confidence.
```

## Anti-patterns

- Citation-shaped noise: many links, none read.
- Inventing a URL, version number, price, or date. If you did not see it, say "unverified".
- Treating search-result ordering as authority.
- Reporting a benchmark without its workload.
- Ending with "it depends" without naming what it depends on.
