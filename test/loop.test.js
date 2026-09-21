import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentBrowser, actionArgs, browserCommandArgs, normalizeSnapshot } from '../src/browser.js';
import { applyCliConfig, parseArgs, runSkillsCommand, validateOptions } from '../src/cli.js';
import { buildCriteria, buildDecisionRequest, parseDecisionResponse, requestDecision } from '../src/decision.js';
import { normalizeFieldKey, runLoop } from '../src/loop.js';
import { applyProfileOverrides, buildBatchClassificationRequest, parseBatchClassificationResponse } from '../src/classifier.js';
import { enrichContactEvidence, keepClassifiedItems } from '../src/research.js';
import { allowedFollowUpTarget, loadResearchConfig, runResearch } from '../src/research-runner.js';
import * as publicApi from '../src/index.js';

test('applies decision defaults from a CLI config without storing the key', () => {
  const options = applyCliConfig(parseArgs(['--goal', 'inspect']), {
    decision: { endpoint: 'https://openrouter.ai/api/alpha/decisions', apiKeyEnv: 'OPENROUTER_API_KEY', model: '~typesafe/jev-latest' },
    maxSteps: 9,
  });
  assert.equal(options.endpoint, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(options.apikeyenv, 'OPENROUTER_API_KEY');
  assert.equal(options.model, '~typesafe/jev-latest');
  assert.equal(options.maxSteps, 9);
});

test('exposes a small programmatic API entrypoint', () => {
  assert.equal(publicApi.AgentBrowser, undefined);
  assert.equal(typeof publicApi.runLoop, 'function');
  assert.equal(typeof publicApi.runResearch, 'function');
  assert.equal(typeof publicApi.requestDecision, 'function');
});

test('builds agent-browser commands for an existing CDP session', () => {
  assert.deepEqual(browserCommandArgs({ session: 'youtube', connectionArgs: ['--cdp', '9222'], args: ['snapshot', '--json'] }), [
    '--session', 'youtube', '--cdp', '9222', 'snapshot', '--json',
  ]);
  assert.deepEqual(browserCommandArgs({ session: 'youtube', connectionArgs: ['--auto-connect', '--pin-tab'], browserArgs: ['--profile', 'Default', '--engine', 'chrome'], args: ['snapshot'] }), [
    '--auto-connect', '--pin-tab', '--profile', 'Default', '--engine', 'chrome', 'snapshot',
  ]);
  assert.throws(() => new AgentBrowser({ browserArgs: ['--cdp', '9222'] }), /wrapper-owned/);
});

test('exposes the installed agent-facing skill', async () => {
  assert.equal(await runSkillsCommand(['list']), 'core\n');
  assert.match(await runSkillsCommand(['get', 'core', '--full']), /Scrolling and lazy loading/);
  assert.match((await runSkillsCommand(['path', 'core'])).trim(), /skills\/core\.md$/);
});

test('parses and validates attach mode', () => {
  const options = parseArgs(['--attach', '--auto-connect', '--jsonl', '--browser-arg', '--profile', '--browser-arg', 'Default', '--api-key-env', 'JEV_KEY', '--input-values-json', '{"email":"user@example.com"}', '--goal', 'inspect current tab']);
  assert.equal(options.attach, true);
  assert.equal(options.jsonl, true);
  assert.deepEqual(options.inputValues, { email: 'user@example.com' });
  assert.equal(options.autoConnect, true);
  assert.deepEqual(options.browserArgs, ['--profile', 'Default']);
  assert.equal(options.apikeyenv, 'JEV_KEY');
  assert.doesNotThrow(() => validateOptions(options));
  assert.throws(() => validateOptions({ attach: true, goal: 'inspect' }), /requires --auto-connect or --cdp/);
  assert.throws(() => validateOptions({ goal: 'inspect' }), /--url or --attach is required/);
});

test('requests the full JSON snapshot so static content is observable', async () => {
  const browser = new AgentBrowser();
  let args;
  browser.run = async (received) => {
    args = received;
    return { stdout: JSON.stringify({ data: { origin: 'https://example.test', snapshot: 'paragraph done', refs: { e1: { name: 'Go', role: 'button' } } } }) };
  };
  const result = await browser.snapshot();
  assert.deepEqual(args, ['snapshot', '--json']);
  assert.equal(result.snapshot, 'paragraph done');
  assert.deepEqual(result.refs, { '@e1': { name: 'Go', role: 'button' } });
});

test('runs a JSON page helper through agent-browser eval stdin', async () => {
  const browser = new AgentBrowser();
  let received;
  browser.run = async (args, options) => {
    received = { args, options };
    return { stdout: JSON.stringify({ data: { result: [{ id: 1 }] } }) };
  };
  assert.deepEqual(await browser.eval('(() => [{ id: 1 }])()'), [{ id: 1 }]);
  assert.deepEqual(received.args, ['eval', '--json', '--stdin']);
  assert.equal(received.options.stdin, '(() => [{ id: 1 }])()');
});

test('passes configured tool values without adding tool-specific core logic', async () => {
  const browser = new AgentBrowser({ tools: { scroll: { source: '(() => globalThis.__JEV_TOOL_CONFIG__)()', config: { amountRatio: 0.9 } } } });
  let source;
  browser.eval = async (value) => { source = value; return { amountRatio: globalThis.__JEV_TOOL_CONFIG__?.amountRatio }; };
  await browser.runTool('scroll');
  assert.match(source, /__JEV_TOOL_CONFIG__/);
  assert.match(source, /amountRatio/);
});

test('normalizes agent-browser snapshot refs to executable @refs', () => {
  const result = normalizeSnapshot({ success: true, data: { origin: 'https://example.test', snapshot: '- button "Go" [ref=e1]', refs: { e1: { name: 'Go', role: 'button' } } } });
  assert.equal(result.url, 'https://example.test');
  assert.deepEqual(result.refs, { '@e1': { name: 'Go', role: 'button' } });
});

test('criteria gate explicit inputs and filters operation targets by role', () => {
  const without = buildCriteria({
    '@button': { name: 'Go', role: 'button' },
    '@textbox': { name: 'Name', role: 'textbox' },
    '@select': { name: 'Color', role: 'combobox' },
    '@option': { name: 'Green', role: 'option' },
  });
  assert.deepEqual(Object.keys(without.operation.criteria), ['CLICK', 'SCROLL_UP', 'SCROLL_DOWN', 'BACK', 'WAIT', 'DONE']);
  assert.deepEqual(Object.keys(without.click_target.criteria), ['none_of_the_above', '@button']);
  assert.deepEqual(Object.keys(without.type_target.criteria), ['none_of_the_above', '@textbox', '@select']);
  assert.deepEqual(Object.keys(without.select_target.criteria), ['none_of_the_above', '@select']);
  const withInputs = buildCriteria({}, { text: 'Ada', selectValue: 'green' });
  assert.ok(Object.hasOwn(withInputs.operation.criteria, 'TYPE'));
  assert.ok(Object.hasOwn(withInputs.operation.criteria, 'SELECT'));
});

test('defers ambiguous content cards until filter controls are complete', () => {
  const refs = {
    '@task': { name: 'Text Classification', role: 'link' },
    '@card': { name: 'Text Classification • 0.4B • Updated today • 250', role: 'link' },
    '@sort': { name: 'Sort: Trending', role: 'button' },
  };
  const goal = 'filter tasks, sort downloads, choose a library, then open a model card';
  const initial = buildCriteria(refs, { goal, history: [] });
  assert.deepEqual(Object.keys(initial.click_target.criteria), ['none_of_the_above', '@task', '@sort']);
  const later = buildCriteria(refs, { goal, history: [{ operation: 'CLICK' }, { operation: 'CLICK' }, { operation: 'CLICK' }, { operation: 'CLICK' }] });
  assert.ok(Object.hasOwn(later.click_target.criteria, '@card'));
});

test('builds the exact Decisions API request shape', () => {
  assert.deepEqual(buildDecisionRequest({
    goal: 'click Go',
    observation: { url: 'https://example.test', snapshot: 'button Go' },
    refs: { '@e1': { name: 'Go', role: 'button' } },
  }), {
    model: 'jev-latest',
    state: { goal: 'click Go', url: 'https://example.test', snapshot: 'button Go', refs: { '@e1': { name: 'Go', role: 'button' } } },
    questions: {
      operation: {
        type: 'choice',
        instructions: 'Choose the next browser operation.',
        criteria: {
          CLICK: 'Choose a current control, filter, menu, pagination link, or clearly requested content target. Prefer controls over content cards and do not repeat an already executed click.', SCROLL_UP: 'Execute SCROLL_UP.', SCROLL_DOWN: 'Execute SCROLL_DOWN.',
          BACK: 'Execute BACK.', WAIT: 'Execute WAIT.', DONE: 'Execute DONE.',
        },
      },
      click_target: {
        type: 'choice',
        instructions: 'Choose the current browser ref targeted by the operation. Prefer exact filter/menu controls over similarly named result cards.',
        criteria: { none_of_the_above: 'No current ref is an appropriate target.', '@e1': 'button/control/Go' },
      },
      type_target: {
        type: 'choice',
        instructions: 'Choose the current browser ref targeted by the operation. Prefer exact filter/menu controls over similarly named result cards.',
        criteria: { none_of_the_above: 'No current ref is an appropriate target.' },
      },
      select_target: {
        type: 'choice',
        instructions: 'Choose the current browser ref targeted by the operation. Prefer exact filter/menu controls over similarly named result cards.',
        criteria: { none_of_the_above: 'No current ref is an appropriate target.' },
      },
      goal_reached: {
        type: 'noul', instructions: 'Estimate whether the requested goal has been reached.',
        criteria: { true: 'The requested goal is reached.', false: 'The requested goal is not reached.' },
      },
      stuck: {
        type: 'noul', instructions: 'Estimate whether the browser agent is stuck.',
        criteria: { true: 'The agent cannot safely make progress.', false: 'The agent can safely make progress.' },
      },
    },
  });
});

test('includes bounded parent context and action history', () => {
  const request = buildDecisionRequest({
    goal: 'complete subtask', plan: 'Search then inspect a model', subtask: 'Open the first result',
    observation: { url: 'x', snapshot: 's' }, refs: {},
    history: [{ step: 1, operation: 'TYPE', signature: 'TYPE|combobox|Search|@e1' }],
  });
  assert.equal(request.state.plan, 'Search then inspect a model');
  assert.equal(request.state.subtask, 'Open the first result');
  assert.equal(request.state.history[0].operation, 'TYPE');
});

test('bounds large page context before sending a Decisions request', () => {
  const request = buildDecisionRequest({
    goal: 'inspect', observation: { url: 'x', snapshot: '1234567890' },
    refs: { '@e1': { role: 'link' }, '@e2': { role: 'button' } }, maxSnapshotChars: 5, maxRefs: 1,
  });
  assert.equal(request.state.snapshot, '12345\n[ snapshot truncated ]');
  assert.deepEqual(Object.keys(request.state.refs), ['@e1']);
  assert.deepEqual(Object.keys(request.questions.click_target.criteria), ['none_of_the_above', '@e1']);
});

test('parses operation-specific Decisions targets and rejects malformed responses', () => {
  const response = { model: '~typesafe/jev-latest', answers: {
    operation: { type: 'choice', choice: 'CLICK', probabilities: { CLICK: 0.97 }, confidence: 0.97 },
    click_target: { type: 'choice', choice: '@e1', probabilities: { '@e1': 0.99 }, confidence: 0.99 },
    goal_reached: { type: 'noul', noul: 0.1 },
    stuck: { type: 'noul', noul: 0.2 },
  }, usage: { input_tokens: 1, output_tokens: 1 } };
  assert.deepEqual(parseDecisionResponse(response), {
    operation: 'CLICK', target: '@e1', goal_reached: 0.1, stuck: 0.2,
    probabilities: { operation: 0.97, target: 0.99, goal_reached: undefined, stuck: undefined },
    raw: response,
  });
  assert.throws(() => parseDecisionResponse({ answers: { operation: { type: 'choice', choice: 'NOPE' } } }), /supported operation/);
});

test('select decisions use the combobox target rather than an option ref', async () => {
  const response = { answers: {
    operation: { type: 'choice', choice: 'SELECT' },
    select_target: { type: 'choice', choice: '@e2' },
    goal_reached: { type: 'noul', noul: 0 },
    stuck: { type: 'noul', noul: 0 },
  } };
  assert.equal(parseDecisionResponse(response).target, '@e2');
  let action;
  const result = await runLoop({
    goal: 'choose green',
    selectValue: 'green',
    browser: {
      snapshot: async () => ({ url: 'x', snapshot: 's', refs: { '@e2': { role: 'combobox' }, '@e5': { role: 'option' } } }),
      action: async (...args) => { action = args; },
    },
    decide: async () => parseDecisionResponse(response),
    maxSteps: 1,
  });
  assert.deepEqual(action, ['SELECT', '@e2', { text: undefined, selectValue: 'green', pressKey: undefined }]);
  assert.equal(result.steps, 1);
});

test('decision client sends auth, exact request, parses response, and times out', async () => {
  const request = buildDecisionRequest({ goal: 'finish', observation: { url: 'x', snapshot: 's' }, refs: {} });
  let received;
  const decision = await requestDecision({ apiKey: 'secret', request, endpoint: 'https://decisions.test', headers: { 'x-compatible-provider': 'test' }, transport: 'fetch', fetchImpl: async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ model: '~typesafe/jev-latest', answers: {
      operation: { type: 'choice', choice: 'DONE', probabilities: { DONE: 1 }, confidence: 1 },
      goal_reached: { type: 'noul', noul: 0.9 }, stuck: { type: 'noul', noul: 0 },
    }, usage: {} }), { status: 200 });
  } });
  assert.equal(decision.operation, 'DONE');
  assert.equal(received.options.headers.authorization, 'Bearer secret');
  assert.equal(received.options.headers['x-compatible-provider'], 'test');
  assert.deepEqual(JSON.parse(received.options.body), request);
  await assert.rejects(() => requestDecision({ apiKey: 'secret', request: {}, transport: 'fetch', timeoutMs: 1, fetchImpl: (_u, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) }), /timed out/);
});

test('uses the native TypeSafe SDK by default and preserves an injectable fetch seam', async () => {
  let received;
  const request = { model: 'jev', state: {}, questions: { operation: { type: 'choice', criteria: { DONE: 'done' } } } };
  const result = await requestDecision({
    apiKey: 'secret',
    request,
    sdkClient: { systemOne: async (body, options) => { received = { body, options }; return { answers: { operation: { choice: 'DONE' }, goal_reached: { noul: 0.9 }, stuck: { noul: 0 } } }; } },
  });
  assert.equal(result.operation, 'DONE');
  assert.deepEqual(received.body, request);
});

test('the native SDK can target a compatible custom endpoint path', async () => {
  let received;
  const result = await requestDecision({
    apiKey: 'secret',
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    request: { model: '~typesafe/jev-latest', state: {}, questions: { operation: { type: 'choice', criteria: { DONE: 'done' } } } },
    fetchImpl: async (url, options) => {
      received = { url, options };
      return new Response(JSON.stringify({ answers: { operation: { choice: 'DONE' }, goal_reached: { noul: 0.9 }, stuck: { noul: 0 } } }), { status: 200 });
    },
  });
  assert.equal(result.operation, 'DONE');
  assert.equal(received.url, 'https://openrouter.ai/api/alpha/decisions');
  assert.match(received.options.headers.Authorization, /^Bearer secret$/);
});

test('loop emits ordered stream events', async () => {
  const events = [];
  const result = await runLoop({
    goal: 'finish',
    browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: {} }) },
    decide: async () => ({ operation: 'DONE', goal_reached: 0.9, stuck: 0 }),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(events.map((event) => event.type), ['start', 'step', 'handoff']);
  for (const event of events) assert.doesNotThrow(() => JSON.stringify(event));
});

test('loop carries bounded tool progress into the next decision', async () => {
  let request;
  let calls = 0;
  await runLoop({
    goal: 'collect',
    tools: { scroll: { description: 'Scroll' } },
    browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: {} }), action: async () => ({ moved: true, atEnd: true }) },
    decide: async ({ request: received }) => { request = received; calls += 1; return calls === 1 ? { operation: 'RUN_TOOL', target: 'scroll', goal_reached: 0, stuck: 0 } : { operation: 'DONE', goal_reached: 0.9, stuck: 0 }; },
    maxSteps: 2,
  });
  assert.deepEqual(request.state.history[0].result, { type: 'object', moved: true, atEnd: true });
});

test('loop accepts explicit stop-after-back completion evidence', async () => {
  let calls = 0;
  const result = await runLoop({
    goal: 'Inspect the model card, go back to the filtered list, then stop.',
    browser: {
      snapshot: async () => ({ url: 'https://example.test/models', snapshot: 'filtered models', refs: {} }),
      action: async () => {},
    },
    decide: async () => calls++ === 0
      ? { operation: 'BACK', goal_reached: 0.1, stuck: 0 }
      : { operation: 'DONE', goal_reached: 0.65, stuck: 0 },
    maxSteps: 2,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.steps, 1);
});

test('loop stops successfully before executing when goal confidence is high', async () => {
  let actions = 0;
  const result = await runLoop({ goal: 'finish', browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: {} }), action: async () => { actions += 1; } }, decide: async () => ({ operation: 'DONE', goal_reached: 0.8, stuck: 0 }) });
  assert.equal(result.status, 'success');
  assert.equal(result.steps, 0);
  assert.equal(actions, 0);
});

test('loop re-reads after a transient stale browser ref', async () => {
  let decisions = 0;
  const result = await runLoop({
    goal: 'click',
    browser: {
      snapshot: async () => ({ url: 'x', snapshot: 's', refs: { '@new': {} } }),
      action: async () => { throw new Error('Could not locate element with role=button'); },
    },
    decide: async () => {
      decisions += 1;
      if (decisions === 1) return { operation: 'CLICK', target: '@new', goal_reached: 0, stuck: 0 };
      return { operation: 'DONE', goal_reached: 0.9, stuck: 0 };
    },
    maxSteps: 2,
  });
  assert.equal(result.status, 'success');
  assert.equal(result.steps, 0);
  assert.equal(result.trace[0].action.executed, false);
});

test('loop hands control back after repeated equivalent actions', async () => {
  let actions = 0;
  const result = await runLoop({
    goal: 'scroll once',
    browser: {
      snapshot: async () => ({ url: 'x', snapshot: 's', refs: {} }),
      action: async () => { actions += 1; },
    },
    decide: async () => ({ operation: 'SCROLL_DOWN', goal_reached: 0, stuck: 0 }),
    maxSteps: 6,
    repeatLimit: 2,
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'loop-detected');
  assert.equal(result.steps, 1);
  assert.equal(actions, 1);
  assert.equal(result.handoff.parentDecisionRequired, true);
  assert.ok(result.handoff.recentActions.length >= 1);
});

test('loop detects the same semantic target across regenerated refs', async () => {
  let call = 0;
  const result = await runLoop({
    goal: 'click once',
    browser: {
      snapshot: async () => ({ url: 'x', snapshot: 's', refs: { [`@e${++call}`]: { role: 'button', name: 'Continue' } } }),
      action: async () => {},
    },
    decide: async ({ request }) => ({ operation: 'CLICK', target: Object.keys(request.state.refs).at(-1), goal_reached: 0, stuck: 0 }),
    maxSteps: 5,
    repeatLimit: 2,
  });
  assert.equal(result.reason, 'loop-detected');
  assert.equal(result.steps, 1);
});

test('loop rejects stale and none-of-the-above targets without action', async () => {
  let actions = 0;
  for (const target of ['@old', 'none_of_the_above']) {
    const result = await runLoop({ goal: 'click', browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: { '@new': {} } }), action: async () => { actions += 1; } }, decide: async () => ({ operation: 'CLICK', target, goal_reached: 0, stuck: 0 }) });
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'recovery-exhausted');
  }
  assert.equal(actions, 0);
});

test('action mapping uses supported agent-browser commands', () => {
  assert.deepEqual(actionArgs('CLICK', '@e1'), ['click', '@e1']);
  assert.deepEqual(actionArgs('TYPE', '@e1', { text: 'hello' }), ['fill', '@e1', 'hello']);
  assert.deepEqual(actionArgs('SELECT', '@e1', { selectValue: 'blue' }), ['select', '@e1', 'blue']);
  assert.deepEqual(actionArgs('PRESS', undefined, { pressKey: 'Enter' }), ['press', 'Enter']);
  assert.deepEqual(actionArgs('SCROLL_DOWN'), ['scroll', 'down']);
});

test('PRESS is offered only with an explicit key', () => {
  assert.equal(Object.hasOwn(buildCriteria({}, {}).operation.criteria, 'PRESS'), false);
  assert.equal(Object.hasOwn(buildCriteria({}, { pressKey: 'Enter' }).operation.criteria, 'PRESS'), true);
});

test('unresolved TYPE decisions request generic parent input', async () => {
  const result = await runLoop({
    goal: 'fill the form',
    browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: { '@e1': { role: 'textbox', name: 'Email' } } }) },
    decide: async () => ({ operation: 'TYPE', target: '@e1', goal_reached: 0, stuck: 0 }),
    maxSteps: 1,
  });
  assert.equal(result.status, 'input-required');
  assert.deepEqual(result.handoff.inputRequired, { operation: 'TYPE', ref: '@e1', key: 'textbox:email', name: 'Email', role: 'textbox' });
  assert.equal(result.handoff.parentDecisionRequired, true);
});

test('parent input values are resolved locally and redacted from Decisions state', async () => {
  let request;
  let action;
  const result = await runLoop({
    goal: 'fill the form',
    inputValues: { email: 'user@example.com' },
    browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: { '@e1': { role: 'textbox', name: 'Email' } } }), action: async (...args) => { action = args; } },
    decide: async ({ request: received }) => { request = received; return { operation: 'TYPE', target: '@e1', goal_reached: 0, stuck: 0 }; },
    maxSteps: 1,
  });
  assert.equal(result.status, 'limit');
  assert.equal(action[2].text, 'user@example.com');
  assert.equal(Object.hasOwn(request.state, 'inputValues'), false);
});

test('parent values can resolve a generic select field locally', async () => {
  let action;
  await runLoop({
    goal: 'choose a value', inputValues: { color: 'green' },
    browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: { '@e1': { role: 'combobox', name: 'Color' } } }), action: async (...args) => { action = args; } },
    decide: async () => ({ operation: 'SELECT', target: '@e1', goal_reached: 0, stuck: 0 }),
    maxSteps: 1,
  });
  assert.equal(action[2].selectValue, 'green');
});

test('field keys normalize generic accessible names', () => {
  assert.equal(normalizeFieldKey({ role: 'textbox', name: '  Full   Name ' }), 'textbox:full name');
});

test('builds one redacted typed classification request from any profile', () => {
  const profile = { evidenceFields: ['profile_evidence'], dimensions: { fit: { instructions: 'Classify fit.', choices: { keep: 'Keep', reject: 'Reject' } }, kind: { instructions: 'Classify kind.', choices: { job: 'Job', article: 'Article' } } } };
  const request = buildBatchClassificationRequest({ goal: 'triage evidence', profile, candidates: [{ author: 'Recruiter', title: 'Senior React AI Engineer', text: 'Email secret@example.com call +1 555 123 4567 https://example.com/apply', emails: ['secret@example.com'], apply_urls: ['https://example.com/apply'], profile_evidence: { location: 'India', text: 'Profile email profile@example.com https://profile.test' } }] });
  const serialized = JSON.stringify(request);
  assert.equal(request.state.candidates.length, 1);
  assert.equal(Object.hasOwn(request.state.candidates[0], 'emails'), false);
  assert.equal(Object.hasOwn(request.state.candidates[0], 'apply_urls'), false);
  assert.equal(serialized.includes('secret@example.com'), false);
  assert.equal(serialized.includes('profile@example.com'), false);
  assert.equal(serialized.includes('https://example.com/apply'), false);
  assert.equal(request.state.candidates[0].evidence.profile_evidence.location, 'India');
  assert.equal(Object.keys(request.questions).length, 2);
  assert.equal(request.questions.candidate_0_fit.type, 'choice');
});

test('profile-owned overrides can reject explicit location or intent evidence', () => {
  const profile = { overrides: [{ when: { field: 'profile_evidence.profile_text', matches: 'India|Индия' }, set: { labels: { geo_fit: 'local_only', recommendation: 'reject' } }, reason: 'incompatible-location' }] };
  const result = applyProfileOverrides([{ profile_evidence: { profile_text: 'Губби, Карнатака, Индия' } }], [{ status: 'classified', labels: { geo_fit: 'poland_eu_explicit', recommendation: 'verify' } }], profile);
  assert.deepEqual(result[0].labels, { geo_fit: 'local_only', recommendation: 'reject' });
  assert.deepEqual(result[0].policyReasons, ['incompatible-location']);
});

test('validates profile-defined answers and preserves malformed results', () => {
  const profile = { dimensions: { fit: { instructions: 'Classify fit.', choices: { keep: 'Keep', reject: 'Reject' } }, kind: { instructions: 'Classify kind.', choices: { job: 'Job', article: 'Article' } } } };
  const complete = { candidate_0_fit: { choice: 'keep' }, candidate_0_kind: { choice: 'job' } };
  assert.deepEqual(parseBatchClassificationResponse({ answers: complete }, profile, 1), [{ index: 0, status: 'classified', labels: { fit: 'keep', kind: 'job' } }]);
  const malformed = parseBatchClassificationResponse({ answers: { candidate_0_fit: { choice: 'apply-now' } } }, profile, 1);
  assert.equal(malformed[0].status, 'classification-error');
  assert.ok(malformed[0].errors.includes('kind:missing'));
});

test('keeps classification separate from post-filter enrichment', () => {
  const profile = { keep: { dimension: 'decision', choices: ['retain', 'verify'] } };
  const items = [{ id: 'good', text: 'Email good@example.com apply https://company.test/apply' }, { id: 'bad', text: 'bad@example.com' }];
  const classifications = [{ status: 'classified', labels: { decision: 'retain' } }, { status: 'classified', labels: { decision: 'reject' } }];
  assert.deepEqual(keepClassifiedItems(items, classifications, profile), [items[0]]);
  assert.deepEqual(enrichContactEvidence(items[0]), { emails: ['good@example.com'], phones: [], urls: ['https://company.test/apply'] });
});

test('Jev can trigger an allowlisted browser tool through the main loop', async () => {
  let request;
  let action;
  const result = await runLoop({
    goal: 'collect evidence',
    tools: { collect: { description: 'Collect visible evidence.' } },
    browser: { snapshot: async () => ({ url: 'x', snapshot: 's', refs: {} }), action: async (...args) => { action = args; } },
    decide: async ({ request: received }) => { request = received; return { operation: 'RUN_TOOL', target: 'collect', goal_reached: 0, stuck: 0 }; },
    maxSteps: 1,
  });
  assert.equal(request.questions.operation.criteria.RUN_TOOL, 'Execute one allowlisted page helper and inspect its bounded result.');
  assert.deepEqual(request.questions.tool_target.criteria, { collect: 'Collect visible evidence.' });
  assert.deepEqual(action, ['RUN_TOOL', 'collect', { text: undefined, selectValue: undefined, pressKey: undefined }]);
  assert.equal(result.steps, 1);
});

test('research mode runs configured tools before generic batch classification', async () => {
  let decisions = 0;
  const profile = { dimensions: { decision: { instructions: 'Keep relevant items.', choices: { retain: 'Retain', reject: 'Reject' } } }, keep: { dimension: 'decision', choices: ['retain'] } };
  const output = await runResearch({
    config: { profile, queries: [{ url: 'https://example.test' }], tools: { collect: { description: 'Collect', collect: true } }, maxSteps: 2, enrichKept: true },
    browser: { open: async () => {}, snapshot: async () => ({ url: 'https://example.test', snapshot: 's', refs: {} }), action: async () => [{ id: 'item-1', text: 'hello@example.test' }] },
    decide: async ({ request, parseResponse }) => parseResponse
      ? [{ index: 0, status: 'classified', labels: { decision: 'retain' } }]
      : decisions++ === 0 ? { operation: 'RUN_TOOL', target: 'collect', goal_reached: 0, stuck: 0 } : { operation: 'DONE', goal_reached: 0.9, stuck: 0 },
  });
  assert.equal(output.collected.length, 1);
  assert.equal(output.metrics.decisionSteps, 2);
  assert.equal(output.metrics.classificationBatches, 1);
  assert.equal(output.metrics.jevRequests, 3);
  assert.equal(output.classified[0].labels.decision, 'retain');
  assert.equal(output.enriched[0].contactEvidence.emails[0], 'hello@example.test');
});

test('follow-up targets require an explicit HTTP(S) host allowlist', () => {
  assert.equal(allowedFollowUpTarget('https://example.test/profile', ['example.test']), true);
  assert.equal(allowedFollowUpTarget('https://sub.example.test/profile', ['example.test']), true);
  assert.equal(allowedFollowUpTarget('https://evil.test/profile', ['example.test']), false);
  assert.equal(allowedFollowUpTarget('javascript:alert(1)', ['example.test']), false);
  assert.equal(allowedFollowUpTarget('https://example.test/profile', []), false);
});

test('research follow-ups collect configured profile evidence before classification', async () => {
  let classificationRequest;
  const opened = [];
  const output = await runResearch({
    config: {
      profile: { evidenceFields: ['profile_evidence'], dimensions: { source: { instructions: 'Classify source.', choices: { job_seeker: 'Job seeker', employer: 'Employer' } } }, keep: { dimension: 'source', choices: ['employer'] } },
      queries: [{ url: 'https://example.test/search' }],
      tools: { collect: { collect: true }, profile: {} },
      followUps: [{ name: 'profile', targetField: 'profile_urls', outputField: 'profile_evidence', when: { missingAny: ['profile_evidence'] }, tools: ['profile'], allowedHosts: ['example.test'] }],
      maxSteps: 1,
    },
    browser: {
      open: async (url) => opened.push(url),
      snapshot: async () => ({ url: 'https://example.test/search', snapshot: 's', refs: {} }),
      action: async (operation, target) => operation === 'RUN_TOOL' && target === 'collect' ? [{ id: 'item-1', profile_urls: ['https://example.test/profile'], text: 'Hiring now' }] : { location: 'India', text: 'Recruiter email@example.com https://secret.test' },
    },
    decide: async ({ request, parseResponse }) => {
      if (parseResponse) { classificationRequest = request; return [{ index: 0, status: 'classified', labels: { source: 'employer' } }]; }
      return { operation: 'RUN_TOOL', target: 'collect', goal_reached: 0, stuck: 0 };
    },
  });
  assert.deepEqual(opened, ['https://example.test/search', 'https://example.test/profile']);
  assert.equal(output.collected[0].profile_evidence.location, 'India');
  assert.equal(output.metrics.followUpVisits, 1);
  assert.equal(output.metrics.followUpToolCalls, 1);
  assert.equal(classificationRequest.state.candidates[0].evidence.profile_evidence.location, 'India');
  assert.equal(JSON.stringify(classificationRequest).includes('email@example.com'), false);
});

test('local recovery removes the repeated target from the next choice set', () => {
  const criteria = buildCriteria({ '@e1': { role: 'link', name: 'Text Generation' }, '@e2': { role: 'link', name: 'Qwen' } }, {
    avoidSignatures: ['CLICK|link|Text Generation'],
  });
  assert.deepEqual(Object.keys(criteria.click_target.criteria), ['none_of_the_above', '@e2']);
});
