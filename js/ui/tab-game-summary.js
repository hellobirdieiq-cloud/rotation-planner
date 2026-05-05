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

function renderSummary(ag) {
  const players = (ag.presentPlayers || []).map((pid) => ({
    pid,
    name: nameOf(ag, pid),
  })).sort((a, b) => a.name.localeCompare(b.name));

  // Compute per-player totals from schedule + pitchAppearances.
  const t = {};
  players.forEach((p) => {
    t[p.pid] = { bench: 0, ifT: 0, ofT: 0, perPos: {}, pitches: 0 };
    POSITIONS.forEach((pos) => { t[p.pid].perPos[pos] = 0; });
  });

  ag.schedule.forEach((inn) => {
    Object.entries(inn.cells || {}).forEach(([pid, cell]) => {
      const acc = t[pid];
      if (!acc || !cell) return;
      const a = cell.assignment;
      if (a === 'BN') {
        acc.bench++;
      } else if (POSITIONS.includes(a)) {
        acc.perPos[a]++;
        if (isInfield(a)) acc.ifT++;
        else if (isOutfield(a)) acc.ofT++;
      }
    });
  });
  Object.entries(ag.pitchAppearances || {}).forEach(([pid, ap]) => {
    if (!t[pid]) return;
    t[pid].pitches = Object.values(ap.perInning || {}).reduce((a, b) => a + (b || 0), 0);
  });

  const headers = `
    <th class="summary-name-col">Player</th>
    <th>BN</th>
    ${POSITIONS.map((p) => `<th>${p}</th>`).join('')}
    <th>IF</th>
    <th>OF</th>
    <th>Pitches</th>
  `;
  const rows = players.map((p) => {
    const acc = t[p.pid];
    const cells = POSITIONS.map((pos) => `<td${acc.perPos[pos] ? '' : ' class="zero"'}>${acc.perPos[pos] || ''}</td>`).join('');
    return `
      <tr>
        <td class="summary-name-col">${esc(p.name)}</td>
        <td${acc.bench ? '' : ' class="zero"'}>${acc.bench || ''}</td>
        ${cells}
        <td>${acc.ifT}</td>
        <td>${acc.ofT}</td>
        <td>${acc.pitches || ''}</td>
      </tr>
    `;
  }).join('');

  const completedCount = (ag.completedInnings || []).length;
  return `
    <div class="summary-meta">
      <div><strong>${esc(ag.date || '')}</strong> · ${players.length} players · ${ag.schedule.length} innings${completedCount > 0 ? ` · ${completedCount} complete` : ''}</div>
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
