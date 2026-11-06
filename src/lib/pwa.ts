// Small browser-environment checks shared by the install popup and the notifications opt-in.
// Client-only: every function reads window / navigator.

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  // iPadOS reports itself as a Mac, with a touch screen
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isPhone(): boolean {
  return /Android|iPhone|iPod|Mobi/i.test(navigator.userAgent) || (isIOS() && Math.min(screen.width, screen.height) < 820);
}

/** WhatsApp / Instagram / Facebook open links in their own browser, which can't add to the home screen. */
export function isInAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|MicroMessenger/i.test(navigator.userAgent);
}

// localStorage that never throws (private mode, blocked storage): reads give null, writes are skipped.
export function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeStore(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* it just may ask again */ }
}
