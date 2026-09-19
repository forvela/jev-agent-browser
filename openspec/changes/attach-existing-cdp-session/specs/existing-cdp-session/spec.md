## ADDED Requirements

### Requirement: Connect through an explicit existing Chrome endpoint
The controller MUST support `--cdp <port|url>` and `--auto-connect`, forwarding the selected connection mode to every agent-browser command in the run.

#### Scenario: Explicit CDP port
- **WHEN** the CLI receives `--cdp 9222`
- **THEN** every browser command uses the Chrome DevTools endpoint on port 9222

#### Scenario: Auto-connect
- **WHEN** the CLI receives `--auto-connect`
- **THEN** every browser command asks agent-browser to discover and attach to a running Chrome instance

### Requirement: Keep an explicitly pinned shared tab stable
The controller MUST support `--pin-tab` and forward it to agent-browser when multiple sessions share the connected Chrome instance.

#### Scenario: Pin a dedicated tab
- **WHEN** the CLI receives `--pin-tab` with `--cdp` or `--auto-connect`
- **THEN** agent-browser keeps the session bound to one tab across commands

### Requirement: Attach without navigating
The controller MUST support `--attach` to use the current connected tab without calling `agent-browser open`.

#### Scenario: Attach to current page
- **WHEN** the CLI receives `--attach` with `--auto-connect` or `--cdp`
- **THEN** the first operation is a snapshot of the current page and no navigation is performed

#### Scenario: Invalid attach configuration
- **WHEN** `--attach` is supplied without `--auto-connect` or `--cdp`
- **THEN** the CLI exits with a clear configuration error

### Requirement: Preserve normal URL mode
The controller MUST continue to support `--url` in launch mode and MUST reject a run that has neither `--url` nor `--attach`.

#### Scenario: Launch mode
- **WHEN** the CLI receives `--url <url>` without attach mode
- **THEN** it opens that URL before starting the Jev loop

#### Scenario: Attach URL override
- **WHEN** the CLI receives `--attach --auto-connect --url <url>`
- **THEN** it connects to the existing Chrome and navigates that tab to the supplied URL before the loop
