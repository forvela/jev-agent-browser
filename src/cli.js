#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentBrowser } from './browser.js';
import { requestDecision } from './decision.js';
import { runLoop, validateActionDelayMs } from './loop.js';
import { applyProfileOverrides, buildBatchClassificationRequest, classifyBatch } from './classifier.js';
import { enrichContactEvidence, keepClassifiedItems } from './research.js';
import { loadResearchConfig, runResearch } from './research-runner.js';

export function parseArgs(argv) {
  const options = { attach: false, autoConnect: false, pinTab: false, jsonl: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    const key = arg.slice(2).replaceAll('-', '');
    if (key === 'maxsteps') options.maxSteps = Number(argv[++i]);
    else if (key === 'autoconnect') options.autoConnect = true;
    else if (key === 'attach') options.attach = true;
    else if (key === 'pintab') options.pinTab = true;
    else if (key === 'jsonl') options.jsonl = true;
    else if (['goal', 'url', 'text', 'selectvalue', 'presskey', 'plan', 'subtask', 'session', 'model', 'endpoint', 'cdp', 'mode', 'profilejson', 'config', 'browsercommand', 'apikeyenv', 'decisiontransport'].includes(key)) options[key] = argv[++i];
    else if (key === 'browserarg') (options.browserArgs ??= []).push(argv[++i]);
    else if (key === 'maxitems') options.maxItems = Number(argv[++i]);
    else if (key === 'maxtextchars') options.maxTextChars = Number(argv[++i]);
    else if (key === 'browsertimeout') options.browserTimeoutMs = Number(argv[++i]);
    else if (key === 'summary') options.summary = true;
    else if (key === 'enrichkept') options.enrichKept = true;
    else if (key === 'historylimit') options.historyLimit = Number(argv[++i]);
    else if (key === 'repeatlimit') options.repeatLimit = Number(argv[++i]);
    else if (key === 'maxrecoveryattempts') options.maxRecoveryAttempts = Number(argv[++i]);
    else if (key === 'actiondelay') options.actionDelayMs = Number(argv[++i]);
    else if (key === 'inputvaluesjson') {
      try { options.inputValues = JSON.parse(argv[++i]); } catch (error) { throw new Error(`--input-values-json must be valid JSON: ${error.message}`); }
    }
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

export async function loadCliConfig(configPath) {
  const defaultPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'jev', 'config.json');
  const path = configPath ?? process.env.JEV_CONFIG ?? defaultPath;
  try {
    const config = JSON.parse(await readFile(path, 'utf8'));
    return { ...config, tools: normalizeCliTools(config.tools, path) };
  } catch (error) {
    if (!configPath && error.code === 'ENOENT') return {};
    throw new Error(`cannot read Jev config ${path}: ${error.message}`);
  }
}

export function normalizeCliTools(tools = {}, configPath = process.cwd()) {
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) throw new Error('config tools must be an object');
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new Error(`config tool ${name} must be an object`);
    return [name, {
      description: tool.description ?? name,
      sourcePath: tool.path ? resolve(dirname(configPath), tool.path) : undefined,
      source: tool.source,
      config: tool.config,
      collect: Boolean(tool.collect),
    }];
  }));
}

export function applyCliConfig(options, config = {}) {
  const decision = config.decision ?? {};
  return {
    ...options,
    goal: options.goal ?? config.goal,
    url: options.url ?? config.url,
    model: options.model ?? decision.model ?? config.model,
    endpoint: options.endpoint ?? decision.endpoint ?? config.endpoint,
    apikeyenv: options.apikeyenv ?? decision.apiKeyEnv ?? config.apiKeyEnv,
    decisiontransport: options.decisiontransport ?? decision.transport ?? config.decisionTransport,
    actionDelayMs: options.actionDelayMs ?? config.pacing?.actionDelayMs ?? 0,
    tools: options.tools ?? config.tools ?? {},
    maxSteps: options.maxSteps ?? config.maxSteps ?? 32,
  };
}

export function isSuccessfulExit(status) {
  return status === 'success' || status === 'limit';
}

export function validateOptions(options) {
  validateActionDelayMs(options.actionDelayMs ?? 0);
  if (options.mode === 'classify') {
    if (!options.profilejson) throw new Error('--profile-json is required in classify mode');
    return;
  }
  if (options.mode === 'research') {
    if (!options.config) throw new Error('--config is required in research mode');
    if (!options.attach && !options.autoConnect && !options.cdp) throw new Error('research mode requires --attach with --auto-connect or --cdp');
    return;
  }
  if (!options.goal) throw new Error('--goal is required');
  if (!options.url && !options.attach) throw new Error('--url or --attach is required');
  if (options.attach && !options.autoConnect && !options.cdp) {
    throw new Error('--attach requires --auto-connect or --cdp <port|url>');
  }
}

export function helpText() {
  return `jev-agent-browser: bounded typed-decision browser loop

Usage:
  node src/cli.js --url <url> --goal <goal> [options]
  node src/cli.js --attach --auto-connect --goal <goal> [options]

Options:
  --attach                    Use the current tab; do not navigate without --url
  --auto-connect              Attach to a running Chrome discovered by agent-browser
  --browser-command <path>    Override the agent-browser executable
  --browser-arg <value>      Pass a native agent-browser argument (repeatable)
  --cdp <port|url>             Attach to a specific Chrome DevTools endpoint
  --pin-tab                    Keep this session bound to its attached tab
  --text <value>              Enable TYPE with this explicit value
  --select-value <value>      Enable SELECT with this explicit value
  --press-key <key>           Enable PRESS with this explicit key (e.g. Enter)
  --input-values-json <json>  Parent values for non-secret test flows
  --mode classify             Classify JSON items from stdin using a profile
  --mode research             Collect configured queries, tools, and classify
  skills list|get|path        Read the installed Jev usage skill
  --profile-json <json>       Profile dimensions for classify mode
  --config <path>             JSON config; defaults to ~/.config/jev/config.json when present
  --api-key-env <name>        Environment variable containing the Decisions key
  --decision-transport <name> typesafe (default) or fetch
  --max-items <n>             Items per Decisions request (default: 20)
  --max-text-chars <n>        Text bound per item (default: 2000)
  --enrich-kept               Extract contacts/links after profile keep rules
  --browser-timeout <ms>      Browser command timeout (research mode)
  --summary                   Compact research result/event output
  --plan <text>               Parent plan context
  --subtask <text>            Short-horizon subtask context
  --history-limit <n>         Recent actions sent to Jev (default: 6)
  --repeat-limit <n>          Equivalent actions before recovery (default: 2)
  --max-recovery-attempts <n> Local recovery attempts (default: 3)
  --action-delay <ms>        Fixed delay between successful browser actions (default: 0)
  --jsonl                     Stream JSON events, one object per line
  --max-steps <n>             Maximum actions (default: 32)
  --session <name>            agent-browser session name
  --model <name>              Jev model
  --endpoint <url>            Decisions API endpoint/base URL
  -h, --help

Environment:
  TYPESAFE_API_KEY            Required for the default TypeSafe SDK transport
  OPENROUTER_API_KEY          Use this when the config or --api-key-env selects OpenRouter
`;
}

async function runClassificationMode(options) {
  const input = JSON.parse(await readStdin());
  const items = Array.isArray(input) ? input : input.items ?? input.results;
  if (!Array.isArray(items)) throw new Error('classify mode expects a JSON array or an object with items/results');
  const profile = JSON.parse(options.profilejson);
  const apiKey = process.env[options.apikeyenv ?? 'TYPESAFE_API_KEY'];
  const request = buildBatchClassificationRequest({ goal: options.goal, candidates: items, profile, model: options.model, maxItems: options.maxItems, maxTextChars: options.maxTextChars });
  const bounded = items.slice(0, request.state.candidates.length);
  const classifications = applyProfileOverrides(bounded, await classifyBatch({ apiKey, request, profile, endpoint: options.endpoint, decide: (args) => requestDecision({ ...args, transport: options.decisiontransport }) }), profile);
  const classified = bounded.map((item, index) => ({ ...item, ...(classifications[index] ?? { index, status: 'classification-error', errors: ['missing result'] }) }));
  const deferred = items.slice(bounded.length).map((item) => ({ ...item, status: 'deferred', reason: 'batch-limit' }));
  const output = { classified, deferred };
  if (options.enrichKept) {
    const kept = keepClassifiedItems(bounded, classifications, profile);
    output.enriched = kept.map((item) => ({ ...item, contactEvidence: enrichContactEvidence(item) }));
  }
  return output;
}

function compactResearchResult(output) {
  const compact = (item) => ({
    id: item.id,
    sourceUrl: itemSourceUrl(item),
    author: item.author,
    title: item.title,
    text: item.text ? item.text.slice(0, 800) : undefined,
    status: item.status,
    labels: item.labels,
    reason: item.reason,
    reasons: item.reasons ?? item.hardFilterReasons,
    policyReasons: item.policyReasons,
    links: compactLinks(item),
    contactEvidence: compactContactEvidence(item),
  });
  const classifications = new Map((output.classified ?? []).map((item) => [item.id, item]));
  return {
    queryResults: output.queryResults,
    counts: { collected: output.collected?.length ?? 0, classified: output.classified?.length ?? 0, deferred: output.deferred?.length ?? 0, enriched: output.enriched?.length ?? 0 },
    metrics: output.metrics,
    classified: (output.classified ?? []).map(compact),
    deferred: (output.deferred ?? []).map(compact),
    enriched: (output.enriched ?? []).map((item) => compact({ ...classifications.get(item.id), ...item })),
  };
}

function itemSourceUrl(item) {
  const entry = Object.entries(item ?? {}).find(([key, value]) => /(url|uri)$/i.test(key) && typeof value === 'string' && value);
  return entry?.[1] ?? item.id;
}

function compactLinks(item) {
  const links = Array.isArray(item.links) ? item.links.map((link) => typeof link === 'string' ? link : link?.href) : [];
  return [...new Set([...links, ...(item.contactEvidence?.urls ?? [])].filter(Boolean))].slice(0, 40);
}

function compactContactEvidence(item) {
  const evidence = item.contactEvidence;
  if (!evidence) return undefined;
  return { emails: evidence.emails ?? [], phones: evidence.phones ?? [], urls: compactLinks(item) };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

export async function runSkillsCommand(argv = []) {
  const command = argv[0] ?? 'list';
  const name = argv[1] ?? 'core';
  const path = skillPath(name);
  if (command === 'list') return 'core\n';
  if (command === 'path') return `${path}\n`;
  if (command === 'get') return readFile(path, 'utf8');
  throw new Error('usage: jev skills list | jev skills get core [--full] | jev skills path [core]');
}

function skillPath(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`unknown skill: ${name}`);
  return fileURLToPath(new URL(`../skills/${name}.md`, import.meta.url));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function writeJsonl(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

if (isMainModule()) {
  let jsonl = process.argv.includes('--jsonl');
  try {
    if (process.argv[2] === 'skills') {
      process.stdout.write(await runSkillsCommand(process.argv.slice(3)));
      process.exit(0);
    }
    let options = parseArgs(process.argv.slice(2));
    jsonl = options.jsonl;
    if (options.help) { console.log(helpText()); process.exit(0); }
    if (options.mode) validateOptions(options);
    if (options.mode === 'classify') {
      const output = await runClassificationMode(options);
      console.log(JSON.stringify(output));
      process.exit(0);
    }
    if (options.mode === 'research') {
      const config = await loadResearchConfig(options.config);
      const decisionConfig = config.decision ?? {};
      const endpoint = options.endpoint ?? decisionConfig.endpoint ?? config.endpoint;
      const apiKey = process.env[options.apikeyenv ?? decisionConfig.apiKeyEnv ?? config.apiKeyEnv ?? 'TYPESAFE_API_KEY'];
      const headers = decisionConfig.headers ?? config.decisionHeaders;
      const transport = options.decisiontransport ?? decisionConfig.transport ?? config.decisionTransport ?? 'typesafe';
      const browser = new AgentBrowser({ command: options.browsercommand ?? config.browserCommand, session: options.session, cdp: options.cdp, autoConnect: options.autoConnect, pinTab: options.pinTab, browserArgs: options.browserArgs ?? config.browserArgs ?? [], timeoutMs: options.browserTimeoutMs ?? config.browserTimeoutMs ?? 120_000, tools: config.tools });
      const output = await runResearch({ config, browser, actionDelayMs: options.actionDelayMs, apiKey, model: options.model, endpoint, headers, transport, onEvent: options.jsonl ? writeJsonl : undefined });
      const rendered = options.summary ? compactResearchResult(output) : output;
      if (options.jsonl) writeJsonl({ type: 'result', status: 'completed', ...rendered });
      else console.log(JSON.stringify(rendered));
      process.exit(0);
    }
    const config = await loadCliConfig(options.config);
    options = applyCliConfig(options, config);
    validateOptions(options);
    const browser = new AgentBrowser({ command: options.browsercommand, session: options.session, cdp: options.cdp, autoConnect: options.autoConnect, pinTab: options.pinTab, browserArgs: options.browserArgs ?? [], tools: options.tools });
    const apiKey = process.env[options.apikeyenv ?? 'TYPESAFE_API_KEY'];
    if (options.url) await browser.open(options.url);
    const result = await runLoop({
      goal: options.goal,
      browser,
      apiKey,
      model: options.model,
      text: options.text,
      selectValue: options.selectvalue,
      pressKey: options.presskey,
      inputValues: options.inputValues,
      plan: options.plan,
      subtask: options.subtask,
      historyLimit: options.historyLimit,
      repeatLimit: options.repeatLimit,
      maxRecoveryAttempts: options.maxRecoveryAttempts,
      maxSteps: options.maxSteps,
      actionDelayMs: options.actionDelayMs,
      tools: options.tools,
      onEvent: options.jsonl ? writeJsonl : undefined,
      decide: ({ request }) => requestDecision({ apiKey, request, endpoint: options.endpoint, transport: options.decisiontransport ?? 'typesafe' }),
    });
    if (jsonl) {
      writeJsonl({
        type: 'result', status: result.status, reason: result.reason,
        steps: result.steps, durationMs: result.durationMs, handoff: result.handoff,
      });
    } else {
      console.log(JSON.stringify(result));
    }
    process.exitCode = isSuccessfulExit(result.status) ? 0 : 1;
  } catch (error) {
    if (jsonl) writeJsonl({ type: 'error', message: error.message });
    else console.error(`jev-agent-browser: ${error.message}`);
    process.exitCode = 2;
  }
}
