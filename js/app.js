import { mountPlayersTab } from './ui/tab-players.js';
import { mountGameTab } from './ui/tab-game.js';
import { mountGameSummaryTab } from './ui/tab-game-summary.js';
import { mountSavedTab } from './ui/tab-saved.js';
import { mountSettingsTab } from './ui/tab-settings.js';
import { showToast } from './ui/toast.js';
import { getUiPrefs, setUiPrefs } from './store.js';

const placeholderMount = (container, label, copy) => {
  container.innerHTML = `<div class="placeholder"><strong>${label}</strong>${copy}</div>`;
};

const TABS = {
  players: {
    title: 'Players',
    mount: (c) => mountPlayersTab(c),
  },
  game: {
    title: 'Game',
    mount: (c) => mountGameTab(c),
  },
  'game-summary': {
    title: 'Game Summary',
    mount: (c) => mountGameSummaryTab(c),
  },
  season: {
    title: 'Season',
    mount: (c) => placeholderMount(c, 'Season Summary', 'Cross-game totals land in Phase 4.'),
  },
  saved: {
    title: 'Saved Games',
    mount: (c) => mountSavedTab(c),
  },
  settings: {
    title: 'Settings',
    mount: (c) => mountSettingsTab(c),
  },
};

const ONBOARDING_KEY = 'rp_v1_onboarding_seen';

function getActiveTab() {
  const hash = window.location.hash.replace(/^#/, '');
  if (TABS[hash]) return hash;
  const last = getUiPrefs().lastTab;
  return TABS[last] ? last : 'players';
}

function renderTab() {
  const tab = getActiveTab();
  const content = document.getElementById('tab-content');
  if (content) {
    content.innerHTML = '';
    TABS[tab].mount(content);
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const title = document.getElementById('app-title');
  if (title) title.textContent = TABS[tab].title;
  setUiPrefs({ lastTab: tab });
  if (window.location.hash !== '#' + tab) {
    history.replaceState(null, '', '#' + tab);
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function showOnboardingIfNeeded() {
  let seen = false;
  try { seen = !!localStorage.getItem(ONBOARDING_KEY); } catch (e) { return; }
  if (seen) return;
  const msg = isIOS()
    ? 'Install: tap the Share icon → Add to Home Screen → Add. Then open from your home screen.'
    : 'Install: open the browser menu → Install app. Then open from your app drawer.';
  showToast(msg, { durationMs: 0, dismissible: true });
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch (e) { /* ignore */ }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch((err) => {
    console.warn('Service worker registration failed:', err);
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'NEW_VERSION') {
      showToast('New version installed — reload to apply.', { durationMs: 0, dismissible: true });
    }
  });
}

window.addEventListener('hashchange', renderTab);
window.addEventListener('DOMContentLoaded', () => {
  renderTab();
  registerServiceWorker();
  setTimeout(showOnboardingIfNeeded, 600);
});
