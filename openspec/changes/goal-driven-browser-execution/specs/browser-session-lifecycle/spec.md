## ADDED Requirements

### Requirement: Browser runs have explicit session lifecycle

Jev SHALL treat attach, tab binding, liveness checks, recovery, cancellation, and cleanup as lifecycle operations around the existing browser adapter.

#### Scenario: Attach to an existing browser
- **WHEN** a run starts in auto-connect or CDP attach mode
- **THEN** Jev binds a usable tab before executing actions and records the session correlation identity

#### Scenario: Bound tab is already gone
- **WHEN** the first snapshot or action reports that the bound tab no longer exists
- **THEN** Jev performs at most one bounded reattach/rebind attempt before returning a typed recoverable tab-lost result

### Requirement: Resume preserves the browser session but refreshes page state

Jev SHALL resume a handoff against the caller's existing session while taking a fresh snapshot. It MUST NOT replay old DOM refs from the paused trace.

#### Scenario: Resume after human input
- **WHEN** the parent resumes a paused run with new input and the browser tab remains alive
- **THEN** Jev snapshots the current page, resolves fresh refs, and continues the goal

#### Scenario: Session cannot be recovered
- **WHEN** the session or tab cannot be rebound during resume
- **THEN** Jev returns `tab-lost` or `session-unavailable` with `resumable=false` and performs cleanup

### Requirement: Cancellation releases browser resources

Jev SHALL accept an abort signal and propagate cancellation to pending browser commands. A cancelled run MUST attempt child-process termination and release owned session resources before returning.

#### Scenario: Voice turn is interrupted during a browser action
- **WHEN** the caller aborts the run while a browser command is pending
- **THEN** Jev returns status `cancelled`, stops further actions, and releases resources

#### Scenario: Browser command exceeds its timeout
- **WHEN** a browser command exceeds its configured timeout
- **THEN** Jev returns status `timeout`, attempts process cleanup, and does not leave the run occupying a session slot

### Requirement: Session failures do not cause unbounded retries

Jev SHALL bound stale-target, tab-loss, repeated-action, and browser-action recovery attempts and SHALL expose the final recovery reason to the caller.

#### Scenario: Repeated stale tab failure
- **WHEN** bounded reattachment fails repeatedly
- **THEN** Jev stops retrying and returns a recoverable typed failure with the final browser/session reason
