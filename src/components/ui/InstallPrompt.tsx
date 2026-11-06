'use client';
import { useEffect, useRef, useState } from 'react';

/** Chrome / Edge / Samsung Internet fire this when the page can be installed; it isn't in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SNOOZE_KEY = 'mm_install_snoozed_until';
const INSTALLED_KEY = 'mm_install_done';
const SNOOZE_DAYS = 7;
const SHOW_DELAY_MS = 2500;

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode: it just may ask again */ }
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function isIOS(): boolean {
  // iPadOS reports itself as a Mac, with a touch screen
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isPhone(): boolean {
  return /Android|iPhone|iPod|Mobi/i.test(navigator.userAgent) || (isIOS() && Math.min(screen.width, screen.height) < 820);
}
/** WhatsApp / Instagram / Facebook open links in their own browser, which can't add to the home screen. */
function isInAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|MicroMessenger/i.test(navigator.userAgent);
}

/**
 * Offers to install the site as an app on phones: a real "Instalar" button where the browser
 * supports it (Android / Chrome) and step-by-step instructions on iPhone, where Apple doesn't allow
 * a button. Shows up once, a moment after the page opens; "Ahora no" snoozes it for a week and
 * installing (or already running installed) silences it for good.
 *
 * `startPath` is the page the installed app should open on — the player's own ticket.
 */
export default function InstallPrompt({ startPath }: { startPath: string }) {
  const [mode, setMode] = useState<'android' | 'ios' | null>(null);
  const [open, setOpen] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  // Point the manifest at this ticket so the home-screen icon opens it directly; restore on leave.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return;
    const original = link.getAttribute('href');
    link.setAttribute('href', `/api/manifest?start=${encodeURIComponent(startPath)}`);
    return () => { if (original) link.setAttribute('href', original); };
  }, [startPath]);

  useEffect(() => {
    if (readStore(INSTALLED_KEY) || isStandalone() || !isPhone()) return;
    const snoozedUntil = Number(readStore(SNOOZE_KEY) ?? 0);
    if (snoozedUntil > Date.now()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = (m: 'android' | 'ios') => {
      clearTimeout(timer);
      timer = setTimeout(() => { setMode(m); setOpen(true); }, SHOW_DELAY_MS);
    };
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini-bar away; we show ours
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      reveal('android');
    };
    const onInstalled = () => { writeStore(INSTALLED_KEY, '1'); setOpen(false); };

    if (isIOS()) reveal('ios');
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function snooze() {
    writeStore(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    setOpen(false);
  }

  async function install() {
    const evt = deferredPrompt.current;
    if (!evt) { snooze(); return; }
    setOpen(false);
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === 'accepted') writeStore(INSTALLED_KEY, '1'); else snooze();
    } catch {
      snooze();
    }
    deferredPrompt.current = null;
  }

  if (!open || !mode) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={snooze}
      role="dialog" aria-modal="true" aria-label="Instalar Meeple Loop">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-4 text-sm"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="w-14 h-14 rounded-xl shrink-0" />
          <div>
            <h3 className="font-semibold text-gray-100 text-base">Instalá Meeple Loop</h3>
            <p className="text-gray-400">Tené tu ticket y tus mesas a un toque, desde un icono en tu teléfono.</p>
          </div>
        </div>

        {mode === 'android' ? (
          <div className="flex gap-2">
            <button onClick={snooze}
              className="flex-1 border border-gray-700 rounded-lg py-2.5 text-gray-300 hover:bg-gray-800">
              Ahora no
            </button>
            <button onClick={install}
              className="flex-1 bg-indigo-600 text-white rounded-lg py-2.5 font-semibold hover:bg-indigo-700">
              Instalar
            </button>
          </div>
        ) : (
          <>
            <ol className="space-y-2 text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 font-bold">1.</span>
                <span>
                  Tocá el botón <strong>Compartir</strong>{' '}
                  <svg className="inline w-4 h-4 -mt-1 text-indigo-300" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                  </svg>{' '}
                  de la barra del navegador.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 font-bold">2.</span>
                <span>Elegí <strong>«Agregar a pantalla de inicio»</strong>.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-400 font-bold">3.</span>
                <span>Tocá <strong>Agregar</strong>. Listo: te queda el icono en tu teléfono.</span>
              </li>
            </ol>
            {isInAppBrowser() && (
              <p className="text-xs text-amber-300">
                Parece que abriste el link desde otra app (WhatsApp, Instagram…). Abrilo en Safari para poder instalarla.
              </p>
            )}
            <button onClick={snooze}
              className="w-full bg-indigo-600 text-white rounded-lg py-2.5 font-semibold hover:bg-indigo-700">
              Entendido
            </button>
          </>
        )}
      </div>
    </div>
  );
}
