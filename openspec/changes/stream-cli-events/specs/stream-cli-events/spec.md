## ADDED Requirements

### Requirement: Stream loop events as NDJSON
The CLI MUST support an explicit `--jsonl` mode that writes one valid JSON object per line to stdout as the loop progresses.

#### Scenario: Step events
- **WHEN** a JSONL run observes and decides a browser action
- **THEN** the stream contains a `step` event with the step number, URL, decision, and action outcome

#### Scenario: Terminal handoff
- **WHEN** the loop returns success, blockage, or an error
- **THEN** the stream contains a `handoff` or `result` event with the terminal status and reason

### Requirement: Stream errors without temporary files
JSONL mode MUST emit structured errors to stdout and retain a non-zero process exit code for blocked or failed runs.

#### Scenario: Configuration or runtime error
- **WHEN** parsing, browser, Decisions API, or loop execution fails
- **THEN** the stream contains an `error` event with a message and the process exits non-zero

### Requirement: Preserve batch compatibility
Without `--jsonl`, the CLI MUST keep its existing single-result JSON output and human-readable fatal error behavior.

#### Scenario: Default invocation
- **WHEN** the CLI runs without `--jsonl`
- **THEN** stdout remains one JSON result after completion
