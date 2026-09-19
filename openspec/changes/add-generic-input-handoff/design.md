## Context

The worker should own navigation and execution, while the parent owns semantic answers and user data. A missing value is not a browser blocker; it is a request for parent input. Native `fill` remains the actuator and avoids slow per-character typing.

## Goals / Non-Goals

**Goals:**

- Identify missing field input generically from the current ref's accessible name and role.
- Resolve supplied values by current ref or stable normalized field key.
- Keep values out of the Jev Decisions API state.
- Return control with enough metadata for a parent agent to provide values and resume.

**Non-Goals:**

- Generating CVs, registration answers, or domain-specific text inside the browser worker.
- Storing credentials or bypassing confirmation for submit/apply/register actions.
- Adding a second LLM.

## Decisions

- `TYPE` remains a Jev-selected operation; when no value resolves, the loop emits an `input_required` handoff instead of guessing.
- `inputValues` is a generic map accepted by `runLoop`; lookup tries the current ref, normalized accessible name, and a `role:name` field key, with the existing scalar `text` as compatibility fallback.
- The input map is used only by the controller when executing `fill`; it is never included in `buildDecisionRequest`.
- CLI support is opt-in through `--input-values-json`; callers handling sensitive data should prefer the library API or a protected process boundary.

## Risks / Trade-offs

- Accessible names can be duplicated. → Parent can use the current ref key from the handoff for exact targeting.
- Refs change after navigation. → Parent receives a fresh handoff on the current page and should provide values by stable key where possible.
- A supplied value can still be inappropriate for a site. → Parent/user remains responsible for semantic correctness and final submission approval.
