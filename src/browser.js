import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WRAPPER_OWNED_ARGS = new Set(['--session', '--session-name', '--cdp', '--auto-connect', '--pin-tab', '--no-pin-tab']);

export class AgentBrowser {
  constructor({ session = `jev-${process.pid}`, command, timeoutMs = 30_000, cdp, autoConnect = false, pinTab = false, browserArgs = [], tools = {} } = {}) {
    this.session = session;
    const resolved = resolveBrowserCommand(command);
    this.command = resolved.command;
    this.commandPrefix = resolved.prefix;
    this.timeoutMs = timeoutMs;
    this.connectionArgs = cdp ? ['--cdp', String(cdp)] : autoConnect ? ['--auto-connect'] : [];
    if (pinTab) this.connectionArgs.push('--pin-tab');
    this.browserArgs = validateBrowserArgs(browserArgs);
    this.tools = tools;
  }

  async run(args, { stdin } = {}) {
    const commandArgs = browserCommandArgs({ session: this.session, connectionArgs: this.connectionArgs, browserArgs: this.browserArgs, args });
    try {
      const result = await runProcess(this.command, [...this.commandPrefix, ...commandArgs], stdin, this.timeoutMs);
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const detail = error.code === 'ENOENT'
        ? 'agent-browser executable not found; install agent-browser separately with npm or pass --browser-command <path>'
        : [error.message, error.stdout, error.stderr].filter(Boolean).join('\n');
      throw new Error(`agent-browser ${args.join(' ')} failed: ${detail}`, { cause: error });
    }
  }

  async open(url) { return this.run(['open', url]); }
  async close() { return this.run(['close']); }

  async eval(source) {
    const { stdout } = await this.run(['eval', '--json', '--stdin'], { stdin: source });
    try {
      const payload = JSON.parse(stdout);
      return payload?.data?.result ?? payload?.data?.value ?? payload?.result ?? payload?.value ?? payload;
    } catch (error) {
      throw new Error(`agent-browser returned invalid eval JSON: ${stdout.slice(0, 500)}`, { cause: error });
    }
  }

  async snapshot() {
    const { stdout } = await this.run(['snapshot', '--json']);
    let payload;
    try { payload = JSON.parse(stdout); } catch (error) {
      throw new Error(`agent-browser returned invalid snapshot JSON: ${stdout.slice(0, 500)}`, { cause: error });
    }
    return normalizeSnapshot(payload);
  }

  async action(operation, target, { text, selectValue, pressKey } = {}) {
    if (operation === 'RUN_TOOL') return this.runTool(target);
    const args = actionArgs(operation, target, { text, selectValue, pressKey });
    return this.run(args);
  }

  async runTool(name) {
    const tool = this.tools[name];
    if (!tool || (!tool.source && !tool.sourcePath)) throw new Error(`unknown browser tool: ${name}`);
    const source = tool.sourcePath ? await readFile(tool.sourcePath, 'utf8') : tool.source;
    const config = tool.config && typeof tool.config === 'object'
      ? `globalThis.__JEV_TOOL_CONFIG__ = ${JSON.stringify(tool.config)};\n`
      : '';
    return this.eval(`${config}${source}`);
  }
}

function resolveBrowserCommand(command) {
  if (command) return { command, prefix: [] };
  try {
    return { command: process.execPath, prefix: [require.resolve('agent-browser/bin/agent-browser.js')] };
  } catch {
    return { command: 'agent-browser', prefix: [] };
  }
}

function runProcess(command, args, stdin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(Object.assign(new Error(`exited with code ${code}`), { stdout, stderr }));
    });
    child.stdin.end(stdin ?? '');
  });
}

export function browserCommandArgs({ session, connectionArgs = [], browserArgs = [], args = [] }) {
  const autoConnect = connectionArgs.includes('--auto-connect');
  return [...(autoConnect ? [] : ['--session', session]), ...connectionArgs, ...browserArgs, ...args];
}

function validateBrowserArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('browserArgs must be an array of strings');
  for (const arg of args) {
    const name = arg.split('=', 1)[0];
    if (WRAPPER_OWNED_ARGS.has(name)) throw new Error(`browserArgs cannot override wrapper-owned ${name}`);
  }
  return args.slice();
}

export function normalizeSnapshot(payload) {
  const data = payload?.data ?? payload;
  const snapshot = data?.snapshot;
  const rawRefs = data?.refs;
  if (typeof snapshot !== 'string' || !rawRefs || typeof rawRefs !== 'object' || Array.isArray(rawRefs)) {
    throw new Error('agent-browser snapshot is missing data.snapshot or data.refs');
  }
  const refs = Object.fromEntries(Object.entries(rawRefs)
    .sort(([left], [right]) => refNumber(left) - refNumber(right))
    .map(([ref, value]) => [
      ref.startsWith('@') ? ref : `@${ref}`,
      typeof value === 'object' && value ? { name: String(value.name ?? ''), role: String(value.role ?? '') } : { name: String(value) },
    ]));
  return { url: String(data.url ?? data.origin ?? ''), snapshot, refs };
}

function refNumber(ref) {
  const match = String(ref).match(/(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function actionArgs(operation, target, { text, selectValue, pressKey } = {}) {
  switch (operation) {
    case 'CLICK': return ['click', target];
    case 'TYPE': return ['fill', target, text];
    case 'SELECT': return ['select', target, selectValue];
    case 'PRESS': return ['press', pressKey];
    case 'SCROLL_UP': return ['scroll', 'up'];
    case 'SCROLL_DOWN': return ['scroll', 'down'];
    case 'BACK': return ['back'];
    case 'WAIT': return ['wait', '500'];
    default: throw new Error(`unsupported operation: ${operation}`);
  }
}
