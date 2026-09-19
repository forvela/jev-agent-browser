## Context

This is a new standalone Node.js project. The installed `agent-browser` CLI already owns browser lifecycle, accessibility snapshots, refs, and action execution. The wrapper only needs to coordinate snapshots, one typed Jev decision request, and the next CLI action. The MVP is intended for fast empirical testing, not production browser autonomy.

## Goals / Non-Goals

**Goals:**

- Keep `agent-browser` unchanged and use its CLI as the actuator.
- Make one OpenRouter Decisions API request per loop iteration with operation, target, goal, and stuck decisions.
- Use deterministic refs from `snapshot --json`; never ask Jev to invent selectors.
- Stop on goal completion, stuck confidence, an explicit safe terminal action, action failure, or a step limit.
- Make text and select values explicit CLI inputs so the first MVP has no second LLM.

**Non-Goals:**

- Forking or modifying `agent-browser`.
- Arbitrary text generation, multi-agent planning, retries, or DOM mutation outside the CLI.
- Streaming Jev responses or hiding the roughly 0.5s+ decision latency.
- Production-grade authentication, CAPTCHA handling, or recovery from browser crashes.

## Decisions

1. **Plain Node.js ESM with built-ins only.** Use `fetch`, `child_process`, `node:test`, and `node:assert`; avoid a dependency/runtime layer for a small experiment.
2. **CLI boundary for browser actions.** A single `runAgentBrowser(args)` adapter wraps `agent-browser --session <name> ...`. This preserves the existing daemon and makes the controller independently testable.
3. **One batched decision request.** The state contains the goal, current URL, compact snapshot text, and refs. Questions include `operation` (choice), relevant target choices (choice), `goal_reached` (noul), and `stuck` (noul). Target criteria include `none_of_the_above`.
4. **Explicit input capabilities.** `TYPE` is exposed only when `--text` is present; `SELECT` is exposed only when `--select-value` is present. This prevents an action that the controller cannot execute.
5. **Conservative controller.** A target must be a current ref; `DONE` requires `goal_reached.noul >= 0.8`; `stuck.noul >= 0.8` stops with a non-success result. Failed commands and max steps stop rather than retrying blindly.
6. **Observable JSON result.** Each iteration logs the selected operation, probabilities, action result, and timing. Final output contains `status`, `steps`, and `reason` so latency and failure modes can be compared with another agent.

## Risks / Trade-offs

- [Decision latency] Every meaningful state change waits for Jev. → Keep the loop bounded, batch heads, and use this as a benchmark rather than a hard-realtime controller.
- [Ref lifetime] A navigation or DOM mutation invalidates old refs. → Snapshot again after every executed action and validate targets against the current snapshot.
- [Closed choice space] Jev cannot select an action outside the provided options. → Include explicit terminal/stuck options and expose only executable actions.
- [Text coverage] The MVP cannot invent arbitrary text. → Accept one explicit `--text` and leave a narrow text-generator adapter for a later change.
- [CLI variability] `agent-browser` output may change between versions. → Parse the documented JSON envelope and fail with the raw output when the expected `data.refs` or `data.snapshot` shape is absent.

## Migration Plan

No existing system is changed. Initialize the new project, run unit tests, then run the local fixture smoke test with an OpenRouter key. Delete the directory to roll back.
