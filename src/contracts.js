const INPUT_KINDS = new Set(['url', 'text', 'select', 'key', 'secret']);

export const SUPPORTED_INPUT_KINDS = [...INPUT_KINDS];

export function normalizeInputs({ inputs = [], inputValues = {}, text, selectValue, pressKey } = {}) {
  const entries = [];
  const add = (raw, fallbackKey, fallbackKind = 'text') => {
    const item = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : { value: raw };
    const key = String(item.key ?? fallbackKey ?? '').trim();
    if (!key) throw new Error('goal input key is required');
    const kind = String(item.kind ?? fallbackKind).trim().toLowerCase();
    if (!INPUT_KINDS.has(kind)) throw new Error(`unsupported goal input kind: ${kind}`);
    if (item.value === undefined || item.value === null) throw new Error(`goal input ${key} requires a value`);
    const value = typeof item.value === 'string' ? item.value : String(item.value);
    if (!value) throw new Error(`goal input ${key} requires a non-empty value`);
    const secret = Boolean(item.secret || kind === 'secret');
    if (kind === 'url') validateUrl(value, key);
    entries.push({ key, kind, value, targetHint: item.targetHint ? String(item.targetHint) : undefined, secret });
  };

  if (Array.isArray(inputs)) inputs.forEach((input) => add(input));
  else if (inputs && typeof inputs === 'object') Object.entries(inputs).forEach(([key, input]) => add(input, key));
  else throw new Error('inputs must be an array or object');

  if (inputValues && typeof inputValues === 'object' && !Array.isArray(inputValues)) {
    Object.entries(inputValues).forEach(([key, value]) => add(value, key));
  } else if (inputValues !== undefined && inputValues !== null) {
    throw new Error('inputValues must be an object');
  }
  if (text !== undefined && text !== null) add(text, '__legacy_text', 'text');
  if (selectValue !== undefined && selectValue !== null) add(selectValue, '__legacy_select', 'select');
  if (pressKey !== undefined && pressKey !== null) add(pressKey, '__legacy_press', 'key');

  const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
  return {
    entries,
    byKey,
    values: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
    metadata: entries.map(({ key, kind, targetHint, secret }) => ({ key, kind, targetHint, secret })),
  };
}

export function validateUrl(value, key = 'url') {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`input ${key} must be a non-empty URL`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`input ${key} must be a valid URL`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`input ${key} must use http or https`);
  return value.trim();
}

export function inputForKey(normalized, key, kinds = null) {
  if (!key || key === 'none_of_the_above') return undefined;
  const entry = normalized?.byKey?.[key];
  if (!entry || (kinds && !kinds.includes(entry.kind))) return undefined;
  return entry;
}

export function inputChoices(normalized, kinds) {
  return Object.fromEntries([
    ['none_of_the_above', 'No supplied input is appropriate.'],
    ...(normalized?.entries ?? [])
      .filter((entry) => kinds.includes(entry.kind))
      .map((entry) => [entry.key, [entry.kind, entry.targetHint].filter(Boolean).join(': ') || entry.kind]),
  ]);
}

export function redact(value, secret = false) {
  return secret ? '[REDACTED]' : value;
}

export function redactInputMetadata(normalized) {
  return (normalized?.metadata ?? []).map((entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)));
}

export function redactActionInput(entry) {
  if (!entry) return undefined;
  return { key: entry.key, kind: entry.kind, targetHint: entry.targetHint, secret: entry.secret };
}
