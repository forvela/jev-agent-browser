## Why

The first LinkedIn adapter made a wrong architectural split: it hard-coded LinkedIn filters and exposed a separate CLI. The useful abstraction is a general research pipeline. It should collect bounded raw evidence first, classify the batch with Jev, and only then enrich retained items with contact/link extraction. LinkedIn is one profile/configuration, not a special engine.

## What Changes

- Replace LinkedIn-specific batch classification with a profile-driven generic classifier.
- Expose classification and post-filter enrichment through the existing single `src/cli.js`.
- Remove deterministic LinkedIn hard-filter logic from the Jev path; criteria and categories come from the supplied profile JSON.
- Keep raw item evidence and links parent-side, while redacting contact/action values from the Jev request.
- Add configurable bounded follow-up collection (for example, opening an author/detail URL and running an allowlisted helper) before final batch classification.
- Add optional post-classification contact enrichment for retained items.
- Make the CLI globally installable as `jev`, including its pinned `agent-browser` dependency and executable resolution.
- Ship an agent-facing `jev skills get core --full` usage guide with configuration and operating practices.
- Make lazy-loading scroll budgets configurable and carry bounded tool progress into the next Jev decision.
- Use the official JavaScript Decisions SDK by default while keeping endpoint/server selection and an explicit fetch fallback for compatible paths.
- Pass native agent-browser options through the wrapper while reserving only lifecycle options needed for safe attachment.

## Capabilities

### New Capabilities

- `generic-research-profile`: Define arbitrary classification dimensions, choices, instructions, and keep rules as JSON.
- `unified-research-cli`: Run browser control, batch classification, and optional retained-item enrichment from one CLI.

### Modified Capabilities

- `batch-evidence-classification`: Use dynamic profile dimensions instead of LinkedIn-specific labels and apply one request to each bounded evidence batch.

## Impact

- `src/classifier.js`, `src/cli.js`, `src/research-runner.js`, packaging, and tests are generalized.
- LinkedIn-specific classifier/CLI modules are removed; LinkedIn profile/detail helpers remain configuration assets.
- The existing injected browser seam remains the engine boundary; a formal multi-engine registry is deferred until a second backend exists.
- No fork or modification of the upstream `agent-browser` package.
