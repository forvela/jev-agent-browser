## ADDED Requirements

### Requirement: Observe the current browser through agent-browser
The controller MUST obtain the current URL and full accessibility snapshot through `agent-browser snapshot --json`, including non-interactive content, and MUST treat the returned refs as the only valid action targets for that iteration.

#### Scenario: Snapshot contains refs and page content
- **WHEN** the controller requests an observation
- **THEN** it returns the snapshot text, current URL, and a map of refs with their accessible names and roles

#### Scenario: Snapshot output is malformed
- **WHEN** the CLI exits unsuccessfully or its JSON does not contain the expected snapshot and refs
- **THEN** the controller stops with a diagnostic error and does not execute an action

### Requirement: Ask Jev for one typed browser decision
The controller MUST send the goal and current observation to the OpenRouter Decisions API using one request with a typed operation choice, compatible target choices, a goal-reached noul, and a stuck noul.

#### Scenario: Decision has an executable operation
- **WHEN** Jev returns a supported operation and a current ref where that operation requires a target
- **THEN** the controller validates the ref and proceeds to execution

#### Scenario: Decision selects an unavailable target
- **WHEN** Jev returns a target that is not present in the current refs or selects `none_of_the_above`
- **THEN** the controller does not call agent-browser and records the decision as non-executable

### Requirement: Execute only the supported MVP actions
The controller MUST support `CLICK`, `TYPE`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`, `BACK`, `WAIT`, and `DONE`, and MUST map each operation to an existing agent-browser CLI command.

#### Scenario: Click action
- **WHEN** Jev selects `CLICK` and a valid ref
- **THEN** the controller runs `agent-browser click <ref>` for the active session

#### Scenario: Type action
- **WHEN** Jev selects `TYPE`, a valid ref, and a configured text value
- **THEN** the controller runs `agent-browser fill <ref> <text>` for the active session

#### Scenario: Select action
- **WHEN** Jev selects `SELECT`, a valid ref, and a configured select value
- **THEN** the controller runs `agent-browser select <ref> <value>` for the active session

#### Scenario: Scroll, back, or wait action
- **WHEN** Jev selects `SCROLL_UP`, `SCROLL_DOWN`, `BACK`, or `WAIT`
- **THEN** the controller runs the corresponding agent-browser command without inventing a selector

### Requirement: Stop safely and report a trace
The controller MUST stop on goal completion, high stuck confidence, an action failure, a malformed decision, or the configured maximum number of steps, and MUST report the selected operations and final status.

#### Scenario: Goal reached
- **WHEN** `goal_reached.noul` is at least 0.8
- **THEN** the controller stops with a successful result and does not execute another action

#### Scenario: Stuck
- **WHEN** `stuck.noul` is at least 0.8
- **THEN** the controller stops with a blocked result and includes the latest decision in the trace

#### Scenario: Step budget exhausted
- **WHEN** the loop reaches the maximum step count without a terminal decision
- **THEN** the controller stops with a limit result and includes all executed steps

### Requirement: Preserve explicit input boundaries
The controller MUST expose `TYPE` only when a text value is configured and MUST expose `SELECT` only when a select value is configured; it MUST NOT ask a model to produce shell commands, selectors, or arbitrary JavaScript.

#### Scenario: No text configured
- **WHEN** the CLI starts without `--text`
- **THEN** the operation criteria do not include `TYPE`

#### Scenario: No select value configured
- **WHEN** the CLI starts without `--select-value`
- **THEN** the operation criteria do not include `SELECT`
