// Pure logic for Wristband Builder V1: duplicate-call-code detection and
// the physical page/panel layout math. No DOM, no printing — this is the
// part that has to be exactly right before any print CSS gets built on
// top of it, so it's kept separate and independently testable.

/**
 * Flags any wristband code used by more than one play in the same Game
 * Plan — "if play 12 is Green Grass, every wristband must consistently
 * show 12 as Green Grass" only holds if no other play in the same plan
 * also claims 12. Comparison is trimmed but case-sensitive (wristband
 * codes are typically short numeric/alnum strings, e.g. "12" vs "12A").
 *
 * @param {Array<{playId}>} entries - Game Plan entries
 * @param {Object.<string, {name, wristbandCode}>} playsById
 * @returns {Array<{code: string, playIds: string[], names: string[]}>}
 */
export function findDuplicateWristbandCodes(entries, playsById) {
  const byCode = {};
  (entries || []).forEach((e) => {
    const play = playsById[e.playId];
    const code = (play?.wristbandCode || '').trim();
    if (!code) return;
    (byCode[code] ||= []).push(play);
  });
  return Object.entries(byCode)
    .filter(([, plays]) => plays.length > 1)
    .map(([code, plays]) => ({ code, playIds: plays.map((p) => p.id), names: plays.map((p) => p.name) }));
}

/**
 * Computes how many physical insert panels are needed for a given number
 * of play tiles, how many panels fit on one 8.5x11 sheet at the coach's
 * chosen insert size/margin, and groups play indices into panels in
 * Game Plan order. Pure arithmetic — no rendering.
 *
 * @param {{
 *   totalPlays: number,
 *   playsPerPanel: number,
 *   insertWidthIn: number,
 *   insertHeightIn: number,
 *   marginIn: number,
 *   pageWidthIn?: number,
 *   pageHeightIn?: number,
 * }} config
 */
export function computeWristbandLayout(config) {
  const {
    totalPlays,
    playsPerPanel,
    insertWidthIn,
    insertHeightIn,
    marginIn,
    pageWidthIn = 8.5,
    pageHeightIn = 11,
  } = config;

  const safePlaysPerPanel = Math.max(1, Math.floor(playsPerPanel) || 1);
  const panelsNeeded = totalPlays === 0 ? 0 : Math.ceil(totalPlays / safePlaysPerPanel);

  const usableW = pageWidthIn - marginIn * 2;
  const usableH = pageHeightIn - marginIn * 2;
  const panelsAcrossPage = Math.max(1, Math.floor((usableW + marginIn) / (insertWidthIn + marginIn)));
  const panelsDownPage = Math.max(1, Math.floor((usableH + marginIn) / (insertHeightIn + marginIn)));
  const panelsPerPage = panelsAcrossPage * panelsDownPage;
  const pagesNeeded = panelsNeeded === 0 ? 0 : Math.ceil(panelsNeeded / panelsPerPage);

  const panelGroups = [];
  for (let i = 0; i < totalPlays; i += safePlaysPerPanel) {
    const group = [];
    for (let j = i; j < Math.min(i + safePlaysPerPanel, totalPlays); j++) group.push(j);
    panelGroups.push(group);
  }

  return { panelsNeeded, panelsAcrossPage, panelsDownPage, panelsPerPage, pagesNeeded, panelGroups };
}
