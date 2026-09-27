'use strict';

let timer = null;

export function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    // Announced to screen readers; the app has no other feedback channel.
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

/** Clears a toast that belongs to the screen being left (switching tabs). */
export function hideToast() {
  clearTimeout(timer);
  document.getElementById('toast')?.classList.remove('show');
}
