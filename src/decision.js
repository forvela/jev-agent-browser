import { TypeSafeClient } from '@typesafe-ai/sdk';
import { inputChoices, redactInputMetadata } from './contracts.js';

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const TYPESAFE_PATH = '/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_MAX_SNAPSHOT_CHARS = 18_000;
const DEFAULT_MAX_REFS = 180;

export const OPERATIONS = ['CLICK', 'TYPE', 'SELECT', 'PRESS', 'SCROLL_UP', 'SCROLL_DOWN', 'BACK', 'WAIT', 'RUN_TOOL', 'NAVIGATE', 'DONE'];

export function buildCriteria(refs, { text, selectValue, pressKey, allowInputRequest = false, avoidSignatures = [], tools = {}, goal = '', history = [], inputs = { entries: [] } } = {}) {
  const avoid = new Set(avoidSignatures);
  const operations = OPERATIONS.filter((operation) =>
    !avoid.has(`${operation}|`) &&
    (operation !== 'RUN_TOOL' || Object.keys(tools).length > 0) &&
    (operation !== 'TYPE' || allowInputRequest || text !== undefined && text !== null || inputs.entries.some((entry) => ['text', 'secret'].includes(entry.kind))) &&
    (operation !== 'SELECT' || allowInputRequest || selectValue !== undefined && selectValue !== null || inputs.entries.some((entry) => ['select', 'text'].includes(entry.kind))) &&
    (operation !== 'PRESS' || pressKey !== undefined && pressKey !== null || inputs.entries.some((entry) => entry.kind === 'key')));
  const criteria = {
    operation: {
      type: 'choice',
      instructions: 'Choose the next browser operation.',
      criteria: Object.fromEntries(operations.map((operation) => [operation, operationInstructions(operation, { text, selectValue, pressKey })])),
    },
    click_target: targetCriteria(refs, ['button', 'link'], 'CLICK', avoid, { goal, history }),
    type_target: targetCriteria(refs, ['textbox', 'combobox'], 'TYPE', avoid, { goal, history }),
    select_target: targetCriteria(refs, ['combobox', 'listbox', 'select'], 'SELECT', avoid, { goal, history }),
    ...(inputs.entries.length ? {
      navigate_input: inputQuestion('Choose the supplied destination input.', inputChoices(inputs, ['url'])),
      type_input: inputQuestion('Choose the supplied text input.', inputChoices(inputs, ['text', 'secret'])),
      select_input: inputQuestion('Choose the supplied select input.', inputChoices(inputs, ['select', 'text'])),
      press_input: inputQuestion('Choose the supplied key input.', inputChoices(inputs, ['key'])),
    } : {}),
    goal_reached: {
      type: 'noul',
      instructions: 'Estimate whether the requested goal has been reached.',
      criteria: { true: 'The requested goal is reached.', false: 'The requested goal is not reached.' },
    },
    stuck: {
      type: 'noul',
      instructions: 'Estimate whether the browser agent is stuck.',
      criteria: { true: 'The agent cannot safely make progress.', false: 'The agent can safely make progress.' },
    },
  };
  if (Object.keys(tools).length) criteria.tool_target = {
    type: 'choice',
    instructions: 'Choose one allowlisted page tool to execute now.',
    criteria: Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, String(tool.description ?? name)])),
  };
  return criteria;
}

function selectContextRefs(refs, maxRefs) {
  const entries = Object.entries(refs);
  if (maxRefs < 180) return entries.slice(0, maxRefs);
  const interactive = entries.filter(([, details]) => ['button', 'link', 'textbox', 'combobox', 'listbox', 'select'].includes(String(details?.role).toLowerCase()));
  const selected = [...entries.slice(0, 60), ...interactive.slice(0, 100), ...interactive.slice(-20)];
  return [...new Map(selected.map(([ref, details]) => [ref, [ref, details]])).values()].slice(0, maxRefs);
}

function inputQuestion(instructions, criteria) {
  return { type: 'choice', instructions, criteria };
}

function operationInstructions(operation, { text, selectValue, pressKey }) {
  if (operation === 'CLICK') return 'Choose a current control, filter, menu, pagination link, or clearly requested content target. Prefer controls over content cards and do not repeat an already executed click.';
  if (operation === 'TYPE') return text === undefined ? 'Fill a matching field using one supplied text input.' : `Fill a matching field with the explicit value "${text}"; do not repeat it if it is already filled.`;
  if (operation === 'SELECT') return selectValue === undefined ? 'Select a value from the supplied inputs.' : `Select the explicit value "${selectValue}".`;
  if (operation === 'PRESS') return pressKey === undefined ? 'Press one supplied key on the currently focused control.' : `Press ${pressKey} on the currently focused control, usually to submit it.`;
  if (operation === 'RUN_TOOL') return 'Execute one allowlisted page helper and inspect its bounded result.';
  if (operation === 'NAVIGATE') return 'Open the supplied destination URL.';
  return `Execute ${operation}.`;
}

function targetCriteria(refs, roles, operation, avoid, { goal = '', history = [] } = {}) {
  const allowedRoles = new Set(roles);
  const goalText = String(goal).toLowerCase();
  const goalNeedsControls = ['filter', 'sort', 'task', 'library', 'language', 'license', 'category'].some((word) => goalText.includes(word));
  const allowContentTargets = !goalNeedsControls || history.filter((entry) => ['CLICK', 'SELECT'].includes(entry.operation)).length >= 4;
  return {
    type: 'choice',
    instructions: 'Choose the current browser ref targeted by the operation. Prefer exact filter/menu controls over similarly named result cards.',
    criteria: Object.fromEntries([
      ['none_of_the_above', 'No current ref is an appropriate target.'],
      ...Object.entries(refs).filter(([, details]) => {
        if (!details || typeof details !== 'object' || !allowedRoles.has(String(details.role).toLowerCase())) return false;
        if (avoid.has([operation, details.role ?? '', details.name ?? ''].join('|'))) return false;
        return allowContentTargets || !isContentCard(details);
      }).map(([ref, details]) => [
        ref,
        [details.role, isContentCard(details) ? 'content card' : 'control', details.name].filter(Boolean).join('/') || null,
      ]),
    ]),
  };
}

function isContentCard(details) {
  const role = String(details?.role ?? '').toLowerCase();
  const name = String(details?.name ?? '');
  return role === 'link' && (name.includes(' • ') || name.length > 100);
}

export function buildDecisionRequest({ goal, observation, refs, text, selectValue, pressKey, inputs = { entries: [] }, allowInputRequest = false, tools = {}, plan, subtask, history, recovery, model = DEFAULT_MODEL, maxSnapshotChars = DEFAULT_MAX_SNAPSHOT_CHARS, maxRefs = DEFAULT_MAX_REFS }) {
  const contextRefs = Object.fromEntries(selectContextRefs(refs, maxRefs));
  const snapshot = observation.snapshot.length > maxSnapshotChars
    ? `${observation.snapshot.slice(0, maxSnapshotChars)}\n[ snapshot truncated ]`
    : observation.snapshot;
  const state = { goal, url: observation.url, snapshot, refs: contextRefs };
  if (inputs.entries.length) state.inputs = redactInputMetadata(inputs);
  if (plan) state.plan = plan;
  if (subtask) state.subtask = subtask;
  if (history?.length) state.history = history;
  if (recovery) state.recovery = recovery;
  return {
    model,
    state,
    questions: buildCriteria(contextRefs, { text, selectValue, pressKey, allowInputRequest, avoidSignatures: recovery?.avoid, tools, goal, history, inputs }),
  };
}

export async function requestDecision({ apiKey, request, endpoint = DEFAULT_ENDPOINT, headers = {}, timeoutMs = 30_000, transport = 'typesafe', fetchImpl, sdkClient, parseResponse = parseDecisionResponse, signal }) {
  if (!apiKey) throw new Error('Decision API key is required');
  if (transport === 'fetch') {
    return requestDecisionWithFetch({ apiKey, request, endpoint, headers, timeoutMs, fetchImpl: fetchImpl ?? fetch, parseResponse, signal });
  }
  if (transport !== 'typesafe' && transport !== 'sdk') {
    throw new Error(`unsupported decision transport: ${transport}`);
  }
  const { baseURL, fetch: sdkFetch } = sdkConnection(endpoint, fetchImpl);
  const client = sdkClient ?? new TypeSafeClient({ apiKey, baseURL, defaultModel: request.model, timeout: timeoutMs, defaultHeaders: headers, ...(sdkFetch ? { fetch: sdkFetch } : {}) });
  const response = await client.systemOne(request, { headers, timeout: timeoutMs, ...(signal ? { signal } : {}) });
  return parseResponse(response);
}

async function requestDecisionWithFetch({ apiKey, request, endpoint, headers, timeoutMs, fetchImpl, parseResponse, signal }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body;
    try { body = JSON.parse(bodyText); } catch (error) {
      throw new Error(`Decision API returned invalid JSON (${response.status})`, { cause: error });
    }
    if (!response.ok) throw new Error(`Decision API ${response.status}: ${body.error?.message ?? bodyText.slice(0, 300)}`);
    return parseResponse(body);
  } catch (error) {
    if (error.name === 'AbortError') {
      if (signal?.aborted) { const aborted = new Error('Decision API request cancelled', { cause: error }); aborted.code = 'ABORT_ERR'; throw aborted; }
      throw new Error(`Decision API timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function sdkConnection(endpoint, fetchImpl) {
  const url = new URL(endpoint);
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const standardPath = path === '' || path === TYPESAFE_PATH;
  if (standardPath) {
    url.pathname = '';
    url.search = '';
    const baseURL = url.toString();
    return { baseURL: baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL, fetch: fetchImpl };
  }
  const fetcher = fetchImpl ?? fetch;
  return {
    baseURL: url.origin,
    fetch: (input, init) => fetcher(endpoint, init),
  };
}

export function parseDecisionResponse(payload) {
  let value = payload?.decision ?? payload?.answers ?? payload?.result ?? payload?.output ?? payload;
  if (Array.isArray(value) && value.every((item) => item && typeof item === 'object' && item.name)) {
    value = Object.fromEntries(value.map((item) => [item.name, item.answer ?? item.value ?? item]));
  }
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'string') {
    const text = value.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    try { value = JSON.parse(text); } catch (error) { throw new Error('Decision response content is not JSON', { cause: error }); }
  }
  if (value?.message?.content) return parseDecisionResponse(value.message.content);
  if (Array.isArray(value?.choices) && value.choices[0]) return parseDecisionResponse(value.choices[0].message?.content ?? value.choices[0]);
  const operation = pickChoice(value?.operation);
  const targetHead = operationTargetHead(operation);
  const targetValue = targetHead ? value?.[targetHead] : undefined;
  const target = pickChoice(targetValue) ?? pickChoice(value?.target);
  const targetProbability = pickProbability(targetValue) ?? pickProbability(value?.target);
  const inputHead = operationInputHead(operation);
  const inputValue = inputHead ? value?.[inputHead] : undefined;
  const inputKey = pickChoice(inputValue) ?? pickChoice(value?.inputKey);
  const inputProbability = pickProbability(inputValue) ?? pickProbability(value?.inputKey);
  const goalReached = pickNoul(value?.goal_reached ?? value?.goalReached);
  const stuck = pickNoul(value?.stuck);
  if (!operation || !OPERATIONS.includes(operation)) throw new Error('Decision response has no supported operation');
  const result = {
    operation,
    target,
    goal_reached: goalReached,
    stuck,
    probabilities: {
      operation: pickProbability(value?.operation),
      target: targetProbability,
      goal_reached: pickProbability(value?.goal_reached ?? value?.goalReached),
      stuck: pickProbability(value?.stuck),
    },
    raw: payload,
  };
  if (inputKey !== undefined) result.inputKey = inputKey;
  if (inputProbability !== undefined) result.probabilities.input = inputProbability;
  return result;
}

function operationTargetHead(operation) {
  return { CLICK: 'click_target', TYPE: 'type_target', SELECT: 'select_target', RUN_TOOL: 'tool_target' }[operation];
}

function operationInputHead(operation) {
  return { NAVIGATE: 'navigate_input', TYPE: 'type_input', SELECT: 'select_input', PRESS: 'press_input' }[operation];
}

export function targetForOperation(decision) {
  const head = operationTargetHead(decision?.operation);
  return (head && pickChoice(decision?.[head])) ?? pickChoice(decision?.target);
}

export function inputKeyForOperation(decision) {
  return decision?.inputKey ?? pickChoice(decision?.[operationInputHead(decision?.operation)]);
}

function pickChoice(value) {
  if (typeof value === 'string') return value;
  return value?.choice ?? value?.value ?? value?.selected ?? value?.name;
}

function pickNoul(value) {
  if (typeof value === 'number') return value;
  return Number(value?.noul ?? value?.value ?? 0);
}

function pickProbability(value) {
  const number = Number(value?.probability ?? value?.confidence);
  return Number.isFinite(number) ? number : undefined;
}

export { DEFAULT_ENDPOINT, DEFAULT_MODEL, DEFAULT_MAX_SNAPSHOT_CHARS, DEFAULT_MAX_REFS };
