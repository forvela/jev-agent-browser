## Why

The MVP currently launches or controls its own browser session. For realistic evaluation, it must act on an already-running headed Chrome session so the user can watch the same tab and preserve existing login state.

## What Changes

- Add `--cdp <port|url>` and `--auto-connect` browser connection options.
- Add optional `--pin-tab` so shared Chrome sessions stay on one bound tab.
- Add attach mode that snapshots and acts on the current tab without navigating it.
- Make `--url` optional in attach mode and keep normal launch mode unchanged.
- Document Chrome remote-debugging setup and session behavior.

## Capabilities

### New Capabilities

- `existing-cdp-session`: Attach the Jev controller to an existing Chrome session and operate on its current page.

### Modified Capabilities

None.

## Impact

- Changes the wrapper CLI and browser adapter only.
- Requires a Chrome instance discoverable through `--auto-connect` or a supplied CDP port/URL.
- No changes to agent-browser internals or Jev request schema.
