## 1. Generic input resolution

- [x] 1.1 Add unresolved TYPE decisions and stable field-key/value resolution.
- [x] 1.2 Keep input values out of Decisions requests and preserve scalar text compatibility.

## 2. Parent handoff

- [x] 2.1 Return `input_required` handoffs with generic field metadata.
- [x] 2.2 Add optional CLI `--input-values-json` support for non-secret test flows.

## 3. Verification and docs

- [x] 3.1 Add tests for missing input, name/ref resolution, and request redaction.
- [x] 3.2 Document parent-agent usage and safety boundary, then run the full test suite.
