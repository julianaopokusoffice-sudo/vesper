---
name: system-design
description: Design or critique a system architecture. Use when asked to propose an architecture, review a design doc, or decide between approaches under real constraints.
license: MIT
allowed-tools: read_file list_files write_file
---

# System design

## Start with constraints, not components

Write these four lines before drawing anything. If a number is unknown, give a range and mark it as an assumption.

1. **Scale**: requests/sec peak, data volume/year, largest single object, growth rate.
2. **Latency budget**: p50 and p99 targets, and which path is user-facing.
3. **Consistency requirement**: what breaks if two readers see different values for 5 seconds?
4. **Operational reality**: team size, deploy cadence, on-call tolerance, existing infrastructure you cannot leave.

A design that ignores (4) is fiction.

## Then estimate

- Storage per year = volume × retention × replication.
- Hot path cost per request × peak RPS.
- The one resource that runs out first. Name it. Design around it.

## Structure of the answer

```
## Constraints (assumptions marked)
## The one hard problem
What is genuinely difficult here. Everything else is CRUD.
## Design
Components in the path of a single request, in order. What each owns, and what it does not.
## Data model
Only the tables/keys that the design depends on. Show the index that makes the hot query fast.
## Failure modes
For each component: what happens when it dies, is slow, or returns garbage. What the user sees.
## What I would build first
The thinnest slice that proves the risky assumption.
## What this design does not handle
Honest limits, and the trigger that would force a redesign.
```

## Rules

- Name the tradeoff in every decision. "We chose X over Y because Z" — never just X.
- Prefer boring, understood technology unless the hard problem demands otherwise.
- No component without a job. No queue because queues are cool.
- One diagram's worth of boxes, in text. Depth beats breadth.
- If asked to compare options, give a decision table with weighted criteria, then a recommendation. Do not hide the recommendation behind the table.
