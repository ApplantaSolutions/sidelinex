'use strict';

// Sideline Advisor V1 — AI EXPLANATION layer only. Coach-only, server-side,
// same ANTHROPIC_API_KEY-never-touches-the-browser rule as analyzePlay.js.
//
// Critical architectural boundary, per the roadmap: "Deterministic
// filtering -> transparent ranking -> real stats/context -> AI
// explanation." The ranking itself happens entirely client-side in
// sidelineAdvisor.js (pure, no AI) BEFORE this function is ever called.
// This function receives ONLY the already-ranked candidates — never the
// full Playbook, never raw snap data — and its ONLY job is to turn each
// candidate's real, already-computed reasons into one short natural
// sentence. It is explicitly forbidden from re-ranking, re-scoring, or
// adding any new factual/numeric claim.
//
// The one thing this function cannot fully trust the model to do on its
// own is honor "never invent a number" — so it doesn't trust it: every
// returned explanation is checked server-side against the exact set of
// numbers that actually appeared in that candidate's input (its reasons +
// the situation string). Any explanation containing a number NOT in that
// set is thrown out entirely and the caller gets null for that play,
// meaning the UI falls back to showing the deterministic reasons on their
// own — which is already useful without AI, per the "if AI is
// offline/unavailable, deterministic recommendations must still display"
// requirement.

const { withHttp, Errors } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { checkAndConsumeRateLimit } = require('./_lib/rateLimit');

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const MAX_CANDIDATES = 4;
const MAX_EXPLANATION_LEN = 160;

const SYSTEM_PROMPT = `You are a youth flag football sideline advisor inside SidelineX. A deterministic ranking system (not you) has already selected and ordered a short list of play candidates for the coach's next call, using real stats and situation data. Your ONLY job is to turn each candidate's already-computed reasons into ONE short, natural-language sentence a coach can read at a glance on their phone.

Rules you must follow exactly:
- You are NOT choosing, ranking, or scoring plays. That has already been done. Do not suggest a different order or a different play.
- You may ONLY restate/paraphrase the reasons given to you for each play. Never introduce a new number, statistic, percentage, or claim that is not already present in the reasons or situation text given to you.
- If a candidate's reasons are sparse or thin, keep the sentence honest and short rather than padding it with invented confidence or detail.
- Never use a bare percentage or invented probability anywhere.
- Keep each explanation under 20 words. One sentence. No football jargon overload — plain coach language.
- Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:
{"explanations": {"<playId>": "string", ...}}
One entry per playId given to you, no more, no fewer.`;

function buildUserPrompt(situation, candidates) {
  const lines = candidates.map((c) => `- playId: ${c.playId}\n  name: ${c.playName}\n  confidence: ${c.confidence}\n  reasons: ${JSON.stringify(c.reasons)}`);
  return `Situation: ${situation}\n\nCandidates (already ranked, in order):\n${lines.join('\n')}`;
}

/**
 * Same fence/prose-tolerant JSON extraction as analyzePlay.js — kept as
 * its own local copy (not shared) so each function file's behavior is
 * independently readable and testable, matching this project's existing
 * pattern.
 */
function extractJsonObject(text) {
  const trimmed = (text || '').trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) return fenceMatch[1];

  const start = trimmed.indexOf('{');
  if (start === -1) return trimmed;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed;
}

function extractNumbers(str) {
  return (String(str || '').match(/\d+(\.\d+)?/g) || []);
}

/**
 * The core anti-fabrication guard. allowedNumbers is built from ONLY real
 * input text (that candidate's reasons + the situation string) — anything
 * the AI's sentence contains that isn't in that set means it invented a
 * number, so the whole sentence is rejected (not edited/patched — a
 * partially-trusted AI sentence is worse than none, since the UI already
 * has a safe deterministic fallback to show instead).
 */
function containsOnlyKnownNumbers(explanation, allowedNumbers) {
  const used = extractNumbers(explanation);
  return used.every((n) => allowedNumbers.includes(n));
}

function sanitizeExplanations(raw, candidates, situation) {
  const result = {};
  candidates.forEach((c) => {
    const text = raw && raw.explanations ? raw.explanations[c.playId] : null;
    if (typeof text !== 'string' || !text.trim()) {
      result[c.playId] = null;
      return;
    }
    const trimmed = text.trim().slice(0, MAX_EXPLANATION_LEN);
    const allowedNumbers = [...extractNumbers(c.reasons.join(' ')), ...extractNumbers(situation)];
    result[c.playId] = containsOnlyKnownNumbers(trimmed, allowedNumbers) ? trimmed : null;
  });
  return result;
}

function validateCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw Errors.invalidArgument('candidates array is required');
  }
  if (candidates.length > MAX_CANDIDATES) {
    throw Errors.invalidArgument(`candidates must be at most ${MAX_CANDIDATES}`);
  }
  candidates.forEach((c) => {
    if (!c || typeof c.playId !== 'string' || typeof c.playName !== 'string' || !Array.isArray(c.reasons)) {
      throw Errors.invalidArgument('each candidate needs playId, playName, and a reasons array');
    }
  });
}

module.exports.buildUserPrompt = buildUserPrompt;
module.exports.extractJsonObject = extractJsonObject;
module.exports.sanitizeExplanations = sanitizeExplanations;
module.exports.containsOnlyKnownNumbers = containsOnlyKnownNumbers;
module.exports.validateCandidates = validateCandidates;

exports.handler = withHttp(async ({ event, data }) => {
  const decoded = await requireAuth(event);
  if (decoded.role !== 'coach') {
    throw Errors.permissionDenied('Only the coach can use the Sideline Advisor');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Errors.internal('Sideline Advisor explanations are not configured yet — missing ANTHROPIC_API_KEY.');
  }

  const situation = typeof data.situation === 'string' ? data.situation.slice(0, 300) : '';
  const candidates = data.candidates;
  validateCandidates(candidates);

  await checkAndConsumeRateLimit(`sidelineAdvisorExplain:${decoded.teamId}`);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600, // short sentences only — this is never a report
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(situation, candidates) }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error('Anthropic API error:', res.status, errText);
    // Explicitly NOT an error the client should show as broken — the
    // deterministic recommendations remain fully valid on their own. The
    // client treats a thrown/failed call here as "no AI gloss this time."
    throw Errors.internal('Sideline Advisor explanations are temporarily unavailable.');
  }

  const payload = await res.json();
  const textBlock = payload?.content?.find((c) => c.type === 'text');
  const rawText = textBlock?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(rawText));
  } catch (parseErr) {
    // eslint-disable-next-line no-console
    console.error('Sideline Advisor explain: could not parse model response as JSON.', parseErr.message, 'Raw text:', rawText);
    throw Errors.internal('Sideline Advisor explanations returned an unreadable response.');
  }

  return { explanations: sanitizeExplanations(parsed, candidates, situation) };
});
