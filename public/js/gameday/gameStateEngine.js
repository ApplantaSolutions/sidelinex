// The ONE shared, pure state-transition function Game Day runs on. Given
// the same (state, result, ruleConfig), always returns the same new
// state — no DOM, no Firestore, no randomness, no side effects. Every
// other piece of Game Day (the UI, undo, stat derivation) either calls
// this directly or is built on data this produces, so its correctness is
// the single most load-bearing thing in this stage — see the paired
// .test.js for heavy coverage.
//
// DESIGN NOTE — worth flagging explicitly: this league's rules
// (ruleConfig: downsToMidfield / downsAfterMidfieldToScore) are
// downs-based, not yards-to-go based — there is no tracked absolute
// field position anywhere in this codebase, and the existing ruleConfig
// is explicitly marked "provisional... pending the official rulebook."
// Because of that, this engine cannot SAFELY auto-infer "did this play
// cross midfield" from yardage alone (that would require knowing the
// real starting yard line, which nothing here tracks). Instead,
// "crossing midfield" is an explicit fact the RESULT carries
// (result.crossedMidfield) — the coach, standing on the real field,
// marks it when it happens. This is a deliberate interpretation of an
// underspecified rule, not an oversight; flagged for review.

/**
 * @typedef {Object} GameState
 * @property {'us'|'them'} possession
 * @property {'toMidfield'|'toScore'} phase
 * @property {number} down - 1-indexed, within the current phase
 * @property {{us: number, them: number}} score
 */

/**
 * @param {'us'|'them'} startingPossession
 * @returns {GameState}
 */
export function initialGameState(startingPossession = 'us') {
  return {
    possession: startingPossession,
    phase: 'toMidfield',
    down: 1,
    score: { us: 0, them: 0 },
  };
}

function flipPossession(possession) {
  return possession === 'us' ? 'them' : 'us';
}

/**
 * @typedef {Object} SnapResult
 * @property {'complete'|'incomplete'|'drop'|'run'|'penalty'|'other'} type
 * @property {number} [yards]
 * @property {boolean} [touchdown] - this snap ended in a score
 * @property {boolean} [crossedMidfield] - explicit coach call: this snap's gain got the offense past midfield (only meaningful while phase==='toMidfield')
 * @property {boolean} [turnover] - explicit coach call: possession changes for a reason OTHER than downs (interception, fumble, etc.)
 */

/**
 * @param {GameState} state
 * @param {SnapResult} result
 * @param {{downsToMidfield: number, downsAfterMidfieldToScore: number}} ruleConfig
 * @returns {GameState} a NEW state object — never mutates the input
 */
export function applyResult(state, result, ruleConfig) {
  const next = { ...state, score: { ...state.score } };

  // A touchdown always ends the possession's series, regardless of which
  // result type produced it (a run or a completed pass can both score).
  if (result.touchdown) {
    next.score[next.possession] += 6;
    next.possession = flipPossession(next.possession);
    next.phase = 'toMidfield';
    next.down = 1;
    return next;
  }

  // An explicit turnover (interception, fumble, etc.) — distinct from a
  // turnover on downs, which is computed below instead of flagged here.
  if (result.turnover) {
    next.possession = flipPossession(next.possession);
    next.phase = 'toMidfield';
    next.down = 1;
    return next;
  }

  // Penalties replay the down by default — no down consumed, no phase
  // change — unless the coach explicitly also marks it as having crossed
  // midfield (rare, but a penalty can include enough gained ground to).
  if (result.type === 'penalty') {
    if (result.crossedMidfield && next.phase === 'toMidfield') {
      next.phase = 'toScore';
      next.down = 1;
    }
    return next;
  }

  // 'other' with no down-affecting flags: log it, but don't guess at a
  // down/phase consequence the coach didn't tell us about.
  if (result.type === 'other' && !result.crossedMidfield) {
    return next;
  }

  // Any live-ball snap (complete / incomplete / drop / run / other-with-
  // crossedMidfield) that gets marked as crossing midfield moves straight
  // to the scoring phase with a fresh set of downs — the coach's call
  // supersedes down-counting for that snap.
  if (result.crossedMidfield && next.phase === 'toMidfield') {
    next.phase = 'toScore';
    next.down = 1;
    return next;
  }

  // Normal down progression: did this snap use up the last down available
  // in the current phase?
  const maxDowns = next.phase === 'toMidfield' ? ruleConfig.downsToMidfield : ruleConfig.downsAfterMidfieldToScore;
  if (next.down >= maxDowns) {
    // Turnover on downs.
    next.possession = flipPossession(next.possession);
    next.phase = 'toMidfield';
    next.down = 1;
  } else {
    next.down += 1;
  }
  return next;
}

/**
 * Replays an ordered list of results from the initial state — this is
 * how Undo stays correct for free: state is never incrementally patched
 * and separately tracked, it's always a pure fold over the (non-voided)
 * result log. Removing/voiding a result and re-deriving state this way
 * can never leave state inconsistent with what was actually logged.
 *
 * @param {SnapResult[]} results - in the order they were logged
 * @param {{downsToMidfield: number, downsAfterMidfieldToScore: number}} ruleConfig
 * @param {'us'|'them'} startingPossession
 */
export function deriveGameState(results, ruleConfig, startingPossession = 'us') {
  return (results || []).reduce((state, result) => applyResult(state, result, ruleConfig), initialGameState(startingPossession));
}

/**
 * Plain-language label for the current down/phase, for the Situation Bar.
 * Kept here (not hardcoded in the UI) so it always reflects the same
 * config-driven rules the engine itself uses.
 */
export function describeDown(state, ruleConfig) {
  const maxDowns = state.phase === 'toMidfield' ? ruleConfig.downsToMidfield : ruleConfig.downsAfterMidfieldToScore;
  const ordinal = ORDINALS[state.down] || `${state.down}th`;
  const target = state.phase === 'toMidfield' ? 'to Midfield' : 'to Score';
  return `${ordinal} down (of ${maxDowns}) ${target}`;
}

const ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th' };
