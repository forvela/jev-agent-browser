## ADDED Requirements

### Requirement: Preserve bounded subtask context
The loop MUST accept an optional plan and subtask and include them in every Decisions request.

#### Scenario: Parent supplies a subtask
- **WHEN** the caller starts the loop with `plan` and `subtask`
- **THEN** the Decisions state contains both values for every iteration

### Requirement: Include recent action history
The loop MUST include a bounded history of recent action outcomes in each Decisions request.

#### Scenario: Action history is available
- **WHEN** the loop has executed prior actions
- **THEN** the next Decisions state includes the latest action signatures, URLs, and outcome summaries

#### Scenario: History reaches its cap
- **WHEN** more actions occur than the configured history limit
- **THEN** only the most recent entries are sent and the request remains bounded

### Requirement: Recover locally from repeated actions
The loop MUST enter bounded local recovery when it repeats an equivalent action beyond the configured threshold, and MUST stop safely only after recovery attempts are exhausted.

#### Scenario: Repeated filter or scroll
- **WHEN** the same operation and target signature repeats without completing the subtask
- **THEN** the next Decisions state contains recovery instructions that avoid the repeated action, and the repeated action is not executed again

#### Scenario: Recovery cannot escape the loop
- **WHEN** bounded recovery attempts are exhausted without progress
- **THEN** the loop returns `blocked` with reason `loop-detected` and a parent handoff

### Requirement: Return control to the caller
The loop MUST return a structured `handoff` for completion, blockage, loop detection, and step limits.

#### Scenario: Jev reports stuck
- **WHEN** the stuck confidence reaches the stopping threshold
- **THEN** the loop first gives Jev bounded local recovery attempts; if they are exhausted, the result contains `handoff.reason`, current URL/observation, and recent actions

#### Scenario: Subtask completes
- **WHEN** goal confidence reaches the completion threshold
- **THEN** the result is successful and the handoff identifies the completed subtask
