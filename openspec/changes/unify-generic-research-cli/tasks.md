## 1. Generic classifier

- [x] 1.1 Replace fixed LinkedIn dimensions with validated profile-defined dimensions.
- [x] 1.2 Preserve bounded evidence, redaction, one-request batching, and malformed-answer handling.

## 2. Unified CLI

- [x] 2.1 Add `--mode classify` and stdin JSON input to the existing CLI.
- [x] 2.2 Add profile keep rules and optional post-classification contact/link enrichment.
- [x] 2.3 Remove separate LinkedIn CLI and hard-coded LinkedIn adapter logic.
- [x] 2.4 Add `--mode research`, config-driven multi-query collection, and typed Jev-triggered tools.

## 3. Verification and docs

- [x] 3.1 Add LinkedIn-profile and non-LinkedIn-profile tests.
- [x] 3.2 Verify the portfolio capture/parser pipe works as a generic input source without temp files.
- [x] 3.3 Run the full test suite and OpenSpec validation.

## 4. Configured detail verification and distribution

- [x] 4.1 Add generic config-driven follow-ups with target fields, missing-field conditions, host allowlists, and ordered tools before classification.
- [x] 4.2 Add profile-declared detail evidence, recursive contact/phone/URL redaction, and profile-owned label overrides in Jev requests.
- [x] 4.3 Add configurable source type and post intent dimensions to the LinkedIn profile without adding LinkedIn logic to core.
- [x] 4.4 Expose a globally installable `jev` command with bundled agent-browser resolution and a compatible command override.
- [x] 4.5 Keep the injected browser seam as the current engine boundary and document deferral of a multi-engine registry.
- [x] 4.6 Add `jev skills list|get|path` with a packaged agent-facing core skill.
- [x] 4.7 Pass bounded tool progress into the next decision and support per-tool configuration values.
- [x] 4.8 Configure LinkedIn lazy-loading scrolls as large viewport-relative steps.
- [x] 4.9 Emit aggregate research metrics for Jev requests, browser actions, tools, follow-ups, items, batches, and duration.
- [x] 4.10 Keep Decisions transport provider-neutral with endpoint/header selection and injectable fetch/decide seams.
- [x] 4.11 Pass native agent-browser arguments through while rejecting lifecycle conflicts.
