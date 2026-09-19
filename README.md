# jev-agent-browser

> Run fast, bounded browser agents with [Jev](https://typesafe.ai/) and [`agent-browser`](https://github.com/vercel-labs/agent-browser).

Give an agent a goal. Jev chooses the next typed browser action. `agent-browser` executes it. Your parent agent gets a structured result back.

![jev-agent-browser demo](https://raw.githubusercontent.com/forvela/jev-agent-browser/main/media/huggingface-filter-demo.gif)

A real 17-second, read-only walkthrough: Tasks → Text Classification → Most downloads → PyTorch → `ProsusAI/finbert` → back.

[Watch the full MP4 demo](https://github.com/forvela/jev-agent-browser/blob/main/media/huggingface-filter-demo.mp4) · [Open the original WebM recording](https://github.com/forvela/jev-agent-browser/blob/main/media/huggingface-filter-demo.webm)

## Quick start

```bash
npm install -g agent-browser
npm install -g jev-agent-browser
export TYPESAFE_API_KEY=...

jev \
  --url https://huggingface.co/models \
  --goal 'Open Tasks and select Text Classification' \
  --max-steps 6
```

`agent-browser` is an external peer tool; this package owns the decision loop and research tools, not the browser engine. API keys stay in environment variables; they are never part of the browser page or decision state.

## What it does

- **Browser tasks** — navigate, click, type explicit values, select, scroll, wait, and stop safely.
- **Research** — collect bounded raw evidence from configured pages and browser tools.
- **Classification** — send one typed, profile-driven batch to Jev.
- **Agent orchestration** — stream JSONL events or return a structured handoff to the parent agent.

## Why this wrapper

- **Typed actions, not generated browser code.** Jev chooses from a small validated action set.
- **Real browser control.** Built on `agent-browser`, with CDP attach, auto-connect, sessions, pinning, and native browser options preserved.
- **Research-ready.** Raw evidence is collected before classification; enrichment happens only after keep rules.
- **Provider-flexible.** Uses the official TypeSafe SDK by default and can target compatible Decisions endpoints, including OpenRouter.
- **CLI and Node.js API.** Use it from a shell, or embed the same loop in another agent.

## Common use cases

### Browse a real website

```bash
jev --url https://example.com \
  --goal 'Open the pricing page' \
  --max-steps 5
```

### Attach to an existing Chrome tab

```bash
jev --attach --auto-connect --pin-tab \
  --goal 'Inspect the current page and report what is visible'
```

Use a known CDP endpoint with `--attach --cdp 9222`. Native `agent-browser` arguments pass through with repeatable `--browser-arg` flags.

### Run bounded research

```bash
jev --mode research \
  --config ./research.json \
  --attach --auto-connect --pin-tab \
  --jsonl --summary
```

Profiles define the classification dimensions, keep rules, follow-ups, and allowed tools. The core stays domain-neutral.

### Use it from Node.js

```js
import { runLoop } from 'jev-agent-browser';

// Pass an adapter for the externally installed agent-browser or another engine.
export async function run(browser) {
  const result = await runLoop({
    browser,
    apiKey: process.env.TYPESAFE_API_KEY,
    goal: 'Open the pricing page',
    maxSteps: 5,
  });
  console.log(result.status, result.reason);
}
```

`runLoop` accepts injected browser and decision seams, so tests and other Node agents can provide their own adapters.

## Compatible Decisions endpoints

TypeSafe AI is the default:

```text
https://api.typesafe.ai/v1/systemone
```

A compatible endpoint can be selected without changing the browser loop:

```json
{
  "decision": {
    "endpoint": "https://openrouter.ai/api/alpha/decisions",
    "apiKeyEnv": "OPENROUTER_API_KEY"
  }
}
```

Use `decision.transport: "fetch"` only when intentionally bypassing the SDK for a custom transport. The SDK's fetch implementation remains injectable for library callers.

## Performance

Fast by construction: Jev makes typed decisions, while `agent-browser` executes native browser commands directly. This wrapper adds orchestration, not a second browser engine or a generated-JavaScript layer.

See Jev's own benchmark and performance claims for model-level results. This project will publish reproducible wrapper benchmarks separately rather than mixing network latency, model latency, and browser time into one number.

## Safety boundaries

- Browser work is sequential and bounded by `--max-steps`.
- Stale refs, repeated actions, malformed decisions, and stuck states stop safely.
- Input values are supplied by the parent and resolved locally.
- Submit, register, apply, and similar commitment actions should remain behind parent or user confirmation.
- Classification requests omit contact fields from collected candidates; bounded browser observations may still contain page content and URLs sent to the Decisions API.

## More

- [Full agent-facing skill](skills/core.md)
- [Profiles](profiles/)

## License

[MIT](LICENSE)
