import type { Metadata, Viewport } from 'next';
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
        {children}
      </body>
    </html>
  );
}
