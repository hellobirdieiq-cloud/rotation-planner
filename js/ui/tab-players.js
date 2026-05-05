import { getRoster, setRoster, getActiveGame, setActiveGame } from '../store.js';
import { newId } from '../id.js';
import { POSITIONS } from '../positions.js';
import { openSheet, closeSheet } from './bottom-sheet.js';

export function mountPlayersTab(container) {
  function refresh() {
    container.innerHTML = renderHtml();
    bind();
  }

  function renderHtml() {
    const roster = getRoster();
    const active = Object.values(roster)
      .filter((p) => !p.archived)
      .sort(byName);
    const archivedCount = Object.values(roster).filter((p) => p.archived).length;

    return `
      <div class="players-toolbar">
        <span class="players-count">${active.length} active player${active.length === 1 ? '' : 's'}</span>
        <button class="btn-primary" type="button" data-action="add">+ Add player</button>
      </div>
      ${active.length === 0
        ? '<div class="placeholder"><strong>No players yet</strong>Tap "+ Add player" to start your roster.</div>'
        : '<div class="players-list">' + active.map(playerRowHtml).join('') + '</div>'}
      ${archivedCount > 0
        ? `<button class="btn-link" type="button" data-action="archived">View archived (${archivedCount})</button>`
        : ''}
    `;
  }

  function bind() {
    container.querySelector('[data-action="add"]')?.addEventListener('click', () => openEditor(null, refresh));
    container.querySelector('[data-action="archived"]')?.addEventListener('click', () => openArchivedList(refresh));
    container.querySelectorAll('.player-row').forEach((row) => {
      row.addEventListener('click', () => openEditor(row.dataset.playerId, refresh));
    });
  }

  refresh();
}

function playerRowHtml(p) {
  const restrictedPositions = p.restrictions
    .map((r, i) => (r ? POSITIONS[i] : null))
    .filter(Boolean);
  const restrictedText = restrictedPositions.length > 0
    ? ' · ⊘ ' + restrictedPositions.join(', ')
    : '';
  const jersey = p.jerseyNumber ? ` <span class="player-jersey">#${esc(p.jerseyNumber)}</span>` : '';
  const last = p.lastName ? ' ' + esc(p.lastName) : '';
  return `
    <div class="player-row" data-player-id="${esc(p.id)}">
      <div class="player-name">${esc(p.firstName)}${last}${jersey}</div>
      <div class="player-meta">age ${p.age}${esc(restrictedText)}</div>
    </div>
  `;
}

function openEditor(playerId, refreshFn) {
  const isNew = !playerId;
  const player = isNew ? newPlayerDefaults() : getRoster()[playerId];
  if (!isNew && !player) return;

  const form = document.createElement('div');
  form.className = 'player-editor';
  form.innerHTML = `
    <div class="form-row">
      <label for="f-first">First name</label>
      <input type="text" id="f-first" value="${escAttr(player.firstName || '')}" autocomplete="off" autocapitalize="words" enterkeyhint="done">
    </div>
    <div class="form-row">
      <label for="f-last">Last name <span class="form-hint">(optional)</span></label>
      <input type="text" id="f-last" value="${escAttr(player.lastName || '')}" autocomplete="off" autocapitalize="words">
    </div>
    <div class="form-row form-row-half">
      <label for="f-jersey">Jersey # <span class="form-hint">(optional)</span>
        <input type="text" id="f-jersey" value="${escAttr(player.jerseyNumber || '')}" autocomplete="off" inputmode="numeric">
        <div class="form-warning" id="f-jersey-warning" hidden></div>
      </label>
      <label for="f-age">Age
        <select id="f-age">
          ${[8, 9, 10, 11, 12].map((a) => `<option value="${a}"${a === player.age ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="form-row">
      <label>Cannot play <span class="form-hint">(red = restricted)</span></label>
      <div class="restriction-toggles" role="group" aria-label="Position restrictions">
        ${POSITIONS.map((p, i) =>
          `<button type="button" class="pos-toggle${player.restrictions[i] ? ' restricted' : ''}" data-pos-index="${i}" aria-pressed="${player.restrictions[i] ? 'true' : 'false'}">${p}</button>`
        ).join('')}
      </div>
    </div>
  `;

  // Toggle restriction class on tap.
  form.querySelectorAll('.pos-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pressed = btn.classList.toggle('restricted');
      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  });

  // Live duplicate-jersey warning (warn-only per spec L197).
  const jerseyInput = form.querySelector('#f-jersey');
  const jerseyWarning = form.querySelector('#f-jersey-warning');
  function updateJerseyWarning() {
    const val = jerseyInput.value.trim();
    if (!val) {
      jerseyWarning.hidden = true;
      return;
    }
    const dup = Object.values(getRoster()).find(
      (p) => !p.archived && p.id !== playerId && p.jerseyNumber === val
    );
    if (dup) {
      jerseyWarning.textContent = `Heads up — #${val} is also used by ${dup.firstName}.`;
      jerseyWarning.hidden = false;
    } else {
      jerseyWarning.hidden = true;
    }
  }
  jerseyInput.addEventListener('input', updateJerseyWarning);
  updateJerseyWarning();

  const actions = [
    { label: 'Cancel', variant: '', handler: closeSheet },
  ];
  if (!isNew) {
    actions.push({
      label: player.archived ? 'Unarchive' : 'Archive',
      variant: 'danger',
      handler: () => {
        const r = getRoster();
        if (!r[playerId]) { closeSheet(); return; }
        r[playerId] = { ...r[playerId], archived: !r[playerId].archived };
        setRoster(r);
        closeSheet();
        refreshFn();
      },
    });
  }
  actions.push({
    label: isNew ? 'Add player' : 'Save',
    variant: 'primary',
    handler: () => {
      const firstName = form.querySelector('#f-first').value.trim();
      if (!firstName) {
        form.querySelector('#f-first').focus();
        return; // require at least a first name
      }
      const lastName = form.querySelector('#f-last').value.trim();
      const jerseyNumber = form.querySelector('#f-jersey').value.trim();
      const age = parseInt(form.querySelector('#f-age').value, 10);
      const restrictions = Array.from(form.querySelectorAll('.pos-toggle'))
        .map((b) => b.classList.contains('restricted'));

      const r = getRoster();
      if (isNew) {
        const id = newId();
        r[id] = {
          id,
          firstName,
          lastName,
          jerseyNumber,
          age,
          restrictions,
          archived: false,
          createdAt: new Date().toISOString(),
        };
      } else {
        r[playerId] = {
          ...r[playerId],
          firstName,
          lastName,
          jerseyNumber,
          age,
          restrictions,
        };
      }
      setRoster(r);

      const ag = getActiveGame();
      if (ag && ag.rosterSnapshot && ag.rosterSnapshot[playerId]) {
        ag.rosterSnapshot[playerId] = {
          ...ag.rosterSnapshot[playerId],
          firstName,
          lastName,
        };
        setActiveGame(ag);
      }

      closeSheet();
      refreshFn();
    },
  });

  openSheet({
    title: isNew ? 'Add player' : 'Edit player',
    content: form,
    actions,
  });
}

function openArchivedList(refreshFn) {
  const archived = Object.values(getRoster())
    .filter((p) => p.archived)
    .sort(byName);

  const wrap = document.createElement('div');
  if (archived.length === 0) {
    wrap.innerHTML = '<div class="placeholder">No archived players.</div>';
  } else {
    wrap.innerHTML = '<div class="archived-list">' + archived.map((p) => `
      <div class="archived-row">
        <div>
          <div class="player-name">${esc(p.firstName)}${p.lastName ? ' ' + esc(p.lastName) : ''}</div>
          <div class="player-meta">age ${p.age}</div>
        </div>
        <button type="button" class="btn-secondary" data-unarchive="${esc(p.id)}">Unarchive</button>
      </div>
    `).join('') + '</div>';
  }

  wrap.querySelectorAll('[data-unarchive]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-unarchive');
      const r = getRoster();
      if (!r[id]) return;
      r[id] = { ...r[id], archived: false };
      setRoster(r);
      closeSheet();
      refreshFn();
    });
  });

  openSheet({
    title: 'Archived players',
    content: wrap,
    actions: [{ label: 'Done', variant: 'primary', handler: closeSheet }],
  });
}

function newPlayerDefaults() {
  return {
    firstName: '',
    lastName: '',
    jerseyNumber: '',
    age: 10,
    restrictions: new Array(POSITIONS.length).fill(false),
    archived: false,
  };
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
function escAttr(s) { return esc(s); }
