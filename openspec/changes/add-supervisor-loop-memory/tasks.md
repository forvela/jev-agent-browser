## 1. Decision context

- [x] 1.1 Add plan, subtask, and bounded history fields to Decisions requests.
- [x] 1.2 Keep existing request shape compatible when optional context is absent.

## 2. Loop supervision

- [x] 2.1 Track compact action history and repeat signatures.
- [x] 2.2 Add configurable loop detection, local recovery attempts, and structured handoff results.
- [x] 2.3 Preserve existing stale-target and safety behavior.

## 3. Verification and docs

- [x] 3.1 Add tests for context, history caps, repeat detection, and handoffs.
- [x] 3.2 Document parent-agent/subtask usage and run the full test suite.
