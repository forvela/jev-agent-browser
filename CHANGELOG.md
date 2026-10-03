# Changelog

## 0.2.1 — 2026-10-03

### Added

- `jev --version` and `jev -v` CLI flags.

## 0.2.0 — 2026-10-03

### Added

- Goal requests with parent-provided semantic `inputs`.
- First-class `NAVIGATE` browser action with HTTP(S) validation.
- Semantic target resolution for live page fields without caller DOM refs.
- Resumable `input-required` handoffs and `resumeLoop`.
- Structured execution results and JSONL lifecycle events.
- Browser tab rebind recovery, cancellation, timeout cleanup, and secret redaction.
- CLI options `--inputs-json` and `--resume-json`.
- Unit, contract, JSONL, and browser smoke test commands.

### Compatibility

- Legacy `text`, `selectValue`, `pressKey`, `inputValues`, and bounded `limit` behavior remain supported.
- Jev remains model-agnostic and does not bundle an LLM or parse URLs/goals with regex.
