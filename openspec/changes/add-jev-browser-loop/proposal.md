## Why

Jev's typed decisions are a promising low-latency policy layer for browser automation, but the existing `agent-browser` CLI currently needs an external controller to turn snapshots into actions. A small wrapper can test real browser tasks quickly without forking or modifying `agent-browser` internals.

## What Changes

- Add a standalone Node.js wrapper that drives the installed `agent-browser` CLI.
- Read full accessibility snapshots and send one batched typed decision request to OpenRouter's Decisions API per loop.
- Support a minimal action set: `CLICK`, `TYPE`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`, `BACK`, `WAIT`, `DONE`.
- Execute selected actions through existing `agent-browser` commands and repeat after meaningful state changes.
- Use explicit `none_of_the_above`/`DONE` and `stuck` decisions so the controller can stop safely.
- Keep arbitrary text generation out of the first MVP; `TYPE` accepts configured task text or a future text-generator seam.

## Capabilities

### New Capabilities

- `jev-browser-loop`: Closed-loop browser observation, typed decision, action execution, and termination.

### Modified Capabilities

None.

## Impact

- New project under `/Users/artem/Documents/Web/jev-agent-browser`.
- Requires Node.js 20+, the installed `agent-browser` CLI, `OPENROUTER_API_KEY`, and network access to OpenRouter.
- Uses only Node.js built-ins; no changes to `agent-browser`.
- The first MVP is experimental and not intended to replace Browser Use or provide arbitrary text generation.
