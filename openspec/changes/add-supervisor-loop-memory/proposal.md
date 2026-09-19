## Why

The short-horizon Jev loop currently receives the page and goal, but not its recent actions or an explicit subtask boundary. On real sites it can repeat a filter, scroll forever, or miss that it is stuck. A calling main agent needs a reliable handoff instead of an opaque failure.

## What Changes

- Include a bounded recent action history and current subtask/plan context in each Decisions request.
- Detect repeated actions deterministically and stop with a structured handoff.
- Return structured handoff data for `stuck`, loop detection, step limits, and completed subtasks.
- Keep the browser actuator and Jev decision client independent from the higher-level supervisor.

## Capabilities

### New Capabilities

- `supervisor-handoff`: Short-horizon execution with memory, bounded subtask context, loop detection, and control handoff.

### Modified Capabilities

None.

## Impact

- Generic changes to the loop and Decisions request schema.
- New supervisor-facing result fields; existing status/reason fields remain compatible.
- No second LLM, no changes to agent-browser, and no browser-specific planning logic.
