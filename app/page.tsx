'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, runTransaction, where, query } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';
import { ADMIN_EMAIL, BRAND_NAME, DRAW_COLLECTION, DRAW_DOCUMENT, DRAW_DATE, ORDER_COLLECTION, PRIZE_NAME, RAFFLE_TITLE, TICKET_COLLECTION, TICKET_COUNT, WHATSAPP_NUMBER, fmt, priceFor } from './raffle-config';

type Status = 'reserved' | 'paid';
type Ticket = { number: number; status: Status; orderId?: string; updatedAt?: string };
type Draw = { number: number; buyer: string; timestamp: string; proof: string; sequence: number[]; nonWinners?: Array<{ number: number; buyer: string }>; eligibleCount: number };
type Lookup = { number: string; buyer: string; phone: string; status: Status; payment: string };
const secureIndex = (length: number) => {
  if (length < 1) return 0;
  const limit = 0x100000000 - (0x100000000 % length);
  const values = new Uint32Array(1);
  let value = limit;
  while (value >= limit) { crypto.getRandomValues(values); value = values[0]; }
  return value % length;
};

export default function Home() {
  const [sold, setSold] = useState<Record<number, Status>>({});
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [notice, setNotice] = useState('');
  const [whatsappUrl, setWhatsappUrl] = useState('');
  const [luckyCount, setLuckyCount] = useState(1);
  const [spinning, setSpinning] = useState(false);
  const [reelNumbers, setReelNumbers] = useState<number[]>([]);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [drawLocked, setDrawLocked] = useState(false);
  const pageSize = 200;
  const pageCount = Math.ceil(TICKET_COUNT / pageSize);
  const salesEnabled = firebaseConfigured && Boolean(ADMIN_EMAIL) && !DRAW_DATE.toLowerCase().includes('hora por confirmar');
  const counts = useMemo(() => {
    const reserved = Object.values(sold).filter(status => status === 'reserved').length;
    const paid = Object.values(sold).filter(status => status === 'paid').length;
    return { reserved, paid, available: TICKET_COUNT - reserved - paid };
  }, [sold]);
  const selectionPrice = useMemo(() => priceFor(selected.length), [selected.length]);
  const displayedTickets = useMemo(() => {
    const numericSearch = Number(search);
    if (search && Number.isInteger(numericSearch) && numericSearch >= 1 && numericSearch <= TICKET_COUNT) return [numericSearch];
    const start = page * pageSize + 1;
    return Array.from({ length: Math.min(pageSize, TICKET_COUNT - page * pageSize) }, (_, index) => start + index);
  }, [page, search]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const soldQuery = query(collection(db, TICKET_COLLECTION), where('status', 'in', ['reserved', 'paid']));
    const stopTickets = onSnapshot(soldQuery, snapshot => {
      const next: Record<number, Status> = {};
      snapshot.forEach(item => { const data = item.data() as Ticket; if (data.number >= 1 && data.number <= TICKET_COUNT) next[data.number] = data.status; });
      setSold(next); setInventoryLoaded(true);
    }, () => setNotice('No se pudo conectar con la lista de boletos. Intenta de nuevo en un momento.'));
    const stopDraw = onSnapshot(doc(db, DRAW_COLLECTION, DRAW_DOCUMENT), snapshot => setDraw(snapshot.exists() ? snapshot.data() as Draw : null));
    const stopDrawLock = onSnapshot(doc(db, DRAW_COLLECTION, 'draw-lock'), snapshot => setDrawLocked(snapshot.exists()));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    return () => { stopTickets(); stopDraw(); stopDrawLock(); };
  }, []);

  function toggleTicket(number: number) {
    if (sold[number] || drawLocked || draw) return;
    setSelected(current => current.includes(number) ? current.filter(value => value !== number) : current.length >= 100 ? current : [...current, number].sort((a, b) => a - b));
  }

  function pickLucky() {
    const available: number[] = [];
    for (let number = 1; number <= TICKET_COUNT; number += 1) if (!sold[number]) available.push(number);
    const amount = Math.min(luckyCount, available.length);
    if (!amount) { setNotice('No hay suficientes boletos disponibles.'); return; }
    setSelected([]); setSpinning(true);
    const previewPool = [...available];
    setReelNumbers(Array.from({ length: amount }, () => previewPool[secureIndex(previewPool.length)]));
    const timer = window.setInterval(() => setReelNumbers(Array.from({ length: amount }, () => available[secureIndex(available.length)])), 80);
    window.setTimeout(() => {
      window.clearInterval(timer);
      const pool = [...available], chosen: number[] = [];
      while (chosen.length < amount) chosen.push(pool.splice(secureIndex(pool.length), 1)[0]);
      chosen.sort((a, b) => a - b); setReelNumbers(chosen); setSelected(chosen); setSpinning(false);
      setNotice('La maquinita eligió: ' + chosen.map(fmt).join(', '));
    }, 1700);
  }

  async function searchTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLookup(null); setLookupError(''); setLookupLoading(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/ticket-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: data.get('number'), phone: data.get('phone') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      setLookup(result as Lookup);
    } catch { setLookupError('No encontramos el boleto con esos datos. Verifica el número y el teléfono usado al apartar.'); }
    finally { setLookupLoading(false); }
  }

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!salesEnabled) { setNotice('Antes de abrir los apartados, falta conectar la base independiente y confirmar la hora del sorteo y el correo de administración.'); return; }
    if (drawLocked || draw) { setNotice('Los apartados están cerrados porque el sorteo oficial ya inició o se realizó.'); return; }
    const form = new FormData(event.currentTarget);
    const buyer = String(form.get('buyer') || '').trim();
    const phone = String(form.get('phone') || '').trim();
    const payment = String(form.get('payment') || 'transferencia');
    if (!buyer || phone.replace(/\D/g, '').length < 7 || !selected.length) return;
    const numbers = [...selected].sort((a, b) => a - b);
    const chosen = numbers.map(fmt).join(', ');
    const amount = priceFor(numbers.length).total;
    const orderId = crypto.randomUUID();
    const paymentNote = payment === 'efectivo'
      ? 'Elegí efectivo. ¿Me compartes por aquí cómo coordinamos el pago?'
      : 'Elegí transferencia. ¿Me compartes por aquí los datos para realizar el pago? Enviaré el comprobante por este mismo chat.';
    const message = `Hola, quiero apartar estos boletos para ${RAFFLE_TITLE}: ${chosen}. Mi nombre es ${buyer}. Mi WhatsApp es ${phone}. Son ${numbers.length} boleto(s), total $${amount} MXN. ${paymentNote}`;
    const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
    let whatsappTab: Window | null = null;
    try {
      whatsappTab = window.open('about:blank', '_blank');
      await runTransaction(db, async transaction => {
        const refs = numbers.map(number => doc(db, TICKET_COLLECTION, fmt(number)));
        const snapshots = [];
        for (const ref of refs) snapshots.push(await transaction.get(ref));
        if (snapshots.some(snapshot => snapshot.exists() && snapshot.data().status !== 'available')) throw new Error('already-reserved');
        const createdAt = new Date().toISOString();
        const ticketIds = numbers.map(fmt);
        const orderRef = doc(db, ORDER_COLLECTION, orderId);
        transaction.set(orderRef, { orderId, buyer, phone, payment, ticketIds, numbers, firstTicketId: ticketIds[0], orderCount: numbers.length, orderTotal: amount, createdAt });
        refs.forEach((ref, index) => {
          const number = numbers[index];
          transaction.set(ref, { number, status: 'reserved', orderId, updatedAt: createdAt });
        });
      });
      if (whatsappTab && !whatsappTab.closed) whatsappTab.location.href = url;
      else setWhatsappUrl(url);
      setSelected([]); setCheckout(false);
      setNotice('Apartado guardado. WhatsApp abrirá el mensaje listo; recuerda tocar Enviar para contactar a Adriana.');
    } catch {
      if (whatsappTab && !whatsappTab.closed) whatsappTab.close();
      setNotice('No se completó el apartado: alguno de esos números pudo apartarse justo antes. Actualiza la lista y vuelve a intentar.');
    }
  }

  return <main className="appShell">
    <header className="topbar"><a className="menuMark" href="#inicio" aria-label="Inicio">☰</a><a className="brand" href="#inicio" aria-label={BRAND_NAME}><Image src="/rifas-ay-icon.png" alt="" width={42} height={42}/><span><small>RIFAS PREMIUM</small><b>ADRIANA <i>YUNIVA</i></b></span></a><a className="navContact" href="#boletos" aria-label="Ir a comprar boletos">▱ <span>Boletos</span></a></header>

    {!firebaseConfigured && <div className="connectionNotice" role="status"><b>Configuración pendiente.</b> Los apartados reales se activarán al conectar el Firebase independiente de esta rifa.</div>}
    {firebaseConfigured && !salesEnabled && <div className="connectionNotice" role="status"><b>Ventas aún cerradas.</b> Falta confirmar la hora del sorteo y el correo administrador antes de recibir apartados.</div>}
    {drawLocked && !draw && <div className="connectionNotice" role="status"><b>Sorteo oficial en curso.</b> Los cambios y nuevos apartados están temporalmente cerrados para conservar la lista de boletos pagados.</div>}

    <section className="hero" id="inicio"><div className="heroTexture"/><div className="heroCopy"><span className="eyebrow">RIFAS ADRIANA YUNIVA · EDICIÓN ESPECIAL</span><h1>Gran Rifa<br/><em>Decembrina</em><br/><span>Premium · 2026</span></h1><p>Una experiencia especial para cerrar el año. Elige tus números y participa por un premio premium.</p><div className="heroPrize"><span>ELIGE TU PREMIO</span><b>iPhone 18 Pro Max <i>o</i> $25,000 MXN</b><small>Sorteo: {DRAW_DATE}</small></div><div className="heroActions"><a className="goldButton" href="#boletos">▱ &nbsp; Comprar boletos <span>→</span></a><a className="heroSecondary" href="#premio">Conoce el premio</a></div><div className="heroTrust"><span>✦ 9,000 boletos</span><i/> <span>Desde $10 MXN</span></div></div><div className="heroArtwork"><Image src="/rifa-premium-phones.png" alt="Cuatro teléfonos en cajas selladas, mostrados en tonos negro, plata, azul y vino" fill sizes="(max-width: 620px) 90vw, 48vw" priority/><div className="imageCaption">PREMIO PRINCIPAL · VARIOS COLORES</div><div className="ornament o1"/><div className="ornament o2"/></div><div className="heroRibbon"><span>✨</span> GRAN RIFA DECEMBRINA <span>✨</span></div></section>

    {draw && <section className="winnerPublic"><span className="eyebrow">RESULTADO OFICIAL</span><h2>GANADOR O GANADORA</h2><div className="winnerBall">{fmt(draw.number)}</div><strong>{draw.buyer || 'Participante ganador'}</strong><p>El quinto número fue el ganador. Las cuatro salidas anteriores no fueron ganadoras.</p><div className="loserRow">{(draw.nonWinners || draw.sequence.slice(0, 4).map(number => ({ number, buyer: 'Participante' }))).map((item, index) => <article key={`${index}-${item.number}`}><small>SALIDA {index + 1}</small><b>{fmt(item.number)}</b><strong>{item.buyer || 'Participante'}</strong><span>NO GANADOR</span></article>)}</div><small>Resultado registrado · {new Date(draw.timestamp).toLocaleString('es-MX')}</small></section>}

    <section className="prizeSection" id="premio"><div className="prizeHeading"><span className="eyebrow">UN PREMIO PARA RECORDAR</span><h2>Elige cómo ganar</h2><p>Un teléfono premium en el color disponible o su alternativa en efectivo.</p></div><div className="prizeFeature"><div className="prizeFeatureImage"><Image src="/rifa-premium-phones.png" alt="Premio ilustrativo: teléfonos premium nuevos en varios colores y cajas selladas" fill sizes="(max-width: 700px) 100vw, 48vw"/></div><div className="prizeFeatureCopy"><span className="goldPill">PREMIO PRINCIPAL</span><h3>{PRIZE_NAME}</h3><p>Teléfono nuevo en color sujeto a disponibilidad, o recibe la opción de <strong>$25,000 MXN en efectivo</strong>. Consulta los términos con la organizadora antes de participar.</p><div className="prizeHighlights"><span><b>01</b> Teléfono en caja sellada</span><span><b>02</b> Varios colores ilustrativos</span><span><b>03</b> Alternativa en efectivo</span></div><a href="#boletos" className="textLink">Quiero participar <span>→</span></a></div></div></section>

    <section className="intro" id="paquetes"><span className="eyebrow">BOLETOS PARA CADA PRESUPUESTO</span><h2>Elige tu paquete</h2><p>Precios especiales por cantidad. Después podrás escoger tus números o usar la maquinita para una selección al azar.</p><div className="offerCards">{[1, 10, 20, 100].map(amount => <button className="offerCard" type="button" key={amount} onClick={() => { setLuckyCount(amount); document.getElementById('maquinita')?.scrollIntoView({ behavior: 'smooth' }); }}><small>{amount === 1 ? 'PARA PROBAR TU SUERTE' : amount === 100 ? 'PAQUETE MAYOR' : 'PAQUETE ESPECIAL'}</small><b>{amount} <i>{amount === 1 ? 'boleto' : 'boletos'}</i></b><span>${priceFor(amount).total.toLocaleString('es-MX')} MXN en total</span><em>Elegir cantidad <b>→</b></em></button>)}</div><div className="finePrint">La cuenta de transferencia se comparte directamente por WhatsApp al apartar. Envía tu comprobante por ese mismo chat. Pago en efectivo: coordinar con la organizadora. OXXO continúa pendiente de validación.</div></section>

    <section className="raffleSection" id="boletos"><div className="sectionTitle"><div><span className="eyebrow">9,000 BOLETOS · $10 MXN BASE</span><h2>Escoge tus números</h2><p>Los números apartados o pagados se actualizan en vivo.</p></div><a href="#consulta">Ya aparté · consultar</a></div>
      <div className="stats"><article><b>{inventoryLoaded ? counts.available.toLocaleString('es-MX') : '—'}</b><span>Disponibles</span></article><article><b>{inventoryLoaded ? counts.reserved.toLocaleString('es-MX') : '—'}</b><span>Apartados</span></article><article><b>{inventoryLoaded ? counts.paid.toLocaleString('es-MX') : '—'}</b><span>Pagados</span></article></div>
      <div className="soldProgress"><div><span>Boletos registrados</span><b>{inventoryLoaded ? `${Math.round(((counts.reserved + counts.paid) / TICKET_COUNT) * 100)}%` : '—'}</b></div><div className="progressTrack"><i style={{ width: `${inventoryLoaded ? ((counts.reserved + counts.paid) / TICKET_COUNT) * 100 : 0}%` }}/></div><small>{inventoryLoaded ? `${(counts.reserved + counts.paid).toLocaleString('es-MX')} de ${TICKET_COUNT.toLocaleString('es-MX')} boletos` : 'Inventario en vivo'}</small></div>
      <div className="legend"><span><i className="dot free"/> Disponible</span><span><i className="dot reserved"/> Apartado</span><span><i className="dot paid"/> Pagado</span></div>
      <div className="ticketControls"><label>Buscar número<input value={search} onChange={event => { setSearch(event.target.value.replace(/\D/g, '').slice(0, 4)); if (event.target.value) setPage(Math.min(pageCount - 1, Math.max(0, Math.floor((Number(event.target.value) - 1) / pageSize)))); }} inputMode="numeric" placeholder="0001–9000"/></label><div className="pagination"><button onClick={() => { setSearch(''); setPage(Math.max(0, page - 1)); }} disabled={page === 0}>Anterior</button><span>{search && Number(search) > 0 ? 'Resultado de búsqueda' : `Página ${page + 1} de ${pageCount}`}</span><button onClick={() => { setSearch(''); setPage(Math.min(pageCount - 1, page + 1)); }} disabled={page === pageCount - 1 || Boolean(search)}>Siguiente</button></div></div>
      {!inventoryLoaded && <p className="finePrint">Conectando con el inventario en vivo. Los números no se pueden seleccionar hasta confirmar la conexión.</p>}
      <div className="ticketGrid">{displayedTickets.map(number => { const status = sold[number]; return <button key={number} onClick={() => toggleTicket(number)} disabled={Boolean(status) || drawLocked || Boolean(draw) || !salesEnabled || !inventoryLoaded} className={`ticket ${status || ''} ${selected.includes(number) ? 'selected' : ''}`} aria-label={`Boleto ${fmt(number)} ${status || 'disponible'}`}>{status === 'reserved' ? 'APARTADO' : status === 'paid' ? 'PAGADO' : fmt(number)}</button>; })}</div>
      <div className="luckyCard" id="maquinita"><div className="luckyHeader"><span className="eyebrow">SELECCIÓN ALEATORIA · SUGERENCIA</span><h3>Maquinita de la suerte</h3><p>Elige cuántos boletos quieres y deja que la máquina te sugiera números disponibles. Solo se apartan al confirmar.</p></div><div className={`reels ${spinning ? 'spinning' : ''}`}>{Array.from({ length: luckyCount }, (_, index) => <div className="reel" key={index}>{fmt(reelNumbers[index] || 0)}</div>)}</div><div className="luckyActions"><label>¿Cuántos quieres?<select value={luckyCount} disabled={spinning} onChange={event => setLuckyCount(Number(event.target.value))}>{Array.from({ length: 100 }, (_, index) => index + 1).map(value => <option value={value} key={value}>{value} boleto{value === 1 ? '' : 's'}</option>)}</select></label><button onClick={pickLucky} disabled={spinning || !counts.available || !salesEnabled || drawLocked || Boolean(draw)}>{spinning ? 'Girando…' : 'Girar maquinita'}</button></div></div>
    </section>

    <section className="lookupSection" id="consulta"><span className="eyebrow">SEGUIMIENTO PRIVADO</span><h2>Mis boletos</h2><p>Ingresa el número de boleto y el WhatsApp usado al apartar. Por privacidad, solo tú podrás consultar el nombre, teléfono y estado de tu boleto.</p><form onSubmit={searchTicket}><label>Número de boleto<input name="number" required inputMode="numeric" minLength={1} maxLength={4} placeholder="Ej. 0432"/></label><label>WhatsApp registrado<input name="phone" required inputMode="tel" placeholder="Tu número de teléfono"/></label><button disabled={lookupLoading}>{lookupLoading ? 'Consultando…' : 'Consultar boleto'}</button></form>{lookup && <article className={`lookupResult ${lookup.status}`}><small>BOLETO {lookup.number}</small><b>{lookup.status === 'paid' ? 'PAGADO' : 'APARTADO'}</b><strong>{lookup.buyer}</strong><span>Tel. {lookup.phone} · {lookup.payment}</span></article>}{lookupError && <div className="lookupError">{lookupError}</div>}</section>

    <section className="ctaWhatsApp" id="ayuda"><div><span className="eyebrow">ATENCIÓN PERSONALIZADA</span><h2>¿Tienes dudas?</h2><p>La organizadora te comparte por WhatsApp la cuenta vigente y confirma tu comprobante.</p></div><a href={'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent('Hola, quiero información de pago para la Rifa Decembrina 2026.')} target="_blank" rel="noreferrer">Escribir por WhatsApp <b>+52 479 229 3687</b></a></section>
    <footer><span>© 2026 · {BRAND_NAME}</span><a href="/admin">Acceso administrador ↗</a><small>Consulta las condiciones del sorteo con la organizadora antes de participar.</small></footer>
    <nav className="mobileTabs" aria-label="Navegación principal"><a className="current" href="#inicio"><span>⌂</span><small>Inicio</small></a><a href="#consulta"><span>▱</span><small>Mis boletos</small></a><a href="#maquinita"><span>◉</span><small>Suerte</small></a><a href="#premio"><span>✧</span><small>Premio</small></a><a href="#ayuda"><span>?</span><small>Ayuda</small></a></nav>

    {selected.length > 0 && <div className="selectionDock"><div><small>{selected.length} BOLETO{selected.length === 1 ? '' : 'S'} · ESTIMADO</small><b>{selected.length <= 100 ? `$${selectionPrice.total} MXN` : 'Máximo 100 por apartado'}</b></div><button onClick={() => setCheckout(true)} disabled={selected.length > 100}>Continuar</button></div>}
    {checkout && <div className="modalBackdrop" role="dialog" aria-modal="true"><form className="checkoutCard" onSubmit={reserve}><button className="closeButton" type="button" onClick={() => setCheckout(false)}>×</button><span className="eyebrow">CASI LISTO</span><h2>Confirma tu apartado</h2><div className="selectedNumbers">{selected.map(fmt).join(' · ')}</div><label>Nombre completo<input name="buyer" required autoFocus maxLength={100} placeholder="Tu nombre"/></label><label>WhatsApp / teléfono<input name="phone" required minLength={7} maxLength={25} inputMode="tel" placeholder="Teléfono de contacto"/></label><fieldset><legend>¿Cómo planeas pagar?</legend><label><input type="radio" name="payment" value="transferencia" defaultChecked/> Transferencia</label><label><input type="radio" name="payment" value="efectivo"/> Efectivo</label><label className="disabledPayment"><input type="radio" disabled/> OXXO · pendiente de validación</label></fieldset><div className="checkoutTotal"><span>{selected.length} boleto(s) · paquetes aplicados automáticamente</span><b>${selectionPrice.total} MXN</b></div><small className="packageBreakdown">{selectionPrice.breakdown.map(pack => `${pack.tickets} × $${pack.price}`).join(' + ')}</small><p>El número queda apartado en cuanto confirmes aquí. WhatsApp abrirá el mensaje listo; tendrás que tocar Enviar para avisar a la organizadora.</p><button className="goldButton full" type="submit">Apartar y continuar por WhatsApp</button><small className="privacyLine">No mostramos tus datos personales en la página.</small></form></div>}
    {notice && <div className="toast" role="status">{notice}{whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer">Abrir WhatsApp y enviar mensaje ↗</a>}<button onClick={() => { setNotice(''); setWhatsappUrl(''); }} aria-label="Cerrar">×</button></div>}
  </main>;
}
