# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

Layout: **single-context**. One `GLOSSARY.md` and one `docs/adr/` at the repo
root. There are no workspace packages here, so there is nothing to split.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root
- **`docs/adr/`**: read ADRs that touch the area you're about to work in

If either doesn't exist, **proceed silently**. Don't flag their absence; don't
suggest creating them upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily
when terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-mysql-blob-file-storage.md
│   └── 0002-....md
└── src/
```

A `GLOSSARY-MAP.md` at the root would mean the multi-context layout (one
glossary per context). This repo doesn't use it.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`.
Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either
you're inventing language the project doesn't use (reconsider) or there's a
real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

## Precedence

`rules.md` outranks these docs and any skill's advice. Where a skill's guidance
conflicts with a rule there — the design-token scale, composition over new
components, preserving user-authored design — the rule wins, and say which
skill was consulted and where it was overridden.
