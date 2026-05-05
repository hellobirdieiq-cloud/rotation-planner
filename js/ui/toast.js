// Shared toast + warning panel primitives.
// Direct DOM, no event bus.

export function showToast(text, opts = {}) {
  const { durationMs = 4000, dismissible = false, variant = '' } = opts;
  const host = document.getElementById('toast-host');
  if (!host) return null;
  const div = document.createElement('div');
  div.className = 'toast' + (variant ? ' toast-' + variant : '');
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

// Render a warning panel inside `container`. Pass an empty array to clear.
// `messages`: string[] | { text, severity? }[]
export function renderWarningPanel(container, messages) {
  const existing = container.querySelector('.warning-panel');
  if (existing) existing.remove();
  if (!messages || messages.length === 0) return;

  const panel = document.createElement('div');
  panel.className = 'warning-panel';

  const title = document.createElement('div');
  title.className = 'warning-title';
  title.textContent = `⚠ ${messages.length} ${messages.length === 1 ? 'warning' : 'warnings'}`;
  panel.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'warning-list';
  messages.forEach((m) => {
    const li = document.createElement('li');
    li.textContent = typeof m === 'string' ? m : m.text;
    ul.appendChild(li);
  });
  panel.appendChild(ul);

  container.prepend(panel);
}
