// Canonical 11-position list per VF9. AF2: this file is the single source of truth.
// Index order is the contract for PlayerRecord.restrictions[i].

export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'CF', 'RCF', 'RF'];

export const POSITION_INDEX = Object.freeze(
  POSITIONS.reduce((acc, p, i) => { acc[p] = i; return acc; }, {})
);

const INFIELD = ['P', 'C', '1B', '2B', '3B', 'SS'];
const OUTFIELD = ['LF', 'LCF', 'CF', 'RCF', 'RF'];

// H13 outfield reconfig by present player count.
// AF5 / OD-3 rec B: 8 → LCF/RCF; 9 → LF/CF/RF; 10+ → LF/LCF/RCF/RF.
// Returns null at <8 (hard-block per OD-3).
export function layoutFor(presentCount) {
  if (presentCount < 8) return null;
  if (presentCount === 8) return ['P', 'C', '1B', '2B', '3B', 'SS', 'LCF', 'RCF'];
  if (presentCount === 9) return ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  return ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF'];
}

export function isInfield(pos) {
  return INFIELD.indexOf(pos) >= 0;
}

export function isOutfield(pos) {
  return OUTFIELD.indexOf(pos) >= 0;
}
