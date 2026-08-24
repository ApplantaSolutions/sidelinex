'use strict';

// AI Play Analyzer (Play Intelligence V1). Coach-only, server-side —
// ANTHROPIC_API_KEY never touches the browser, matching the project's
// standing rule that AI calls must be server-side.
//
// Priority of inputs per the roadmap: structured Play Designer data
// (formation, routes, timing, Primary/Secondary/Decoy, defensive look,
// existing coach metadata) always comes first. This function does NOT
// attempt computer-vision reading of an uploaded hand-drawn diagram —
// that's explicitly deferred (see the roadmap's "do not fake it" note).
// If a play has no structured routes at all, this function still runs
// against whatever structured data it does have and is honest about the
// gap via NOT ENOUGH INFORMATION rather than inventing an analysis.
//
// The model is instructed to return strict JSON and never fabricate a
// numeric confidence — every confidence value is validated server-side
// against the fixed HIGH/MEDIUM/LIMITED vocabulary before it's ever
// returned to the client; anything else gets coerced to LIMITED with an
// honest "insufficient information" note rather than passed through.

const { getDb } = require('./_lib/firebaseAdmin');
const { withHttp, Errors } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { checkAndConsumeRateLimit } = require('./_lib/rateLimit');

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const CONFIDENCE_VALUES = new Set(['HIGH', 'MEDIUM', 'LIMITED']);

const SYSTEM_PROMPT = `You are a youth flag football (5v5/6v6/7v7) coaching analyst inside SidelineX, a play-design app. A coach has designed a play using structured data (player positions, route shapes, timing, and their own Primary/Secondary/Decoy designations). Your job is ADVISORY coaching intelligence, not a guarantee of outcomes.

Rules you must follow exactly:
- Base your analysis on the structured route/formation/timing data given to you. Do not invent information not present or reasonably inferable from it.
- Every "confidence" value must be exactly one of: "HIGH", "MEDIUM", "LIMITED". Never a number, percentage, or made-up statistic.
- If the play has too little structured data to say something useful (e.g. no routes at all), say so honestly using "LIMITED" confidence and a "NOT ENOUGH INFORMATION" style explanation — never fabricate an answer to fill the space.
- Every strength/weakness/coverage-fit claim must include a short, concrete football reason referencing the actual routes/positions given — never a bare buzzword with no explanation.
- Keep every string SHORT — this is read on a coach's phone, not a report. One sentence per item, max ~20 words.
- Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:
{
  "strengths": ["string", ...],
  "weaknesses": ["string", ...],
  "bestSituations": ["string", ...],
  "coverageFit": {
    "man": {"confidence": "HIGH"|"MEDIUM"|"LIMITED", "why": "string"},
    "zone": {"confidence": "HIGH"|"MEDIUM"|"LIMITED", "why": "string"},
    "pressure": {"confidence": "HIGH"|"MEDIUM"|"LIMITED", "why": "string"}
  },
  "suggestedMetadata": {
    "category": "pass"|"run"|"play_action_pass"|"play_action_run"|"special_trick"|null,
    "riskLevel": "low"|"medium"|"high"|null,
    "yardageDepth": "short"|"medium"|"deep"|null,
    "tags": {"beatsMan": true|false, "beatsZone": true|false, "beatsPressure": true|false, "goalLine": true|false, "conversion": true|false, "explosive": true|false, "safe": true|false},
    "effectiveness": {"vsMan": "strong"|"neutral"|"weak"|null, "vsZone": "strong"|"neutral"|"weak"|null, "vsPressure": "strong"|"neutral"|"weak"|null},
    "primaryTargetSlot": "string or null — ONLY suggest this if the coach has not already set primary/secondary/decoy intent; if they already set it, return null here",
    "secondaryTargetSlot": "string or null, same rule",
    "decoySlots": ["string", ...]
  }
}

If the coach's own Primary/Secondary/Decoy intent (given to you below) is already set, return null/[] for those three suggestedMetadata fields — never propose changing something the coach already decided.`;

function buildUserPrompt(play) {
  return `Analyze this play. All coordinates are normalized 0-1 (y increases downfield from the line of scrimmage toward the offense's own end).

Formation: ${play.formation || 'not named'}
Category (coach-set): ${play.category || 'not set'}
Side: ${play.side}

Player positions: ${JSON.stringify(play.positions || {})}

Routes (routeType, designation, timing): ${JSON.stringify(play.routes || {})}

Coach's own Primary/Secondary/Decoy intent: primary=${play.primaryTargetSlot || 'none set'}, secondary=${play.secondaryTargetSlot || 'none set'}, decoys=${(play.decoySlots || []).join(', ') || 'none set'}

Defensive look selected (if any): ${play.defense?.mode ? `${play.defense.mode}, defenders: ${JSON.stringify(play.defense.defenders)}` : 'none selected'}

Existing coach metadata: riskLevel=${play.existingMetadata?.riskLevel || 'not set'}, tags=${JSON.stringify(play.existingMetadata?.tags || {})}, effectiveness=${JSON.stringify(play.existingMetadata?.effectiveness || {})}`;
}

/**
 * Models are instructed to return ONLY a JSON object, but sometimes wrap
 * it in a ```json fence or add a stray sentence anyway — this strips a
 * fence if present, then falls back to slicing out the first balanced
 * {...} block rather than failing outright on otherwise-valid JSON that
 * just wasn't returned perfectly bare.
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

function sanitizeConfidence(value) {
  const v = String(value || '').toUpperCase();
  return CONFIDENCE_VALUES.has(v) ? v : 'LIMITED';
}

function sanitizeAnalysis(raw) {
  const safe = {
    strengths: Array.isArray(raw?.strengths) ? raw.strengths.filter((s) => typeof s === 'string').slice(0, 6) : [],
    weaknesses: Array.isArray(raw?.weaknesses) ? raw.weaknesses.filter((s) => typeof s === 'string').slice(0, 6) : [],
    bestSituations: Array.isArray(raw?.bestSituations) ? raw.bestSituations.filter((s) => typeof s === 'string').slice(0, 6) : [],
    coverageFit: {
      man: {
        confidence: sanitizeConfidence(raw?.coverageFit?.man?.confidence),
        why: typeof raw?.coverageFit?.man?.why === 'string' ? raw.coverageFit.man.why : 'NOT ENOUGH INFORMATION',
      },
      zone: {
        confidence: sanitizeConfidence(raw?.coverageFit?.zone?.confidence),
        why: typeof raw?.coverageFit?.zone?.why === 'string' ? raw.coverageFit.zone.why : 'NOT ENOUGH INFORMATION',
      },
      pressure: {
        confidence: sanitizeConfidence(raw?.coverageFit?.pressure?.confidence),
        why: typeof raw?.coverageFit?.pressure?.why === 'string' ? raw.coverageFit.pressure.why : 'NOT ENOUGH INFORMATION',
      },
    },
    suggestedMetadata: raw?.suggestedMetadata && typeof raw.suggestedMetadata === 'object' ? raw.suggestedMetadata : {},
  };
  return safe;
}

module.exports.sanitizeConfidence = sanitizeConfidence;
module.exports.sanitizeAnalysis = sanitizeAnalysis;
module.exports.buildUserPrompt = buildUserPrompt;
module.exports.extractJsonObject = extractJsonObject;

exports.handler = withHttp(async ({ event, data }) => {
  const decoded = await requireAuth(event);
  if (decoded.role !== 'coach') {
    throw Errors.permissionDenied('Only the coach can run Analyze Play');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Errors.internal('AI Analyzer is not configured yet — missing ANTHROPIC_API_KEY.');
  }

  const play = data.play;
  if (!play || typeof play !== 'object') {
    throw Errors.invalidArgument('play data is required');
  }

  await checkAndConsumeRateLimit(`analyzePlay:${decoded.teamId}`);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      // Raised from 1200: a play with a fuller roster (more routes, more
      // suggested tags/reasoning text) can genuinely need more room than
      // a simple 3-route test play does — a truncated response would
      // never close its JSON braces and would fail extractJsonObject's
      // balancing regardless of how well it handles fences/stray prose.
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(play) }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error('Anthropic API error:', res.status, errText);
    throw Errors.internal('AI Analyzer is temporarily unavailable — try again shortly.');
  }

  const payload = await res.json();
  const textBlock = payload?.content?.find((c) => c.type === 'text');
  const rawText = textBlock?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(rawText));
  } catch (parseErr) {
    // eslint-disable-next-line no-console
    console.error('AI Analyzer: could not parse model response as JSON.', parseErr.message, 'Raw text:', rawText);
    throw Errors.internal('AI Analyzer returned an unreadable response — try again.');
  }

  return sanitizeAnalysis(parsed);
});
