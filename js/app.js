const TABS = {
  players: {
    title: 'Players',
    render: () => '<div class="placeholder"><strong>Players</strong>Roster CRUD lands in Phase 1.</div>',
  },
  game: {
    title: 'Game',
    render: () => '<div class="placeholder"><strong>Game</strong>Inning cards + Generate land in Phase 2.</div>',
  },
  'game-summary': {
    title: 'Game Summary',
    render: () => '<div class="placeholder"><strong>Game Summary</strong>Current-game totals land in Phase 3.</div>',
  },
  season: {
    title: 'Season',
    render: () => '<div class="placeholder"><strong>Season Summary</strong>Cross-game totals land in Phase 4.</div>',
  },
  saved: {
    title: 'Saved Games',
    render: () => '<div class="placeholder"><strong>Saved Games</strong>Save / load / Test toggle land in Phase 3.</div>',
  },
};

const ONBOARDING_KEY = 'rp_v1_onboarding_seen';

function getActiveTab() {
  const hash = window.location.hash.replace(/^#/, '');
  return TABS[hash] ? hash : 'players';
}

function renderTab() {
  const tab = getActiveTab();
  const content = document.getElementById('tab-content');
  if (content) content.innerHTML = TABS[tab].render();
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const title = document.getElementById('app-title');
  if (title) title.textContent = TABS[tab].title;
}

function showToast(text, opts = {}) {
  const { durationMs = 4000, dismissible = false } = opts;
  const host = document.getElementById('toast-host');
  if (!host) return;
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = text;
  if (dismissible) {
    const btn = document.createElement('button');
    btn.className = 'toast-dismiss';
    btn.type = 'button';
    btn.textContent = 'Got it';
    btn.addEventListener('click', () => div.remove());
    div.appendChild(btn);
  }
  host.appendChild(div);
  if (durationMs > 0) setTimeout(() => div.remove(), durationMs);
  return div;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function showOnboardingIfNeeded() {
  let seen = false;
  try { seen = !!localStorage.getItem(ONBOARDING_KEY); } catch (e) { return; }
  if (seen) return;
  const msg = isIOS()
    ? 'Install: tap the Share icon → Add to Home Screen → Add. Then open from your home screen for the best experience.'
    : 'Install: open the browser menu → Install app. Then open from your app drawer for the best experience.';
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
