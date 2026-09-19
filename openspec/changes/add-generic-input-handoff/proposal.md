## Why

Jev can locate controls and execute fast native fills, but it should not invent personal, domain-specific, or sensitive text. Generic workflows may need values for registration, verification, search forms, applications, and other sites. The parent agent must be able to provide those values or ask the user without losing the browser state.

## What Changes

- Allow a worker run to identify a text field whose value is not available.
- Return a structured `input_required` handoff with a stable field key and metadata.
- Let the parent provide a generic field-value map; values are resolved locally and are not sent to Jev's Decisions request.
- Continue filling fields through native `agent-browser fill` in one operation.
- Keep the design domain-neutral and preserve the existing scalar `--text` path.

## Capabilities

### New Capabilities

- `generic-input-handoff`: Request and safely apply parent-provided values for arbitrary web forms.

### Modified Capabilities

None.

## Impact

- Generic loop, decision criteria, and CLI option changes.
- No second LLM and no changes to agent-browser.
- Existing text flows remain compatible; sensitive values can be supplied through the library API instead of shell arguments.
