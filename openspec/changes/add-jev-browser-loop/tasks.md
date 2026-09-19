## 1. Project setup

- [x] 1.1 Create a dependency-free Node.js ESM project with CLI scripts and ignored local secrets.
- [x] 1.2 Add README usage, required environment variables, and the supported MVP action contract.

## 2. Browser and decision adapters

- [x] 2.1 Implement the `agent-browser` subprocess adapter for snapshots and supported actions.
- [x] 2.2 Implement snapshot normalization and dynamic operation/target criteria from current refs.
- [x] 2.3 Implement the OpenRouter Decisions API client with timeout and response validation.

## 3. Controller loop

- [x] 3.1 Implement the bounded observe → decide → validate → execute loop and terminal statuses.
- [x] 3.2 Add JSON trace output for observations, decisions, actions, timings, and final result.
- [x] 3.3 Enforce current-ref validation, `none_of_the_above`, input capability gates, and safe stop thresholds.

## 4. Verification

- [x] 4.1 Add unit tests for criteria generation, response parsing, action validation, and terminal decisions.
- [x] 4.2 Add a local HTML fixture and a smoke command that exercises agent-browser without changing its source.
- [x] 4.3 Run tests, CLI help, and a live Jev/browser smoke test when `OPENROUTER_API_KEY` is available.
