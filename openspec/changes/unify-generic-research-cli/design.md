## Context

The browser worker and the portfolio collector already produce bounded evidence. Jev should see that evidence only after collection, classify it in batches, and return control to a parent that decides what to enrich or verify. The classifier must not know that one profile happens to be LinkedIn.

## Decisions

### Profile-driven dimensions

A profile contains `goal`, optional `context`, and `dimensions`. Each dimension has `instructions` and a bounded `choices` map. The same mechanism covers vacancies, products, documents, leads, search results, and verification queues.

### Single CLI with modes and configured tools

The existing `src/cli.js` accepts `--mode research` for a config-driven multi-query run and `--mode classify` for an already collected batch. The normal browser loop remains the default mode. Research configs register allowed page tools (small JS helpers) that Jev can trigger through a typed `RUN_TOOL` decision; the runner opens queries sequentially, preserves bounded raw items in memory, classifies them, and optionally enriches kept items. `--enrich-kept` applies a profile `keep` rule after classification and extracts contact/link evidence from retained parent-side items. No domain-specific CLI remains.

### No hard-coded domain filter in the core

The core never embeds LinkedIn, country, recruiter, or technology strings. Those distinctions are profile dimensions and instructions. A profile MAY additionally declare generic regex-based label overrides against configured evidence fields; the profile owns the patterns, labels, and reasons. A different domain can use entirely different fields and patterns.

### Configured follow-ups before classification

A research config may declare generic `followUps` with a `targetField`, a
missing/present-field condition, an allowlisted host set, and an ordered list
of registered browser tools. The runner opens only those configured targets,
executes the configured helpers, merges their bounded result under the
configured output field, and then performs batch classification. This supports
profile/detail verification without putting LinkedIn or location logic in the
core. It is deterministic and parent-configured; the normal Jev loop remains
responsible for adaptive collection-tool choices.

### One request per bounded batch

The CLI sends one Decisions request for the batch, bounded by `--max-items` and `--max-text-chars`. If a larger collection exists, the parent runs another batch. Contact parsing happens only after classification and only for kept items when enrichment is requested. Configured follow-up evidence is included through profile-declared `evidenceFields` after the same sensitive-value redaction boundary.

### Evidence boundary

The entire original item is returned to the parent, including links and provenance. The Decisions state receives only an allowlisted evidence projection: id, author/title/company/location, bounded text, non-sensitive signals, and explicitly profile-declared detail fields. Email addresses, phone numbers, URLs, and URL-like action values are redacted recursively from text, signals, and detail evidence before the request is sent. Configured tools are allowlisted and executed only when Jev selects their typed tool choice, except deterministic follow-up sequences explicitly declared by the parent config.

### Native browser passthrough

`AgentBrowser` accepts `browserArgs` and repeatable `--browser-arg` values and
places them on every native invocation. This keeps native options such as
profile, headed mode, engine/provider, allowed domains, config path, and
network policy available. The wrapper reserves only lifecycle arguments it must
own (`session`, CDP/auto-connect, and pinning) and rejects attempts to override
them, avoiding silent conflicts.

### Browser engine boundary and installation

`runLoop` already consumes a small duck-typed browser surface (`snapshot`,
`action`, and research uses `open`), so `AgentBrowser` remains the current
agent-browser adapter. The package exposes `--browser-command` and resolves
its bundled `agent-browser` dependency automatically. A formal engine registry
is intentionally deferred until a second compatible backend exists; adding one
now would be an unused abstraction.

### Agent-facing skill and scroll budget

The package exposes `jev skills list|get|path`, with a version-matched `core`
skill covering modes, config examples, safety boundaries, diagnostics, and
scroll budgeting. Configured tool values are passed through
`globalThis.__JEV_TOOL_CONFIG__`; the next Jev decision receives a bounded
summary of the previous tool result. Profiles can therefore choose a large
viewport-relative scroll amount for lazy loading without changing core code or
spending one Jev request per tiny scroll. Research output also reports aggregate
request/action/tool/follow-up/item counts and duration so a profile can be tuned
against evidence rather than intuition.

### Compatible Decisions transport

The request/response contract is transport-neutral, but the default
implementation uses the official `@typesafe-ai/sdk` and its `systemOne`
method. The SDK supports a configurable API base URL, so
`--endpoint`/`decision.endpoint` can select another compatible TypeSafe
service while optional non-secret headers are passed through. The SDK's
`fetch` implementation remains injectable through `fetchImpl` without making
ordinary fetch the default transport.

OpenRouter can be selected simply by changing `endpoint` to
`https://openrouter.ai/api/alpha/decisions` and `apiKeyEnv` to
`OPENROUTER_API_KEY`; the same TypeSafe SDK remains in use and rewrites only
the SDK's fixed path through its injectable fetch seam. The explicit `fetch`
transport remains available when bypassing the SDK is intentional.

## Risks / Trade-offs

- Large batches still have token limits. → Bound each request and expose the batch limit in output.
- Jev labels are probabilistic. → Require profile keep rules and preserve `verify`/unclear outcomes; never auto-submit or contact.
- Contact extraction after classification can miss data hidden outside the retained evidence. → Keep all raw item text/links and allow a later explicit verification pass.
- A profile can be poorly specified. → Validate dimensions/choices and mark malformed responses as classification errors rather than guessing.
