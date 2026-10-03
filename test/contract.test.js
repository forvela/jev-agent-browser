import test from 'node:test';
import assert from 'node:assert/strict';
import { actionArgs } from '../src/browser.js';
import { buildDecisionRequest, parseDecisionResponse } from '../src/decision.js';
import { normalizeInputs, validateUrl } from '../src/contracts.js';
import { resumeLoop, runLoop } from '../src/loop.js';

test('parent goal inputs compile into a navigation action without an LLM compiler', async () => {
  let action;
  const result = await runLoop({
    goal: 'Открой Фейсбук точка ком',
    inputs: [{ key: 'destination', kind: 'url', value: 'https://facebook.com' }],
    browser: { snapshot: async () => ({ url: 'https://google.com', snapshot: 'home', refs: {} }), action: async (...args) => { action = args; } },
    decide: async ({ request }) => {
      assert.deepEqual(request.state.inputs, [{ key: 'destination', kind: 'url', secret: false }]);
      return { operation: 'NAVIGATE', inputKey: 'destination', goal_reached: 0, stuck: 0 };
    },
    maxSteps: 1,
  });
  assert.equal(result.status, 'limit');
  assert.deepEqual(action, ['NAVIGATE', undefined, { text: undefined, selectValue: undefined, pressKey: undefined, url: 'https://facebook.com' }]);
});

test('semantic target hints resolve a live field without caller DOM refs', async () => {
  let action;
  await runLoop({
    goal: 'Найди пиццу',
    inputs: [{ key: 'query', kind: 'text', value: 'пицца доставка', targetHint: 'search field' }],
    browser: { snapshot: async () => ({ url: 'https://google.com', snapshot: 'search', refs: { '@search': { role: 'combobox', name: 'Search' } } }), action: async (...args) => { action = args; } },
    decide: async () => ({ operation: 'TYPE', inputKey: 'query', target: 'none_of_the_above', goal_reached: 0, stuck: 0 }),
    maxSteps: 1,
  });
  assert.equal(action[0], 'TYPE');
  assert.equal(action[1], '@search');
  assert.equal(action[2].text, 'пицца доставка');
});

test('missing destination returns a resumable handoff and resume uses fresh refs', async () => {
  let calls = 0;
  const browser = {
    snapshot: async () => ({ url: 'https://google.com', snapshot: 'page', refs: {} }),
    action: async () => {},
  };
  const first = await runLoop({ goal: 'Открой сайт', browser, decide: async () => ({ operation: 'NAVIGATE', goal_reached: 0, stuck: 0 }), maxSteps: 1, sessionId: 'voice-1' });
  assert.equal(first.status, 'input-required');
  assert.equal(first.handoff.inputRequired.key, 'destination');
  assert.equal(first.handoff.resumable, true);
  const resumed = await resumeLoop({
    continuation: first.handoff.continuation,
    inputs: [{ key: 'destination', kind: 'url', value: 'https://example.com' }],
    browser,
    decide: async () => { calls += 1; return { operation: 'NAVIGATE', inputKey: 'destination', goal_reached: 0, stuck: 0 }; },
    maxSteps: 1,
  });
  assert.equal(calls, 1);
  assert.equal(resumed.status, 'limit');
});

test('secret inputs are never sent to decisions or traces', async () => {
  let request;
  const result = await runLoop({
    goal: 'enter password',
    inputs: [{ key: 'password', kind: 'secret', value: 'super-secret', targetHint: 'password field' }],
    browser: { snapshot: async () => ({ url: 'x', snapshot: 'password super-secret', refs: { '@password': { role: 'textbox', name: 'Password' } } }), action: async () => ({ value: 'super-secret' }) },
    decide: async ({ request: received }) => { request = received; return { operation: 'TYPE', target: '@password', inputKey: 'password', goal_reached: 0, stuck: 0 }; },
    maxSteps: 1,
  });
  const serialized = JSON.stringify({ request, result });
  assert.equal(serialized.includes('super-secret'), false);
});

test('unsafe destinations are rejected before browser execution', () => {
  assert.throws(() => validateUrl('javascript:alert(1)', 'destination'), /http or https/);
  assert.throws(() => normalizeInputs({ inputs: [{ key: 'destination', kind: 'url', value: 'file:///tmp/a' }] }), /http or https/);
  assert.deepEqual(actionArgs('NAVIGATE', undefined, { url: 'https://example.com' }), ['open', 'https://example.com']);
});

test('stale tabs get one bounded rebind attempt', async () => {
  let snapshots = 0;
  let rebinds = 0;
  const result = await runLoop({
    goal: 'finish',
    browser: {
      snapshot: async () => { snapshots += 1; const error = new Error('bound tab is gone'); error.code = 'TAB_GONE'; throw error; },
      rebind: async () => { rebinds += 1; return { url: 'https://example.com', snapshot: 'ready', refs: {} }; },
    },
    decide: async () => ({ operation: 'DONE', goal_reached: 0.9, stuck: 0 }),
    maxSteps: 1,
  });
  assert.equal(snapshots, 1);
  assert.equal(rebinds, 1);
  assert.equal(result.status, 'success');
});

test('cancellation stops actions and calls cleanup', async () => {
  const controller = new AbortController();
  let cleaned = false;
  const resultPromise = runLoop({
    goal: 'wait',
    signal: controller.signal,
    browser: {
      snapshot: async () => ({ url: 'x', snapshot: 'ready', refs: {} }),
      action: async (_operation, _target, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { const error = new Error('cancelled'); error.code = 'ABORT_ERR'; reject(error); }, { once: true })),
      cleanup: async () => { cleaned = true; },
    },
    decide: async () => ({ operation: 'WAIT', goal_reached: 0, stuck: 0 }),
    maxSteps: 2,
  });
  setTimeout(() => controller.abort(), 5);
  const result = await resultPromise;
  assert.equal(result.status, 'cancelled');
  assert.equal(cleaned, true);
});

test('browser timeout is distinct and cleans up', async () => {
  let cleaned = false;
  const result = await runLoop({
    goal: 'wait',
    browser: {
      snapshot: async () => ({ url: 'x', snapshot: 'ready', refs: {} }),
      action: async () => { const error = new Error('timed out'); error.code = 'TIMEOUT'; throw error; },
      cleanup: async () => { cleaned = true; },
    },
    decide: async () => ({ operation: 'WAIT', goal_reached: 0, stuck: 0 }),
    maxSteps: 1,
    maxRecoveryAttempts: 0,
  });
  assert.equal(result.status, 'timeout');
  assert.equal(cleaned, true);
});

test('decision contract exposes only finite input choices', () => {
  const request = buildDecisionRequest({
    goal: 'search', observation: { url: 'https://google.com', snapshot: 'Search', refs: { '@search': { role: 'combobox', name: 'Search' } } },
    refs: { '@search': { role: 'combobox', name: 'Search' } },
    inputs: normalizeInputs({ inputs: [{ key: 'query', kind: 'text', value: 'pizza', targetHint: 'search field' }] }),
  });
  assert.equal(request.state.inputs[0].key, 'query');
  assert.equal(Object.hasOwn(request.questions.type_input.criteria, 'query'), true);
  assert.equal(Object.hasOwn(request.questions.type_input.criteria, 'pizza'), false);
  const parsed = parseDecisionResponse({ answers: { operation: { choice: 'TYPE' }, type_target: { choice: '@search' }, type_input: { choice: 'query' }, goal_reached: { noul: 0 }, stuck: { noul: 0 } } });
  assert.equal(parsed.inputKey, 'query');
});
