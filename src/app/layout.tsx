import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MeepleMatch',
  description: 'Organizá tu evento de juegos de mesa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='es'>
      <body className='min-h-screen bg-gray-950 text-gray-100 antialiased'>
        {children}
      </body>
    </html>
  );
}
