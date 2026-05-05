// Direct localStorage access via a single root key — no abstraction class.
// AF1: atomic writes of the entire blob.
// VF10: clean start, no v7 migration.
//
// Data preservation contract:
//   - If `rp_v1` exists in localStorage, loadStore() ALWAYS returns the parsed
//     blob (with defaults filling in missing top-level fields). It NEVER
//     replaces existing data with empty defaults.
//   - On parse error or unexpected shape, loadStore() flags corruption; the
//     next saveStore() backs the corrupt blob up to a timestamped side key
//     before overwriting, so the original is recoverable via DevTools.
//   - Schema-version mismatch logs a warning but preserves existing data
//     (future migrations live here).
//   - saveStore() additionally auto-backs-up if a save would wipe a previously
//     populated roster, as a belt-and-suspenders against logic bugs in callers.
//   - No code path in this file (or anywhere in the project) calls
//     localStorage.clear() or removeItem(ROOT_KEY). Service worker updates do
//     NOT touch localStorage — only the SW cache.

const ROOT_KEY = 'rp_v1';
const SCHEMA_VERSION = 1;

// Module-local flag — set when loadStore detects corrupt/unparseable data.
// While true, the next saveStore writes a backup copy of the corrupt original
// to a timestamped side key (so it's recoverable) and then clears the flag.
let corruptionDetected = false;
let lastCorruptRaw = null;

function defaults() {
  return {
    schemaVersion: SCHEMA_VERSION,
    roster: {},
    activeGame: null,
    savedGames: [],
    uiPrefs: { lastTab: 'players', onboardingSeen: false },
  };
}

export function loadStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(ROOT_KEY);
  } catch (e) {
    console.error('store: localStorage.getItem threw — returning defaults for THIS read only', e);
    return defaults();
  }

  // Truly missing — first run. Defaults are a fresh start; the next write is
  // safe because no prior data exists.
  if (raw == null || raw === '') return defaults();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Parse failed. PRESERVE the raw data — flag corruption so the next save
    // backs it up to a side key before overwriting.
    corruptionDetected = true;
    lastCorruptRaw = raw;
    console.error('store: rp_v1 is unparseable; raw data preserved. Returning defaults for this read only.', e);
    return defaults();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Wrong shape. Preserve and back up.
    corruptionDetected = true;
    lastCorruptRaw = raw;
    console.error('store: rp_v1 is not a plain object; raw data preserved.');
    return defaults();
  }

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    // Mismatched schema. Preserve existing fields; the merge below fills in
    // any missing top-level fields with defaults but leaves existing data
    // intact. Future migrations live here.
    console.warn(
      `store: schemaVersion ${parsed.schemaVersion} !== ${SCHEMA_VERSION}; preserving existing data`
    );
  }

  return {
    ...defaults(),
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    uiPrefs: { ...defaults().uiPrefs, ...(parsed.uiPrefs || {}) },
  };
}

export function saveStore(blob) {
  // 1) If we previously detected corruption, back up the corrupt original to a
  //    timestamped side key BEFORE overwriting. After a successful backup,
  //    clear the flag so future saves proceed normally.
  if (corruptionDetected && lastCorruptRaw) {
    const backupKey = `${ROOT_KEY}_corrupt_backup_${Date.now()}`;
    try {
      localStorage.setItem(backupKey, lastCorruptRaw);
      console.warn(`store: backed up corrupt rp_v1 to ${backupKey}`);
      corruptionDetected = false;
      lastCorruptRaw = null;
    } catch (e) {
      console.error('store: backup of corrupt data failed — aborting save to avoid data loss', e);
      return false;
    }
  }

  // 2) Belt-and-suspenders: if this save would wipe a previously populated
  //    roster (e.g., a logic bug in a caller), back up the prior blob to a
  //    timestamped side key before letting the wipe proceed. Logged loudly so
  //    the regression is noticed.
  try {
    const existingRaw = localStorage.getItem(ROOT_KEY);
    if (existingRaw) {
      const prev = JSON.parse(existingRaw);
      const prevCount = prev && prev.roster ? Object.keys(prev.roster).length : 0;
      const newCount = blob && blob.roster ? Object.keys(blob.roster).length : 0;
      if (prevCount > 0 && newCount === 0) {
        const backupKey = `${ROOT_KEY}_backup_${Date.now()}`;
        localStorage.setItem(backupKey, existingRaw);
        console.warn(
          `store: save would wipe roster (was ${prevCount} players, now 0). ` +
          `Backed up prior blob to ${backupKey}. If unintentional, restore via DevTools.`
        );
      }
    }
  } catch (e) {
    // If the guard itself fails, do not block the save.
  }

  // 3) Actually write.
  try {
    localStorage.setItem(ROOT_KEY, JSON.stringify(blob));
    return true;
  } catch (e) {
    console.error('store: setItem failed', e);
    return false;
  }
}

// === per-slice accessors ===
// All setters do load → mutate → save, so the rest of the blob (roster,
// activeGame, savedGames, uiPrefs) is always carried forward intact.

export function getRoster() {
  return loadStore().roster;
}

export function setRoster(roster) {
  const blob = loadStore();
  blob.roster = roster;
  saveStore(blob);
}

export function getActiveGame() {
  return loadStore().activeGame;
}

export function setActiveGame(game) {
  const blob = loadStore();
  blob.activeGame = game;
  saveStore(blob);
}

export function getSavedGames() {
  return loadStore().savedGames;
}

export function setSavedGames(games) {
  const blob = loadStore();
  blob.savedGames = games;
  saveStore(blob);
}

export function getUiPrefs() {
  return loadStore().uiPrefs;
}

export function setUiPrefs(prefs) {
  const blob = loadStore();
  blob.uiPrefs = { ...blob.uiPrefs, ...prefs };
  saveStore(blob);
}
