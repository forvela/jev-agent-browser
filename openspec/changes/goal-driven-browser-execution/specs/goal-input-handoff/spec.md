## ADDED Requirements

### Requirement: Goal requests preserve raw goals and accept semantic inputs

Jev SHALL accept a goal request containing the original goal string unchanged and zero or more structured semantic inputs. Inputs SHALL identify a stable caller key, a supported kind (`url`, `text`, `select`, `key`, or `secret`), a value, and optional target guidance without requiring a DOM ref.

#### Scenario: Parent supplies navigation and search values
- **WHEN** a caller submits a goal with `destination` URL and `search_query` text inputs
- **THEN** Jev preserves the goal verbatim and makes both keyed values available to the decision loop

#### Scenario: Parent does not provide DOM refs
- **WHEN** a caller supplies a text input with a semantic target hint but no `@ref`
- **THEN** Jev accepts the request and resolves any target against the current snapshot later

### Requirement: Input values are selected from the supplied input catalog

Jev SHALL resolve operation values from the normalized input catalog or legacy explicit arguments. Jev MUST NOT generate, infer, or regex-extract a missing value from the raw goal.

#### Scenario: Existing input is selected for typing
- **WHEN** the decision selects a current textbox and an available `text` input key
- **THEN** Jev executes the action using that input's value

#### Scenario: Raw goal contains an unprovided value
- **WHEN** the goal requires a URL or text value but no matching input is supplied
- **THEN** Jev returns a missing-input handoff instead of guessing or parsing the goal

### Requirement: Missing values produce resumable handoffs

Jev SHALL return `input-required` with a semantic key, kind, reason, current browser context, and a JSON-safe continuation for missing values that can be supplied by the parent or a human.

#### Scenario: Navigation value is missing
- **WHEN** the loop selects `NAVIGATE` and no usable URL input exists
- **THEN** the result has status `input-required`, identifies the required destination input, and marks the run resumable

#### Scenario: Parent resumes after supplying a value
- **WHEN** the parent submits the continuation with the requested input and the same browser session
- **THEN** Jev re-snapshots the browser and continues without reusing stale DOM refs

### Requirement: Secret inputs are protected

Jev SHALL allow inputs to be marked secret and MUST exclude their values from decision requests, traces, action history, compact observations, JSONL events, and error messages.

#### Scenario: Secret is used by a browser action
- **WHEN** a secret input is selected for a local fill action
- **THEN** the browser receives the value, but all returned diagnostics contain only the input key and redacted metadata

#### Scenario: Secret is returned by a continuation
- **WHEN** a run pauses while a secret is required
- **THEN** the continuation identifies the secret key and kind without embedding the secret value
