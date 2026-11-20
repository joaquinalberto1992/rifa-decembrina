import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: 'Rifas de Adriana Yuniva', short_name: 'Rifas Adriana',
    description: 'Rifa Decembrina 2026 · boletos digitales', start_url: '/', scope: '/',
    display: 'standalone', background_color: '#160509', theme_color: '#31070f', orientation: 'portrait',
    categories: ['shopping', 'entertainment'],
    icons: [
      { src: '/rifas-ay-icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: '/rifas-ay-icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
