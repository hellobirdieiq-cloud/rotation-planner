// In-game hard-stop validators (V1 lean: H2-H10, H12-H14).
// Each validator returns { allowed: bool, reason: string }.
// No auto-unlock — the caller surfaces the reason as a block message.

import { POSITION_INDEX, layoutFor, isInfield, isOutfield } from './positions.js';

const PITCH_MAX_BY_AGE = { 8: 50, 9: 75, 10: 75, 11: 75, 12: 0 };
const RULE_5_CATCHING_THRESHOLD = 3;
const RULE_5_PITCH_THRESHOLD = 21;
const RULE_6_PITCH_THRESHOLD = 41;
const CATCHER_4_THRESHOLD = 4;

const ALLOWED = Object.freeze({ allowed: true, reason: '' });
const deny = (reason) => ({ allowed: false, reason });

// Validate a single proposed assignment against the current game state.
// `state` is a GameRecord-like snapshot AFTER any candidate change has been applied.
// `proposal` = { inning: number, playerId: string, position: 'P'|'C'|...|'BN' }
//
// Returns the FIRST failing validator's { allowed: false, reason } — or ALLOWED.
export function validateProposal(state, proposal) {
  let r;
  r = validateLayoutH13(state, proposal);    if (!r.allowed) return r;
  r = validateRestriction(state, proposal);  if (!r.allowed) return r;
  r = validateNoDupH9(state, proposal);      if (!r.allowed) return r;
  r = validateAge12H5(state, proposal);      if (!r.allowed) return r;
  r = validateReentryH2H8(state, proposal);  if (!r.allowed) return r;
  r = validatePitchMaxH4(state, proposal);   if (!r.allowed) return r;
  r = validateRule6H7(state, proposal);      if (!r.allowed) return r;
  r = validateRule5H6(state, proposal);      if (!r.allowed) return r;
  r = validateCatcher4H3(state, proposal);   if (!r.allowed) return r;
  return ALLOWED;
}

// Validate marking an inning complete (H12 + check that no future locks would be
// invalidated by hard stops at the moment of marking).
// Returns ALLOWED or deny(reason). The caller must NOT auto-unlock — coach clears.
export function validateMarkComplete(state, inningIdx) {
  if (inningIdx < 0 || inningIdx >= state.schedule.length) {
    return deny('Inning index out of range.');
  }
  if (state.completedInnings && state.completedInnings.includes(inningIdx)) {
    return deny('Inning is already marked complete.');
  }
  // Walk future innings; check P-locks against H3 and C-locks against Rule 6.
  // Catching count is computed up to and including the inning being completed.
  for (let future = inningIdx + 1; future < state.schedule.length; future++) {
    const inn = state.schedule[future];
    if (!inn) continue;
    for (const [pid, cell] of Object.entries(inn.cells || {})) {
      if (!cell || !cell.locked) continue;

      if (cell.assignment === 'P') {
        // Count catching innings up through `inningIdx` for this player.
        let cc = 0;
        for (let j = 0; j <= inningIdx; j++) {
          const c = state.schedule[j] && state.schedule[j].cells[pid];
          if (c && c.assignment === 'C') cc++;
        }
        if (cc >= CATCHER_4_THRESHOLD) {
          return deny(`P lock on ${nameOf(state, pid)} (inning ${future + 1}) conflicts with Catcher 4+ rule. Clear the lock first.`);
        }
        // Also: pitch-max + age checks
        const player = playerOf(state, pid);
        if (player && player.age === 12) {
          return deny(`P lock on ${nameOf(state, pid)} (inning ${future + 1}) conflicts with H5 (age 12 cannot pitch). Clear the lock first.`);
        }
      } else if (cell.assignment === 'C') {
        const total = totalPitches(state, pid);
        if (total >= RULE_6_PITCH_THRESHOLD) {
          return deny(`C lock on ${nameOf(state, pid)} (inning ${future + 1}) conflicts with Rule 6 (${total} pitches). Clear the lock first.`);
        }
      }
    }
  }
  return ALLOWED;
}

// === per-rule validators ===

// H13 — assigned position must exist in the current layout (or be BN).
function validateLayoutH13(state, p) {
  const layout = layoutFor((state.presentPlayers || []).length);
  if (!layout) return deny(`Need at least 8 players present (have ${(state.presentPlayers || []).length}).`);
  if (p.position === 'BN') return ALLOWED;
  if (!layout.includes(p.position)) {
    return deny(`${p.position} is not in this lineup's layout (${state.presentPlayers.length} players present).`);
  }
  return ALLOWED;
}

// Player position-restriction (denylist boolean[11]).
function validateRestriction(state, p) {
  if (p.position === 'BN') return ALLOWED;
  const player = playerOf(state, p.playerId);
  if (!player || !player.restrictions) return ALLOWED;
  const idx = POSITION_INDEX[p.position];
  if (idx == null) return ALLOWED;
  if (player.restrictions[idx]) {
    return deny(`${nameOf(state, p.playerId)} cannot play ${p.position}.`);
  }
  return ALLOWED;
}

// H9 — no two players at the same fielding position in the same inning.
// (BN is multi-occupant; H10 covers BN+field consistency on the SAME player.)
function validateNoDupH9(state, p) {
  if (p.position === 'BN') return ALLOWED;
  const inning = state.schedule[p.inning];
  if (!inning) return ALLOWED;
  for (const [pid, cell] of Object.entries(inning.cells)) {
    if (pid === p.playerId) continue;
    if (cell && cell.assignment === p.position) {
      return deny(`${nameOf(state, pid)} is already at ${p.position} in inning ${p.inning + 1}.`);
    }
  }
  return ALLOWED;
}

// H5 — age 12 players cannot pitch in Minors.
function validateAge12H5(state, p) {
  if (p.position !== 'P') return ALLOWED;
  const player = playerOf(state, p.playerId);
  if (player && player.age === 12) return deny('Age 12 cannot pitch in Minors.');
  return ALLOWED;
}

// H2 / H8 — once a pitcher is removed (replaced by a different P in a later inning),
// they cannot return to P later in the game.
function validateReentryH2H8(state, p) {
  if (p.position !== 'P') return ALLOWED;
  const ap = state.pitchAppearances && state.pitchAppearances[p.playerId];
  if (ap && ap.removed) {
    return deny(`${nameOf(state, p.playerId)} was removed from pitching this game and cannot return.`);
  }
  // Implicit removal detection from the schedule: the player pitched in inning N1 < proposal.inning,
  // but a different player was P in some inning between N1 and proposal.inning.
  let lastPitchedInn = -1;
  for (let i = 0; i < p.inning; i++) {
    const cell = state.schedule[i] && state.schedule[i].cells[p.playerId];
    if (cell && cell.assignment === 'P') lastPitchedInn = i;
  }
  if (lastPitchedInn >= 0) {
    for (let i = lastPitchedInn + 1; i < p.inning; i++) {
      const innP = pitcherOf(state, i);
      if (innP && innP !== p.playerId) {
        return deny(`${nameOf(state, p.playerId)} pitched in inning ${lastPitchedInn + 1} and was replaced — cannot return to pitching.`);
      }
    }
  }
  return ALLOWED;
}

// H4 — total pitches at or above age limit blocks further P assignment.
function validatePitchMaxH4(state, p) {
  if (p.position !== 'P') return ALLOWED;
  const player = playerOf(state, p.playerId);
  if (!player) return ALLOWED;
  const max = PITCH_MAX_BY_AGE[player.age];
  if (max == null || max === 0) return ALLOWED; // age 12 caught by H5
  const total = totalPitches(state, p.playerId);
  if (total >= max) {
    return deny(`${nameOf(state, p.playerId)} has reached the ${max} pitch limit for age ${player.age}.`);
  }
  return ALLOWED;
}

// H7 — Rule 6: 41+ pitches blocks catching for the rest of the game.
function validateRule6H7(state, p) {
  if (p.position !== 'C') return ALLOWED;
  const total = totalPitches(state, p.playerId);
  if (total >= RULE_6_PITCH_THRESHOLD) {
    return deny(`Rule 6: ${nameOf(state, p.playerId)} has pitched ${total} — cannot catch this game.`);
  }
  return ALLOWED;
}

// H6 — Rule 5: ≤3 catching innings AND ≥21 pitches → cannot return to catcher.
function validateRule5H6(state, p) {
  if (p.position !== 'C') return ALLOWED;
  const total = totalPitches(state, p.playerId);
  if (total < RULE_5_PITCH_THRESHOLD) return ALLOWED;
  // count catching innings excluding the proposal inning (which is the one we're proposing now)
  const catchInnings = countCatchInnings(state, p.playerId, p.inning);
  if (catchInnings <= RULE_5_CATCHING_THRESHOLD) {
    return deny(`Rule 5: ${nameOf(state, p.playerId)} caught ${catchInnings} and pitched ${total} — cannot return to catcher.`);
  }
  return ALLOWED;
}

// H3 — 4+ catching innings blocks pitching for the rest of the game.
function validateCatcher4H3(state, p) {
  if (p.position !== 'P') return ALLOWED;
  const cc = countCatchInnings(state, p.playerId, p.inning);
  if (cc >= CATCHER_4_THRESHOLD) {
    return deny(`${nameOf(state, p.playerId)} has caught ${cc} innings — cannot pitch later this game.`);
  }
  return ALLOWED;
}

// === helpers ===

function playerOf(state, pid) {
  return (state.rosterSnapshot && state.rosterSnapshot[pid]) || null;
}

function nameOf(state, pid) {
  const p = playerOf(state, pid);
  return p ? p.firstName : 'Player';
}

function totalPitches(state, pid) {
  const ap = state.pitchAppearances && state.pitchAppearances[pid];
  if (!ap || !ap.perInning) return 0;
  return Object.values(ap.perInning).reduce((a, b) => a + (b || 0), 0);
}

function countCatchInnings(state, pid, excludeInning) {
  let n = 0;
  for (let i = 0; i < state.schedule.length; i++) {
    if (i === excludeInning) continue;
    const cell = state.schedule[i] && state.schedule[i].cells[pid];
    if (cell && cell.assignment === 'C') n++;
  }
  return n;
}

function pitcherOf(state, inning) {
  const inn = state.schedule[inning];
  if (!inn) return null;
  for (const [pid, cell] of Object.entries(inn.cells)) {
    if (cell && cell.assignment === 'P') return pid;
  }
  return null;
}
