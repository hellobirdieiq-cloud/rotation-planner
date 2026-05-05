// Game Summary tab — a pure projection of activeGame.schedule (+ pitchAppearances
// for the Pitches column). NEVER reads ag.presentPlayers and never caches:
//
//   - Every render fetches activeGame fresh from localStorage.
//   - Per-player accumulators are initialized lazily — one entry per pid that
//     actually appears in any inning's cells. presentPlayers is intentionally
//     ignored, so a divergence between presentPlayers and cells (which would
//     have silently dropped counts in the previous implementation) cannot hide
//     data.
//   - No memoization, no module-level state, no derived state held across renders.
//   - Defensive: non-string assignments are skipped (cannot accidentally index
//     perPos with an unintended key).
//
// Diagnostic strip at the top renders "Pitcher per inning" derived directly
// from the same schedule. If this strip ever disagrees with the Game tab's
// inning cards, the bug is in store / data flow, not in this computation.

import { getActiveGame } from '../store.js';
import { POSITIONS, isInfield, isOutfield } from '../positions.js';

export function mountGameSummaryTab(container) {
  const ag = getActiveGame();
  if (!ag || !ag.schedule || ag.schedule.length === 0) {
    container.innerHTML = '<div class="placeholder"><strong>No active game</strong>Generate a lineup on the Game tab first.</div>';
    return;
  }
  container.innerHTML = renderSummary(ag);
}

// === pure: takes ag, returns t keyed by pid =================================
function computeTotals(ag) {
  const t = {};
  function ensure(pid) {
    if (t[pid]) return t[pid];
    const fresh = { bench: 0, ifT: 0, ofT: 0, perPos: {}, pitches: 0 };
    POSITIONS.forEach((p) => { fresh.perPos[p] = 0; });
    t[pid] = fresh;
    return fresh;
  }

  (ag.schedule || []).forEach((inn) => {
    if (!inn || !inn.cells) return;
    Object.keys(inn.cells).forEach((pid) => {
      const cell = inn.cells[pid];
      if (!cell) return;
      const a = cell.assignment;
      if (typeof a !== 'string') return;
      const acc = ensure(pid);
      if (a === 'BN') {
        acc.bench++;
        return;
      }
      if (POSITIONS.indexOf(a) >= 0) {
        acc.perPos[a]++;
        if (isInfield(a)) acc.ifT++;
        else if (isOutfield(a)) acc.ofT++;
      }
    });
  });

  Object.entries(ag.pitchAppearances || {}).forEach(([pid, ap]) => {
    if (!ap || !ap.perInning) return;
    const acc = ensure(pid);
    acc.pitches = Object.values(ap.perInning).reduce((a, b) => a + (b || 0), 0);
  });

  return t;
}

function renderSummary(ag) {
  const totals = computeTotals(ag);
  const pids = Object.keys(totals).sort((a, b) => nameOf(ag, a).localeCompare(nameOf(ag, b)));
  const completedCount = (ag.completedInnings || []).length;

  // Diagnostic: pitcher per inning, derived directly from this very schedule.
  const pitcherByInning = ag.schedule.map((inn, i) => {
    const e = inn && inn.cells
      ? Object.entries(inn.cells).find(([, c]) => c && c.assignment === 'P')
      : null;
    return { inning: i + 1, name: e ? nameOf(ag, e[0]) : '—' };
  });

  const headers = `
    <th class="summary-name-col">Player</th>
    <th>BN</th>
    <th>IF</th>
    <th>OF</th>
    ${POSITIONS.map((p) => `<th>${p}</th>`).join('')}
    <th>Pitches</th>
  `;
  const rows = pids.map((pid) => {
    const acc = totals[pid];
    const cells = POSITIONS.map((pos) => `<td${acc.perPos[pos] ? '' : ' class="zero"'}>${acc.perPos[pos] || ''}</td>`).join('');
    return `
      <tr>
        <td class="summary-name-col">${esc(nameOf(ag, pid))}</td>
        <td${acc.bench ? '' : ' class="zero"'}>${acc.bench || ''}</td>
        <td>${acc.ifT}</td>
        <td>${acc.ofT}</td>
        ${cells}
        <td>${acc.pitches || ''}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="summary-meta">
      <div><strong>${esc(ag.date || '')}</strong> · ${pids.length} players · ${ag.schedule.length} innings${completedCount > 0 ? ` · ${completedCount} complete` : ''}</div>
    </div>
    <div class="summary-pitch-line">
      <span class="summary-pitch-label">Pitcher per inning:</span>
      ${pitcherByInning.map((x) => `<span class="summary-pitch-cell"><strong>${x.inning}</strong> ${esc(x.name)}</span>`).join('')}
    </div>
    <div class="summary-scroll">
      <table class="summary-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function nameOf(ag, pid) {
  const p = ag.rosterSnapshot && ag.rosterSnapshot[pid];
  return p ? p.firstName : 'Player';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
