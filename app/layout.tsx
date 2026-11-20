import type { Metadata, Viewport } from 'next';
import './globals.css';
import InstallApp from './InstallApp';

const origin = 'https://rifas-adriana-yuniva.vercel.app';
export const viewport: Viewport = { themeColor: '#31070f', width: 'device-width', initialScale: 1 };
export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: 'Rifas de Adriana Yuniva · Rifa Decembrina 2026',
  description: 'Una experiencia de rifa premium con boletos digitales y seguimiento transparente.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Rifas de Adriana Yuniva',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Rifas Adriana' },
  icons: { icon: '/rifas-ay-icon.png', apple: '/rifas-ay-icon.png' },
  openGraph: {
    title: 'Rifas de Adriana Yuniva · Rifa Decembrina 2026',
    description: 'Elige tus números y sigue el estado de tus boletos en vivo.',
    images: [{ url: '/rifas-adriana-yuniva-logo.png', width: 1024, height: 1024, alt: 'Rifas de Adriana Yuniva' }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}<InstallApp /></body></html>;
}
