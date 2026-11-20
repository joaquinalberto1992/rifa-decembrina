'use client';

import { useEffect, useState } from 'react';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (location.pathname.startsWith('/admin')) return;
    const timer = window.setTimeout(() => {
      setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
      setInstalled(matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
    }, 0);
    const handler = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => { window.clearTimeout(timer); window.removeEventListener('beforeinstallprompt', handler); };
  }, []);
  async function install() {
    if (!prompt) { setShowHelp(true); return; }
    await prompt.prompt();
    if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  }
  if (installed) return null;
  return <>
    <button className="installButton" onClick={install}>Instalar app</button>
    {showHelp && <div className="installOverlay" role="dialog" aria-modal="true"><section className="installCard">
      <button className="closeButton" onClick={() => setShowHelp(false)} aria-label="Cerrar">×</button>
      <span className="eyebrow">RIFAS ADRIANA YUNIVA</span><h2>{isIOS ? 'Agrégala a tu iPhone' : 'Instala la app'}</h2>
      <ol>{isIOS ? <><li>Abre esta página en Safari.</li><li>Toca Compartir ⬆️.</li><li>Elige “Agregar a pantalla de inicio”.</li></> : <><li>Abre el menú del navegador ⋮.</li><li>Elige “Instalar aplicación”.</li></>}</ol>
    </section></div>}
  </>;
}
