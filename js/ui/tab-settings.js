// Settings tab.
//
// Sections:
//   - App Update — Reload App for testing service-worker updates.
//   - Backup & Restore — copy/download a JSON snapshot of the entire store;
//     paste a backup to restore (with confirmation + automatic pre-restore
//     side-key backup).
//
// Future-proof structure: the tab body is a flat list of labeled <section>
// blocks. Add new sections by writing a render function and including it in
// renderHtml(). Candidate future sections:
//   - Team / roster (rename, archive bulk, reset season data shortcut)
//   - Player settings (default age, default restrictions)
//   - App version info (CACHE_NAME, install date, last update)
//   - App preferences (theme, default innings, view mode default)

import { loadStore, saveStore } from '../store.js';
import { showToast } from './toast.js';

const ROOT_KEY = 'rp_v1';

export function mountSettingsTab(container) {
  container.innerHTML = renderHtml();
  bind(container);
}

function renderHtml() {
  return `
    <div class="settings-list">
      ${renderAppUpdateSection()}
      ${renderBackupSection()}
    </div>
  `;
}

function renderAppUpdateSection() {
  return `
    <section class="settings-section">
      <h2 class="settings-heading">App Update</h2>
      <p class="settings-text">Reload the app to apply the latest version.</p>
      <button class="btn-primary" type="button" data-action="reload">Reload App</button>
    </section>
  `;
}

function renderBackupSection() {
  return `
    <section class="settings-section">
      <h2 class="settings-heading">Backup & Restore</h2>
      <p class="settings-text">Back up your team before reinstalling, clearing cache, or testing updates.</p>
      <div class="settings-actions">
        <button class="btn-secondary" type="button" data-action="copy-backup">Copy Backup</button>
        <button class="btn-secondary" type="button" data-action="download-backup">Download Backup</button>
      </div>
      <h3 class="settings-subheading">Restore from backup</h3>
      <p class="settings-text">Paste backup JSON below. Restore replaces your current roster and games — confirm before applying.</p>
      <textarea
        class="backup-textarea"
        data-input="restore-json"
        rows="6"
        placeholder='{"schemaVersion":1,"roster":{...},"savedGames":[...]}'
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"></textarea>
      <button class="btn-primary" type="button" data-action="restore">Restore Backup</button>
    </section>
  `;
}

function bind(container) {
  container.querySelector('[data-action="reload"]')?.addEventListener('click', () => {
    window.location.reload();
  });
  container.querySelector('[data-action="copy-backup"]')?.addEventListener('click', () => handleCopyBackup());
  container.querySelector('[data-action="download-backup"]')?.addEventListener('click', () => handleDownloadBackup());
  container.querySelector('[data-action="restore"]')?.addEventListener('click', () => handleRestore(container));
}

// === backup helpers ========================================================

function buildBackupBlob() {
  const blob = loadStore();
  return {
    schemaVersion: blob.schemaVersion,
    roster: blob.roster || {},
    activeGame: blob.activeGame ?? null,
    savedGames: Array.isArray(blob.savedGames) ? blob.savedGames : [],
    uiPrefs: blob.uiPrefs || {},
    backupCreatedAt: new Date().toISOString(),
  };
}

function backupSummary(blob) {
  const players = Object.keys(blob.roster || {}).length;
  const games = (blob.savedGames || []).length;
  return `${players} player${players === 1 ? '' : 's'}, ${games} saved game${games === 1 ? '' : 's'}`;
}

// Synchronous so iOS Safari treats the clipboard write as "in the user gesture".
function handleCopyBackup() {
  const blob = buildBackupBlob();
  const json = JSON.stringify(blob, null, 2);
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showToast('Clipboard not available on this browser. Use Download Backup.', {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }
  navigator.clipboard.writeText(json).then(() => {
    showToast(`Backup copied — ${backupSummary(blob)}.`, { durationMs: 4000 });
  }).catch((e) => {
    showToast(`Copy failed: ${(e && e.message) || e}. Try Download Backup.`, {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
  });
}

function handleDownloadBackup() {
  const blob = buildBackupBlob();
  const json = JSON.stringify(blob, null, 2);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `rotation-planner-backup-${ts}.json`;
  try {
    const file = new Blob([json], { type: 'application/json' });
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
    showToast(`Saving ${filename} — ${backupSummary(blob)}.`, { durationMs: 4000 });
  } catch (e) {
    showToast(`Download not supported here. Use Copy Backup. (${(e && e.message) || e})`, {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
  }
}

// === restore ==============================================================

function handleRestore(container) {
  const textarea = container.querySelector('[data-input="restore-json"]');
  const raw = (textarea && textarea.value || '').trim();
  if (!raw) {
    showToast('Paste backup JSON into the box first.', { variant: 'danger', dismissible: true });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    showToast(`Not valid JSON: ${(e && e.message) || e}`, {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }

  const validation = validateBackup(parsed);
  if (!validation.valid) {
    showToast(`Backup invalid: ${validation.reason}. Nothing was changed.`, {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }

  // Confirm overwrite — required per spec.
  const proceed = window.confirm('This will replace your current roster and games. Continue?');
  if (!proceed) return;

  // Belt-and-suspenders: snapshot the current rp_v1 to a side key BEFORE
  // overwriting, so a coach who mis-tapped Restore can recover via DevTools.
  try {
    const current = localStorage.getItem(ROOT_KEY);
    if (current) {
      localStorage.setItem(`${ROOT_KEY}_pre_restore_${Date.now()}`, current);
    }
  } catch (_) {
    // If even this fails, continue — saveStore() has its own safety guards.
  }

  // Build the canonical blob (drop backup-only metadata like backupCreatedAt).
  const cleanBlob = {
    schemaVersion: validation.schemaVersion,
    roster: parsed.roster && typeof parsed.roster === 'object' && !Array.isArray(parsed.roster) ? parsed.roster : {},
    activeGame: parsed.activeGame && typeof parsed.activeGame === 'object' && !Array.isArray(parsed.activeGame)
      ? parsed.activeGame
      : null,
    savedGames: Array.isArray(parsed.savedGames) ? parsed.savedGames : [],
    uiPrefs: parsed.uiPrefs && typeof parsed.uiPrefs === 'object' && !Array.isArray(parsed.uiPrefs)
      ? parsed.uiPrefs
      : { lastTab: 'players', onboardingSeen: true },
  };

  let writeOk = false;
  try {
    const result = saveStore(cleanBlob);
    writeOk = result !== false;
  } catch (e) {
    showToast(`Restore failed: ${(e && e.message) || e}. Existing data unchanged.`, {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }
  if (!writeOk) {
    showToast('Restore failed (save returned false). Existing data unchanged.', {
      variant: 'danger', dismissible: true, durationMs: 0,
    });
    return;
  }

  showToast('Backup restored. Reloading…', { durationMs: 1500 });
  setTimeout(() => window.location.reload(), 1500);
}

function validateBackup(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return { valid: false, reason: 'must be a JSON object' };
  }
  // schemaVersion required and numeric — accept any int (loadStore's schema-mismatch
  // path is non-destructive).
  if (typeof b.schemaVersion !== 'number' || !Number.isFinite(b.schemaVersion)) {
    return { valid: false, reason: 'missing or invalid schemaVersion' };
  }
  // Each top-level field, if present, must have the expected shape.
  if (b.roster != null && (typeof b.roster !== 'object' || Array.isArray(b.roster))) {
    return { valid: false, reason: 'roster must be an object' };
  }
  if (b.savedGames != null && !Array.isArray(b.savedGames)) {
    return { valid: false, reason: 'savedGames must be an array' };
  }
  if (b.activeGame != null && (typeof b.activeGame !== 'object' || Array.isArray(b.activeGame))) {
    return { valid: false, reason: 'activeGame must be null or an object' };
  }
  if (b.uiPrefs != null && (typeof b.uiPrefs !== 'object' || Array.isArray(b.uiPrefs))) {
    return { valid: false, reason: 'uiPrefs must be an object' };
  }
  return { valid: true, schemaVersion: b.schemaVersion };
}
