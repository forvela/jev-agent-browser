## Context

The main agent should own long-horizon planning. Jev should execute one bounded subtask quickly, remember recent actions, and return control when it reaches the subtask goal, a safe stopping condition, or a blocker.

## Goals / Non-Goals

**Goals:**

- Give Jev a bounded `subtask` and optional `plan` supplied by the caller.
- Include a compact, serializable history of recent observations/actions in every decision request.
- Detect repeated equivalent actions without asking another model.
- Return a handoff object that a parent agent can use to choose the next subtask.

**Non-Goals:**

- Adding a planner LLM or autonomous multi-level planning.
- Moving browser execution into the supervisor.
- Teaching the loop site-specific recovery behavior.

## Decisions

- The caller remains the planner; `runLoop` is the bounded worker.
- History is controller-owned and capped by count and text size. It contains action, target, URL, and result status, not full snapshots.
- A repeated action signature enters bounded local recovery after a small configurable threshold. The recovery state tells Jev to avoid the signature and try another safe route.
- `stuck`, exhausted recovery, `max-steps`, and successful completion all return a common `handoff` object with the current observation and recent actions. Only fatal/exhausted cases require parent intervention; a step budget can be resumed with the same subtask.
- The request uses generic fields `plan`, `subtask`, and `history`; neither Jev nor the browser adapter knows the identity of the parent agent.

## Risks / Trade-offs

- Small history can omit older context. → Keep the latest entries and expose the cap as an option.
- Repeated actions can be valid in some workflows. → Use a configurable threshold and bounded recovery attempts; only exhaustion escalates to the parent.
- Handoff is local evidence, not proof of task success. → Parent agents decide whether to continue, replan, or report failure.
