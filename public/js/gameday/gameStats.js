// Pure stat derivation from a list of Snap records. Nothing here is ever
// stored as a separately-incremented total — every number is recomputed
// fresh from the (non-voided) snap log every time it's needed, which is
// exactly what makes Undo automatically correct for stats too: void one
// snap, re-derive, done. No drift is possible because there's no second
// copy of the truth to drift from.
//
// "Sample size must always matter" (explicit instruction): every derived
// stat object carries its own sample count (attempts/carries/timesCalled)
// alongside the rate/average — never present a rate without the count
// that produced it.

function isLive(snap) {
  return !snap.voided;
}

/**
 * @param {Array} snaps - Snap records (voided ones are ignored automatically)
 * @returns {Object.<string, {playerId, attempts, completions, passingYards, touchdowns}>}
 */
export function derivePassingStats(snaps) {
  const byPasser = {};
  (snaps || []).filter(isLive).forEach((s) => {
    if (!s.passerId) return;
    if (!['complete', 'incomplete', 'drop'].includes(s.resultType)) return;
    const p = (byPasser[s.passerId] ||= { playerId: s.passerId, attempts: 0, completions: 0, passingYards: 0, touchdowns: 0 });
    p.attempts += 1;
    if (s.resultType === 'complete') {
      p.completions += 1;
      p.passingYards += s.yards || 0;
      if (s.touchdown) p.touchdowns += 1;
    }
  });
  return byPasser;
}

/**
 * @returns {Object.<string, {playerId, targets, catches, drops, receivingYards, touchdowns, catchRate, yardsPerCatch}>}
 */
export function deriveReceivingStats(snaps) {
  const byReceiver = {};
  (snaps || []).filter(isLive).forEach((s) => {
    const receiverKey = s.targetId || s.receiverId;
    if (!receiverKey) return;
    if (!['complete', 'incomplete', 'drop'].includes(s.resultType)) return;
    const r = (byReceiver[receiverKey] ||= { playerId: receiverKey, targets: 0, catches: 0, drops: 0, receivingYards: 0, touchdowns: 0 });
    r.targets += 1;
    if (s.resultType === 'complete') {
      r.catches += 1;
      r.receivingYards += s.yards || 0;
      if (s.touchdown) r.touchdowns += 1;
    } else if (s.resultType === 'drop') {
      r.drops += 1;
    }
  });
  Object.values(byReceiver).forEach((r) => {
    r.catchRate = r.targets > 0 ? r.catches / r.targets : null;
    r.yardsPerCatch = r.catches > 0 ? r.receivingYards / r.catches : null;
  });
  return byReceiver;
}

/**
 * @returns {Object.<string, {playerId, carries, rushingYards, touchdowns, yardsPerCarry}>}
 */
export function deriveRushingStats(snaps) {
  const byRusher = {};
  (snaps || []).filter(isLive).forEach((s) => {
    if (!s.ballCarrierId || s.resultType !== 'run') return;
    const r = (byRusher[s.ballCarrierId] ||= { playerId: s.ballCarrierId, carries: 0, rushingYards: 0, touchdowns: 0 });
    r.carries += 1;
    r.rushingYards += s.yards || 0;
    if (s.touchdown) r.touchdowns += 1;
  });
  Object.values(byRusher).forEach((r) => {
    r.yardsPerCarry = r.carries > 0 ? r.rushingYards / r.carries : null;
  });
  return byRusher;
}

/**
 * "Success" is deliberately simple and explicit here (crossed midfield or
 * scored) since no more specific conversion/success definition exists in
 * the league's ruleConfig yet — kept as one clearly-named function so a
 * future, more precise definition only has to change in one place.
 */
function isSuccess(snap) {
  return !!(snap.crossedMidfield || snap.touchdown);
}

/**
 * @returns {Object.<string, {playId, timesCalled, totalYards, averageGain, completions, attempts, completionRate, successes, successRate, touchdowns, byDefensiveLook: {...}}>}
 */
export function derivePlayStats(snaps) {
  const byPlay = {};
  (snaps || []).filter(isLive).forEach((s) => {
    if (!s.playId) return;
    const p = (byPlay[s.playId] ||= {
      playId: s.playId,
      timesCalled: 0,
      totalYards: 0,
      attempts: 0,
      completions: 0,
      successes: 0,
      touchdowns: 0,
      byDefensiveLook: {},
    });
    p.timesCalled += 1;
    p.totalYards += s.yards || 0;
    if (['complete', 'incomplete', 'drop'].includes(s.resultType)) {
      p.attempts += 1;
      if (s.resultType === 'complete') p.completions += 1;
    }
    if (isSuccess(s)) p.successes += 1;
    if (s.touchdown) p.touchdowns += 1;

    if (s.defensiveLookObserved) {
      const look = (p.byDefensiveLook[s.defensiveLookObserved] ||= { timesCalled: 0, totalYards: 0, successes: 0 });
      look.timesCalled += 1;
      look.totalYards += s.yards || 0;
      if (isSuccess(s)) look.successes += 1;
    }
  });

  Object.values(byPlay).forEach((p) => {
    p.averageGain = p.timesCalled > 0 ? p.totalYards / p.timesCalled : null;
    p.completionRate = p.attempts > 0 ? p.completions / p.attempts : null;
    p.successRate = p.timesCalled > 0 ? p.successes / p.timesCalled : null;
    Object.values(p.byDefensiveLook).forEach((look) => {
      look.averageGain = look.timesCalled > 0 ? look.totalYards / look.timesCalled : null;
      look.successRate = look.timesCalled > 0 ? look.successes / look.timesCalled : null;
    });
  });

  return byPlay;
}

/**
 * Convenience: all four derivations at once, for a Game Day "Quick Stats"
 * view that wants everything without four separate passes over the log
 * from the UI layer.
 */
export function deriveAllStats(snaps) {
  return {
    passing: derivePassingStats(snaps),
    receiving: deriveReceivingStats(snaps),
    rushing: deriveRushingStats(snaps),
    plays: derivePlayStats(snaps),
  };
}
