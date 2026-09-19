# Jev CLI skill

`jev` is a bounded, configuration-driven browser worker and research runner.
Use it when an agent needs a browser to inspect pages, execute safe actions,
collect evidence, classify batches, or run configured follow-ups.

## Start here

```sh
jev --help
jev skills get core --full
```

The CLI never invents personal or secret input values, never submits a
commitment action without parent/user control, and never sends contact values
or action URLs to Jev's Decisions API.

## Modes

### Browser loop

Use for one bounded interactive task:

```sh
jev --attach --auto-connect --pin-tab \
  --goal 'inspect the current page and report the visible pricing options' \
  --max-steps 8 --jsonl
```

Use `--cdp 9222` instead of `--auto-connect` when the Chrome endpoint is known.
Supported decisions include clicks, typing with parent-provided values,
selects, key presses, scrolling, back, wait, configured tools, and done.

### Generic classification

Classify JSON from stdin with a profile. The profile defines all dimensions and
choices; there is no LinkedIn-specific classifier:

```sh
cat items.json | jev --mode classify \
  --profile-json "$(cat profiles/linkedin-example.json)" \
  --enrich-kept
```

Use `--max-items` and `--max-text-chars` to keep one Decisions request bounded.
`--enrich-kept` runs only after the profile keep rule. Raw items remain
parent-side.

### Research pipeline

A research config declares queries, allowed page tools, follow-ups, and a
classification profile:

```sh
jev --mode research \
  --config /absolute/path/to/research.json \
  --attach --auto-connect --pin-tab --jsonl --summary
```

The flow is:

```text
query → configured collection tools → dedupe
     → configured detail follow-ups → one Jev batch per bounded batch
     → keep rule → optional parent-side enrichment
```

A `followUps` entry is generic:

```json
{
  "name": "detail",
  "targetField": "profile_urls",
  "outputField": "detail_evidence",
  "when": { "missingAny": ["location", "detail_evidence"] },
  "tools": ["collect_detail"],
  "allowedHosts": ["example.com"],
  "maxTargets": 1
}
```

The core does not know what a profile, product page, document, or company is.
The config decides which URL field to open, which hosts are allowed, and which
helpers run. Profile `evidenceFields` tells the classifier which follow-up
fields to inspect. Profile-owned regex overrides can set labels for explicit
high-confidence policy cases without putting domain strings in core code.

## Scrolling and lazy loading

Scrolling is a cost knob. Each Jev loop step can create another Decisions
request, so do not use tiny fixed scrolls when the page loads a large batch.
Configure the helper instead:

```json
{
  "maxSteps": 8,
  "tools": {
    "scroll": {
      "description": "Scroll one large bounded viewport step; stop atEnd.",
      "path": "./helpers/scroll.js",
      "config": { "amountRatio": 0.9 }
    }
  }
}
```

Tool config is exposed as `globalThis.__JEV_TOOL_CONFIG__`. A helper should
return bounded progress such as `moved`, `atEnd`, `before`, `after`, `count`,
or `limited`. The next Jev decision receives a bounded result summary, so it
can stop when `atEnd` is true. Prefer this sequence:

```text
guard → expand → collect → large scroll → collect → large scroll → done
```

Use smaller steps only when the site has an aggressive intersection observer,
virtualized rows, or loses content when too much is skipped. Research results
also include aggregate `metrics`: `decisionSteps`, `browserActions`,
`toolCallsByName`, `followUpVisits`, `rawItems`, `uniqueItems`,
`classificationBatches`, `jevRequests`, and `durationMs`. JSONL adds the
per-step timings.

## Safe tool design

Tools are allowlisted in config and should:

- read only the current page;
- return bounded JSON;
- avoid navigation unless the follow-up config explicitly owns the target;
- avoid clicks, submit/apply/contact actions, and external links during raw collection;
- return progress flags instead of large DOM dumps.

## Installation and engine

Install globally:

```sh
npm install -g /path/to/jev-agent-browser
jev --help
```

The package bundles/resolves its `agent-browser` dependency. Node.js 24+ is
required. Use `--browser-command /path/to/compatible-agent-browser` only for a
compatible replacement. Pass native options with repeatable `--browser-arg`
or config `browserArgs`, for example `--browser-arg --profile --browser-arg
Default`. The wrapper reserves connection/session flags so they cannot conflict
with its own lifecycle. A formal multi-engine registry is intentionally not
needed until a second backend exists; the current injected browser surface is
the seam.

## Diagnostics

- `TYPESAFE_API_KEY` must be available in the environment for the default
  transport, never in source or chat. Set `apiKeyEnv` to
  `OPENROUTER_API_KEY` when pointing the same SDK at OpenRouter.
- `status: limit` means the configured bounded budget ended; it is resumable,
  not automatically an error.
- `status: blocked` or `status: error` requires inspecting the handoff.
- If `agent-browser` cannot be found, install the package or pass
  `--browser-command`.
- Compatible Decisions endpoints can be selected with `--endpoint` or
  `decision.endpoint` in config:

```json
{
  "decision": {
    "endpoint": "https://compatible.example/v1/systemone",
    "transport": "typesafe",
    "apiKeyEnv": "COMPATIBLE_API_KEY",
    "headers": { "x-provider": "compatible" }
  }
}
```

The default transport is the official `@typesafe-ai/sdk`; its endpoint is
configurable for compatible TypeSafe services and OpenRouter's
`/api/alpha/decisions` endpoint. Set `apiKeyEnv` for the selected provider.
Use `decision.transport: "fetch"` only when bypassing the SDK is intentional.
Library callers may inject the SDK's `fetch` implementation through
`fetchImpl`, or inject another provider through `decide`.
- Use `--jsonl` for timings and machine-readable events.
