## Context

A Unix pipeline already provides the transport. The CLI should emit one JSON object per line, allowing `jq`, `tee`, or another parent agent to consume progress without a temporary file or a custom parser.

## Goals / Non-Goals

**Goals:**

- Keep default batch JSON behavior unchanged.
- Add `--jsonl` as an explicit streaming mode.
- Emit structured errors in the same stream and retain meaningful exit codes.
- Reuse the existing loop trace/events rather than adding a second logging protocol.

**Non-Goals:**

- Token streaming from the Decisions API.
- A custom daemon or websocket transport.
- Removing the existing JSON trace from batch mode.

## Decisions

- `runLoop` accepts an optional `onEvent` callback and emits `start`, `step`, and `handoff` events.
- The CLI's `--jsonl` writer serializes each event with `JSON.stringify` and a newline.
- In JSONL mode, terminal errors are JSON events on stdout; exit status still distinguishes success (`0`) from blocked/error (`1`/`2`).
- Batch mode continues to print one final JSON result and human-readable fatal errors for compatibility.

## Risks / Trade-offs

- JSONL consumers must handle multiple records instead of one object. → The mode is opt-in and line-delimited by definition.
- A full result plus step events duplicates some data. → Streaming consumers can select only `step`, `handoff`, or `result` with `jq`.
