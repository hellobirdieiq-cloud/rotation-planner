// Surgical single-cell edit. NEVER calls Generate.
// Validates the full transactional change before any state mutation.
// Pattern (RR-2): build candidate next-state → validate as a whole → commit or reject atomically.

import { validateProposal } from './rules.js';

// Apply a swap-style edit at (inning, position) → newPlayerId.
// The new player moves to (inning, position). Whoever was at that position
// moves to whatever the new player WAS doing in this inning (swap), or to BN.
//
// Returns:
//   { success: true, nextGame, ripples: [{inning, playerId, reason}], displacedPlayerId }
//   { rejected: true, reason }
export function applyEdit(activeGame, change) {
  if (!activeGame || !activeGame.schedule) {
    return { rejected: true, reason: 'No active game.' };
  }
  if ((activeGame.completedInnings || []).includes(change.inning)) {
    return { rejected: true, reason: 'Cannot edit a completed inning.' };
  }
  const inn = activeGame.schedule[change.inning];
  if (!inn) return { rejected: true, reason: 'Invalid inning.' };

  // Find the current occupant at this (inning, position).
  let currentPlayerId = null;
  for (const [pid, cell] of Object.entries(inn.cells)) {
    if (cell && cell.assignment === change.position) {
      currentPlayerId = pid;
      break;
    }
  }
  // Already assigned? No-op.
  if (currentPlayerId === change.newPlayerId) {
    return { rejected: true, reason: 'That player is already assigned to this cell.' };
  }
  // Block edits to a locked cell (caller must Unlock first).
  if (currentPlayerId && inn.cells[currentPlayerId].locked) {
    return { rejected: true, reason: `${nameOf(activeGame, currentPlayerId)} is locked at ${change.position}. Unlock the cell first.` };
  }
  // Block if the new player's current cell is locked at a different position.
  const newPlayerCurrentCell = inn.cells[change.newPlayerId];
  if (newPlayerCurrentCell && newPlayerCurrentCell.locked) {
    return { rejected: true, reason: `${nameOf(activeGame, change.newPlayerId)} is locked at ${newPlayerCurrentCell.assignment} this inning. Unlock first.` };
  }

  // The new player's PRIOR position becomes where the displaced player goes.
  const newPlayerPriorPosition = newPlayerCurrentCell ? newPlayerCurrentCell.assignment : 'BN';

  // Build candidate (deep clone — keeps validation pure).
  const candidate = deepClone(activeGame);
  const candInn = candidate.schedule[change.inning];

  // Apply: new player → position; displaced player → new player's prior position (or BN).
  candInn.cells[change.newPlayerId] = {
    assignment: change.position,
    locked: false,
    manual: true,
  };
  if (currentPlayerId) {
    candInn.cells[currentPlayerId] = {
      assignment: newPlayerPriorPosition,
      locked: false,
      manual: true,
    };
  }

  // Validate as a transaction: the new assignment AND the displaced player's new assignment.
  const v1 = validateProposal(candidate, {
    inning: change.inning,
    playerId: change.newPlayerId,
    position: change.position,
  });
  if (!v1.allowed) return { rejected: true, reason: v1.reason };

  if (currentPlayerId) {
    const v2 = validateProposal(candidate, {
      inning: change.inning,
      playerId: currentPlayerId,
      position: newPlayerPriorPosition,
    });
    if (!v2.allowed) {
      return { rejected: true, reason: `Cannot displace ${nameOf(activeGame, currentPlayerId)}: ${v2.reason}` };
    }
  }

  // Detect ripples in future innings (cells that became invalid given this change).
  const ripples = detectRipples(candidate, change.inning);

  return {
    success: true,
    nextGame: candidate,
    ripples,
    displacedPlayerId: currentPlayerId,
  };
}

// Set a cell to BN. Used when the coach taps "Clear cell."
export function clearCell(activeGame, inning, playerId) {
  if (!activeGame || !activeGame.schedule) return { rejected: true, reason: 'No active game.' };
  if ((activeGame.completedInnings || []).includes(inning)) {
    return { rejected: true, reason: 'Cannot edit a completed inning.' };
  }
  const inn = activeGame.schedule[inning];
  const cell = inn && inn.cells[playerId];
  if (!cell) return { rejected: true, reason: 'Cell not found.' };
  if (cell.locked) return { rejected: true, reason: 'Cell is locked. Unlock first.' };
  if (cell.assignment === 'BN') return { rejected: true, reason: 'Already on bench.' };

  const candidate = deepClone(activeGame);
  candidate.schedule[inning].cells[playerId] = { assignment: 'BN', locked: false, manual: true };
  // No hard-stop validation needed for BN (BN always allowed).
  const ripples = detectRipples(candidate, inning);
  return { success: true, nextGame: candidate, ripples };
}

// Toggle the locked flag on a cell. No validation needed — locking/unlocking
// doesn't change assignments.
export function toggleLock(activeGame, inning, playerId) {
  if (!activeGame || !activeGame.schedule) return { rejected: true, reason: 'No active game.' };
  const inn = activeGame.schedule[inning];
  const cell = inn && inn.cells[playerId];
  if (!cell) return { rejected: true, reason: 'Cell not found.' };
  const candidate = deepClone(activeGame);
  candidate.schedule[inning].cells[playerId] = { ...cell, locked: !cell.locked };
  return { success: true, nextGame: candidate, locked: !cell.locked };
}

// === helpers ===

function detectRipples(state, fromInning) {
  const ripples = [];
  for (let i = fromInning + 1; i < state.schedule.length; i++) {
    const inn = state.schedule[i];
    if (!inn) continue;
    for (const [pid, cell] of Object.entries(inn.cells)) {
      if (!cell) continue;
      const v = validateProposal(state, { inning: i, playerId: pid, position: cell.assignment });
      if (!v.allowed) {
        ripples.push({ inning: i, playerId: pid, reason: v.reason });
      }
    }
  }
  return ripples;
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function nameOf(state, pid) {
  const p = state.rosterSnapshot && state.rosterSnapshot[pid];
  return p ? p.firstName : 'Player';
}
