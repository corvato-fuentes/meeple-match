import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meeple Loop',
  description: 'Organizá tu evento de juegos de mesa',
  // When added to the iPhone home screen it opens full screen, with this name under the icon.
  appleWebApp: { capable: true, title: 'Meeple Loop', statusBarStyle: 'black' },
  // Next only writes the generic "mobile-web-app-capable"; older iOS versions look for Apple's own tag.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

// Colors the browser bar / status bar to match the app instead of white.
export const viewport: Viewport = { themeColor: '#030712' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='es'>
      <body className='min-h-screen bg-gray-950 text-gray-100 antialiased'>
        {/*
          Chrome announces "this site can be installed" (beforeinstallprompt) once, right as the page loads — long
          before the ticket finishes loading its data and mounts the install popup. Listen from the very start and
          keep the event for the popup (window.__mmInstallPrompt). Also remember installs: the appinstalled event,
          and simply running inside the installed app (on Android it shares storage with Chrome, so the browser
          then knows the app exists and stops offering it).
        */}
        <Script id='mm-pwa-capture' strategy='beforeInteractive'>{`
          (function () {
            var KEY = 'mm_install_done';
            function remember() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }
            try {
              if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) remember();
            } catch (e) {}
            window.addEventListener('beforeinstallprompt', function (e) {
              e.preventDefault();
              window.__mmInstallPrompt = e;
              window.dispatchEvent(new Event('mm:installprompt'));
            });
            window.addEventListener('appinstalled', function () { window.__mmInstallPrompt = null; remember(); });
          })();
        `}</Script>
        {children}
      </body>
    </html>
  );
}
