## ADDED Requirements

### Requirement: Jev supports first-class navigation

Jev SHALL expose `NAVIGATE` as a bounded browser operation. The operation SHALL consume a caller-provided URL input and execute through the existing browser adapter's open capability.

#### Scenario: Navigate to a supplied HTTPS URL
- **WHEN** the decision selects `NAVIGATE` and the request contains a valid HTTPS destination
- **THEN** Jev opens that URL and records the resulting URL in the action event and final result

#### Scenario: Navigate to a supplied HTTP URL
- **WHEN** the decision selects `NAVIGATE` and the request contains a valid HTTP destination
- **THEN** Jev opens that URL without requiring a conversational agent or additional model call

### Requirement: Navigation values pass trust-boundary validation

Jev SHALL reject malformed URLs and schemes other than approved `http` and `https` before invoking the browser adapter.

#### Scenario: Unsafe URL scheme is supplied
- **WHEN** an input contains a `javascript:`, `file:`, or `data:` URL
- **THEN** Jev refuses execution and returns a typed validation error without invoking the browser

#### Scenario: Malformed URL is supplied
- **WHEN** an input cannot be parsed as an approved URL
- **THEN** Jev returns a typed validation error identifying the input key without exposing secret values

### Requirement: Dynamic field actions use semantic inputs and live refs

Jev SHALL allow `TYPE` and `SELECT` to consume values selected from the supplied input catalog while resolving the target against the current snapshot. Callers MUST NOT need to provide transient DOM refs.

#### Scenario: Fill the current search field
- **WHEN** the decision selects a combobox and a text input whose target hint is `search field`
- **THEN** Jev fills the matching live ref with the supplied value

#### Scenario: Select a supplied option
- **WHEN** the decision selects a current select/combobox and a supplied select input
- **THEN** Jev executes the select action with the supplied value

#### Scenario: Semantic target cannot be resolved
- **WHEN** no current ref safely matches the selected semantic target
- **THEN** Jev performs bounded recovery and returns a recoverable blocked handoff without using a stale ref

### Requirement: Raw goals do not trigger hidden URL or prompt parsing

Jev SHALL preserve raw goals as decision context but MUST NOT add URL extraction, spoken-domain conversion, regex prompt parsing, or an internal LLM compiler as a prerequisite for execution.

#### Scenario: Goal names a site without a destination input
- **WHEN** the raw goal says to open a site but the parent supplies no URL input
- **THEN** Jev requests the missing destination through `input-required` rather than guessing or parsing it

#### Scenario: Parent supplies the structured destination
- **WHEN** the parent provides a destination input alongside the same raw goal
- **THEN** Jev can navigate without invoking any additional LLM provider
