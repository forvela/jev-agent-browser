## ADDED Requirements

### Requirement: Report missing generic input
The worker MUST return an `input_required` handoff when Jev selects a value-entering operation and no value is available for the selected field.

#### Scenario: Form field needs parent data
- **WHEN** Jev selects `TYPE` for a current textbox or `SELECT` for a combobox without a resolved value
- **THEN** the run stops with `status: input-required` and returns operation, field ref, role, accessible name, and stable key

### Requirement: Resolve parent-provided values locally
The worker MUST support a generic input-value map and resolve values by current ref or stable field identity before invoking the native fill or select action.

#### Scenario: Value is supplied by field name
- **WHEN** the parent supplies a value keyed by the field's normalized accessible name
- **THEN** the worker invokes one native value-setting action with that value

#### Scenario: Existing scalar text input
- **WHEN** the caller supplies the existing scalar text option
- **THEN** the worker continues to use it as a fallback value

### Requirement: Keep input values out of Decisions state
The worker MUST NOT include parent-provided field values in the request sent to Jev.

#### Scenario: Sensitive value is available
- **WHEN** the worker asks Jev to choose a field or operation
- **THEN** the Decisions state contains field metadata but not the actual input value

### Requirement: Preserve generic scope
The protocol MUST describe fields and values generically without resume-specific or site-specific assumptions.

#### Scenario: Arbitrary form
- **WHEN** the current page is a registration, verification, search, application, or other form
- **THEN** the same input handoff and fill behavior applies
