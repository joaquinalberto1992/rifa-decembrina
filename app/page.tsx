'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, runTransaction, where, query } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';
import { ADMIN_EMAIL, BRAND_NAME, DRAW_COLLECTION, DRAW_DOCUMENT, DRAW_DATE, ORDER_COLLECTION, PRIZE_ITEMS, PRIZE_NAME, RAFFLE_TITLE, TICKET_COLLECTION, TICKET_COUNT, WHATSAPP_NUMBER, fmt, priceFor } from './raffle-config';

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
  const [suggestionUnverified, setSuggestionUnverified] = useState(false);
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    if (!firebaseConfigured) return;
    const soldQuery = query(collection(db, TICKET_COLLECTION), where('status', 'in', ['reserved', 'paid']));
    const stopTickets = onSnapshot(soldQuery, snapshot => {
      const next: Record<number, Status> = {};
      snapshot.forEach(item => { const data = item.data() as Ticket; if (data.number >= 1 && data.number <= TICKET_COUNT) next[data.number] = data.status; });
      setSold(next); setInventoryLoaded(true);
    }, () => setNotice('No se pudo conectar con la lista de boletos. Intenta de nuevo en un momento.'));
    const stopDraw = onSnapshot(doc(db, DRAW_COLLECTION, DRAW_DOCUMENT), snapshot => setDraw(snapshot.exists() ? snapshot.data() as Draw : null));
    const stopDrawLock = onSnapshot(doc(db, DRAW_COLLECTION, 'draw-lock'), snapshot => setDrawLocked(snapshot.exists()));
    return () => { stopTickets(); stopDraw(); stopDrawLock(); };
  }, []);

  function toggleTicket(number: number) {
    if (sold[number] || drawLocked || draw) return;
    setSuggestionUnverified(false);
    setSelected(current => current.includes(number) ? current.filter(value => value !== number) : current.length >= 100 ? current : [...current, number].sort((a, b) => a - b));
  }

  function pickLucky() {
    const available: number[] = [];
    for (let number = 1; number <= TICKET_COUNT; number += 1) {
      if (!inventoryLoaded || !sold[number]) available.push(number);
    }
    const amount = Math.min(luckyCount, available.length);
    if (!amount) { setNotice('No hay suficientes boletos disponibles.'); return; }
    setSuggestionUnverified(!inventoryLoaded);
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
    const message = `Hola, quiero apartar estos boletos para ${RAFFLE_TITLE}: ${chosen}. Mi nombre es ${buyer}. Mi WhatsApp es ${phone}. Son ${numbers.length} boleto(s), total $${amount} MXN. ${paymentNote}${salesEnabled ? '' : ' Por favor confirma que siguen disponibles antes de pagar; este mensaje es una solicitud y la página todavía no bloquea los números.'}`;
    const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
    if (!salesEnabled) {
      setWhatsappUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
      setCheckout(false);
      setNotice('Se abrió WhatsApp con tu solicitud. La base independiente todavía no está conectada, así que los números no quedan bloqueados por la página; espera confirmación de Adriana antes de pagar.');
      return;
    }
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

    {!firebaseConfigured && <div className="connectionNotice" role="status"><b>Solicitudes por WhatsApp disponibles.</b> Para bloquear y actualizar números en vivo hace falta conectar el Firebase independiente de esta rifa. Hasta entonces, confirma disponibilidad con Adriana antes de pagar.</div>}
    {firebaseConfigured && !salesEnabled && <div className="connectionNotice" role="status"><b>Ventas aún cerradas.</b> Falta confirmar la hora del sorteo y el correo administrador antes de recibir apartados.</div>}
    {drawLocked && !draw && <div className="connectionNotice" role="status"><b>Sorteo oficial en curso.</b> Los cambios y nuevos apartados están temporalmente cerrados para conservar la lista de boletos pagados.</div>}

    <section className="hero" id="inicio"><div className="heroTexture"/><div className="heroCopy"><span className="eyebrow">RIFAS ADRIANA YUNIVA · EDICIÓN ESPECIAL</span><h1>Gran Rifa<br/><em>Decembrina</em><br/><span>Premium · 2026</span></h1><p>Una experiencia especial para cerrar el año. Participa por el paquete de bebidas y accesorios de la convocatoria o elige la alternativa de $25,000 MXN en efectivo.</p><div className="heroPrize"><span>PREMIO PRINCIPAL · O EFECTIVO</span><b>Paquete premium <i>o</i> $25,000 MXN</b><small>Sorteo: {DRAW_DATE}</small></div><div className="heroActions"><a className="goldButton" href="#boletos">▱ &nbsp; Comprar boletos <span>→</span></a><a className="heroSecondary" href="#premio">Conoce el premio</a></div><div className="heroTrust"><span>✦ 9,000 boletos</span><i/> <span>Desde $10 MXN</span></div></div><div className="heroArtwork"><Image src="/decembrina-poster.png" alt="Convocatoria original de la Gran Rifa Decembrina: hielera Igloo, bebidas, accesorios, boleto de $10 y sorteo el 24 de diciembre en León, Guanajuato" fill sizes="(max-width: 620px) 94vw, 48vw" priority/></div></section>

    {draw && <section className="winnerPublic"><span className="eyebrow">RESULTADO OFICIAL</span><h2>GANADOR O GANADORA</h2><div className="winnerBall">{fmt(draw.number)}</div><strong>{draw.buyer || 'Participante ganador'}</strong><p>El quinto número fue el ganador. Las cuatro salidas anteriores no fueron ganadoras.</p><div className="loserRow">{(draw.nonWinners || draw.sequence.slice(0, 4).map(number => ({ number, buyer: 'Participante' }))).map((item, index) => <article key={`${index}-${item.number}`}><small>SALIDA {index + 1}</small><b>{fmt(item.number)}</b><strong>{item.buyer || 'Participante'}</strong><span>NO GANADOR</span></article>)}</div><small>Resultado registrado · {new Date(draw.timestamp).toLocaleString('es-MX')}</small></section>}

    <section className="prizeSection" id="premio"><div className="prizeHeading"><span className="eyebrow">UN PREMIO PARA RECORDAR</span><h2>Paquete Decembrino Premium</h2><p>El paquete de bebidas y accesorios de la convocatoria, con alternativa de $25,000 MXN en efectivo.</p></div><div className="prizeFeature"><div className="prizeFeatureImage"><Image src="/decembrina-premio.png" alt="Fotografía de referencia del premio: hielera Igloo, bebidas, cristalería y accesorios de servicio" fill sizes="(max-width: 700px) 100vw, 48vw"/></div><div className="prizeFeatureCopy"><span className="goldPill">PREMIO PRINCIPAL · VALOR ESTIMADO $15,000 MXN</span><h3>{PRIZE_NAME}</h3><p>Este es el paquete de bebidas, hielera y accesorios anunciado para la rifa Decembrina. La alternativa es <strong>$25,000 MXN en efectivo</strong>.</p><ul className="prizeItems">{PRIZE_ITEMS.map((item, index) => <li key={item}><b>{String(index + 1).padStart(2, '0')}</b><span>{item}</span></li>)}</ul><a href="#boletos" className="textLink">Quiero participar <span>→</span></a></div></div></section>

    <section className="intro" id="paquetes"><span className="eyebrow">BOLETOS PARA CADA PRESUPUESTO</span><h2>Elige tu paquete</h2><p>Precios especiales por cantidad. Después podrás escoger tus números o usar la maquinita para una selección al azar.</p><div className="offerCards">{[1, 10, 20, 100].map(amount => <button className="offerCard" type="button" key={amount} onClick={() => { setLuckyCount(amount); document.getElementById('maquinita')?.scrollIntoView({ behavior: 'smooth' }); }}><small>{amount === 1 ? 'PARA PROBAR TU SUERTE' : amount === 100 ? 'PAQUETE MAYOR' : 'PAQUETE ESPECIAL'}</small><b>{amount} <i>{amount === 1 ? 'boleto' : 'boletos'}</i></b><span>${priceFor(amount).total.toLocaleString('es-MX')} MXN en total</span><em>Elegir cantidad <b>→</b></em></button>)}</div><div className="finePrint">La cuenta de transferencia se comparte directamente por WhatsApp al apartar. Envía tu comprobante por ese mismo chat. Pago en efectivo: coordinar con la organizadora. OXXO continúa pendiente de validación.</div></section>

    <section className="raffleSection" id="boletos"><div className="sectionTitle"><div><span className="eyebrow">9,000 BOLETOS · $10 MXN BASE</span><h2>Escoge tus números</h2><p>Los números apartados o pagados se actualizan en vivo.</p></div><a href="#consulta">Ya aparté · consultar</a></div>
      <div className="stats"><article><b>{inventoryLoaded ? counts.available.toLocaleString('es-MX') : '—'}</b><span>Disponibles</span></article><article><b>{inventoryLoaded ? counts.reserved.toLocaleString('es-MX') : '—'}</b><span>Apartados</span></article><article><b>{inventoryLoaded ? counts.paid.toLocaleString('es-MX') : '—'}</b><span>Pagados</span></article></div>
      <div className="soldProgress"><div><span>Boletos registrados</span><b>{inventoryLoaded ? `${Math.round(((counts.reserved + counts.paid) / TICKET_COUNT) * 100)}%` : '—'}</b></div><div className="progressTrack"><i style={{ width: `${inventoryLoaded ? ((counts.reserved + counts.paid) / TICKET_COUNT) * 100 : 0}%` }}/></div><small>{inventoryLoaded ? `${(counts.reserved + counts.paid).toLocaleString('es-MX')} de ${TICKET_COUNT.toLocaleString('es-MX')} boletos` : 'Inventario en vivo'}</small></div>
      <div className="legend"><span><i className="dot free"/> {inventoryLoaded ? 'Disponible' : 'Por confirmar'}</span><span><i className="dot reserved"/> Apartado</span><span><i className="dot paid"/> Pagado</span></div>
      <div className="ticketControls"><label>Buscar número<input value={search} onChange={event => { setSearch(event.target.value.replace(/\D/g, '').slice(0, 4)); if (event.target.value) setPage(Math.min(pageCount - 1, Math.max(0, Math.floor((Number(event.target.value) - 1) / pageSize)))); }} inputMode="numeric" placeholder="0001–9000"/></label><div className="pagination"><button onClick={() => { setSearch(''); setPage(Math.max(0, page - 1)); }} disabled={page === 0}>Anterior</button><span>{search && Number(search) > 0 ? 'Resultado de búsqueda' : `Página ${page + 1} de ${pageCount}`}</span><button onClick={() => { setSearch(''); setPage(Math.min(pageCount - 1, page + 1)); }} disabled={page === pageCount - 1 || Boolean(search)}>Siguiente</button></div></div>
      {!inventoryLoaded && <p className="unverifiedSelection">Puedes elegir números manualmente, pero la disponibilidad está pendiente: sin la base independiente conectada, esta página no los bloquea. Confirma con Adriana por WhatsApp antes de pagar.</p>}
      <div className="ticketGrid">{displayedTickets.map(number => { const status = sold[number]; const availability = status || (!inventoryLoaded ? 'unverified' : ''); return <button key={number} onClick={() => toggleTicket(number)} disabled={Boolean(status) || drawLocked || Boolean(draw)} className={`ticket ${availability} ${selected.includes(number) ? 'selected' : ''}`} aria-label={`Boleto ${fmt(number)} ${status || 'disponibilidad sin verificar'}`}>{status === 'reserved' ? 'APARTADO' : status === 'paid' ? 'PAGADO' : fmt(number)}</button>; })}</div>
      <div className="luckyCard" id="maquinita"><div className="luckyHeader"><span className="eyebrow">SELECCIÓN ALEATORIA · SUGERENCIA</span><h3>Maquinita de la suerte</h3><p>Elige de 1 a 100 boletos y gira para obtener números al azar. La maquinita no realiza el sorteo oficial. Solo el inventario conectado puede verificar disponibilidad.</p></div><div className={`reels ${spinning ? 'spinning' : ''}`}>{Array.from({ length: luckyCount }, (_, index) => <div className="reel" key={index}>{fmt(reelNumbers[index] || 0)}</div>)}</div>{suggestionUnverified && reelNumbers.length > 0 && <p className="unverifiedSelection">Selección sugerida; disponibilidad pendiente de confirmar por WhatsApp.</p>}<div className="luckyActions"><label>¿Cuántos quieres?<select value={luckyCount} disabled={spinning} onChange={event => setLuckyCount(Number(event.target.value))}>{Array.from({ length: 100 }, (_, index) => index + 1).map(value => <option value={value} key={value}>{value} boleto{value === 1 ? '' : 's'}</option>)}</select></label><button onClick={pickLucky} disabled={spinning || !counts.available || drawLocked || Boolean(draw)}>{spinning ? 'Girando…' : 'Girar maquinita'}</button></div></div>
    </section>

    <section className="lookupSection" id="consulta"><span className="eyebrow">SEGUIMIENTO PRIVADO</span><h2>Mis boletos</h2><p>Ingresa el número de boleto y el WhatsApp usado al apartar. Por privacidad, solo tú podrás consultar el nombre, teléfono y estado de tu boleto.</p><form onSubmit={searchTicket}><label>Número de boleto<input name="number" required inputMode="numeric" minLength={1} maxLength={4} placeholder="Ej. 0432"/></label><label>WhatsApp registrado<input name="phone" required inputMode="tel" placeholder="Tu número de teléfono"/></label><button disabled={lookupLoading}>{lookupLoading ? 'Consultando…' : 'Consultar boleto'}</button></form>{lookup && <article className={`lookupResult ${lookup.status}`}><small>BOLETO {lookup.number}</small><b>{lookup.status === 'paid' ? 'PAGADO' : 'APARTADO'}</b><strong>{lookup.buyer}</strong><span>Tel. {lookup.phone} · {lookup.payment}</span></article>}{lookupError && <div className="lookupError">{lookupError}</div>}</section>

    <section className="ctaWhatsApp" id="ayuda"><div><span className="eyebrow">ATENCIÓN PERSONALIZADA</span><h2>¿Tienes dudas?</h2><p>La organizadora te comparte por WhatsApp la cuenta vigente y confirma tu comprobante.</p></div><a href={'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent('Hola, quiero información de pago para la Rifa Decembrina 2026.')} target="_blank" rel="noreferrer">Escribir por WhatsApp <b>+52 479 229 3687</b></a></section>
    <footer><span>© 2026 · {BRAND_NAME}</span><a href="/admin">Acceso administrador ↗</a><small>Consulta las condiciones del sorteo con la organizadora antes de participar.</small></footer>
    <nav className="mobileTabs" aria-label="Navegación principal"><a className="current" href="#inicio"><span>⌂</span><small>Inicio</small></a><a href="#consulta"><span>▱</span><small>Mis boletos</small></a><a href="#maquinita"><span>◉</span><small>Suerte</small></a><a href="#premio"><span>✧</span><small>Premio</small></a><a href="#ayuda"><span>?</span><small>Ayuda</small></a></nav>

    {selected.length > 0 && <div className="selectionDock"><div><small>{selected.length} BOLETO{selected.length === 1 ? '' : 'S'} · ESTIMADO</small><b>{selected.length <= 100 ? `$${selectionPrice.total} MXN` : 'Máximo 100 por apartado'}</b></div><button onClick={() => setCheckout(true)} disabled={selected.length > 100}>Continuar</button></div>}
    {checkout && <div className="modalBackdrop" role="dialog" aria-modal="true"><form className="checkoutCard" onSubmit={reserve}><button className="closeButton" type="button" onClick={() => setCheckout(false)}>×</button><span className="eyebrow">CASI LISTO</span><h2>Solicita tus boletos</h2><div className="selectedNumbers">{selected.map(fmt).join(' · ')}</div><label>Nombre completo<input name="buyer" required autoFocus maxLength={100} placeholder="Tu nombre"/></label><label>WhatsApp / teléfono<input name="phone" required minLength={7} maxLength={25} inputMode="tel" placeholder="Teléfono de contacto"/></label><fieldset><legend>¿Cómo planeas pagar?</legend><label><input type="radio" name="payment" value="transferencia" defaultChecked/> Transferencia</label><label><input type="radio" name="payment" value="efectivo"/> Efectivo</label><label className="disabledPayment"><input type="radio" disabled/> OXXO · pendiente de validación</label></fieldset><div className="checkoutTotal"><span>{selected.length} boleto(s) · paquetes aplicados automáticamente</span><b>${selectionPrice.total} MXN</b></div><small className="packageBreakdown">{selectionPrice.breakdown.map(pack => `${pack.tickets} × $${pack.price}`).join(' + ')}</small>{salesEnabled ? <p>Al confirmar, la página apartará los números y abrirá WhatsApp con tu mensaje listo. Recuerda tocar Enviar.</p> : <p className="reservationWarning">Se abrirá WhatsApp con tu solicitud. La página todavía no puede bloquear los números; espera la confirmación de disponibilidad antes de pagar.</p>}<button className="goldButton full" type="submit">Continuar por WhatsApp</button><small className="privacyLine">La cuenta de pago se solicita por WhatsApp. No se muestran tus datos en la página.</small></form></div>}
    {notice && <div className="toast" role="status">{notice}{whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer">Abrir WhatsApp y enviar mensaje ↗</a>}<button onClick={() => { setNotice(''); setWhatsappUrl(''); }} aria-label="Cerrar">×</button></div>}
  </main>;
}
