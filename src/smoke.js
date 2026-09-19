import { AgentBrowser } from './browser.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const browser = new AgentBrowser({ session: `jev-smoke-${process.pid}` });
const fixture = `file://${join(root, 'fixture/index.html')}`;
try {
  await browser.open(fixture);
  const observation = await browser.snapshot();
  if (!observation.snapshot || !Object.keys(observation.refs).length) throw new Error('fixture has no interactive refs');
  console.log(JSON.stringify({ ok: true, url: observation.url, refs: observation.refs }));
} finally {
  try { await browser.close(); } catch { /* browser may not have launched */ }
}
