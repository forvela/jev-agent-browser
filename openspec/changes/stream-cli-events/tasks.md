## 1. Event plumbing

- [x] 1.1 Add optional loop event callbacks for start, step, and terminal handoff.
- [x] 1.2 Keep event payloads bounded and serializable.

## 2. CLI streaming

- [x] 2.1 Add `--jsonl` parsing and newline-delimited output.
- [x] 2.2 Emit structured configuration/runtime errors in JSONL mode.
- [x] 2.3 Preserve default batch JSON behavior and exit codes.

## 3. Verification and docs

- [x] 3.1 Add tests for event order, valid JSONL records, and error output.
- [x] 3.2 Document native `jq`/pipe usage and run the full test suite.
