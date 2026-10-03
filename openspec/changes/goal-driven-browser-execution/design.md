## Context

Jev is currently a bounded browser decision loop around `agent-browser`. Its decision API selects finite operations and current snapshot refs, while callers can optionally provide explicit `text`, `selectValue`, and `pressKey`. The loop does not currently expose navigation as an operation, has no general goal-input contract, and returns an `input-required` handoff only after a decision has already selected an unresolved field.

The intended caller is a parent agent such as Qwen Voice Router. The parent owns conversation context and can provide known semantic values (for example, a destination URL or search text), but it must not need to know transient DOM refs. Jev owns browser observation, semantic target resolution, action execution, session lifecycle, and resumable execution. Jev must remain model-agnostic and must not bundle an LLM or require a compiler model.

## Goals / Non-Goals

**Goals:**

- Accept an unchanged raw goal plus optional structured semantic inputs.
- Execute parent-provided URL, text, select, and key values while choosing current-page targets from live snapshots.
- Add `NAVIGATE` as a first-class operation.
- Return typed, resumable handoffs when a value, permission, authentication step, or human interaction is required.
- Resume the same browser session without re-running stale refs or losing execution context.
- Propagate cancellation and clean up browser child processes and sessions.
- Preserve structured, JSONL-friendly result and event contracts.
- Keep secrets out of decision requests, traces, history, and handoff observations.
- Keep the classifier API bounded; no free-form model output or bundled LLM is introduced.

**Non-Goals:**

- Building an LLM or implementing a model-backed ActionCompiler inside Jev.
- Parsing URLs, spoken domains, or intent from raw goals in Jev.
- Making the parent choose DOM refs or browser-specific operations.
- Replacing `agent-browser` or changing the external browser product.
- Implementing conversational responses, TTS, or voice routing.
- Adding a new orchestration framework or persistent database.

## Decisions

### 1. Use a goal-plus-input contract, not a parent action contract

The public request will contain the original `goal` and optional `inputs`. Inputs are semantic values, not DOM refs:

```ts
{ key, kind: 'url' | 'text' | 'select' | 'key' | 'secret', value, targetHint?, secret? }
```

The parent may provide `destination=https://google.com` and `search_query=пицца доставка`, but Jev resolves the search field against the current snapshot. This keeps the parent independent of changing refs and keeps Jev responsible for browser execution.

Alternative rejected: accepting raw `CLICK @e12`/`TYPE @e12` actions as the primary API. Such refs are snapshot-scoped and become stale across turns.

### 2. Extend the bounded decision vocabulary with argument selection, not text generation

Add `NAVIGATE` to the finite operation choices. Add finite choices for selecting one of the parent-provided input keys for `NAVIGATE`, `TYPE`, and `SELECT`. The model chooses among values that already exist; it does not generate arbitrary text.

`TYPE` and `SELECT` values are resolved locally from the selected input key. `PRESS` uses the existing explicit key path or a supplied key input. If the selected operation has no usable value, the loop returns a typed input handoff instead of guessing.

Alternative rejected: a second LLM call inside the loop. It adds latency and makes Jev model-dependent.

### 3. Navigation is executed by the existing browser adapter

`AgentBrowser.action('NAVIGATE', ...)` will map to its existing `open(url)` capability. The URL is validated at the Jev trust boundary: only approved `http`/`https` URLs are executable, with unsafe schemes rejected. Validation is not intent parsing.

### 4. Handoffs are explicit and resumable

The loop returns a stable result status and an `inputRequired` descriptor containing a semantic key, kind, reason, and whether the request is safe to resume. A continuation payload contains only non-secret execution context: goal, plan, subtask, bounded history, and session identity/correlation metadata. The parent supplies missing values through a resume call and invokes the loop again against the same browser session.

No server-side persistence or database is added. The caller owns the serialized continuation and the browser session remains the source of browser state.

### 5. Secrets are values, never model context

Secret inputs may be used by local browser actions but are excluded from decision request state, action history, traces, compact observations, JSONL progress events, and error strings. The API marks secret inputs explicitly and validates that callers do not provide secret values through legacy public `text`/`selectValue` fields.

### 6. Add a small session boundary around the existing adapter

The loop will use the existing `AgentBrowser` interface and add generic lifecycle hooks rather than coupling loop logic to CDP internals. The boundary will support attach/bind checks, one bounded stale-tab recovery path, cancellation, and cleanup. A stale target will trigger a fresh snapshot/rebind attempt; repeated failure returns a typed recoverable error rather than retrying indefinitely.

### 7. Cancellation is cooperative and process-safe

`AbortSignal` will flow from `runLoop` to browser commands. The process runner will stop pending child work on abort and the loop will return `cancelled` with cleanup attempted. Timeouts remain distinct from cancellation. Every run releases owned resources in `finally`.

### 8. Preserve compatibility during migration

Existing calls using `goal`, `text`, `selectValue`, `pressKey`, and `inputValues` continue to work. New `inputs` normalize into the existing local value resolution path. Existing statuses and trace fields remain available; new statuses and fields are additive. CLI flags remain supported while JSON/programmatic APIs become the canonical integration surface.

## Risks / Trade-offs

- **[Risk] Parent input keys may not match the page's accessible names.** → Use `targetHint` as semantic context, let Jev select the live target, and return a handoff when no safe target/value match exists.
- **[Risk] A parent can provide a malicious URL.** → Validate scheme and URL syntax before `open`; keep any host policy configurable at the execution boundary.
- **[Risk] Secret values can leak through browser error text or provider output.** → Redact marked secret values before traces/events/errors and never include them in decision state.
- **[Risk] Auto-connect may still discover a closed or wrong tab.** → Bind/recheck the selected tab, perform one bounded recovery, and return `tab-lost` instead of looping.
- **[Risk] Continuation state can become stale while a handoff is pending.** → Re-snapshot on resume, retain bounded history only, and treat the current browser snapshot as authoritative.
- **[Risk] Supporting both legacy inputs and the new contract can duplicate resolution logic.** → Normalize all inputs once at the loop boundary and use one resolver internally.
- **[Trade-off] The library will not infer a URL from a raw goal.** → This is intentional: callers that know the value must provide it; callers without it receive a structured missing-input handoff rather than hidden parsing or an extra model.

## Migration Plan

1. Add the request/input/result types and normalization helpers without changing existing action behavior.
2. Add `NAVIGATE`, URL validation, and finite input-key selection behind unit tests.
3. Add semantic target/value resolution for `TYPE` and `SELECT`, preserving legacy arguments.
4. Add typed handoff and resume continuation handling, including secret redaction tests.
5. Add session lifecycle, stale-tab recovery, abort, timeout, and cleanup behavior.
6. Add JSONL/CLI compatibility and integration fixtures.
7. Update downstream Qwen integration to send `goal + inputs`, consume handoffs, and remove URL/retry workarounds only after end-to-end tests pass.
8. Rollback is additive: callers can omit `inputs`, and the old operation set remains usable except that new navigation behavior is opt-in through supplied URL input.

## Open Questions

- Whether the default URL policy should allow all `http`/`https` hosts or require an explicit host allowlist in attach/research modes. Initial implementation should preserve existing caller policy hooks and default to scheme validation only.
- Whether the parent continuation should be transported as a full JSON object or a caller-owned opaque token. Initial implementation should expose a JSON-safe continuation object and a correlation token, avoiding server-side storage.
- Whether `SWITCH_TAB` belongs in this change. It is useful for recovery, but the first implementation can keep tab selection internal and defer a public multi-tab operation unless tests show a caller need.
