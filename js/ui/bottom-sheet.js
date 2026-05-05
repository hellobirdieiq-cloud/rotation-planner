// Shared bottom-sheet primitive. Used for player editing in Phase 1
// and cell editing in Phase 2.
// Direct DOM manipulation — no UI framework, no state library.

let activeSheet = null;

export function openSheet({ title, content, actions = [], onClose }) {
  closeSheet();

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSheet();
  });

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  if (title) sheet.setAttribute('aria-label', title);

  const handle = document.createElement('div');
  handle.className = 'sheet-handle';
  sheet.appendChild(handle);

  if (title) {
    const h = document.createElement('h2');
    h.className = 'sheet-title';
    h.textContent = title;
    sheet.appendChild(h);
  }

  const body = document.createElement('div');
  body.className = 'sheet-body';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content instanceof Node) body.appendChild(content);
  sheet.appendChild(body);

  if (actions.length > 0) {
    const actionsBar = document.createElement('div');
    actionsBar.className = 'sheet-actions';
    actions.forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheet-btn ' + (action.variant || '');
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        if (action.handler) action.handler();
      });
      actionsBar.appendChild(btn);
    });
    sheet.appendChild(actionsBar);
  }

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Trigger slide-up transition after mount.
  requestAnimationFrame(() => sheet.classList.add('open'));

  activeSheet = { overlay, onClose };
  return { close: closeSheet, body };
}

export function closeSheet() {
  if (!activeSheet) return;
  const { overlay, onClose } = activeSheet;
  activeSheet = null;
  overlay.remove();
  if (onClose) onClose();
}
