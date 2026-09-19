import { DEFAULT_MODEL, requestDecision } from './decision.js';

export const DEFAULT_MAX_ITEMS = 20;
export const DEFAULT_MAX_TEXT_CHARS = 2_000;

export function validateProfile(profile = {}) {
  const dimensions = profile.dimensions;
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) throw new Error('profile.dimensions must be an object');
  const normalized = {};
  for (const [name, dimension] of Object.entries(dimensions)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error(`invalid profile dimension: ${name}`);
    if (!dimension || typeof dimension.instructions !== 'string' || !dimension.instructions.trim()) throw new Error(`profile dimension ${name} needs instructions`);
    const choices = dimension.choices;
    if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).length < 2 || Object.keys(choices).length > 8) throw new Error(`profile dimension ${name} needs 2-8 choices`);
    normalized[name] = { instructions: dimension.instructions, choices: Object.fromEntries(Object.entries(choices).map(([choice, description]) => [String(choice), String(description)])) };
  }
  return { ...profile, dimensions: normalized };
}

export function buildBatchClassificationRequest({ goal, candidates, profile, model = DEFAULT_MODEL, maxItems = DEFAULT_MAX_ITEMS, maxTextChars = DEFAULT_MAX_TEXT_CHARS } = {}) {
  const normalizedProfile = validateProfile(profile);
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('candidates must be a non-empty array');
  if (!Number.isInteger(maxItems) || maxItems < 1) throw new Error('maxItems must be a positive integer');
  if (!Number.isInteger(maxTextChars) || maxTextChars < 1) throw new Error('maxTextChars must be a positive integer');
  const bounded = candidates.slice(0, maxItems);
  const questions = {};
  for (let index = 0; index < bounded.length; index += 1) {
    for (const [dimension, config] of Object.entries(normalizedProfile.dimensions)) {
      questions[questionKey(index, dimension)] = { type: 'choice', instructions: config.instructions, criteria: config.choices };
    }
  }
  return {
    model,
    state: {
      goal: goal ?? normalizedProfile.goal ?? 'Classify these evidence items for relevance and next action.',
      ...(normalizedProfile.context ? { context: normalizedProfile.context } : {}),
      profile: normalizedProfile,
      candidates: bounded.map((candidate, index) => sanitizeCandidate(candidate, index, maxTextChars, normalizedProfile.evidenceFields)),
    },
    questions,
  };
}

export function parseBatchClassificationResponse(payload, profile, candidateCount) {
  const normalizedProfile = validateProfile(profile);
  const answers = answerObject(payload);
  const results = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const labels = {};
    const errors = [];
    for (const [dimension, config] of Object.entries(normalizedProfile.dimensions)) {
      const value = pickAnswer(answers[questionKey(index, dimension)]);
      if (!Object.hasOwn(config.choices, value)) errors.push(`${dimension}:${value ?? 'missing'}`);
      else labels[dimension] = value;
    }
    results.push(errors.length ? { index, status: 'classification-error', errors } : { index, status: 'classified', labels });
  }
  return results;
}

export async function classifyBatch({ apiKey, request, profile, endpoint, timeoutMs, fetchImpl, decide = requestDecision }) {
  const candidateCount = request.state.candidates.length;
  return decide({ apiKey, request, endpoint, timeoutMs, fetchImpl, parseResponse: (payload) => parseBatchClassificationResponse(payload, profile, candidateCount) });
}

export function applyProfileOverrides(candidates, classifications, profile = {}) {
  const overrides = Array.isArray(profile.overrides) ? profile.overrides : [];
  return classifications.map((classification, index) => {
    if (classification?.status !== 'classified') return classification;
    const matched = overrides.filter((override) => matchesOverride(candidates[index], override?.when));
    if (!matched.length) return classification;
    return {
      ...classification,
      labels: matched.reduce((labels, override) => ({ ...labels, ...(override?.set?.labels ?? {}) }), { ...classification.labels }),
      policyReasons: matched.map((override) => override.reason).filter(Boolean),
    };
  });
}

function matchesOverride(candidate, when = {}) {
  const value = readPath(candidate, when.field);
  if (when.matches === undefined) return Boolean(value);
  try { return new RegExp(String(when.matches), 'i').test(String(value ?? '')); } catch { return false; }
}

function readPath(value, path) {
  return String(path ?? '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function sanitizeCandidate(candidate, index, maxTextChars, evidenceFields = []) {
  evidenceFields = Array.isArray(evidenceFields) ? evidenceFields : [];
  return {
    id: String(candidate?.id ?? index),
    author: redact(String(candidate?.author ?? '').slice(0, 160)),
    title: redact(String(candidate?.title ?? '').slice(0, 240)),
    company: redact(String(candidate?.company ?? candidate?.company_or_client ?? '').slice(0, 160)),
    location: redact(String(candidate?.location ?? candidate?.geo ?? candidate?.remote_scope ?? '').slice(0, 160)),
    stack: redact(String(candidate?.stack ?? '').slice(0, 300)),
    signals: redact({ positive: Array.isArray(candidate?.positive) ? candidate.positive.slice(0, 12) : [], negative: Array.isArray(candidate?.negative) ? candidate.negative.slice(0, 12) : [] }),
    evidence: Object.fromEntries(evidenceFields.map((field) => [field, redact(candidate?.[field], Math.max(200, Math.floor(maxTextChars / 2)))])),
    text: redact(String(candidate?.text ?? candidate?.summary ?? candidate?.title ?? '').slice(0, maxTextChars)),
  };
}

function redact(value, maxChars = 1_000) {
  if (typeof value === 'string') {
    return value
      .replace(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
      .replace(/(?:\+\d[\d\s().-]{7,}\d|\b\d{2,4}[\s().-]\d{3}[\s().-]\d{3,4}\b)/g, '[redacted-phone]')
      .replace(/(?:https?|mailto):\/\/[^\s<>'"]+/gi, '[redacted-url]')
      .slice(0, maxChars);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, maxChars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, redact(item, maxChars)]));
  return value;
}

function questionKey(index, dimension) { return `candidate_${index}_${dimension}`; }

function answerObject(payload) {
  let value = payload?.answers ?? payload?.result ?? payload?.output ?? payload;
  if (Array.isArray(value) && value.every((item) => item && typeof item === 'object' && item.name)) value = Object.fromEntries(value.map((item) => [item.name, item.answer ?? item.value ?? item]));
  if (typeof value === 'string') {
    try { return answerObject(JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())); } catch { return {}; }
  }
  if (value?.message?.content) return answerObject(value.message.content);
  if (Array.isArray(value?.choices) && value.choices[0]) return answerObject(value.choices[0].message?.content ?? value.choices[0]);
  return value && typeof value === 'object' ? value : {};
}

function pickAnswer(value) { return typeof value === 'string' ? value : value?.choice ?? value?.value ?? value?.selected ?? value?.name; }

export { questionKey };
