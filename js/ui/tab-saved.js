import { getSavedGames, setSavedGames } from '../store.js';
import { openSheet, closeSheet } from './bottom-sheet.js';
import { showToast } from './toast.js';

export function mountSavedTab(container) {
  let mountEl = container;

  function refresh() {
    mountEl.innerHTML = renderHtml();
    bind();
  }

  function renderHtml() {
    const games = getSavedGames();
    if (games.length === 0) {
      return '<div class="placeholder"><strong>No saved games yet</strong>Save a game from the Game tab to see it here.</div>';
    }
    const sorted = games.slice().sort((a, b) => (b.savedAt || b.date || '').localeCompare(a.savedAt || a.date || ''));
    return `<div class="saved-list">${sorted.map(savedRowHtml).join('')}</div>`;
  }

  function savedRowHtml(g) {
    const playerCount = (g.presentPlayers || []).length;
    const inningsCount = (g.schedule || []).length;
    const pitchTotal = sumPitches(g);
    const cls = g.included ? 'badge-included' : 'badge-test';
    const label = g.included ? 'Included' : 'Test';
    return `
      <div class="saved-game-row" data-id="${esc(g.id)}">
        <div class="saved-game-meta">
          <div class="saved-game-date">${esc(g.date || 'Unknown date')}<span class="saved-game-badge ${cls}">${label}</span></div>
          <div class="saved-game-stats">${playerCount} players · ${inningsCount} innings${pitchTotal > 0 ? ` · ${pitchTotal} pitches` : ''}</div>
        </div>
        <div class="saved-game-actions">
          <button class="btn-secondary" type="button" data-action="view" data-id="${esc(g.id)}">View</button>
          <button class="btn-secondary" type="button" data-action="toggle" data-id="${esc(g.id)}">${g.included ? 'Mark Test' : 'Mark Included'}</button>
          <button class="btn-secondary btn-danger" type="button" data-action="delete" data-id="${esc(g.id)}">Delete</button>
        </div>
      </div>
    `;
  }

  function bind() {
    mountEl.querySelectorAll('[data-action="view"]').forEach((b) => b.addEventListener('click', () => openViewSheet(b.dataset.id)));
    mountEl.querySelectorAll('[data-action="toggle"]').forEach((b) => b.addEventListener('click', () => openToggleConfirm(b.dataset.id)));
    mountEl.querySelectorAll('[data-action="delete"]').forEach((b) => b.addEventListener('click', () => openDeleteConfirm(b.dataset.id)));
  }

  function openViewSheet(id) {
    const g = getSavedGames().find((x) => x.id === id);
    if (!g) return;

    const inningsHtml = (g.schedule || []).map((inn, i) => {
      const sortedCells = Object.entries(inn.cells || {})
        .filter(([, c]) => c && c.assignment !== 'BN')
        .sort((a, b) => POS_ORDER.indexOf(a[1].assignment) - POS_ORDER.indexOf(b[1].assignment));
      const fielders = sortedCells
        .map(([pid, c]) => `<div class="view-cell"><span class="view-pos">${esc(c.assignment)}</span> ${esc(nameOfSnap(g, pid))}</div>`)
        .join('');
      const benched = Object.entries(inn.cells || {})
        .filter(([, c]) => c && c.assignment === 'BN')
        .map(([pid]) => esc(nameOfSnap(g, pid)))
        .join(', ');
      const pitchEntries = Object.entries(g.pitchAppearances || {})
        .map(([pid, ap]) => ({ pid, n: ap.perInning && ap.perInning[i] }))
        .filter((x) => x.n != null);
      const pitchHtml = pitchEntries.length > 0
        ? `<div class="view-pitches">⚾ ${pitchEntries.map((x) => `${esc(nameOfSnap(g, x.pid))} ${x.n}`).join(', ')}</div>`
        : '';
      return `
        <div class="view-inning">
          <div class="view-inning-title">Inning ${i + 1}</div>
          <div class="view-cells">${fielders}</div>
          ${benched ? `<div class="view-bench">BN: ${benched}</div>` : ''}
          ${pitchHtml}
        </div>
      `;
    }).join('');

    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="view-body">${inningsHtml}</div>`;
    openSheet({
      title: `Game · ${g.date}`,
      content: wrap,
      actions: [{ label: 'Close', variant: 'primary', handler: closeSheet }],
    });
  }

  function openToggleConfirm(id) {
    const g = getSavedGames().find((x) => x.id === id);
    if (!g) return;
    const targetIncluded = !g.included;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="confirm-body">
        <p><strong>${targetIncluded ? 'Mark as Included?' : 'Mark as Test?'}</strong></p>
        <p>This game will ${targetIncluded ? 'count toward' : 'be excluded from'} season totals (bench + position innings).</p>
      </div>
    `;
    openSheet({
      title: targetIncluded ? 'Mark as Included' : 'Mark as Test',
      content: wrap,
      actions: [
        { label: 'Cancel', handler: closeSheet },
        {
          label: targetIncluded ? 'Mark Included' : 'Mark Test',
          variant: 'primary',
          handler: () => {
            const games = getSavedGames();
            const updated = games.map((x) => (x.id === id ? { ...x, included: targetIncluded } : x));
            setSavedGames(updated);
            closeSheet();
            refresh();
            showToast(targetIncluded ? 'Marked as Included.' : 'Marked as Test.', { durationMs: 2500 });
          },
        },
      ],
    });
  }

  function openDeleteConfirm(id) {
    const g = getSavedGames().find((x) => x.id === id);
    if (!g) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="confirm-body">
        <p><strong>Delete this game?</strong></p>
        <p>Game from ${esc(g.date)} will be removed. This cannot be undone.</p>
      </div>
    `;
    openSheet({
      title: 'Delete game',
      content: wrap,
      actions: [
        { label: 'Cancel', handler: closeSheet },
        {
          label: 'Delete',
          variant: 'danger',
          handler: () => {
            setSavedGames(getSavedGames().filter((x) => x.id !== id));
            closeSheet();
            refresh();
            showToast('Game deleted.', { durationMs: 2500 });
          },
        },
      ],
    });
  }

  refresh();
}

const POS_ORDER = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'CF', 'RCF', 'RF'];

function sumPitches(g) {
  const ap = g.pitchAppearances || {};
  let total = 0;
  for (const pid of Object.keys(ap)) {
    total += Object.values(ap[pid].perInning || {}).reduce((a, b) => a + (b || 0), 0);
  }
  return total;
}

function nameOfSnap(g, pid) {
  return (g.rosterSnapshot && g.rosterSnapshot[pid] && g.rosterSnapshot[pid].firstName) || 'Player';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
