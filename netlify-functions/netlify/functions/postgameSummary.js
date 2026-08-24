'use strict';

// Postgame Analytics V1 — OPTIONAL AI summary layer. Coach-only,
// server-side, same ANTHROPIC_API_KEY-never-touches-the-browser rule as
// analyzePlay.js and sidelineAdvisorExplain.js.
//
// Architectural boundary, per the roadmap: "After deterministic analytics
// exist, AI may create a SHORT coach-facing summary... AI receives only
// computed real data... must NOT invent numbers, plays, player results,
// defensive looks, or causal claims unsupported by data." This function
// never sees raw snaps or the Playbook — only the already-computed
// worked/review facts, summary totals, and practice suggestions the
// client's postgameAnalytics.js produced. Its ONLY job is prose.
//
// Same anti-fabrication guard as sidelineAdvisorExplain.js: every number
// in the model's output is checked against the exact set of numbers that
// actually appeared in the input. Anything else gets the whole summary
// rejected (null), not edited — the client already has the full
// deterministic report to show on its own, so a rejected AI summary is
// never a broken experience, just a missing extra paragraph.

const { withHttp, Errors } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { checkAndConsumeRateLimit } = require('./_lib/rateLimit');

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const MAX_SUMMARY_LEN = 900;

const SYSTEM_PROMPT = `You are a youth flag football postgame analyst inside SidelineX. A deterministic analytics system (not you) has already computed every real number in this game's report. Your ONLY job is to write ONE short, coach-facing paragraph (3-5 sentences) that helps the coach notice patterns in the data already given to you.

Rules you must follow exactly:
- You may ONLY reference numbers, play names, player references, and defensive looks that appear in the data given to you below. Never introduce a number, statistic, percentage, play, player result, or defensive look that isn't already there.
- Never state a causal claim ("the defense knew X was coming") unless the given data explicitly supports it.
- Use neutral, constructive coaching language. Never call a player "bad," "weak," or similar — describe what happened, not a verdict on the child.
- If the data given to you is thin, say so honestly rather than padding with generic coaching language.
- Keep it SHORT — a coach reads this on their phone after a game, not a report.
- Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:
{"summary": "string"}`;

function buildUserPrompt(data) {
  return `Postgame data (already computed, real, and final — use ONLY these facts):\n${JSON.stringify(data, null, 0)}`;
}

/**
 * Same fence/prose-tolerant JSON extraction as the other AI functions —
 * kept as its own local copy per this project's existing pattern.
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

function extractNumbers(value) {
  return (JSON.stringify(value) || '').match(/\d+(\.\d+)?/g) || [];
}

function containsOnlyKnownNumbers(text, allowedNumbers) {
  const used = (String(text || '').match(/\d+(\.\d+)?/g) || []);
  return used.every((n) => allowedNumbers.includes(n));
}

/**
 * Returns the summary string, or null if it was rejected (fabricated a
 * number, empty, wrong type, or too long to trust as "short").
 */
function sanitizeSummary(raw, inputData) {
  const text = raw?.summary;
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim().slice(0, MAX_SUMMARY_LEN);
  const allowedNumbers = extractNumbers(inputData);
  return containsOnlyKnownNumbers(trimmed, allowedNumbers) ? trimmed : null;
}

module.exports.buildUserPrompt = buildUserPrompt;
module.exports.extractJsonObject = extractJsonObject;
module.exports.containsOnlyKnownNumbers = containsOnlyKnownNumbers;
module.exports.sanitizeSummary = sanitizeSummary;

exports.handler = withHttp(async ({ event, data }) => {
  const decoded = await requireAuth(event);
  if (decoded.role !== 'coach') {
    throw Errors.permissionDenied('Only the coach can generate a Postgame AI summary');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Errors.internal('Postgame AI summary is not configured yet — missing ANTHROPIC_API_KEY.');
  }

  const postgameData = data.postgameData;
  if (!postgameData || typeof postgameData !== 'object') {
    throw Errors.invalidArgument('postgameData is required');
  }

  await checkAndConsumeRateLimit(`postgameSummary:${decoded.teamId}`);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(postgameData) }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error('Anthropic API error:', res.status, errText);
    // Not a client-facing error the report should show as broken — the
    // deterministic report is already complete on its own.
    throw Errors.internal('Postgame AI summary is temporarily unavailable.');
  }

  const payload = await res.json();
  const textBlock = payload?.content?.find((c) => c.type === 'text');
  const rawText = textBlock?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(rawText));
  } catch (parseErr) {
    // eslint-disable-next-line no-console
    console.error('Postgame summary: could not parse model response as JSON.', parseErr.message, 'Raw text:', rawText);
    throw Errors.internal('Postgame AI summary returned an unreadable response.');
  }

  return { summary: sanitizeSummary(parsed, postgameData) };
});
