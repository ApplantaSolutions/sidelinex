// Shared, extensible vocabulary for Playbook fields. Kept in one place so
// adding a new category or role classification later is a one-line change
// here, not a hunt through UI code. Nothing downstream hardcodes these as
// literals — they always read from this module.

export const OFFENSE_CATEGORIES = [
  { value: 'pass', label: 'Pass' },
  { value: 'run', label: 'Run' },
  { value: 'play_action_pass', label: 'Play Action Pass' },
  { value: 'play_action_run', label: 'Play Action Run' },
  { value: 'special_trick', label: 'Special / Trick' },
];

export const DEFENSE_CATEGORIES = [
  { value: 'man', label: 'Man' },
  { value: 'zone', label: 'Zone' },
  { value: 'rush_pressure', label: 'Rush / Pressure' },
  { value: 'contain', label: 'Contain' },
  { value: 'goal_line', label: 'Goal Line' },
  { value: 'special', label: 'Special' },
];

export function categoriesForSide(side) {
  return side === 'defense' ? DEFENSE_CATEGORIES : OFFENSE_CATEGORIES;
}

export const YARDAGE_DEPTH = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'deep', label: 'Deep' },
];

export const RISK_LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const EFFECTIVENESS_LEVELS = [
  { value: 'strong', label: 'Strong' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'weak', label: 'Weak' },
];

// Role classification for a slot's assignment within a play version.
export const ROLE_CLASSIFICATIONS = [
  { value: 'primary_target', label: 'Primary Target' },
  { value: 'secondary_target', label: 'Secondary Target' },
  { value: 'checkdown', label: 'Checkdown' },
  { value: 'decoy_clearout', label: 'Decoy / Clear-Out' },
  { value: 'block_screen', label: 'Block / Screen' },
  { value: 'motion', label: 'Motion' },
  { value: 'ball_carrier', label: 'Ball Carrier' },
  { value: 'fake_misdirection', label: 'Fake / Misdirection' },
  { value: 'qb', label: 'QB' },
  { value: 'defensive_assignment', label: 'Defensive Assignment' },
  { value: 'other', label: 'Other' },
];

// Suggested slot labels for the Play Designer's "Pick a Player" screen —
// NOT an exhaustive or format-locked list. A coach can add any slot label
// freely via "+ Player"; this just speeds up the common case. Sized for
// this team's actual 5v5 roster: QB + Center + 3 WRs = 5 — there is no
// "4th" wide receiver slot suggested, since a 5v5 lineup doesn't have one.
export const SUGGESTED_SLOTS = ['QB', 'C', 'WR1', 'WR2', 'WR3'];

// The Center is an eligible receiver in flag football (unlike tackle
// football, where the center can never catch a pass) — this label makes
// that explicit wherever a coach is choosing who to add, so it's obvious
// C can be given a real route and a real job, not just treated as a
// snapper. The on-field marker itself still shows the short "C" (it has
// to fit inside a small circle); this longer label is only for the
// player-picker button.
export const SLOT_DISPLAY_LABELS = {
  C: 'C — Center/WR (eligible receiver)',
};

export function slotDisplayLabel(slot) {
  return SLOT_DISPLAY_LABELS[slot] || slot;
}
