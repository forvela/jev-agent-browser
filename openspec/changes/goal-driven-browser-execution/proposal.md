## Why

Jev currently executes a bounded set of browser operations, but its public contract is too narrow for goal-driven parent agents. A parent can provide the goal and known semantic values, yet Jev cannot navigate to a new URL, cannot consume structured values for typing/selecting, and cannot reliably pause and resume when human or parent input is required. These gaps caused the current Facebook failure and forced routing, retry, and session workarounds in the Qwen integration.

This change makes Jev a reusable, model-agnostic browser executor: callers may provide the raw goal together with structured goal inputs, while Jev resolves current-page targets from fresh snapshots, executes safe actions, and returns resumable handoffs when information or permission is missing.

## What Changes

- Add a goal request contract containing the original goal, optional structured semantic inputs, and an optional browser session identity.
- Add `NAVIGATE` support with URL validation and execution through the existing browser adapter.
- Allow parent-provided values for navigation, typing, selection, and key presses without requiring the parent to know DOM refs.
- Resolve semantic target hints against the current snapshot; never require callers to provide stale `@ref` values.
- Add resumable `input-required` handoffs for missing non-secret and secret values, including a resume token and required-input descriptors.
- Add a resume API/flow that continues the same browser session after the parent or a human supplies missing values.
- Define structured execution results for success, input required, blocked, cancelled, timeout, and error outcomes.
- Add browser session lifecycle handling for attach, tab binding, stale-tab recovery, and cleanup.
- Propagate cancellation through the loop and browser process so interrupted voice turns release resources.
- Preserve raw goals and structured inputs for audit/context while preventing secrets from entering model decision state or action history.
- Keep model integration optional: Jev will not bundle or require an LLM. An external compiler/provider may be added by callers later, but the primary contract is parent-supplied goal data.
- Add unit, contract, and integration-style tests for navigation, semantic input resolution, handoffs/resume, stale tabs, cancellation, and result propagation.

## Capabilities

### New Capabilities

- `goal-input-handoff`: Goal requests, semantic input values, missing-input handoffs, secure input handling, and resumable execution.
- `navigation-actions`: Navigation and structured action arguments resolved against live browser state.
- `browser-session-lifecycle`: Attach/bind/recover/cancel/cleanup behavior for long-lived browser sessions.
- `structured-execution-results`: Stable result and event contracts for parent agents and JSONL bridges.

### Modified Capabilities

<!-- No existing repository-level specs exist; all requirements are introduced by this change. -->

## Impact

- `src/loop.js`: action selection, input handling, handoff/resume, cancellation, and result assembly.
- `src/browser.js`: navigation, session lifecycle, cancellation, and tab recovery adapter methods.
- `src/decision.js`: structured action context/arguments and semantic target resolution while retaining bounded classifier decisions.
- `src/index.js` and CLI APIs: new request, resume, and result contracts.
- `test/loop.test.js` and new tests: contract and failure-mode coverage.
- Downstream callers such as `qwen-voice-router`: may pass `goal` plus structured inputs and consume typed handoffs without URL regex or browser-specific parsing.
- No new runtime dependency or bundled model is required.
