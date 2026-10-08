/** R-09: returns true for key combos that must be blocked on a locked station (Alt+F4, Ctrl+W/T/N/R/L, F5, F11, F12, Ctrl+Shift+I/J/C, Meta, Alt+Tab, Escape when fullscreen-locked, browser back). */
export function isBlockedKey(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): boolean { throw new Error("not implemented"); }
/** Constant-time-ish PIN check for proctor exit. */
export function checkProctorPin(input: string, expected: string): boolean { throw new Error("not implemented"); }
