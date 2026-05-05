import { getActiveGame, setActiveGame, getRoster, getSavedGames, setSavedGames } from '../store.js';
import { newId } from '../id.js';
import { layoutFor } from '../positions.js';
import { generate } from '../generate.js';
import { rebalance } from '../rebalance.js';
import { applyEdit, clearCell, toggleLock } from '../edit.js';
import { validateMarkComplete } from '../rules.js';
import { openSheet, closeSheet } from './bottom-sheet.js';
import { showToast, renderWarningPanel } from './toast.js';

// Module-local state for pre-game availability checkboxes.
// Persists in DOM only (until Generate is tapped).
let pendingPresent = null;
let mountEl = null;
// Collapsible-section state. null = uninitialized; once set, persists across refreshes.
// Default rule: expanded before first Generate; auto-collapsed after Generate.
let availabilityExpanded = null;

export function mountGameTab(container) {
  mountEl = container;
  initPendingPresent();
  initAvailabilityExpanded();
  refresh();
}

function initAvailabilityExpanded() {
  if (availabilityExpanded !== null) return;        // preserve user's manual choice across refreshes
  availabilityExpanded = !getActiveGame();           // expanded only before first Generate
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

function renderHtml() {
  const ag = getActiveGame();
  const roster = getRoster();
  const active = Object.values(roster).filter((p) => !p.archived).sort(byName);
  const presentCount = active.filter((p) => pendingPresent[p.id] !== false).length;
  const sittingCount = active.length - presentCount;

  const playerWord = presentCount === 1 ? 'player' : 'players';

  return `
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

    ${ag ? renderInningCards(ag) : '<div class="placeholder"><strong>No lineup yet</strong>Tap Generate to create one.</div>'}

    <div class="game-bottom-bar">
      <button class="btn-bottom" type="button" data-action="generate">Generate</button>
      <button class="btn-bottom" type="button" data-action="rebalance"${ag ? '' : ' disabled'}>Rebalance</button>
      <button class="btn-bottom" type="button" data-action="save"${ag ? '' : ' disabled'}>Save</button>
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
    : `<button class="btn-secondary" type="button" data-action="mark" data-inning="${inn.index}">Mark inning complete</button>`;

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

  // Bottom-bar actions.
  mountEl.querySelector('[data-action="generate"]')?.addEventListener('click', handleGenerateButton);
  mountEl.querySelector('[data-action="rebalance"]')?.addEventListener('click', handleRebalance);
  mountEl.querySelector('[data-action="save"]:not([disabled])')?.addEventListener('click', handleSaveGame);

  // Cell taps.
  mountEl.querySelectorAll('.inn-cell:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [inning, position] = btn.dataset.cell.split('|');
      openCellSheet(parseInt(inning, 10), position);
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
}

// Entry point for the Generate button. Generate now means "append the next
// inning"; the legacy three-button "Regenerate?" sheet is bypassed via the
// ALLOW_FULL_REGENERATE flag. Flip the flag to re-enable a full-regenerate path.
function handleGenerateButton() {
  const ALLOW_FULL_REGENERATE = false;
  const ag = getActiveGame();
  const completedCount = ag ? (ag.completedInnings || []).length : 0;
  if (!ALLOW_FULL_REGENERATE || completedCount === 0) {
    runGenerate();
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="confirm-body">
      <p><strong>${completedCount} ${completedCount === 1 ? 'inning is' : 'innings are'} marked complete.</strong></p>
      <p>Regenerate will reset the entire lineup, including completed innings.</p>
    </div>
  `;
  openSheet({
    title: 'Regenerate?',
    content: wrap,
    actions: [
      { label: 'Cancel', handler: closeSheet },
      { label: 'Rebalance Remaining', variant: 'primary', handler: () => { closeSheet(); handleRebalance(); } },
      { label: 'Regenerate Anyway', variant: 'danger', handler: () => { closeSheet(); runGenerate(); } },
    ],
  });
}

function runGenerate() {
  const totalInnings = parseInt(mountEl.querySelector('#total-innings').value, 10) || 6;
  const oldGame = getActiveGame();
  const existingSchedule = (oldGame && oldGame.schedule) ? oldGame.schedule : [];
  const completedInnings = (oldGame && oldGame.completedInnings) ? oldGame.completedInnings : [];
  const nextIndex = existingSchedule.length;

  // Old games may already have a full 6-inning schedule. Treat "all innings
  // generated" as a separate, friendlier case before asking the user to mark
  // the active inning complete.
  if (nextIndex >= totalInnings) {
    showToast('This game already has all innings generated.', { variant: 'danger', dismissible: true });
    return;
  }
  // Otherwise, only the LAST generated inning needs to be complete before the
  // next one can be appended.
  const lastGeneratedIndex = existingSchedule.length - 1;
  const lastGeneratedComplete = completedInnings.includes(lastGeneratedIndex);
  if (existingSchedule.length > 0 && !lastGeneratedComplete) {
    showToast('Mark the current inning complete before generating the next inning.', { variant: 'danger', dismissible: true });
    return;
  }

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

  // Carry forward locks from already-generated innings so generate() honors
  // them when computing the next inning.
  const locks = [];
  existingSchedule.forEach((inn, idx) => {
    for (const [pid, cell] of Object.entries(inn.cells)) {
      if (cell && cell.locked && presentPlayers.includes(pid) && idx < totalInnings) {
        locks.push({ inning: idx, playerId: pid, position: cell.assignment });
      }
    }
  });
  const carriedPitches = oldGame && oldGame.pitchAppearances ? oldGame.pitchAppearances : {};

  const result = generate({
    presentPlayers, rosterSnapshot, totalInnings, locks,
    pitchAppearances: carriedPitches,
  });
  if (!result.schedule) {
    showToast(result.warnings[0] || 'Could not generate.', {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }
  const nextInning = result.schedule[nextIndex];
  if (!nextInning) {
    showToast('Could not generate next inning.', {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }

  const ag = {
    id: oldGame ? oldGame.id : newId(),
    date: oldGame ? oldGame.date : new Date().toISOString().slice(0, 10),
    savedAt: new Date().toISOString(),
    totalInnings,
    completedInnings,
    schedule: [...existingSchedule, nextInning],
    pitchAppearances: carriedPitches,
    presentPlayers,
    rosterSnapshot,
    included: true,
  };
  setActiveGame(ag);
  // Auto-collapse the pre-game availability section after a successful Generate
  // so the inning cards are immediately visible without scrolling.
  availabilityExpanded = false;
  refresh();
  if (result.warnings.length > 0) {
    const wm = mountEl.querySelector('#warning-mount');
    if (wm) renderWarningPanel(wm, result.warnings);
  }
  showToast(`Inning ${nextIndex + 1} generated.`, { durationMs: 2500 });
}

function handleSaveGame() {
  const ag = getActiveGame();
  if (!ag) {
    showToast('Generate a lineup first.', { variant: 'danger', dismissible: true });
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

function handleRebalance() {
  const ag = getActiveGame();
  if (!ag) return;
  const result = rebalance(ag);
  if (!result.nextGame) {
    showToast(result.warnings[0] || 'Could not rebalance.', {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }
  setActiveGame(result.nextGame);
  refresh();
  if (result.warnings.length > 0) {
    const wm = mountEl.querySelector('#warning-mount');
    if (wm) renderWarningPanel(wm, result.warnings);
  }
  showToast('Future innings rebalanced.', { durationMs: 2500 });
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

function openCellSheet(inning, position) {
  const ag = getActiveGame();
  if (!ag) return;
  if ((ag.completedInnings || []).includes(inning)) {
    showToast('Inning is complete. Unmark to edit.', { variant: 'danger', dismissible: true });
    return;
  }
  const inn = ag.schedule[inning];

  let currentPid = null;
  for (const [pid, cell] of Object.entries(inn.cells)) {
    if (cell && cell.assignment === position) { currentPid = pid; break; }
  }
  const currentCell = currentPid ? inn.cells[currentPid] : null;
  const isLocked = !!(currentCell && currentCell.locked);
  const currentName = currentPid ? nameOf(ag, currentPid) : '(empty)';

  const wrap = document.createElement('div');

  const chipsHtml = ag.presentPlayers.map((pid) => {
    const where = inn.cells[pid] ? inn.cells[pid].assignment : 'BN';
    const lockedElsewhere = inn.cells[pid] && inn.cells[pid].locked && pid !== currentPid;
    const isCurrent = pid === currentPid;
    return `
      <button class="player-chip${isCurrent ? ' current' : ''}${lockedElsewhere ? ' chip-locked' : ''}" type="button" data-target-pid="${esc(pid)}"${lockedElsewhere ? ' disabled' : ''}>
        <span class="chip-name">${esc(nameOf(ag, pid))}</span>
        <span class="chip-where">${lockedElsewhere ? '🔒 ' : ''}${esc(where)}</span>
      </button>
    `;
  }).join('');

  const cellActionsHtml = currentPid ? `
    <div class="cell-actions">
      <button class="btn-secondary" type="button" data-action="toggle-lock">${isLocked ? '🔓 Unlock' : '🔒 Lock'}</button>
      <button class="btn-secondary" type="button" data-action="clear"${currentCell && currentCell.assignment === 'BN' ? ' disabled' : ''}>Clear (→ BN)</button>
    </div>
  ` : '';

  // Position-first hierarchy: the position is the visual focal point; the
  // current player is secondary supporting context.
  const currentLine = currentPid
    ? `<div class="cell-sheet-current">Currently: <span class="cell-sheet-current-name">${esc(currentName)}</span>${isLocked ? ' 🔒' : ''}</div>`
    : '<div class="cell-sheet-current cell-sheet-current-empty">No player assigned yet</div>';

  wrap.innerHTML = `
    <div class="cell-sheet-hero">
      <div class="cell-sheet-pos">${esc(position)}</div>
      <div class="cell-sheet-inning">Inning ${inning + 1}</div>
      <div class="cell-sheet-helper">Assign a player to this position</div>
    </div>
    ${currentLine}
    <div class="cell-sheet-section">
      <div class="cell-sheet-label">Select a player</div>
      <div class="player-chips">${chipsHtml}</div>
    </div>
    ${cellActionsHtml}
  `;

  wrap.querySelectorAll('.player-chip[data-target-pid]:not([disabled])').forEach((chip) => {
    chip.addEventListener('click', () => {
      const newPid = chip.dataset.targetPid;
      if (newPid === currentPid) { closeSheet(); return; }
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
    // Title intentionally omitted — the in-body hero is the header now.
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
