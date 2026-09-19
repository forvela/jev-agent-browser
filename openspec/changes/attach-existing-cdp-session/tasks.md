## 1. Connection plumbing

- [x] 1.1 Add CDP, auto-connect, and pin-tab global arguments to the agent-browser adapter.
- [x] 1.2 Add CLI parsing and validation for `--cdp`, `--auto-connect`, and `--attach`.

## 2. Attach behavior

- [x] 2.1 Skip navigation in attach-only mode and preserve URL override behavior.
- [x] 2.2 Add tests for connection arguments, validation, and attach flow.
- [x] 2.3 Bound large page context and retry transient stale refs during real-site runs.

## 3. Documentation and verification

- [x] 3.1 Document launching Chrome with remote debugging and running attach mode.
- [x] 3.2 Run unit tests and a CDP attach smoke test; auto-connect is unavailable for the current Chrome endpoint.
