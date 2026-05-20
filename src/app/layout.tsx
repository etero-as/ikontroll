import type { Metadata, Viewport } from 'next';
import { Geist, Inter, Roboto_Mono } from 'next/font/google';

import { AuthProvider } from '@/context/AuthContext';
import { LocaleProvider } from '@/context/LocaleContext';

import './globals.css';

const interSans = Inter({
  variable: '--font-inter-sans',
  subsets: ['latin'],
});

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const mono = Roboto_Mono({
  variable: '--font-roboto-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Skillo',
  description: 'Skillo — e-læring som faktisk fester seg.',
  applicationName: 'Skillo',
};

export const viewport: Viewport = {
  themeColor: '#0D9488',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="no">
      <body
        className={`${interSans.variable} ${geistSans.variable} ${mono.variable} bg-slate-50 text-slate-900 antialiased`}
      >
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
