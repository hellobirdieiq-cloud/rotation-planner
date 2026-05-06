import { getActiveGame, setActiveGame, getRoster, getSavedGames, setSavedGames } from '../store.js';
import { newId } from '../id.js';
import { layoutFor, isInfield, isOutfield } from '../positions.js';
import { rebalance } from '../rebalance.js';
import { applyEdit, clearCell, toggleLock } from '../edit.js';
import { validateMarkComplete } from '../rules.js';
import { openSheet, closeSheet } from './bottom-sheet.js';
import { showToast, renderWarningPanel } from './toast.js';

const POSITION_LABELS = {
  P: "Pitcher (P)",
  C: "Catcher (C)",
  '1B': "First Base (1B)",
  '2B': "Second Base (2B)",
  '3B': "Third Base (3B)",
  SS: "Shortstop (SS)",
  LF: "Left Field (LF)",
  LCF: "Left Center (LCF)",
  RCF: "Right Center (RCF)",
  RF: "Right Field (RF)",
  BN: "Bench (BN)"
};

// Module-local state for pre-game availability checkboxes.
// Persists in DOM only (until Update Lineup is tapped).
let pendingPresent = null;
let mountEl = null;
const VIEW_MODE_STORAGE_KEY = 'rotation:viewMode';
let viewMode = 'player';
let viewModeRestored = false;
// Collapsible-section state. null = uninitialized; once set, persists across refreshes.
// Default rule: expanded before first Update Lineup; auto-collapsed after Update Lineup.
let availabilityExpanded = null;
export function mountGameTab(container) {
  mountEl = container;
  initPendingPresent();
  initAvailabilityExpanded();
  refresh();
}

function initAvailabilityExpanded() {
  if (availabilityExpanded !== null) return;        // preserve user's manual choice across refreshes
  availabilityExpanded = !getActiveGame();           // expanded only before first Update Lineup
}

function initPendingPresent() {
  const ag = getActiveGame();
  pendingPresent = {};
  const active = Object.values(getRoster()).filter((p) => !p.archived);
  if (ag && Array.isArray(ag.presentPlayers)) {
    active.forEach((p) => {
      pendingPresent[p.id] = ag.presentPlayers.includes(p.id);
    });
  } else {
    active.forEach((p) => { pendingPresent[p.id] = true; });
  }
}

function refresh() {
  if (!mountEl) return;
  mountEl.innerHTML = renderHtml();
  bind();
}

function ensureViewModeRestored(ag) {
  if (viewModeRestored || !ag) return;
  let stored = null;
  try { stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY); } catch (e) { /* storage unavailable */ }
  if (stored === 'player' || stored === 'position') {
    viewMode = stored;
  } else if ((ag.completedInnings || []).length > 0) {
    viewMode = 'position';
  } else {
    viewMode = 'player';
  }
  viewModeRestored = true;
}

function renderHtml() {
  const ag = getActiveGame();
  ensureViewModeRestored(ag);
  const inGame = !!(ag && ag.gameStarted);
  const roster = getRoster();
  const active = Object.values(roster).filter((p) => !p.archived).sort(byName);
  const presentCount = active.filter((p) => pendingPresent[p.id] !== false).length;
  const sittingCount = active.length - presentCount;

  const playerWord = presentCount === 1 ? 'player' : 'players';

  return `
    <div class="game-tab-root${inGame ? ' game-started' : ''}">
      <details class="game-availability" id="availability-section"${availabilityExpanded ? ' open' : ''}>
        <summary class="availability-summary">
          <span class="availability-title">Pre-game availability</span>
          <span class="availability-meta" id="availability-meta">(${presentCount} ${playerWord})</span>
        </summary>
        <div class="availability-body">
          ${active.length === 0
            ? '<div class="placeholder">No active players in your roster yet.</div>'
            : `<div class="present-list">${active.map(presentRowHtml).join('')}</div>`}
          <div class="present-summary">
            <span id="present-count">${presentCount} present · ${sittingCount} sitting</span>
            <label class="innings-input">Innings
              <input type="number" id="total-innings" min="1" max="9" value="${ag ? ag.totalInnings : 6}">
            </label>
          </div>
        </div>
      </details>

      ${ag ? `
        <div class="game-meta">
          <label class="game-date-label" for="game-date">Game date</label>
          <input type="date" id="game-date" class="game-date-input" value="${esc(ag.date || '')}">
        </div>
        <div class="lineup-view-toggle" role="tablist" aria-label="Lineup view">
          <button type="button" class="view-toggle-btn${viewMode === 'player' ? ' active' : ''}" data-view="player" role="tab" aria-selected="${viewMode === 'player'}">Inning Overview</button>
          <button type="button" class="view-toggle-btn${viewMode === 'position' ? ' active' : ''}" data-view="position" role="tab" aria-selected="${viewMode === 'position'}">Inning Cards</button>
        </div>
        <div class="player-grid-actions">
          <button type="button" class="btn-secondary player-grid-export-btn" data-action="export-csv">Download CSV</button>
        </div>
        <div class="game-toggle-bar">
          <button type="button" class="${inGame ? 'btn-game-end' : 'btn-bottom'} game-toggle-btn" data-action="toggle-game-started">${inGame ? 'End Game' : 'Start Game'}</button>
        </div>
      ` : ''}

      ${ag ? (viewMode === 'player' ? renderPlayerGrid(ag) : renderInningCards(ag)) : '<div class="placeholder"><strong>No lineup yet</strong>Tap Update Lineup to create one.</div>'}

      <div class="game-bottom-bar">
        <button class="btn-bottom" type="button" data-action="update">Update Lineup</button>
        <button class="btn-bottom" type="button" data-action="save"${ag ? '' : ' disabled'}>Save</button>
        <button class="btn-bottom" type="button" data-action="new-game"${ag ? '' : ' disabled'}>Restart Game</button>
      </div>
    </div>
  `;
}

function presentRowHtml(p) {
  const present = pendingPresent[p.id] !== false;
  const jersey = p.jerseyNumber ? ` <span class="player-jersey">#${esc(p.jerseyNumber)}</span>` : '';
  const last = p.lastName ? ' ' + esc(p.lastName) : '';
  return `
    <label class="present-row">
      <input type="checkbox" ${present ? 'checked' : ''} data-pid="${esc(p.id)}">
      <span class="present-name">${esc(p.firstName)}${last}${jersey}</span>
    </label>
  `;
}

function renderInningCards(ag) {
  return `
    <div id="warning-mount"></div>
    <div class="inning-columns">${ag.schedule.map((inn) => renderInningCard(ag, inn)).join('')}</div>
  `;
}

function renderPlayerGrid(ag) {
  const innings = ag.schedule || [];
  const completed = ag.completedInnings || [];
  const players = ag.presentPlayers || [];

  const headerCells = players.map((pid) => `<th scope="col">${esc(nameOf(ag, pid))}</th>`).join('');

  const rows = innings.map((inn) => {
    const isCompleted = completed.includes(inn.index);
    const cells = players.map((pid) => {
      const cell = inn.cells[pid];
      const rawAssignment = cell && cell.assignment ? cell.assignment : '—';
      const isBench = rawAssignment === 'BN';
      const display = isBench ? '—' : rawAssignment;
      const lockIcon = cell && cell.locked ? '🔒 ' : '';
      const manualClass = cell && cell.manual ? ' cell-manual' : '';
      const benchClass = isBench ? ' player-grid-bench' : '';
      const lockedClass = cell && cell.locked ? ' cell-already-locked' : '';
      const clickable = !isCompleted;
      const dataAttrs = clickable
        ? ` data-inning="${inn.index}" data-position="${esc(rawAssignment)}"${isBench ? ` data-player-id="${esc(pid)}"` : ''}`
        : '';
      const posBtnHtml = `<button class="player-grid-pos-btn" type="button" data-swap-inning="${inn.index}" data-swap-position="${esc(rawAssignment)}"${isBench ? ` data-swap-pid="${esc(pid)}"` : ''}${isCompleted ? ' data-swap-completed="true"' : ''} aria-label="Swap player">${esc(display)}</button>`;
      return `<td class="player-grid-cell${manualClass}${benchClass}${lockedClass}"${dataAttrs}>${lockIcon}${posBtnHtml}</td>`;
    }).join('');
    return `
      <tr${isCompleted ? ' class="player-grid-row-complete"' : ''}>
        <th scope="row" class="player-grid-name">
          <span class="player-grid-name-label">Inning ${inn.index + 1}</span>
          ${isCompleted
            ? '<span class="player-grid-name-status">✓ Complete</span>'
            : `<button class="player-grid-end-btn" type="button" data-action="mark" data-inning="${inn.index}">End Inning ${inn.index + 1}</button>`}
        </th>
        ${cells}
      </tr>
    `;
  }).join('');

  const tallies = {};
  players.forEach((pid) => { tallies[pid] = { bench: 0, infield: 0, outfield: 0 }; });
  innings.forEach((inn) => {
    if (!inn || !inn.cells) return;
    players.forEach((pid) => {
      const cell = inn.cells[pid];
      if (!cell || typeof cell.assignment !== 'string') return;
      const a = cell.assignment;
      if (a === 'BN') tallies[pid].bench++;
      else if (isInfield(a)) tallies[pid].infield++;
      else if (isOutfield(a)) tallies[pid].outfield++;
    });
  });
  const tallyRowHtml = (label, key) => {
    const cells = players.map((pid) => `<td>${tallies[pid][key] || 0}</td>`).join('');
    return `<tr><th scope="row" class="player-grid-tally-label">${label}</th>${cells}</tr>`;
  };
  const tallySectionHeaderHtml = `
    <tr class="player-grid-tally-header">
      <th colspan="${1 + players.length}" scope="colgroup" class="player-grid-tally-section-label">Innings at:</th>
    </tr>
  `;
  const tfootHtml = `
    <tfoot class="player-grid-tally">
      ${tallySectionHeaderHtml}
      ${tallyRowHtml('BN', 'bench')}
      ${tallyRowHtml('IF', 'infield')}
      ${tallyRowHtml('OF', 'outfield')}
    </tfoot>
  `;

  return `
    <div id="warning-mount"></div>
    <div class="player-grid-wrap">
      <table class="player-grid">
        <thead>
          <tr>
            <th scope="col" class="player-grid-corner">Inning</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        ${tfootHtml}
      </table>
    </div>
  `;
}

function renderInningCard(ag, inn) {
  const isCompleted = (ag.completedInnings || []).includes(inn.index);
  const layout = layoutFor((ag.presentPlayers || []).length) || [];
  const cellByPos = {};
  const benched = [];
  for (const pid of ag.presentPlayers) {
    const cell = inn.cells[pid];
    if (!cell) continue;
    if (cell.assignment === 'BN') benched.push({ pid, locked: cell.locked, manual: cell.manual });
    else cellByPos[cell.assignment] = { pid, locked: cell.locked, manual: cell.manual };
  }

  const positionRows = layout.map((pos) => {
    const c = cellByPos[pos];
    const playerName = c ? nameOf(ag, c.pid) : '—';
    const lockIcon = c && c.locked ? '🔒 ' : '';
    const manualClass = c && c.manual ? ' cell-manual' : '';
    return `
      <button class="inn-cell${manualClass}" type="button" data-cell="${inn.index}|${pos}"${isCompleted ? ' disabled' : ''}>
        <span class="cell-pos">${pos}</span>
        <span class="cell-player">${lockIcon}${esc(playerName)}</span>
      </button>
    `;
  }).join('');

  const benchRow = benched.length > 0 ? `
    <div class="inn-bench">
      <span class="cell-pos">BN</span>
      <span class="cell-player">${benched.map((b) => esc(nameOf(ag, b.pid))).join(', ')}</span>
    </div>
  ` : '';

  // Pitch row — visible whenever someone is at P this inning.
  const pitcherEntry = Object.entries(inn.cells).find(([, c]) => c && c.assignment === 'P');
  const pitcherPid = pitcherEntry ? pitcherEntry[0] : null;
  const pitchEntered = pitcherPid && ag.pitchAppearances && ag.pitchAppearances[pitcherPid]
    && ag.pitchAppearances[pitcherPid].perInning
    ? ag.pitchAppearances[pitcherPid].perInning[inn.index]
    : null;
  const pitchLabel = pitchEntered != null
    ? `${pitchEntered} ${pitchEntered === 1 ? 'pitch' : 'pitches'}`
    : 'tap to enter';
  const pitchRow = pitcherPid ? `
    <button class="inn-pitches" type="button" data-pitch-inning="${inn.index}" data-pitch-pid="${esc(pitcherPid)}"${isCompleted ? ' disabled' : ''}>
      <span class="cell-pos">⚾</span>
      <span class="cell-player">${esc(nameOf(ag, pitcherPid))}<span class="pitch-count${pitchEntered != null ? '' : ' pitch-empty'}"> · ${pitchLabel}</span></span>
    </button>
  ` : '';

  const completeBtn = isCompleted
    ? `<button class="btn-secondary" type="button" data-action="unmark" data-inning="${inn.index}">✓ Complete · Unmark</button>`
    : `<button class="btn-secondary" type="button" data-action="mark" data-inning="${inn.index}">End Inning ${inn.index + 1}</button>`;

  return `
    <div class="inning-card${isCompleted ? ' completed' : ''}">
      <div class="inning-card-header">
        Inning ${inn.index + 1}${isCompleted ? '<span class="completed-badge">✓ Complete</span>' : ''}
      </div>
      <div class="inning-positions">${positionRows}</div>
      ${benchRow}
      ${pitchRow}
      <div class="inning-footer">${completeBtn}</div>
    </div>
  `;
}

function bind() {
  // Availability section open/close — keep module state in sync with native <details> toggle.
  const detailsEl = mountEl.querySelector('#availability-section');
  detailsEl?.addEventListener('toggle', () => {
    availabilityExpanded = !!detailsEl.open;
  });

  // Availability toggles.
  mountEl.querySelectorAll('.present-row input').forEach((cb) => {
    cb.addEventListener('change', () => {
      pendingPresent[cb.dataset.pid] = cb.checked;
      const active = Object.values(getRoster()).filter((p) => !p.archived);
      const present = active.filter((p) => pendingPresent[p.id] !== false).length;
      const sitting = active.length - present;
      const summaryEl = mountEl.querySelector('#present-count');
      if (summaryEl) summaryEl.textContent = `${present} present · ${sitting} sitting`;
      const metaEl = mountEl.querySelector('#availability-meta');
      if (metaEl) metaEl.textContent = `(${present} ${present === 1 ? 'player' : 'players'})`;
    });
  });

  // View-mode toggle (player grid vs inning cards).
  mountEl.querySelectorAll('.view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.view;
      if (next && next !== viewMode) {
        viewMode = next;
        viewModeRestored = true;
        try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, next); } catch (e) { /* storage unavailable */ }
        refresh();
      }
    });
  });

  // Bottom-bar actions.
  mountEl.querySelector('[data-action="update"]')?.addEventListener('click', handleUpdateLineup);
  mountEl.querySelector('[data-action="save"]:not([disabled])')?.addEventListener('click', handleSaveGame);
  mountEl.querySelector('[data-action="new-game"]:not([disabled])')?.addEventListener('click', handleStartNewGame);
  mountEl.querySelector('[data-action="toggle-game-started"]')?.addEventListener('click', handleToggleGameStarted);

  // Cell taps.
  mountEl.querySelectorAll('.inn-cell:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [inning, position] = btn.dataset.cell.split('|');
      openCellSheet(parseInt(inning, 10), position);
    });
  });

  // Player-grid cell taps.
  mountEl.querySelectorAll('.player-grid-cell[data-inning][data-position]').forEach((td) => {
    td.addEventListener('click', () => {
      openCellSheet(parseInt(td.dataset.inning, 10), td.dataset.position, td.dataset.playerId || null);
    });
  });

  // Player-grid position-button taps — open the bottom sheet.
  mountEl.querySelectorAll('.player-grid-pos-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.swapCompleted === 'true') {
        showToast('Inning is complete. Unmark to swap.', { variant: 'danger', dismissible: true });
        return;
      }
      const inning = parseInt(btn.dataset.swapInning, 10);
      const position = btn.dataset.swapPosition;
      openCellSheet(inning, position);
    });
  });

  // Pitch-count row taps.
  mountEl.querySelectorAll('.inn-pitches:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPitchSheet(parseInt(btn.dataset.pitchInning, 10), btn.dataset.pitchPid);
    });
  });

  // Mark / unmark complete.
  mountEl.querySelectorAll('[data-action="mark"]').forEach((btn) => {
    btn.addEventListener('click', () => handleMarkComplete(parseInt(btn.dataset.inning, 10)));
  });
  mountEl.querySelectorAll('[data-action="unmark"]').forEach((btn) => {
    btn.addEventListener('click', () => handleUnmarkComplete(parseInt(btn.dataset.inning, 10)));
  });

  // CSV export of the rotation grid.
  mountEl.querySelector('[data-action="export-csv"]')?.addEventListener('click', handleExportCsv);

  // Active-game date edit.
  mountEl.querySelector('#game-date')?.addEventListener('change', handleDateChange);
}

// Single-action scheduling: rebuilds incomplete/unlocked innings while
// preserving completed innings and locked cells. Creates a fresh full
// schedule when no active game exists.
function handleUpdateLineup() {
  const totalInnings = parseInt(mountEl.querySelector('#total-innings').value, 10) || 6;
  const oldGame = getActiveGame();

  const roster = getRoster();
  const presentPlayers = Object.values(roster)
    .filter((p) => !p.archived && pendingPresent[p.id] !== false)
    .map((p) => p.id);

  if (presentPlayers.length < 8) {
    showToast(`Need at least 8 players present (have ${presentPlayers.length}).`, {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }

  const rosterSnapshot = {};
  presentPlayers.forEach((pid) => {
    const p = roster[pid];
    rosterSnapshot[pid] = {
      firstName: p.firstName,
      lastName: p.lastName,
      jerseyNumber: p.jerseyNumber,
      age: p.age,
      restrictions: p.restrictions.slice(),
    };
  });

  const baseGame = oldGame ? {
    ...oldGame,
    totalInnings,
    presentPlayers,
    rosterSnapshot,
  } : {
    id: newId(),
    date: new Date().toISOString().slice(0, 10),
    savedAt: new Date().toISOString(),
    totalInnings,
    completedInnings: [],
    schedule: [],
    pitchAppearances: {},
    presentPlayers,
    rosterSnapshot,
    included: true,
  };

  const result = rebalance(baseGame);
  if (!result.nextGame) {
    showToast(result.warnings[0] || 'Could not update lineup.', {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }
  setActiveGame(result.nextGame);
  availabilityExpanded = false;
  refresh();
  if (result.warnings.length > 0) {
    const wm = mountEl.querySelector('#warning-mount');
    if (wm) renderWarningPanel(wm, result.warnings);
  }
  showToast('Lineup updated.', { durationMs: 2500 });
}

function handleExportCsv() {
  const ag = getActiveGame();
  if (!ag) {
    showToast('Update the lineup first.', { variant: 'danger', dismissible: true });
    return;
  }
  const innings = ag.schedule || [];
  const players = ag.presentPlayers || [];
  const headerRow = ['Inning', ...players.map((pid) => nameOf(ag, pid))];
  const dataRows = innings.map((inn) => {
    const cells = players.map((pid) => {
      const c = inn.cells && inn.cells[pid];
      return c && typeof c.assignment === 'string' ? c.assignment : '';
    });
    return [`Inning ${inn.index + 1}`, ...cells];
  });
  const csvCell = (s) => {
    const v = String(s);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const csv = [headerRow, ...dataRows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const stem = ag.date ? `rotation-grid-${ag.date}` : `rotation-grid-${ts}`;
  const filename = `${stem}.csv`;
  try {
    const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      URL.revokeObjectURL(url);
    }, 200);
    showToast(`Saving ${filename}.`, { durationMs: 2500 });
  } catch (e) {
    showToast(`Download not supported here. (${(e && e.message) || e})`, {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
  }
}

function handleDateChange(e) {
  const ag = getActiveGame();
  if (!ag) return;
  const v = e.target.value;
  if (!v) return;
  const next = JSON.parse(JSON.stringify(ag));
  next.date = v;
  setActiveGame(next);
}

function handleStartNewGame() {
  if (!confirm('Restart this game? This will clear the lineup, completed innings, and locked players.')) return;
  setActiveGame(null);
  initPendingPresent();
  availabilityExpanded = true;
  refresh();
}

function handleToggleGameStarted() {
  const ag = getActiveGame();
  if (!ag) return;
  const next = JSON.parse(JSON.stringify(ag));
  next.gameStarted = !next.gameStarted;
  setActiveGame(next);
  refresh();
}

function handleSaveGame() {
  const ag = getActiveGame();
  if (!ag) {
    showToast('Update the lineup first.', { variant: 'danger', dismissible: true });
    return;
  }
  const saved = getSavedGames().slice();
  const idx = saved.findIndex((g) => g.id === ag.id);
  const snapshot = JSON.parse(JSON.stringify({ ...ag, savedAt: new Date().toISOString() }));
  if (idx >= 0) {
    // Preserve `included` flag if it was toggled in Saved Games.
    snapshot.included = saved[idx].included;
    saved[idx] = snapshot;
    setSavedGames(saved);
    showToast('Game updated.', { durationMs: 2500 });
  } else {
    snapshot.included = true; // VF6
    saved.push(snapshot);
    setSavedGames(saved);
    showToast('Game saved.', { durationMs: 2500 });
  }
}

function openPitchSheet(inning, playerId) {
  const ag = getActiveGame();
  if (!ag) return;
  if ((ag.completedInnings || []).includes(inning)) {
    showToast('Inning is complete. Unmark to edit pitch count.', { variant: 'danger', dismissible: true });
    return;
  }
  const current = ag.pitchAppearances && ag.pitchAppearances[playerId]
    && ag.pitchAppearances[playerId].perInning
    ? ag.pitchAppearances[playerId].perInning[inning] ?? ''
    : '';
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="form-row">
      <label for="f-pitches">Pitches in inning ${inning + 1} for <strong>${esc(nameOf(ag, playerId))}</strong></label>
      <input type="number" id="f-pitches" value="${esc(current)}" min="0" max="200" inputmode="numeric" autocomplete="off">
      <div class="form-hint">Leave blank to clear. Coach is responsible for entering correct counts.</div>
    </div>
  `;
  // Auto-focus on iOS Safari (autofocus attr is unreliable).
  setTimeout(() => wrap.querySelector('#f-pitches')?.focus(), 100);

  openSheet({
    title: `Inning ${inning + 1} pitches`,
    content: wrap,
    actions: [
      { label: 'Cancel', handler: closeSheet },
      {
        label: 'Save',
        variant: 'primary',
        handler: () => {
          const raw = wrap.querySelector('#f-pitches').value.trim();
          const next = JSON.parse(JSON.stringify(ag));
          if (!next.pitchAppearances) next.pitchAppearances = {};
          if (!next.pitchAppearances[playerId]) next.pitchAppearances[playerId] = { perInning: {}, removed: false };
          if (raw === '') {
            delete next.pitchAppearances[playerId].perInning[inning];
          } else {
            const val = parseInt(raw, 10);
            if (!Number.isFinite(val) || val < 0) {
              showToast('Enter a non-negative number.', { variant: 'danger', dismissible: true });
              return;
            }
            next.pitchAppearances[playerId].perInning[inning] = val;
          }
          setActiveGame(next);
          closeSheet();
          refresh();
        },
      },
    ],
  });
}

function handleMarkComplete(inningIdx) {
  const ag = getActiveGame();
  if (!ag) return;
  const v = validateMarkComplete(ag, inningIdx);
  if (!v.allowed) {
    showToast(v.reason, { variant: 'danger', dismissible: true, durationMs: 0 });
    return;
  }
  const next = JSON.parse(JSON.stringify(ag));
  if (!next.completedInnings.includes(inningIdx)) {
    next.completedInnings.push(inningIdx);
    next.completedInnings.sort((a, b) => a - b);
  }
  setActiveGame(next);
  refresh();
}

function handleUnmarkComplete(inningIdx) {
  if (!confirm(`Unmark inning ${inningIdx + 1} as complete?`)) return;
  const ag = getActiveGame();
  if (!ag) return;
  const next = JSON.parse(JSON.stringify(ag));
  next.completedInnings = (next.completedInnings || []).filter((i) => i !== inningIdx);
  setActiveGame(next);
  refresh();
}

function openCellSheet(inning, position, targetPid = null) {
  const ag = getActiveGame();
  if (!ag) return;
  if ((ag.completedInnings || []).includes(inning)) {
    showToast('Inning is complete. Unmark to edit.', { variant: 'danger', dismissible: true });
    return;
  }
  const inn = ag.schedule[inning];

  let currentPid = targetPid && inn.cells[targetPid] ? targetPid : null;
  if (!currentPid) {
    for (const [pid, cell] of Object.entries(inn.cells)) {
      if (cell && cell.assignment === position) { currentPid = pid; break; }
    }
  }
  const currentCell = currentPid ? inn.cells[currentPid] : null;
  const isLocked = !!(currentCell && currentCell.locked);
  const currentName = currentPid ? nameOf(ag, currentPid) : '(empty)';

  const wrap = document.createElement('div');

  const renderChip = (pid) => {
    const where = inn.cells[pid] ? inn.cells[pid].assignment : 'BN';
    const lockedElsewhere = inn.cells[pid] && inn.cells[pid].locked && pid !== currentPid;
    const isCurrent = pid === currentPid;
    return `
      <button class="player-chip${isCurrent ? ' current' : ''}${lockedElsewhere ? ' chip-locked' : ''}" type="button" data-target-pid="${esc(pid)}"${lockedElsewhere ? ' disabled' : ''}>
        <span class="chip-name">${esc(nameOf(ag, pid))}</span>
        <span class="chip-where">${lockedElsewhere ? '🔒 ' : ''}${esc(where)}</span>
      </button>
    `;
  };

  const zonePids = { bench: [], pc: [], infield: [], outfield: [] };
  ag.presentPlayers.forEach((pid) => {
    const where = inn.cells[pid] ? inn.cells[pid].assignment : 'BN';
    if (where === 'BN') zonePids.bench.push(pid);
    else if (where === 'P' || where === 'C') zonePids.pc.push(pid);
    else if (isInfield(where)) zonePids.infield.push(pid);
    else if (isOutfield(where)) zonePids.outfield.push(pid);
  });

  const zoneColHtml = (label, pids, modClass = '') => `
    <div class="cell-sheet-zone-col${modClass}">
      <div class="cell-sheet-zone-label">${label}</div>
      ${pids.length ? pids.map(renderChip).join('') : '<div class="cell-sheet-zone-empty">—</div>'}
    </div>
  `;

  const zonesHtml = `
    <div class="cell-sheet-zone-grid">
      ${zoneColHtml('Bench', zonePids.bench, ' cell-sheet-zone-bench')}
      ${zoneColHtml('P · C', zonePids.pc)}
      ${zoneColHtml('Infield', zonePids.infield)}
      ${zoneColHtml('Outfield', zonePids.outfield)}
    </div>
  `;

  const sendBenchHtml = currentPid
    ? `<button class="btn-secondary cell-sheet-send-bench" type="button" data-action="clear"${currentCell && currentCell.assignment === 'BN' ? ' disabled' : ''}>Send to bench</button>`
    : '';

  const positionLabel = POSITION_LABELS[position] || position;
  const lockRowHtml = currentPid
    ? `<button class="cell-sheet-lock-row${isLocked ? ' is-locked' : ''}" type="button" data-action="toggle-lock">
         <span class="cell-sheet-lock-row-text">
           <span class="cell-sheet-lock-row-name">${esc(currentName)}</span> is ${esc(positionLabel)} — Inning ${inning + 1}
         </span>
         <span class="cell-sheet-lock-row-toggle">${isLocked ? '🔒 Locked' : '🔓 Lock'}</span>
       </button>`
    : `<div class="cell-sheet-lock-row cell-sheet-lock-row-empty">
         <span class="cell-sheet-lock-row-text">No player assigned at ${esc(positionLabel)} — Inning ${inning + 1}</span>
       </div>`;

  wrap.innerHTML = `
    ${lockRowHtml}
    <div class="cell-sheet-section">
      ${zonesHtml}
    </div>
    ${sendBenchHtml}
  `;

  wrap.querySelectorAll('.player-chip[data-target-pid]:not([disabled])').forEach((chip) => {
    chip.addEventListener('click', () => {
      const newPid = chip.dataset.targetPid;
      if (newPid === currentPid) return;
      const result = applyEdit(ag, { inning, position, newPlayerId: newPid });
      if (result.rejected) {
        showToast(result.reason, { variant: 'danger', dismissible: true, durationMs: 0 });
        return;
      }
      setActiveGame(result.nextGame);
      closeSheet();
      refresh();
      if (result.ripples && result.ripples.length > 0) {
        const wm = mountEl.querySelector('#warning-mount');
        if (wm) renderWarningPanel(
          wm,
          result.ripples.map((r) => `Inning ${r.inning + 1}: ${r.reason}`)
        );
      }
    });
  });

  wrap.querySelector('[data-action="toggle-lock"]')?.addEventListener('click', () => {
    if (!currentPid) return;
    const result = toggleLock(ag, inning, currentPid);
    if (result.rejected) { showToast(result.reason, { variant: 'danger', dismissible: true }); return; }
    setActiveGame(result.nextGame);
    closeSheet();
    refresh();
  });

  wrap.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
    if (!currentPid) return;
    const result = clearCell(ag, inning, currentPid);
    if (result.rejected) { showToast(result.reason, { variant: 'danger', dismissible: true }); return; }
    setActiveGame(result.nextGame);
    closeSheet();
    refresh();
  });

  openSheet({
    title: `Edit assignment — Inning ${inning + 1}, ${POSITION_LABELS[position] || position}`,
    content: wrap,
    actions: [{ label: 'Close', variant: '', handler: closeSheet }],
  });
}

function nameOf(ag, pid) {
  const p = ag.rosterSnapshot && ag.rosterSnapshot[pid];
  return p ? p.firstName : 'Player';
}

function byName(a, b) {
  const cmp = a.firstName.localeCompare(b.firstName);
  if (cmp !== 0) return cmp;
  return (a.lastName || '').localeCompare(b.lastName || '');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
