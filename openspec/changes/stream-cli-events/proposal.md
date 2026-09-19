## Why

The current CLI prints one batch JSON value only after the loop finishes and prints failures as plain stderr text. Real runs are currently wrapped in shell scripts that redirect to `/tmp` and parse the file afterward. That is fragile and makes progress, timings, and handoffs hard to consume.

## What Changes

- Add a standard NDJSON (`--jsonl`) event stream to stdout.
- Emit lifecycle, action, handoff, result, and error events without temporary files.
- Keep the existing batch JSON output as the default for compatibility.
- Make structured errors available to pipelines while preserving non-zero exit codes.

## Capabilities

### New Capabilities

- `stream-cli-events`: Consume live loop progress and terminal outcomes as newline-delimited JSON.

### Modified Capabilities

None.

## Impact

- Generic output/event plumbing in the loop and CLI.
- No changes to agent-browser or Decisions API behavior.
- Existing scripts using default batch JSON remain compatible.
