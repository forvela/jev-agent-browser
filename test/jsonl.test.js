import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runLoop } from '../src/loop.js';

test('JSONL-compatible events are ordered and match the terminal result', async () => {
  const events = [];
  const result = await runLoop({
    goal: 'navigate',
    inputs: [{ key: 'destination', kind: 'url', value: 'https://example.com' }],
    browser: { snapshot: async () => ({ url: 'https://example.com', snapshot: 'page', refs: {} }), action: async () => ({ ok: true }) },
    decide: async () => ({ operation: 'NAVIGATE', inputKey: 'destination', goal_reached: 0.9, stuck: 0 }),
    onEvent: (event) => { JSON.stringify(event); events.push(event); },
    maxSteps: 1,
  });
  assert.deepEqual(events.map((event) => event.type), ['start', 'step', 'handoff']);
  assert.equal(events.at(-1).handoff.status, result.status);
  for (const event of events) assert.doesNotThrow(() => JSON.stringify(event));
});

test('CLI emits a machine-readable JSONL error envelope', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const result = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--jsonl', '--goal', 'inspect'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  const line = result.stdout.trim().split('\n').at(-1);
  assert.deepEqual(JSON.parse(line).type, 'error');
});

test('JSONL handoff distinguishes missing input from generic errors', async () => {
  const events = [];
  const result = await runLoop({
    goal: 'navigate',
    browser: { snapshot: async () => ({ url: 'https://example.com', snapshot: 'page', refs: {} }) },
    decide: async () => ({ operation: 'NAVIGATE', goal_reached: 0, stuck: 0 }),
    onEvent: (event) => events.push(event),
    maxSteps: 1,
  });
  assert.equal(result.status, 'input-required');
  assert.equal(events.at(-1).handoff.inputRequired.key, 'destination');
  assert.equal(events.at(-1).handoff.parentDecisionRequired, true);
});
