import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { applyProfileOverrides, buildBatchClassificationRequest, classifyBatch, DEFAULT_MAX_ITEMS, DEFAULT_MAX_TEXT_CHARS } from './classifier.js';
import { requestDecision } from './decision.js';
import { enrichContactEvidence, keepClassifiedItems } from './research.js';
import { runLoop, validateActionDelayMs } from './loop.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadResearchConfig(configPath) {
  const root = dirname(resolve(configPath));
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const profile = config.profilePath ? JSON.parse(await readFile(resolve(root, config.profilePath), 'utf8')) : config.profile;
  if (!profile) throw new Error('research config needs profile or profilePath');
  const queries = (config.queries ?? []).map((query) => typeof query === 'string' ? { url: query } : query);
  if (!queries.length || queries.some((query) => !query.url)) throw new Error('research config needs non-empty queries with url');
  const tools = Object.fromEntries(Object.entries(config.tools ?? {}).map(([name, tool]) => [name, {
    description: tool.description ?? name,
    sourcePath: tool.path ? resolve(root, tool.path) : undefined,
    source: tool.source,
    config: tool.config,
    collect: Boolean(tool.collect),
  }]));
  const followUps = (config.followUps ?? []).map((followUp) => ({
    ...followUp,
    tools: followUp.tools ?? [],
    allowedHosts: followUp.allowedHosts ?? [],
  }));
  for (const followUp of followUps) {
    if (!followUp.targetField || !followUp.tools.length) throw new Error('each followUp needs targetField and tools');
    for (const tool of followUp.tools) if (!tools[tool]) throw new Error(`followUp references unknown tool: ${tool}`);
  }
  return { ...config, profile, queries, tools, followUps };
}

export async function runResearch({ config, browser, apiKey, endpoint, headers, transport = 'typesafe', model, actionDelayMs = config?.pacing?.actionDelayMs ?? 0, sleep, onEvent, decide } = {}) {
  if (!config?.profile) throw new Error('research config needs profile');
  validateActionDelayMs(actionDelayMs);
  const decision = decide ?? ((options) => requestDecision({ ...options, headers, transport }));
  const started = Date.now();
  const collected = [];
  const queryResults = [];
  const metrics = { queries: config.queries.length, decisionSteps: 0, browserActions: 0, toolCalls: 0, toolCallsByName: {}, followUpVisits: 0, followUpToolCalls: 0 };
  const maxSteps = config.maxSteps ?? 20;
  for (let index = 0; index < config.queries.length; index += 1) {
    const query = config.queries[index];
    await browser.open(query.url);
    const loopResult = await runLoop({
      goal: query.goal ?? config.goal ?? 'Collect relevant evidence from this page using the configured tools.',
      plan: config.plan,
      subtask: query.subtask ?? config.subtask ?? `Collect this query: ${query.url}`,
      browser,
      tools: config.tools,
      apiKey,
      model,
      maxSteps: query.maxSteps ?? maxSteps,
      historyLimit: config.historyLimit,
      repeatLimit: config.repeatLimit,
      maxRecoveryAttempts: config.maxRecoveryAttempts,
      actionDelayMs,
      sleep,
      onEvent: onEvent ? (event) => onEvent({ query: index, ...event }) : undefined,
      decide: decision,
    });
    const trace = loopResult.trace ?? [];
    metrics.decisionSteps += trace.length;
    for (const entry of trace) {
      if (!entry.action?.executed) continue;
      metrics.browserActions += 1;
      if (entry.decision?.operation === 'RUN_TOOL') {
        metrics.toolCalls += 1;
        const name = entry.decision.target;
        metrics.toolCallsByName[name] = (metrics.toolCallsByName[name] ?? 0) + 1;
      }
    }
    const items = collectToolItems(trace, config.tools);
    for (const item of items) collected.push(item);
    queryResults.push({ index, url: query.url, status: loopResult.status, reason: loopResult.reason, collected: items.length });
  }

  const followUpResult = await runFollowUps(dedupe(collected), config, browser, onEvent, actionDelayMs, sleep);
  const unique = followUpResult.items;
  metrics.followUpVisits = followUpResult.metrics.visits;
  metrics.followUpToolCalls = followUpResult.metrics.toolCalls;
  metrics.browserActions += followUpResult.metrics.visits + followUpResult.metrics.toolCalls;
  const maxItems = config.maxItems ?? DEFAULT_MAX_ITEMS;
  const classified = [];
  const deferred = [];
  for (let offset = 0; offset < unique.length; offset += maxItems) {
    const batch = unique.slice(offset, offset + maxItems);
    const request = buildBatchClassificationRequest({ goal: config.profile.goal ?? config.goal, profile: config.profile, candidates: batch, model, maxItems, maxTextChars: config.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS });
    const labels = applyProfileOverrides(batch, await classifyBatch({ apiKey, request, profile: config.profile, endpoint, decide: decision }), config.profile);
    classified.push(...batch.map((item, index) => ({ ...item, ...(labels[index] ?? { status: 'classification-error', errors: ['missing result'] }) })));
  }
  if (unique.length > classified.length) deferred.push(...unique.slice(classified.length).map((item) => ({ ...item, status: 'deferred', reason: 'batch-limit' })));
  metrics.rawItems = queryResults.reduce((total, result) => total + result.collected, 0);
  metrics.uniqueItems = unique.length;
  metrics.classificationBatches = unique.length ? Math.ceil(unique.length / maxItems) : 0;
  metrics.jevRequests = metrics.decisionSteps + metrics.classificationBatches;
  metrics.durationMs = Date.now() - started;
  const output = { queryResults, collected: unique, classified, deferred, metrics };
  if (config.enrichKept) {
    output.enriched = keepClassifiedItems(unique, classified, config.profile).map((item) => ({ ...item, contactEvidence: enrichContactEvidence(item) }));
  }
  return output;
}

function collectToolItems(trace = [], tools = {}) {
  const items = [];
  for (const entry of trace) {
    const action = entry.action;
    const target = entry.decision?.target;
    if (!action?.executed || entry.decision?.operation !== 'RUN_TOOL' || !tools[target]?.collect) continue;
    const value = action.result?.data ?? action.result?.result ?? action.result;
    const batch = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
    items.push(...batch.map((item, index) => ({ ...item, id: itemIdentity(item, `${target}-${index}`) })));
  }
  return items;
}

async function runFollowUps(items, config, browser, onEvent, actionDelayMs = 0, sleep = defaultSleep) {
  const followUps = Array.isArray(config.followUps) ? config.followUps : [];
  if (!followUps.length) return { items, metrics: { visits: 0, toolCalls: 0 } };
  const output = [];
  const metrics = { visits: 0, toolCalls: 0 };
  let actionCompleted = false;
  for (const original of items) {
    let item = original;
    for (const followUp of followUps) {
      if (!matchesFollowUp(item, followUp.when)) continue;
      const targets = readTargets(item, followUp.targetField).slice(0, followUp.maxTargets ?? 1);
      for (const target of targets) {
        if (!allowedFollowUpTarget(target, followUp.allowedHosts)) continue;
        await pauseBetweenActions();
        const started = Date.now();
        await browser.open(target);
        actionCompleted = true;
        metrics.visits += 1;
        const values = [];
        for (const tool of followUp.tools ?? []) {
          await pauseBetweenActions();
          values.push(await browser.action('RUN_TOOL', tool));
          actionCompleted = true;
          metrics.toolCalls += 1;
        }
        const value = values.length === 1 ? values[0] : values;
        item = { ...item, [followUp.outputField ?? followUp.name ?? 'followUp']: value };
        if (onEvent) onEvent({ type: 'followup', name: followUp.name ?? 'followUp', id: item.id, target, tools: followUp.tools ?? [], durationMs: Date.now() - started });
      }
    }
    output.push(item);
  }
  return { items: output, metrics };

  async function pauseBetweenActions() {
    if (actionCompleted && actionDelayMs > 0) await sleep(actionDelayMs);
    actionCompleted = false;
  }
}

function matchesFollowUp(item, when = {}) {
  if (!when || when.always === true) return true;
  if (Array.isArray(when.missingAny) && when.missingAny.some((field) => !readValue(item, field))) return true;
  if (Array.isArray(when.presentAny) && when.presentAny.some((field) => readValue(item, field))) return true;
  return false;
}

function readTargets(item, field) {
  const value = readValue(item, field);
  return Array.isArray(value) ? value.filter(Boolean).map(String) : value ? [String(value)] : [];
}

function readValue(item, path) {
  return String(path ?? '').split('.').filter(Boolean).reduce((value, key) => value?.[key], item);
}

export function allowedFollowUpTarget(target, hosts = []) {
  if (!Array.isArray(hosts) || !hosts.length) return false;
  try {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return hosts.some((host) => {
      const allowed = String(host).toLowerCase().replace(/^\.+/, '');
      return allowed && (hostname === allowed || hostname.endsWith(`.${allowed}`));
    });
  } catch {
    return false;
  }
}

function itemIdentity(item, fallback) {
  const explicit = item?.id;
  if (explicit) return String(explicit);
  const identity = Object.entries(item ?? {}).find(([key, value]) => /(id|url|uri)$/i.test(key) && typeof value === 'string' && value);
  return String(identity?.[1] ?? fallback);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = itemIdentity(item, `${item.author ?? ''}|${item.title ?? ''}|${String(item.text ?? '').slice(0, 160)}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
