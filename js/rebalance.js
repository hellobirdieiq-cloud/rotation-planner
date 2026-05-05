// Rebalance future, unlocked, non-completed cells.
// Strategy: re-run Generate with completed-inning cells AND locked cells fed in
// as "effective locks", then merge so completed/locked cells are preserved
// byte-identical.

import { generate } from './generate.js';

export function rebalance(activeGame) {
  if (!activeGame || !activeGame.schedule) {
    return { nextGame: null, warnings: ['No active game to rebalance.'] };
  }

  const completed = new Set(activeGame.completedInnings || []);
  const effectiveLocks = [];
  activeGame.schedule.forEach((inn, idx) => {
    const isCompleted = completed.has(idx);
    for (const [pid, cell] of Object.entries(inn.cells)) {
      if (!cell) continue;
      if (isCompleted || cell.locked) {
        effectiveLocks.push({ inning: idx, playerId: pid, position: cell.assignment });
      }
    }
  });

  const result = generate({
    presentPlayers: activeGame.presentPlayers,
    rosterSnapshot: activeGame.rosterSnapshot,
    totalInnings: activeGame.totalInnings,
    locks: effectiveLocks,
    pitchAppearances: activeGame.pitchAppearances || {},
  });

  if (!result.schedule) {
    return { nextGame: null, warnings: result.warnings };
  }

  // Preserve original cells in completed innings AND original `locked`/`manual`
  // flags on cells that were already locked. Other cells take on the freshly
  // computed assignment.
  const scheduleLimit = activeGame.schedule.length;
  const newSchedule = result.schedule.slice(0, scheduleLimit).map((inn, idx) => {
    const wasCompleted = completed.has(idx);
    const out = { index: idx, cells: {} };
    for (const [pid, cell] of Object.entries(inn.cells)) {
      const original = activeGame.schedule[idx] && activeGame.schedule[idx].cells[pid];
      if (wasCompleted) {
        out.cells[pid] = original || cell;
      } else if (original && original.locked) {
        out.cells[pid] = original;
      } else {
        out.cells[pid] = { ...cell, manual: false };
      }
    }
    return out;
  });

  return {
    nextGame: { ...activeGame, schedule: newSchedule },
    warnings: result.warnings,
  };
}
