'use client';
import { useEffect, useRef, useState } from 'react';
import { isIOS, isInAppBrowser, isPhone, isStandalone, readStore, writeStore } from '@/lib/pwa';
import { getPushStatus, requestPushPermission, subscribeAfterPermission, type PushStatus } from '@/lib/pushClient';

/** Chrome / Edge / Samsung Internet fire this when the page can be installed; it isn't in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'android' | 'ios' | 'manual';

declare global {
  interface Window {
    /** Set by the early script in the root layout when the browser announced the install prompt. */
    __mmInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

const SNOOZE_KEY = 'mm_install_snoozed_until';
const INSTALLED_KEY = 'mm_install_done';
const SNOOZE_DAYS = 7;
const SNOOZE_DAYS_MANUAL = 30; // can't tell if it's already installed there, so nag less
const SHOW_DELAY_MS = 2500;
const FALLBACK_AFTER_MS = 4500; // how long to wait for the browser's own "installable" signal

/**
 * Helps phone users install the site as an app, in two ways:
 *  - a popup, once, a moment after the page opens ("Ahora no" snoozes it);
 *  - a permanent "📲 Instalar app" button, for anyone who missed or dismissed the popup.
 * Android/Chrome gets a real "Instalar" button; iPhone gets step-by-step instructions (Apple has no
 * install button for websites); any other phone browser that doesn't offer the install prompt gets
 * instructions for its menu. Installing — or running already installed — silences both for good.
 *
 * `startPath` is the page the installed app should open on — the player's own ticket.
 * Render it where the button should appear; the popup itself is a full-screen overlay.
 */
export default function InstallPrompt({ startPath, push }: { startPath: string; push?: { code: string; ticketCode: string } }) {
  const [mode, setMode] = useState<Mode>('manual');
  // With `push`, installing can also turn on notifications for this ticket (on by default, the browser still asks)
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [alsoPush, setAlsoPush] = useState(true);
  const hasPush = !!push;
  useEffect(() => {
    if (hasPush) getPushStatus().then(setPushStatus).catch(() => setPushStatus('unsupported'));
  }, [hasPush]);
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState(false); // phone, not installed: the button may show
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
    if (isStandalone()) writeStore(INSTALLED_KEY, '1'); // running inside the app: it is installed
    if (readStore(INSTALLED_KEY) || isStandalone() || !isPhone()) return;
    const autoPopup = Number(readStore(SNOOZE_KEY) ?? 0) <= Date.now();

    const timers: ReturnType<typeof setTimeout>[] = [setTimeout(() => setEligible(true), 0)];
    const reveal = (m: Mode, after: number) => {
      if (!autoPopup) return;
      timers.push(setTimeout(() => { setMode(m); setOpen(true); }, after));
    };

    const onInstallable = () => {
      if (!window.__mmInstallPrompt) return;
      deferredPrompt.current = window.__mmInstallPrompt;
      setMode('android'); // upgrades the popup if the instructions version was already up
      reveal('android', SHOW_DELAY_MS);
    };
    const onInstalled = () => { writeStore(INSTALLED_KEY, '1'); setOpen(false); setEligible(false); };

    if (window.__mmInstallPrompt) {
      onInstallable(); // the browser already announced it while the page was loading
    } else if (isIOS()) {
      reveal('ios', SHOW_DELAY_MS);
    } else {
      // If the browser never announces the install prompt (or isn't Chrome), show how to do it by hand
      timers.push(setTimeout(() => { if (!deferredPrompt.current) reveal('manual', 0); }, FALLBACK_AFTER_MS));
    }
    window.addEventListener('mm:installprompt', onInstallable);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('mm:installprompt', onInstallable);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function close(days = SNOOZE_DAYS) {
    writeStore(SNOOZE_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
    setOpen(false);
  }

  function openByHand() {
    setMode(deferredPrompt.current ? 'android' : isIOS() ? 'ios' : 'manual');
    setOpen(true);
  }

  async function install() {
    const evt = deferredPrompt.current;
    if (!evt) { setMode('manual'); return; }
    setOpen(false);
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === 'accepted') {
        writeStore(INSTALLED_KEY, '1');
        setEligible(false);
        if (push && alsoPush && pushStatus === 'off') {
          // Right after installing: ask for notifications too, so it is one flow. If the browser declines to show
          // the dialog here, the card on the ticket page offers it.
          try { await subscribeAfterPermission(push.code, push.ticketCode, await requestPushPermission()); } catch { /* the ticket page card covers it */ }
        }
      } else close();
    } catch {
      close();
    }
    deferredPrompt.current = null;
  }

  const dismiss = () => close(mode === 'manual' ? SNOOZE_DAYS_MANUAL : SNOOZE_DAYS);

  // A website can't ask the browser whether it is installed, so people can tell us: stops the popup and the button
  function alreadyInstalled() {
    writeStore(INSTALLED_KEY, '1');
    setOpen(false);
    setEligible(false);
  }

  return (
    <>
      {eligible && !open && (
        <button onClick={openByHand}
          className="text-center text-sm border border-gray-700 rounded-xl px-3 py-1.5 hover:bg-gray-800">
          📲 Instalar app
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={dismiss}
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

            {mode === 'android' && push && pushStatus === 'off' && (
              <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={alsoPush} onChange={(e) => setAlsoPush(e.target.checked)} className="mt-0.5" />
                <span>🔔 Activar también los avisos de mis mesas <span className="text-gray-500">(te van a pedir permiso)</span></span>
              </label>
            )}
            {mode === 'android' ? (
              <div className="flex gap-2">
                <button onClick={dismiss}
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
                {mode === 'ios' ? (
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
                ) : (
                  <ol className="space-y-2 text-gray-300">
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400 font-bold">1.</span>
                      <span>Abrí el menú del navegador (los tres puntitos <strong>⋮</strong>, arriba o abajo a la derecha).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400 font-bold">2.</span>
                      <span>Tocá <strong>«Instalar aplicación»</strong> o <strong>«Agregar a la pantalla de inicio»</strong>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400 font-bold">3.</span>
                      <span>Confirmá. Listo: te queda el icono en tu teléfono.</span>
                    </li>
                  </ol>
                )}
                {mode === 'ios' && push && (
                  <p className="text-xs text-gray-400">🔔 Después de instalarla, abrila desde el icono: ahí vas a poder activar los avisos de tus mesas.</p>
                )}
                {isInAppBrowser() && (
                  <p className="text-xs text-amber-300">
                    Parece que abriste el link desde otra app (WhatsApp, Instagram…). Abrilo en Safari o Chrome para poder instalarla.
                  </p>
                )}
                <button onClick={dismiss}
                  className="w-full bg-indigo-600 text-white rounded-lg py-2.5 font-semibold hover:bg-indigo-700">
                  Entendido
                </button>
                <button onClick={alreadyInstalled} className="w-full text-xs text-gray-400 hover:text-gray-200">
                  Ya la tengo instalada
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
