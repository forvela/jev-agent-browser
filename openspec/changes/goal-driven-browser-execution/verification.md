# Verification evidence

Date: 2026-10-03

## Static and contract gates

- `node --check src/*.js` — PASS
- `openspec validate goal-driven-browser-execution --type change --strict --no-interactive` — PASS (`Change ... is valid`)
- `npm test` — PASS, 58 tests
- `npm run test:unit` — PASS, 46 tests
- `npm run test:contract` — PASS, 9 tests
- `npm run test:jsonl` — PASS, 3 tests
- `npm run smoke` — PASS; fixture loaded and six interactive refs returned

## Live browser navigation smoke

Command used a real `AgentBrowser` session and no model/compiler:

```sh
node --input-type=module <<'EOF'
import { AgentBrowser } from './src/browser.js';
const browser = new AgentBrowser({session:`jev-live-${process.pid}`, timeoutMs:30000});
const results=[];
try {
  for (const url of ['https://www.google.com','https://example.com','https://facebook.com']) {
    try { await browser.open(url); const page=await browser.snapshot(); results.push({requested:url,url:page.url,hasSnapshot:Boolean(page.snapshot)}); }
    catch (error) { results.push({requested:url,error:error.message}); }
  }
} finally { try { await browser.close(); } catch {} }
console.log(JSON.stringify(results));
EOF
```

Result:

```json
[
  {"requested":"https://www.google.com","url":"https://www.google.com/","hasSnapshot":true},
  {"requested":"https://example.com","url":"https://example.com/","hasSnapshot":true},
  {"requested":"https://facebook.com","url":"https://www.facebook.com/","hasSnapshot":true}
]
```

## Live Jev navigation action smoke

A real browser session executed a supplied `destination` input through `runLoop` with an injected finite decision seam:

```json
{"status":"success","reason":"goal-reached","currentUrl":"https://example.com/","steps":1}
```

No LLM was bundled or used by the Jev library during this smoke.
