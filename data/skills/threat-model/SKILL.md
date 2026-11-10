---
name: threat-model
description: Security review of a feature, service, or architecture. Use when designing anything that accepts untrusted input, stores user data, or crosses a network boundary.
license: MIT
allowed-tools: read_file list_files web_search fetch_url
---

# Threat model

## 1. Map the boundaries

List every place data crosses a trust line:

```
internet -> edge -> app -> queue -> worker -> database
browser storage, third-party webhooks, admin console, CI, local model process
```

For each boundary: who controls the sender, what privilege the receiver holds, and what authenticates the message. A boundary with no authentication is the finding.

## 2. Assets and blast radius

What is worth stealing or breaking? Credentials, tokens, PII, money movement, ability to send mail, ability to write to production. For each, ask: after one successful step, what does the attacker reach next? Chained low-severity issues are how real breaches happen.

## 3. STRIDE sweep (short, per component)

| Threat | Question to ask |
|---|---|
| Spoofing | Can a caller claim to be someone else? Is identity checked at every hop or only at the edge? |
| Tampering | Can a client change a trusted value (price, role, tenant id)? |
| Repudiation | Can an action happen with no audit trail? |
| Information disclosure | Do errors, logs, timing, or IDs leak other tenants' data? |
| Denial of service | What is the cheapest request that costs the most server work? |
| Elevation of privilege | Can an unprivileged path reach admin logic? |

## 4. The usual suspects — check these explicitly

- Authorization on the server for every object, including nested and bulk endpoints. IDOR is still the most common bug.
- Injection sinks: SQL, shell, path joins, template rendering, deserialization, `eval`.
- Secrets: in repo, in logs, in client bundles, in error messages, in crash reports.
- SSRF: any URL a user supplies that the server fetches.
- File upload: type sniffing, size, storage path, served back with the right content type.
- Rate limits on anything that costs money or sends messages.
- Webhook signature verification with a constant-time compare.
- Session/token lifetime, rotation, and revocation.

## 5. Output

Rank by **likelihood × impact**, not novelty:

```
1. [high] Attack path — precondition -> step -> impact.
   Mitigation: cheapest effective fix.
   Defence in depth: the layer after that.
```

End with what is **fine** in one line. A review where everything is critical is a review nobody actions.

## Rules

- No generic policy boilerplate. Every item names a concrete path through this system.
- No CVE numbers from memory. If a dependency version matters, check it.
- If you lack the code, state which file or config would settle the question.
