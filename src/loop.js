import { buildDecisionRequest, inputKeyForOperation, requestDecision, targetForOperation } from './decision.js';
import { inputForKey, normalizeInputs, validateUrl } from './contracts.js';

const TARGETED = new Set(['CLICK', 'TYPE', 'SELECT', 'RUN_TOOL']);
const ACTIONS = new Set(['CLICK', 'TYPE', 'SELECT', 'PRESS', 'SCROLL_UP', 'SCROLL_DOWN', 'BACK', 'WAIT', 'RUN_TOOL', 'NAVIGATE']);
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
  goal, browser, decide = requestDecision, apiKey, model, text, selectValue, pressKey, inputs,
  sessionId, signal, plan, subtask, tools = {}, inputValues = {}, history: initialHistory = [], historyLimit = 6, repeatLimit = 2,
  maxRecoveryAttempts = 3, maxSteps = 32, actionDelayMs = 0, sleep = defaultSleep, trace = true, onEvent,
} = {}) {
  validateActionDelayMs(actionDelayMs);
  if (!goal) throw new Error('goal is required');
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('maxSteps must be a positive integer');
  if (!Number.isInteger(historyLimit) || historyLimit < 1) throw new Error('historyLimit must be a positive integer');
  if (!Number.isInteger(repeatLimit) || repeatLimit < 1) throw new Error('repeatLimit must be a positive integer');
  if (!Number.isInteger(maxRecoveryAttempts) || maxRecoveryAttempts < 0) throw new Error('maxRecoveryAttempts must be a non-negative integer');
  const normalized = normalizeInputs({ inputs, inputValues, text, selectValue, pressKey });
  const entries = [];
  const history = Array.isArray(initialHistory) ? initialHistory.slice(-historyLimit) : [];
  let lastSignature;
  let sameActionCount = 0;
  let recoveryAttempts = 0;
  let tabRecoveryAttempts = 0;
  let recovery = null;
  let escalated = false;
  let actionCompleted = false;
  let inputRequired = null;
  const started = Date.now();
  emitEvent(onEvent, { type: 'start', goal, plan: plan ?? null, subtask: subtask ?? goal, sessionId: sessionId ?? null, maxSteps });
  let executed = 0;
  let status = 'limit';
  let reason = 'max-steps';
  let lastObservation = null;

  try {
    for (let step = 0; step < maxSteps; step += 1) {
    throwIfAborted(signal);
    const iterationStarted = Date.now();
    let observation;
    try {
      observation = await browser.snapshot({ signal });
      lastObservation = observation;
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      if (isTabLostError(error) && tabRecoveryAttempts < 1 && typeof browser.rebind === 'function') {
        tabRecoveryAttempts += 1;
        try {
          observation = await browser.rebind({ signal });
          lastObservation = observation;
        } catch (rebindError) {
          status = 'blocked'; reason = 'tab-lost'; escalated = true;
          const event = { step, observation: null, error: redactMessage(rebindError.message, normalized), durationMs: Date.now() - iterationStarted };
          entries.push(event);
          emitEvent(onEvent, { type: 'step', ...event });
          break;
        }
      } else {
        status = 'error'; reason = `snapshot: ${redactMessage(error.message, normalized)}`; escalated = true;
        const event = { step, observation: null, error: redactMessage(error.message, normalized), durationMs: Date.now() - iterationStarted };
        entries.push(event);
        emitEvent(onEvent, { type: 'step', ...event });
        break;
      }
    }
    const refs = observation.refs;
    const decisionObservation = redactObservation(observation, normalized);
    const request = buildDecisionRequest({
      goal, observation: decisionObservation, refs, text: legacyValue(normalized, '__legacy_text'), selectValue: legacyValue(normalized, '__legacy_select'), pressKey: legacyValue(normalized, '__legacy_press'), inputs: normalized, allowInputRequest: true, tools, plan, subtask,
      history: history.slice(-historyLimit), recovery, model,
    });
    let decision;
    try {
      decision = await decide({ apiKey, request, signal });
    } catch (error) {
      status = 'error'; reason = `decision: ${redactMessage(error.message, normalized)}`; escalated = true;
      const event = { step, observation: compactObservation(observation, normalized), error: redactMessage(error.message, normalized), durationMs: Date.now() - iterationStarted };
      entries.push({ step, observation: redactObservation(observation, normalized), error: redactMessage(error.message, normalized), durationMs: event.durationMs });
      emitEvent(onEvent, { type: 'step', ...event });
      break;
    }
    let target = targetForOperation(decision);
    const inputKey = inputKeyForOperation(decision);
    const entry = { step, observation: redactObservation(observation, normalized), decision: publicDecision(decision, target) };
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
    let input = inputForOperation(operation, inputKey, target, refs, normalized);
    let resolvedTarget = target;
    if (TARGETED.has(operation) && operation !== 'RUN_TOOL' && (!resolvedTarget || resolvedTarget === 'none_of_the_above' || !Object.hasOwn(refs, resolvedTarget))) {
      resolvedTarget = resolveSemanticTarget(operation, input, refs);
    }
    const invalidTarget = operation === 'RUN_TOOL'
      ? !resolvedTarget || !Object.hasOwn(tools, resolvedTarget)
      : TARGETED.has(operation) && (!resolvedTarget || resolvedTarget === 'none_of_the_above' || !Object.hasOwn(refs, resolvedTarget));
    if (invalidTarget) {
      if (recoveryAttempts < maxRecoveryAttempts) {
        recoveryAttempts += 1;
        recovery = { reason: 'invalid-target', attempt: recoveryAttempts, instruction: 'Choose a different current ref or a different operation.' };
        entry.action = { executed: false, reason: 'local-recovery', recoveryAttempt: recoveryAttempts };
        remember(history, { step, operation, target: resolvedTarget, url: observation.url, executed: false, reason: 'invalid-target' }, historyLimit);
        emitEvent(onEvent, stepEvent(entry));
        continue;
      }
      status = 'blocked'; reason = 'recovery-exhausted'; escalated = true;
      entry.action = { executed: false, reason };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if (operation === 'NAVIGATE' && !input) {
      status = 'input-required'; reason = 'input-required';
      inputRequired = { operation, key: inputKey ?? 'destination', kind: 'url', reason: 'A destination URL is required.' };
      entry.action = { executed: false, reason, input: inputRequired };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if ((operation === 'TYPE' || operation === 'SELECT') && !input) {
      status = 'input-required'; reason = 'input-required';
      inputRequired = inputDescriptor(operation, inputKey, resolvedTarget, refs, normalized);
      entry.action = { executed: false, reason, input: inputRequired };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if (operation === 'PRESS' && !input && !legacyValue(normalized, '__legacy_press')) {
      status = 'input-required'; reason = 'input-required';
      inputRequired = { operation, key: inputKey ?? 'press_key', kind: 'key', reason: 'A key is required.' };
      entry.action = { executed: false, reason, input: inputRequired };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    if (!ACTIONS.has(operation)) {
      status = 'error'; reason = `unsupported operation: ${operation}`; escalated = true;
      entry.action = { executed: false, reason };
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    target = resolvedTarget;
    const signature = actionSignature(operation, target, refs, input);
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
      const actionResult = await browser.action(operation, target, actionArguments(operation, input, normalized, signal));
      actionCompleted = true;
      executed += 1;
      entry.action = { executed: true, result: redactResult(actionResult, normalized), durationMs: Date.now() - iterationStarted };
      remember(history, { step, operation, target, signature, url: observation.url, executed: true, result: redactResult(historyResult(actionResult), normalized) }, historyLimit);
      if (!recovery || !recovery.avoid?.includes(signature)) {
        recovery = null;
        recoveryAttempts = 0;
      }
      emitEvent(onEvent, stepEvent(entry));
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      entry.action = { executed: false, error: redactMessage(error.message, normalized), durationMs: Date.now() - iterationStarted, signature };
      remember(history, { step, operation, target, signature, url: observation.url, executed: false, error: redactMessage(error.message, normalized) }, historyLimit);
      if (recoveryAttempts < maxRecoveryAttempts && !isTimeout(error)) {
        recoveryAttempts += 1;
        recovery = { reason: 'browser-action-failed', attempt: recoveryAttempts, avoid: [signature], instruction: 'Recover locally from the browser error and choose another safe action.' };
        emitEvent(onEvent, stepEvent(entry));
        continue;
      }
      status = isTimeout(error) ? 'timeout' : 'error'; reason = isTimeout(error) ? 'browser-timeout' : 'recovery-exhausted'; escalated = true;
      emitEvent(onEvent, stepEvent(entry));
      break;
    }
    }
  } catch (error) {
    if (isAbort(error, signal)) {
      status = isTimeout(error) ? 'timeout' : 'cancelled';
      reason = isTimeout(error) ? 'browser-timeout' : 'cancelled';
      escalated = false;
    } else {
      status = 'error';
      reason = redactMessage(error instanceof Error ? error.message : String(error), normalized);
      escalated = true;
    }
  } finally {
    if ((status === 'cancelled' || status === 'timeout') && typeof browser.cleanup === 'function') {
      try { await browser.cleanup({ reason }); } catch { /* best effort */ }
    }
  }
  const continuation = ['input-required', 'limit'].includes(status)
    ? { goal, plan: plan ?? null, subtask: subtask ?? goal, sessionId: sessionId ?? null, history: history.slice(-historyLimit) }
    : null;
  const handoff = buildHandoff({ status, reason, goal, plan, subtask, sessionId, observation: lastObservation, history, escalated, inputRequired, continuation, normalized });
  emitEvent(onEvent, { type: 'handoff', handoff });
  return {
    status, reason, steps: executed, durationMs: Date.now() - started,
    trace: trace ? entries : undefined,
    handoff,
  };
}

export async function resumeLoop({ continuation, inputs, ...options } = {}) {
  if (!continuation?.goal) throw new Error('continuation.goal is required');
  return runLoop({ ...options, goal: continuation.goal, plan: continuation.plan, subtask: continuation.subtask, sessionId: continuation.sessionId, history: continuation.history, inputs });
}

function inputForOperation(operation, inputKey, target, refs, normalized) {
  const kinds = operation === 'NAVIGATE' ? ['url'] : operation === 'TYPE' ? ['text', 'secret'] : operation === 'SELECT' ? ['select', 'text'] : operation === 'PRESS' ? ['key'] : [];
  const explicit = inputForKey(normalized, inputKey, kinds);
  if (explicit) return explicit;
  if (target && refs[target]) {
    const details = refs[target];
    const names = [target, normalizeFieldKey(details), details.name, String(details.name ?? '').trim().toLowerCase()];
    const found = normalized.entries.find((entry) => kinds.includes(entry.kind) && names.includes(entry.key));
    if (found) return found;
  }
  const candidates = normalized.entries.filter((entry) => kinds.includes(entry.kind));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function actionArguments(operation, input, normalized, signal) {
  const args = { text: undefined, selectValue: undefined, pressKey: undefined };
  if (operation === 'TYPE') args.text = input?.value;
  if (operation === 'SELECT') args.selectValue = input?.value;
  if (operation === 'PRESS') args.pressKey = input?.value;
  if (operation === 'NAVIGATE') args.url = validateUrl(input?.value);
  if (signal) args.signal = signal;
  return args;
}

function resolveSemanticTarget(operation, input, refs) {
  if (!input?.targetHint) return undefined;
  const words = input.targetHint.toLowerCase().split(' ').filter(Boolean);
  const roles = operation === 'SELECT' ? ['combobox', 'listbox', 'select'] : ['textbox', 'combobox'];
  const ranked = Object.entries(refs)
    .filter(([, details]) => roles.includes(String(details?.role ?? '').toLowerCase()))
    .map(([ref, details]) => ({ ref, score: words.filter((word) => String(details?.name ?? '').toLowerCase().includes(word)).length }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.score ? ranked[0].ref : undefined;
}

function inputDescriptor(operation, inputKey, target, refs, normalized) {
  const details = refs[target] ?? {};
  const entry = inputForKey(normalized, inputKey);
  if (!normalized.entries.length && !inputKey) return { operation, ref: target, key: normalizeFieldKey(details), name: String(details.name ?? ''), role: String(details.role ?? '') };
  return { operation, key: inputKey ?? normalizeFieldKey(details), kind: entry?.kind ?? (operation === 'SELECT' ? 'select' : 'text'), target: target ?? null, name: String(details.name ?? ''), role: String(details.role ?? ''), targetHint: entry?.targetHint, reason: 'A value is required to continue.' };
}

function legacyValue(normalized, key) {
  return normalized.byKey[key]?.value;
}

function completionEvidence(goal, history) {
  const last = history.at(-1);
  const words = ['stop', 'done', 'complete', 'finish', 'return'];
  return last?.operation === 'BACK' && words.some((word) => goal.toLowerCase().includes(word));
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

function actionSignature(operation, target, refs, input) {
  const details = target && refs[target];
  return details
    ? [operation, details.role ?? '', details.name ?? '', input?.key ?? ''].join('|')
    : [operation, target ?? '', input?.key ?? ''].join('|');
}

function buildHandoff({ status, reason, goal, plan, subtask, sessionId, observation, history, escalated, inputRequired, continuation, normalized }) {
  const needsParent = Boolean(escalated || status === 'input-required');
  return {
    status,
    reason: status === 'success' ? 'completed' : reason,
    goal,
    plan: plan ?? null,
    subtask: subtask ?? goal,
    sessionId: sessionId ?? null,
    currentUrl: observation?.url ?? null,
    observation: observation ? compactObservation(observation, normalized) : null,
    recentActions: history,
    inputRequired: inputRequired ?? null,
    escalation: inputRequired ? 'input' : escalated ? 'parent' : 'none',
    parentDecisionRequired: needsParent,
    resumable: ['input-required', 'limit'].includes(status) && Boolean(continuation),
    continuation,
  };
}

export function normalizeFieldKey(details = {}) {
  const role = String(details.role ?? 'field').trim().toLowerCase();
  const name = String(details.name ?? '').trim().toLowerCase().split(' ').filter(Boolean).join(' ');
  return name ? `${role}:${name}` : role;
}

function compactObservation(observation, normalized) {
  const redacted = redactResult(observation, normalized);
  return {
    url: redacted.url,
    snapshot: redacted.snapshot.length > HANDOFF_SNAPSHOT_CHARS
      ? `${redacted.snapshot.slice(0, HANDOFF_SNAPSHOT_CHARS)}\n[ snapshot truncated ]`
      : redacted.snapshot,
    refs: Object.fromEntries(Object.entries(redacted.refs).slice(0, HANDOFF_REFS)),
  };
}

function redactObservation(observation, normalized) {
  return redactResult(observation, normalized);
}

function redactMessage(message, normalized) {
  return redactResult(String(message ?? ''), normalized);
}

function redactResult(value, normalized) {
  const secrets = normalized.entries.filter((entry) => entry.secret).map((entry) => entry.value).filter(Boolean);
  const hide = (text) => secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text);
  if (typeof value === 'string') return hide(value);
  if (Array.isArray(value)) return value.map((item) => redactResult(item, normalized));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactResult(item, normalized)]));
  return value;
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

function isTabLostError(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return error?.code === 'TAB_GONE' || message.includes('tab_gone') || message.includes('bound tab is gone') || message.includes('tab gone');
}

function isAbort(error, signal) {
  return signal?.aborted || error?.code === 'ABORT_ERR' || error?.name === 'AbortError';
}

function isTimeout(error) {
  return error?.code === 'TIMEOUT' || String(error?.message ?? error).toLowerCase().includes('timed out');
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('browser execution cancelled');
    error.code = 'ABORT_ERR';
    throw error;
  }
}

function publicDecision(decision, target) {
  return {
    operation: decision.operation,
    target,
    inputKey: decision.inputKey,
    goal_reached: decision.goal_reached,
    stuck: decision.stuck,
    probabilities: decision.probabilities,
  };
}
