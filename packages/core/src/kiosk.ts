/** R-09: returns true for key combos that must be blocked on a locked station (Alt+F4, Ctrl+W/T/N/R/L, F5, F11, F12, Ctrl+Shift+I/J/C, Meta, Alt+Tab, Escape when fullscreen-locked, browser back). */
export function isBlockedKey(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): boolean {
  const key = e.key ?? '';
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (e.metaKey || k === 'Meta' || k === 'OS' || k === 'Super' || k === 'Hyper') return true;
  if (['F1', 'F3', 'F5', 'F6', 'F7', 'F11', 'F12', 'Escape', 'Esc', 'BrowserBack', 'BrowserForward', 'BrowserRefresh', 'BrowserHome', 'BrowserSearch', 'ContextMenu', 'PrintScreen'].includes(k)) return true;
  if (e.altKey) {
    if (['F4', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'Escape', ' '].includes(k)) return true;
    if (k === 'd') return true; // address bar
  }
  if (e.ctrlKey) {
    if (e.shiftKey && ['i', 'j', 'c', 'k', 'n', 't', 'w', 'q', 'delete', 'Delete'].includes(k)) return true;
    if (['w', 't', 'n', 'r', 'l', 'q', 'p', 's', 'o', 'u', 'h', 'j', 'd', 'k', 'e', 'g', 'f', 'Tab', 'F4', 'F5', 'PageUp', 'PageDown'].includes(k)) return true;
  }
  return false;
}

/** Constant-time-ish PIN check for proctor exit. */
export function checkProctorPin(input: string, expected: string): boolean {
  if (typeof input !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const len = Math.max(input.length, expected.length);
  let diff = input.length ^ expected.length;
  for (let i = 0; i < len; i++) diff |= (input.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return diff === 0;
}
