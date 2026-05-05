// Settings tab.
//
// Currently holds only an "App Update" section with a Reload button — used
// for testing service-worker updates without forcing a manual swipe-down or
// killing the PWA from the app switcher.
//
// Future-proof structure: the tab body is a flat list of labeled <section>
// blocks. Add new sections by writing a render function and including it in
// renderHtml(). Candidate future sections:
//   - Team / roster (rename, archive bulk, reset season data shortcut)
//   - Player settings (default age, default restrictions)
//   - App version info (CACHE_NAME, install date, last update)
//   - App preferences (theme, default innings, view mode default)

export function mountSettingsTab(container) {
  container.innerHTML = renderHtml();
  bind(container);
}

function renderHtml() {
  return `
    <div class="settings-list">
      ${renderAppUpdateSection()}
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

function bind(container) {
  container.querySelector('[data-action="reload"]')?.addEventListener('click', () => {
    window.location.reload();
  });
}
