// Direct localStorage access via a single root key — no abstraction class.
// AF1: atomic writes of the entire blob.
// VF10: clean start, no v7 migration.

const ROOT_KEY = 'rp_v1';
const SCHEMA_VERSION = 1;

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
  try {
    const raw = localStorage.getItem(ROOT_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return defaults();
    // Fill in any missing top-level fields without disturbing existing ones.
    return {
      ...defaults(),
      ...parsed,
      uiPrefs: { ...defaults().uiPrefs, ...(parsed.uiPrefs || {}) },
    };
  } catch (e) {
    console.warn('store: load failed, returning defaults', e);
    return defaults();
  }
}

export function saveStore(blob) {
  localStorage.setItem(ROOT_KEY, JSON.stringify(blob));
}

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
