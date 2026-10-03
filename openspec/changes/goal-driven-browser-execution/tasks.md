## 1. Public goal/input contract

- [x] 1.1 Define JSON-safe request, semantic input, continuation, handoff, and execution-result types without adding a runtime dependency.
- [x] 1.2 Add input normalization that combines new `inputs` with legacy `text`, `selectValue`, `pressKey`, and `inputValues` paths while preserving backward compatibility.
- [x] 1.3 Validate input kinds, stable keys, target hints, URL values, and secret markers at the public API boundary.
- [x] 1.4 Add local redaction helpers and ensure secret values cannot enter decision state, history, traces, handoffs, events, or error messages.

## 2. Decision contract and semantic resolution

- [x] 2.1 Add `NAVIGATE` to the finite operation vocabulary and decision parser.
- [x] 2.2 Add bounded input-key choices for navigation, typing, and selection; expose only input metadata/keys to the classifier and never require free-form generated values.
- [x] 2.3 Extend decision request construction to include the raw goal, non-secret input metadata, target hints, and bounded continuation history.
- [x] 2.4 Implement semantic target resolution from the live snapshot and selected input hint without accepting stale caller-provided DOM refs as the primary contract.
- [x] 2.5 Add decision parsing and validation tests for navigation, input-key selection, malformed decisions, and missing values.

## 3. Goal execution and handoff/resume

- [x] 3.1 Add `NAVIGATE` action execution through `AgentBrowser.open()` with approved HTTP(S) URL validation.
- [x] 3.2 Route `TYPE`, `SELECT`, and `PRESS` values through the normalized input catalog while retaining legacy explicit arguments.
- [x] 3.3 Return typed `input-required` handoffs for missing destination, text, select, key, authentication, or human-interaction data instead of parsing the raw goal or guessing.
- [x] 3.4 Add JSON-safe continuation state and a resume entry point that reuses the caller's session identity, re-snapshots, and resolves fresh refs.
- [x] 3.5 Keep raw goals byte-for-byte available in results and events while excluding secret values from all diagnostics.
- [x] 3.6 Add bounded handling for unsupported operations, unresolved semantic targets, and unsafe navigation inputs.

## 4. Browser session lifecycle and cancellation

- [x] 4.1 Introduce a small session lifecycle boundary around attach, bind, liveness check, rebind, and cleanup without coupling the loop to CDP internals.
- [x] 4.2 Add one bounded stale-tab recovery path that refreshes the snapshot/rebinds the tab and returns a typed `tab-lost` result when recovery fails.
- [x] 4.3 Thread `AbortSignal` through `runLoop`, browser actions, and the child-process runner.
- [x] 4.4 Ensure cancellation and timeout terminate pending browser work, stop further actions, and release owned resources in `finally` blocks.
- [x] 4.5 Add lifecycle tests for auto-connect/attach, closed tabs, resume, cancellation, timeout, and bounded retry behavior.

## 5. Structured results and event stream

- [x] 5.1 Normalize terminal statuses to `success`, `input-required`, `blocked`, `cancelled`, `timeout`, and `error` with stable reasons and current URL when known, while preserving legacy resumable `limit` for bounded budgets.
- [x] 5.2 Extend handoffs with bounded observation, recent actions, escalation kind, resumability, and required-input metadata without collapsing causes into a generic error.
- [x] 5.3 Make JSONL start, step, handoff, cancellation, timeout, and terminal events JSON-safe and consistent with the returned result.
- [x] 5.4 Add result/event redaction and size-bound tests for large snapshots, refs, history, and secrets.

## 6. CLI and documentation compatibility

- [x] 6.1 Expose goal inputs and resume data through the programmatic API and JSONL interface; retain existing CLI flags.
- [x] 6.2 Document the goal-plus-input contract with examples for navigation, search, authentication handoff, and resume.
- [x] 6.3 Document that Jev does not bundle an LLM, does not parse raw goals into URLs, and optionally accepts an external compiler only as a caller concern.
- [x] 6.4 Add a downstream integration example showing a parent agent passing raw goal plus semantic values and responding to `input-required`.

## 7. Verification and acceptance

- [x] 7.1 Expand unit coverage for every new requirement scenario in the four change specs using fake browser and decision seams.
- [x] 7.2 Add a contract test proving a parent can navigate to a supplied URL and fill a live search field without knowing DOM refs.
- [x] 7.3 Add a resume test proving a missing value can be supplied by the parent/human and the same browser session continues with fresh refs.
- [x] 7.4 Add failure tests proving unsafe URLs, raw-goal URL guessing, stale tabs, cancellation, timeout, and secret leakage are rejected or handled safely.
- [x] 7.5 Run `npm test`, CLI/JSONL smoke tests, and static syntax checks; record exact commands and results in the implementation evidence.
- [x] 7.6 Run an opt-in live browser smoke flow for supplied `https://www.google.com`/`https://example.com` navigation and a Facebook destination, recording authentication/redirect behavior as external runtime evidence rather than treating it as a unit-test failure.
- [x] 7.7 Publish and verify the downstream integration contract in Jev's public API/docs: parent callers send `goal + inputs`, consume typed handoffs, and do not need URL/retry workarounds; consumer-specific Qwen runtime wiring remains outside this repo-scoped change.
