import { buildDecisionRequest, requestDecision, targetForOperation } from './decision.js';

const TARGETED = new Set(['CLICK', 'TYPE', 'SELECT', 'RUN_TOOL']);
const ACTIONS = new Set(['CLICK', 'TYPE', 'SELECT', 'PRESS', 'SCROLL_UP', 'SCROLL_DOWN', 'BACK', 'WAIT', 'RUN_TOOL']);
const HANDOFF_SNAPSHOT_CHARS = 6_000;
const HANDOFF_REFS = 60;
export const MAX_ACTION_DELAY_MS = 60_000;

export function validateActionDelayMs(value = 0) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_ACTION_DELAY_MS) {
    throw new Error(`actionDelayMs must be an integer between 0 and ${MAX_ACTION_DELAY_MS}`);
  }
  return value;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLoop({
  goal, browser, decide = requestDecision, apiKey, model, text, selectValue, pressKey,
  plan, subtask, tools = {}, inputValues = {}, history: initialHistory = [], historyLimit = 6, repeatLimit = 2,
  maxRecoveryAttempts = 3, maxSteps = 32, actionDelayMs = 0, sleep = defaultSleep, trace = true, onEvent,
}) {
  validateActionDelayMs(actionDelayMs);
  if (!goal) throw new Error('goal is required');
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('maxSteps must be a positive integer');
  if (!Number.isInteger(historyLimit) || historyLimit < 1) throw new Error('historyLimit must be a positive integer');
  if (!Number.isInteger(repeatLimit) || repeatLimit < 1) throw new Error('repeatLimit must be a positive integer');
  if (!Number.isInteger(maxRecoveryAttempts) || maxRecoveryAttempts < 0) throw new Error('maxRecoveryAttempts must be a non-negative integer');
  const entries = [];
  const history = Array.isArray(initialHistory) ? initialHistory.slice(-historyLimit) : [];
  let lastSignature;
  let sameActionCount = 0;
  let recoveryAttempts = 0;
  let recovery = null;
  let escalated = false;
  let actionCompleted = false;
  let inputRequired = null;
  const started = Date.now();
  emitEvent(onEvent, { type: 'start', goal, plan: plan ?? null, subtask: subtask ?? goal, maxSteps });
  let executed = 0;
  let status = 'limit';
  let reason = 'max-steps';
  let lastObservation = null;

  for (let step = 0; step < maxSteps; step += 1) {
    const iterationStarted = Date.now();
    let observation;
    try {
      observation = await browser.snapshot();
      lastObservation = observation;
    } catch (error) {
      status = 'error'; reason = `snapshot: ${error.message}`; escalated = true;
      const event = { step, observation: null, error: error.message, durationMs: Date.now() - iterationStarted };
      entries.push(event);
      emitEvent(onEvent, { type: 'step', ...event });
      break;
    }
    const refs = observation.refs;
    const request = buildDecisionRequest({
      goal, observation, refs, text, selectValue, pressKey, allowInputRequest: true, tools, plan, subtask,
      history: history.slice(-historyLimit), recovery, model,
    });
    let decision;
    try {
      decision = await decide({ apiKey, request });
    } catch (error) {
      status = 'error'; reason = `decision: ${error.message}`; escalated = true;
      const event = { step, observation: compactObservation(observation), error: error.message, durationMs: Date.now() - iterationStarted };
      entries.push({ step, observation, error: error.message, durationMs: event.durationMs });
      emitEvent(onEvent, { type: 'step', ...event });
      break;
    }
    const target = targetForOperation(decision);
    const entry = { step, observation, decision: publicDecision(decision, target) };
    entries.push(entry);

    if (decision.stuck >= 0.8) {
      if (recoveryAttempts < maxRecoveryAttempts) {
        recoveryAttempts += 1;
        recovery = { reason: 'jev-reports-stuck', attempt: recoveryAttempts, instruction: 'Change strategy locally; do not repeat the last failed approach.' };
        entry.action = { executed: false, reason: 'local-recovery', recoveryAttempt: recoveryAttempts };
        remember(history, { step, operation: 'RECOVERY', url: observation.url, executed: false, reason: 'jev-reports-stuck' }, historyLimit);
        emitEvent(onEvent, stepEvent(entry));
        continue;
      }
      status = 'blocked'; reason = 'recovery-exhausted'; escalated = true;
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if (decision.goal_reached >= 0.8 || (decision.goal_reached >= 0.6 && completionEvidence(goal, history))) {
      status = 'success'; reason = 'goal-reached';
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    const operation = decision.operation;
    if (operation === 'DONE') {
      if (recoveryAttempts < maxRecoveryAttempts) {
        recoveryAttempts += 1;
        recovery = { reason: 'uncertain-completion', attempt: recoveryAttempts, avoid: ['DONE|'], instruction: 'The subtask is not proven complete; inspect the page and take a different useful action.' };
        entry.action = { executed: false, reason: 'local-recovery', recoveryAttempt: recoveryAttempts };
        remember(history, { step, operation: 'RECOVERY', url: observation.url, executed: false, reason: 'uncertain-completion' }, historyLimit);
        emitEvent(onEvent, stepEvent(entry));
        continue;
      }
      status = 'blocked'; reason = 'recovery-exhausted'; escalated = true;
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    const invalidTarget = !target || target === 'none_of_the_above' || (operation === 'RUN_TOOL' ? !Object.hasOwn(tools, target) : !Object.hasOwn(refs, target));
    if (TARGETED.has(operation) && invalidTarget) {
      if (recoveryAttempts < maxRecoveryAttempts) {
        recoveryAttempts += 1;
        recovery = { reason: 'invalid-target', attempt: recoveryAttempts, instruction: 'Choose a different current ref or a different operation.' };
        entry.action = { executed: false, reason: 'local-recovery', recoveryAttempt: recoveryAttempts };
        remember(history, { step, operation, target, url: observation.url, executed: false, reason: 'invalid-target' }, historyLimit);
        emitEvent(onEvent, stepEvent(entry));
        continue;
      }
      status = 'blocked'; reason = 'recovery-exhausted'; escalated = true;
      entry.action = { executed: false, reason };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    const actionText = operation === 'TYPE' ? resolveInputValue(target, refs, inputValues, text) : text;
    const actionSelectValue = operation === 'SELECT' ? resolveInputValue(target, refs, inputValues, selectValue) : selectValue;
    if ((operation === 'TYPE' && actionText === undefined) || (operation === 'SELECT' && actionSelectValue === undefined)) {
      status = 'input-required'; reason = 'input-required';
      inputRequired = { ...describeInput(target, refs), operation };
      entry.action = { executed: false, reason, input: inputRequired };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if (operation === 'PRESS' && pressKey === undefined) {
      status = 'blocked'; reason = 'press-key-not-configured'; escalated = true;
      entry.action = { executed: false, reason };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if (!ACTIONS.has(operation)) {
      status = 'error'; reason = `unsupported operation: ${operation}`; escalated = true;
      entry.action = { executed: false, reason };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    const signature = actionSignature(operation, target, refs);
    sameActionCount = signature === lastSignature ? sameActionCount + 1 : 1;
    lastSignature = signature;
    if (sameActionCount >= repeatLimit) {
      if (recoveryAttempts < maxRecoveryAttempts) {
        recoveryAttempts += 1;
        recovery = { reason: 'repeated-action', attempt: recoveryAttempts, avoid: [signature], instruction: 'Use a different action or target; the repeated action is not making progress.' };
        entry.action = { executed: false, reason: 'local-recovery', signature, recoveryAttempt: recoveryAttempts };
        remember(history, { step, operation, target, signature, url: observation.url, executed: false, reason: 'repeated-action' }, historyLimit);
        emitEvent(onEvent, stepEvent(entry));
        continue;
      }
      status = 'blocked'; reason = 'loop-detected'; escalated = true;
      entry.action = { executed: false, reason, signature };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if (actionCompleted && actionDelayMs > 0) await sleep(actionDelayMs);
    actionCompleted = false;
    try {
      const actionResult = await browser.action(operation, target, { text: actionText, selectValue: actionSelectValue, pressKey });
      actionCompleted = true;
      executed += 1;
      entry.action = { executed: true, result: actionResult ?? null, durationMs: Date.now() - iterationStarted };
      remember(history, { step, operation, target, signature, url: observation.url, executed: true, result: historyResult(actionResult) }, historyLimit);
      if (!recovery || !recovery.avoid?.includes(signature)) {
        recovery = null;
        recoveryAttempts = 0;
      }
      emitEvent(onEvent, stepEvent(entry));
    } catch (error) {
      entry.action = { executed: false, error: error.message, durationMs: Date.now() - iterationStarted, signature };
      remember(history, { step, operation, target, signature, url: observation.url, executed: false, error: error.message }, historyLimit);
      if (recoveryAttempts < maxRecoveryAttempts) {
        recoveryAttempts += 1;
        recovery = { reason: 'browser-action-failed', attempt: recoveryAttempts, avoid: [signature], instruction: 'Recover locally from the browser error and choose another safe action.' };
        emitEvent(onEvent, stepEvent(entry));
        continue;
      }
      status = 'error'; reason = 'recovery-exhausted'; escalated = true;
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
  }
  const handoff = buildHandoff({ status, reason, goal, plan, subtask, observation: lastObservation, history, escalated, inputRequired });
  emitEvent(onEvent, { type: 'handoff', handoff });
  return {
    status, reason, steps: executed, durationMs: Date.now() - started,
    trace: trace ? entries : undefined,
    handoff,
  };
}

function completionEvidence(goal, history) {
  const last = history.at(-1);
  return last?.operation === 'BACK' && /\b(stop|done|complete|finish|return)\b/i.test(goal);
}

function historyResult(result) {
  if (Array.isArray(result)) return { type: 'array', count: result.length };
  if (!result || typeof result !== 'object') return result === undefined ? undefined : { type: typeof result };
  const keys = ['ok', 'moved', 'atEnd', 'expanded', 'matched', 'limited', 'amount', 'before', 'after'];
  return { type: 'object', ...Object.fromEntries(keys.filter((key) => key in result).map((key) => [key, result[key]])) };
}

function remember(history, item, limit) {
  history.push(item);
  while (history.length > limit) history.shift();
}

function actionSignature(operation, target, refs) {
  const details = target && refs[target];
  return details
    ? [operation, details.role ?? '', details.name ?? ''].join('|')
    : [operation, target ?? ''].join('|');
}

function buildHandoff({ status, reason, goal, plan, subtask, observation, history, escalated, inputRequired }) {
  const needsParent = Boolean(escalated || status === 'input-required');
  return {
    status,
    reason: status === 'success' ? 'completed' : reason,
    goal,
    plan: plan ?? null,
    subtask: subtask ?? goal,
    currentUrl: observation?.url ?? null,
    observation: observation ? compactObservation(observation) : null,
    recentActions: history,
    inputRequired: inputRequired ?? null,
    escalation: inputRequired ? 'input' : escalated ? 'parent' : 'none',
    parentDecisionRequired: needsParent,
    resumable: !escalated && status !== 'success',
  };
}

export function normalizeFieldKey(details = {}) {
  const role = String(details.role ?? 'field').trim().toLowerCase();
  const name = String(details.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return name ? `${role}:${name}` : role;
}

function describeInput(target, refs) {
  const details = refs[target] ?? {};
  return {
    ref: target,
    key: normalizeFieldKey(details),
    name: String(details.name ?? ''),
    role: String(details.role ?? ''),
  };
}

function resolveInputValue(target, refs, inputValues, fallback) {
  if (fallback !== undefined && fallback !== null) return fallback;
  const details = refs[target] ?? {};
  const name = String(details.name ?? '').trim();
  const normalizedName = name.toLowerCase().replace(/\s+/g, ' ');
  const keys = [target, normalizeFieldKey(details), name, normalizedName].filter(Boolean);
  for (const key of keys) {
    const value = inputValues?.[key];
    if (value !== undefined && value !== null) return String(value);
  }
  return undefined;
}

function compactObservation(observation) {
  return {
    url: observation.url,
    snapshot: observation.snapshot.length > HANDOFF_SNAPSHOT_CHARS
      ? `${observation.snapshot.slice(0, HANDOFF_SNAPSHOT_CHARS)}\n[ snapshot truncated ]`
      : observation.snapshot,
    refs: Object.fromEntries(Object.entries(observation.refs).slice(0, HANDOFF_REFS)),
  };
}

function stepEvent(entry) {
  return {
    type: 'step',
    step: entry.step,
    url: entry.observation?.url ?? null,
    decision: entry.decision,
    action: publicAction(entry.action),
    durationMs: entry.action?.durationMs,
  };
}

function publicAction(action) {
  if (!action) return null;
  const result = action.result;
  let summary = result;
  if (Array.isArray(result)) summary = { type: 'array', count: result.length };
  else if (result && typeof result === 'object') {
    summary = { type: 'object', keys: Object.keys(result).slice(0, 20), ...Object.fromEntries(['ok', 'moved', 'atEnd', 'expanded', 'matched', 'limited'].filter((key) => key in result).map((key) => [key, result[key]])) };
  } else if (result !== undefined) summary = { type: typeof result };
  return { ...action, ...(result === undefined ? {} : { result: summary }) };
}

function emitEvent(onEvent, event) {
  if (onEvent) onEvent(event);
}

function isRetryableTargetError(error) {
  return /could not locate element|stale/i.test(error.message);
}

function publicDecision(decision, target) {
  return {
    operation: decision.operation,
    target,
    goal_reached: decision.goal_reached,
    stuck: decision.stuck,
    probabilities: decision.probabilities,
  };
}
