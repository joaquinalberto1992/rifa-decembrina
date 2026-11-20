import type { Metadata, Viewport } from 'next';
import './globals.css';
import './raffle-overrides.css';
import InstallApp from './InstallApp';

const origin = 'https://rifa-decembrina.vercel.app';
export const viewport: Viewport = { themeColor: '#31070f', width: 'device-width', initialScale: 1 };
export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: 'Gran Rifa Decembrina Premium 2026 · Rifas de Adriana Yuniva',
  description: 'Participa por un paquete premium de bebidas y accesorios, o elige $25,000 MXN en efectivo.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Rifas de Adriana Yuniva',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Rifas Adriana' },
  icons: { icon: '/rifas-ay-icon.png', apple: '/rifas-ay-icon.png' },
  openGraph: {
    title: 'Gran Rifa Decembrina Premium 2026 · Rifas de Adriana Yuniva',
    description: 'Paquete premium de bebidas y accesorios o $25,000 MXN en efectivo.',
    images: [{ url: '/rifa-decembrina-premio.png', width: 1024, height: 1024, alt: 'Paquete Decembrino Premium' }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}<InstallApp /></body></html>;
}
