// Preset formations — a fast way to place a whole set of players at once
// instead of one at a time through "+ Add Player". Purely a starting
// point: every position, route, and job stays fully editable afterward,
// exactly like a manually-placed player — nothing about applying a
// formation locks anything down, before OR after the play is saved.
//
// Built for this team's 5v5 flag ruleset: 5 slots per formation (C, QB,
// WR1-3), leaving WR4 free for a coach to add by hand if they want a 6th.
// Real 11-man-tackle formation names (I-Formation, Singleback, Doubleback)
// are translated here to their 5v5 spacing/alignment equivalent — the
// backfield-depth and stack/spread concept each name implies — not a
// literal offensive-line reproduction, which doesn't apply to no-contact
// flag football.
//
// Coordinates are normalized [0,1] in the same space as design.positions
// (x: 0 = left sideline, 1 = right sideline; y: LOS_Y_NORM = on the line,
// higher y = further into the backfield).

const LOS = 0.72;

export const FORMATIONS = [
  {
    key: 'shotgun',
    label: 'Shotgun',
    desc: 'QB set back, three receivers spread on the line.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.85 },
      WR1: { x: 0.10, y: LOS },
      WR2: { x: 0.90, y: LOS },
      WR3: { x: 0.72, y: LOS },
    },
  },
  {
    key: 'i-formation',
    label: 'I-Formation',
    desc: 'QB and a back stacked deep behind center, two wide receivers.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.78 },
      WR3: { x: 0.5, y: 0.88 },
      WR1: { x: 0.12, y: LOS },
      WR2: { x: 0.88, y: LOS },
    },
  },
  {
    key: 'singleback',
    label: 'Singleback',
    desc: 'One back offset behind the QB, two wide receivers.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR3: { x: 0.60, y: 0.82 },
      WR1: { x: 0.10, y: LOS },
      WR2: { x: 0.90, y: LOS },
    },
  },
  {
    key: 'doubleback',
    label: 'Doubleback',
    desc: 'Two backs split behind the QB, one wide receiver.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR2: { x: 0.42, y: 0.83 },
      WR3: { x: 0.58, y: 0.83 },
      WR1: { x: 0.90, y: LOS },
    },
  },
  {
    key: 'empty',
    label: 'Empty / Spread',
    desc: 'QB alone in the backfield, every receiver spread on the line.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.10, y: LOS },
      WR2: { x: 0.32, y: LOS },
      WR3: { x: 0.90, y: LOS },
    },
  },
  {
    key: 'bunch',
    label: 'Bunch',
    desc: 'Three receivers tightly clustered together, off-center.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.35, y: LOS },
      WR2: { x: 0.42, y: 0.76 },
      WR3: { x: 0.36, y: 0.80 },
    },
  },
  {
    key: 'trips-right',
    label: 'Trips Right',
    desc: 'Three receivers spread across the right side.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.62, y: LOS },
      WR2: { x: 0.78, y: LOS },
      WR3: { x: 0.92, y: LOS },
    },
  },
  {
    key: 'trips-left',
    label: 'Trips Left',
    desc: 'Three receivers spread across the left side.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.38, y: LOS },
      WR2: { x: 0.22, y: LOS },
      WR3: { x: 0.08, y: LOS },
    },
  },
  {
    key: 'trips-stack-right',
    label: 'Trips Stack Right',
    desc: 'Three receivers stacked depth-wise on the right side.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.82, y: LOS },
      WR2: { x: 0.85, y: 0.76 },
      WR3: { x: 0.88, y: 0.80 },
    },
  },
  {
    key: 'trips-stack-left',
    label: 'Trips Stack Left',
    desc: 'Three receivers stacked depth-wise on the left side.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.18, y: LOS },
      WR2: { x: 0.15, y: 0.76 },
      WR3: { x: 0.12, y: 0.80 },
    },
  },
  {
    key: 'twins-right',
    label: 'Twins Right',
    desc: 'Two receivers to the right, one alone on the left.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.78, y: LOS },
      WR2: { x: 0.90, y: LOS },
      WR3: { x: 0.10, y: LOS },
    },
  },
  {
    key: 'twins-left',
    label: 'Twins Left',
    desc: 'Two receivers to the left, one alone on the right.',
    positions: {
      C: { x: 0.5, y: LOS },
      QB: { x: 0.5, y: 0.80 },
      WR1: { x: 0.22, y: LOS },
      WR2: { x: 0.10, y: LOS },
      WR3: { x: 0.90, y: LOS },
    },
  },
];

export function getFormation(key) {
  return FORMATIONS.find((f) => f.key === key) || null;
}
