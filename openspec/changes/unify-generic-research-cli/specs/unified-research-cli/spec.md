## ADDED Requirements

### Requirement: Use one CLI for browser and research modes
The system MUST expose browser-loop, config-driven research, and generic batch-classification behavior through the existing CLI entry point.

#### Scenario: Classify a collected batch
- **WHEN** `src/cli.js --mode classify` receives JSON items on stdin
- **THEN** it returns structured classifications without requiring a LinkedIn-specific command

### Requirement: Collect before enriching
The classify mode MUST preserve raw parent-side items and MUST perform contact/link enrichment only after an item passes the profile keep rule.

#### Scenario: Keep then enrich
- **WHEN** `--enrich-kept` is enabled and a profile keeps an item
- **THEN** the output includes extracted contact/link data for that item

#### Scenario: Rejected item
- **WHEN** an item does not match the keep rule
- **THEN** the output preserves the item but does not run enrichment for it

### Requirement: Run configured detail follow-ups before classification
Research mode MUST support generic, config-defined detail URLs and bounded helper sequences before batch classification.

#### Scenario: Verify a missing detail field
- **WHEN** a follow-up condition matches an item with an allowed target URL
- **THEN** the CLI opens that target, runs only the configured tools, merges the bounded result, and includes profile-declared evidence in classification

#### Scenario: Fail closed on an unallowed target
- **WHEN** a follow-up target host is not in its configured allowlist
- **THEN** the CLI does not open the target

### Requirement: Allow Jev to trigger configured research tools
The research mode MUST expose only config-registered tools as typed choices and MUST execute a selected tool through the browser session before continuing the loop.

#### Scenario: Jev expands or collects
- **WHEN** Jev selects a configured `expand`, `collect`, or `scroll` tool
- **THEN** the CLI invokes that tool and includes bounded tool progress in the next decision context

### Requirement: Do not send contact data to Jev
The CLI MUST redact contact values and action URLs from the Decisions request while preserving them in the returned parent-side item.

#### Scenario: Raw post includes an email
- **WHEN** a collected item includes email, phone, or apply links, including inside free text, signals, or follow-up evidence
- **THEN** those values are redacted from the Jev state and remain available only in parent-side output

### Requirement: Provide a globally installable command
The package MUST expose a `jev` executable and resolve its bundled `agent-browser` dependency, while allowing an explicit compatible browser command override.

#### Scenario: Install and invoke globally
- **WHEN** the package is installed globally with npm
- **THEN** `jev --help` runs from any working directory and config-relative paths resolve from the supplied config file

### Requirement: Expose an agent-facing skill
The installed CLI MUST expose a detailed version-matched usage skill through a subcommand without requiring the agent to inspect the source tree.

#### Scenario: New agent starts
- **WHEN** an agent runs `jev skills get core --full`
- **THEN** it receives modes, configuration examples, safety boundaries, scroll guidance, and diagnostics

### Requirement: Carry configured tool progress forward
The browser loop MUST pass bounded results from a configured tool into the next decision context.

#### Scenario: Scroll reports end-of-feed
- **WHEN** a configured scroll tool returns `moved` and `atEnd`
- **THEN** the next Jev decision can see those fields without receiving the full raw tool output

### Requirement: Configure efficient scrolling
Research configs MUST be able to pass bounded tool configuration values, such as a viewport-relative scroll amount, without core changes.

#### Scenario: Lazy-loaded feed
- **WHEN** a scroll tool is configured with a large viewport-relative amount
- **THEN** the helper receives that value and can trigger the next lazy-loaded batch in fewer bounded steps

### Requirement: Support compatible Decisions endpoints
The CLI MUST allow the Decisions endpoint to be selected by CLI or research config and MUST preserve the common state/questions request and typed response contract.

#### Scenario: Switch compatible endpoint
- **WHEN** `--endpoint` or `decision.endpoint` points to a compatible service
- **THEN** the CLI sends the same request shape and parses the typed decision response without provider-specific core logic

#### Scenario: SDK or custom transport
- **WHEN** a library caller supplies `fetchImpl` or `decide`
- **THEN** the caller can use an SDK/custom transport without changing loop or classifier code

### Requirement: Report bounded research metrics
Research results MUST include aggregate counts and duration for decision steps, browser actions, configured tools, follow-ups, raw/unique items, classification batches, and total Jev requests.

#### Scenario: Tune a research profile
- **WHEN** research mode completes or reaches its configured bounds
- **THEN** the result exposes enough metrics to compare scroll/query configurations without parsing raw observations

### Requirement: Preserve native browser options
The wrapper MUST pass configured native agent-browser arguments through on every invocation while reserving only lifecycle arguments required for wrapper correctness.

#### Scenario: Configure native browser behavior
- **WHEN** config or repeatable `--browser-arg` supplies options such as profile, provider, engine, allowed domains, or headed mode
- **THEN** those options reach agent-browser unchanged

#### Scenario: Prevent lifecycle conflict
- **WHEN** native args attempt to override wrapper-owned session/CDP/auto-connect/pinning flags
- **THEN** the wrapper rejects them instead of producing ambiguous behavior

### Requirement: Keep the browser engine seam minimal
The core MUST use the existing injected browser surface and MUST NOT add a multi-engine registry until a second backend exists.

#### Scenario: Default engine
- **WHEN** no browser command override is supplied
- **THEN** the CLI uses the bundled `agent-browser` executable

#### Scenario: Compatible override
- **WHEN** `--browser-command` is supplied
- **THEN** the CLI invokes that command through the same injected browser surface
