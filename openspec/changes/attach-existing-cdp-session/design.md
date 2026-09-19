## Context

`agent-browser` supports `--cdp <port|url>` and `--auto-connect`. The current adapter always prefixes only `--session` and the CLI always calls `open`, which prevents using a user's existing headed Chrome tab.

## Goals / Non-Goals

**Goals:**

- Preserve one browser adapter and add connection flags as global arguments.
- Allow an attach-only run that observes the active existing tab.
- Keep launch mode and existing commands backward compatible.

**Non-Goals:**

- Managing Chrome startup or remote-debugging flags automatically.
- Taking over authentication or profile state.
- Automatically choosing a new tab; attach mode works with the current tab unless the caller explicitly enables `--pin-tab`.

## Decisions

- Store `cdp` and `autoConnect` on `AgentBrowser` and include them on every command.
- Add `--attach` to skip navigation; `--auto-connect` or `--cdp` establishes the connection.
- Require either `--url` or `--attach`; reject attach without a connection mode.
- Keep `agent-browser.json` focused on visual defaults (`headed`); connection and tab selection stay explicit per run.
- Bound oversized snapshots and choice lists before sending a Decisions request, while retaining the full observation for the local trace.

## Risks / Trade-offs

- [No CDP endpoint] The run fails with the agent-browser diagnostic. → Document Chrome launch and `--auto-connect` setup.
- [Shared tab interference] Actions affect the user's current tab. → Make attach mode explicit and use a named session.
