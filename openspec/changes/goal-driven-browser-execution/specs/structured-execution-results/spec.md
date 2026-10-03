## ADDED Requirements

### Requirement: Execution results use stable typed statuses

Jev SHALL return a JSON-serializable result with one of `success`, `input-required`, `blocked`, `cancelled`, `timeout`, or `error`, together with a reason, executed-step count, duration, current URL when known, and a structured handoff. The existing bounded-budget status `limit` SHALL remain as a backwards-compatible non-error status and SHALL carry a resumable continuation.

#### Scenario: Goal completes
- **WHEN** Jev reaches the goal with sufficient completion evidence
- **THEN** the result has status `success` and reason `goal-reached`

#### Scenario: Jev needs parent or human input
- **WHEN** a required value, permission, login, or human interaction is unavailable
- **THEN** the result has status `input-required` and includes a resumable handoff when continuation is safe

#### Scenario: Bounded budget ends
- **WHEN** Jev reaches `maxSteps` without proving completion
- **THEN** the result has legacy status `limit`, reason `max-steps`, and a continuation that can be resumed by the parent

#### Scenario: Jev cannot safely continue
- **WHEN** recovery is exhausted or an unsafe/unsupported action is requested
- **THEN** the result has status `blocked` or `error` with an actionable reason

### Requirement: Handoffs preserve useful context without collapsing causes

A handoff SHALL include the original goal, current URL, bounded observation, bounded recent actions, escalation kind, resumability, and input metadata when applicable. Callers MUST be able to distinguish missing input, tab loss, cancellation, timeout, and execution error.

#### Scenario: Parent receives an input handoff
- **WHEN** Jev pauses before an unresolved action
- **THEN** the handoff identifies the required input and does not report a generic browser failure

#### Scenario: Parent receives a tab-loss handoff
- **WHEN** reattachment fails
- **THEN** the handoff identifies tab/session loss separately from missing user input

### Requirement: JSONL events mirror the structured result

When JSONL/event streaming is enabled, Jev SHALL emit ordered start, step, handoff, and terminal lifecycle events whose public fields are JSON-serializable and consistent with the final result.

#### Scenario: Successful navigation is streamed
- **WHEN** a navigation run is executed with event streaming enabled
- **THEN** events show the selected operation, execution outcome, resulting URL, and final success handoff in order

#### Scenario: Cancellation is streamed
- **WHEN** an active run is aborted
- **THEN** the stream ends with a cancellation event and a matching final result

### Requirement: Diagnostics are bounded and redacted

Jev SHALL bound snapshots, refs, history, and event payloads using existing limits and SHALL apply secret redaction before exposing diagnostics to callers.

#### Scenario: Large page snapshot is returned
- **WHEN** a handoff is created from an oversized page
- **THEN** the observation is truncated according to configured limits and remains valid JSON

#### Scenario: Diagnostic contains a secret input
- **WHEN** a secret was used before failure or handoff
- **THEN** no result, event, trace, or error string contains the secret value
