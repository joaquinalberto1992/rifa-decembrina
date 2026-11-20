'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction, setDoc, where, writeBatch } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from '../firebase';
import { ADMIN_EMAIL, BASE_INVESTMENT, DRAW_COLLECTION, DRAW_DATE, DRAW_DOCUMENT, ORDER_COLLECTION, PRIZE_NAME, RAFFLE_TITLE, TICKET_COLLECTION, TICKET_COUNT, fmt } from '../raffle-config';
import '../admin.css';

type Status = 'reserved' | 'paid';
type Ticket = { number: number; status: Status; orderId: string; updatedAt?: string };
type Order = { orderId: string; buyer: string; phone: string; payment: string; ticketIds: string[]; numbers: number[]; orderTotal: number; orderCount: number; createdAt: string };
type Draw = { number: number; buyer: string; timestamp: string; proof: string; sequence: number[]; nonWinners: Array<{ number: number; buyer: string }>; eligibleCount: number; eligibleNumbers: number[]; algorithm: string };
type Finance = { additionalCosts: number; updatedAt: string };
const secureIndex = (length: number) => {
  const limit = 0x100000000 - (0x100000000 % length), values = new Uint32Array(1);
  let value = limit; while (value >= limit) { crypto.getRandomValues(values); value = values[0]; }
  return value % length;
};
const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export default function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [draw, setDraw] = useState<Draw | null>(null);
  const [drawLocked, setDrawLocked] = useState(false);
  const [finance, setFinance] = useState<Finance>({ additionalCosts: 0, updatedAt: '' });
  const [costInput, setCostInput] = useState('0');
  const [simulation, setSimulation] = useState<Ticket[]>([]);
  const [round, setRound] = useState(0);
  const [rolling, setRolling] = useState(0);
  const [running, setRunning] = useState(false);
  const [winner, setWinner] = useState(false);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => onAuthStateChanged(auth, user => {
    setAuthenticated(Boolean(user && ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()));
    setChecking(false);
  }), []);

  useEffect(() => {
    if (!authenticated || !firebaseConfigured) return;
    const stopTickets = onSnapshot(query(collection(db, TICKET_COLLECTION), where('status', 'in', ['reserved', 'paid'])), snapshot =>
      setTickets(snapshot.docs.map(item => item.data() as Ticket).sort((a, b) => a.number - b.number)),
      () => setError('No fue posible leer los boletos; revisa la configuración y reglas de Firestore.'),
    );
    const stopOrders = onSnapshot(collection(db, ORDER_COLLECTION), snapshot => {
      const next: Record<string, Order> = {};
      snapshot.forEach(item => { const data = item.data() as Order; next[data.orderId] = data; });
      setOrders(next);
    }, () => setError('No fue posible leer los datos de clientes.'));
    const stopDraw = onSnapshot(doc(db, DRAW_COLLECTION, DRAW_DOCUMENT), snapshot => setDraw(snapshot.exists() ? snapshot.data() as Draw : null));
    const stopDrawLock = onSnapshot(doc(db, DRAW_COLLECTION, 'draw-lock'), snapshot => setDrawLocked(snapshot.exists()));
    const stopFinance = onSnapshot(doc(db, DRAW_COLLECTION, 'finance'), snapshot => {
      if (snapshot.exists()) { const value = snapshot.data() as Finance; setFinance(value); setCostInput(String(value.additionalCosts || 0)); }
    });
    return () => { stopTickets(); stopOrders(); stopDraw(); stopDrawLock(); stopFinance(); };
  }, [authenticated]);

  const paid = useMemo(() => tickets.filter(ticket => ticket.status === 'paid'), [tickets]);
  const reserved = useMemo(() => tickets.filter(ticket => ticket.status === 'reserved'), [tickets]);
  const revenue = useMemo(() => Object.values(orders).reduce((sum, order) => {
    const orderTickets = order.numbers.map(number => tickets.find(ticket => ticket.number === number));
    return orderTickets.length > 0 && orderTickets.every(ticket => ticket?.status === 'paid' && ticket.orderId === order.orderId) ? sum + (order.orderTotal || 0) : sum;
  }, 0), [orders, tickets]);
  const costs = BASE_INVESTMENT + (Number(finance.additionalCosts) || 0);
  const target = costs * 3;
  const available = TICKET_COUNT - tickets.length;
  const orderBuyer = (ticketNumber: number) => {
    const ticket = tickets.find(item => item.number === ticketNumber);
    return ticket?.orderId ? orders[ticket.orderId]?.buyer || 'Participante' : 'Participante';
  };
  const orderRows = useMemo(() => Object.values(orders).map(order => {
    const currentTickets = order.numbers.flatMap(number => {
      const ticket = tickets.find(item => item.number === number);
      return ticket?.orderId === order.orderId ? [ticket] : [];
    });
    return { ...order, currentTickets, status: currentTickets.length > 0 && currentTickets.every(ticket => ticket.status === 'paid') ? 'paid' as const : 'reserved' as const };
  }).filter(order => order.currentTickets.length > 0), [orders, tickets]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const credential = await signInWithEmailAndPassword(auth, String(form.get('email')), String(form.get('password')));
      if (!ADMIN_EMAIL || credential.user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) { await signOut(auth); throw new Error('unauthorized'); }
      setAuthenticated(true);
    } catch { setError('Acceso no válido. Usa el correo administrador de esta rifa.'); }
  }

  async function updateTicket(number: number, status: Status | 'available') {
    if (draw || drawLocked) { setError('El sorteo oficial está cerrado o en curso; el historial no se puede modificar.'); return; }
    setError('');
    try {
      const ticket = tickets.find(item => item.number === number);
      const order = ticket?.orderId ? orders[ticket.orderId] : undefined;
      if (!order) throw new Error('missing-order');
      const batch = writeBatch(db), updatedAt = new Date().toISOString();
      if (status === 'available') {
        if (ticket?.status === 'paid' || order.numbers.some(value => tickets.find(item => item.number === value)?.status === 'paid')) throw new Error('paid-order');
        order.numbers.forEach(value => batch.delete(doc(db, TICKET_COLLECTION, fmt(value))));
        batch.delete(doc(db, ORDER_COLLECTION, order.orderId));
      } else {
        order.numbers.forEach(value => batch.set(doc(db, TICKET_COLLECTION, fmt(value)), { number: value, status: 'paid', orderId: order.orderId, updatedAt }));
      }
      await batch.commit();
    } catch { setError('No se pudo actualizar el boleto. Revisa tu conexión y permisos.'); }
  }

  async function saveManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    const numbers = [...new Set(String(form.get('numbers') || '').split(/[\s,;]+/).map(Number).filter(number => Number.isInteger(number) && number >= 1 && number <= TICKET_COUNT))];
    const buyer = String(form.get('buyer') || '').trim(), phone = String(form.get('phone') || '').trim(), payment = String(form.get('payment') || 'transferencia');
    if (!numbers.length || !buyer || phone.replace(/\D/g, '').length < 7) { setError('Revisa los números, nombre y teléfono.'); return; }
    if (draw || drawLocked) { setError('No se permiten cambios mientras el sorteo oficial está cerrado o en curso.'); return; }
    try {
      const refs = numbers.map(number => doc(db, TICKET_COLLECTION, fmt(number)));
      const createdAt = new Date().toISOString(), orderId = crypto.randomUUID(), ticketIds = numbers.map(fmt);
      const orderTotal = Number(form.get('total'));
      if (!Number.isFinite(orderTotal) || orderTotal < 0) throw new Error('bad-total');
      await runTransaction(db, async transaction => {
        const current = [];
        for (const ref of refs) current.push(await transaction.get(ref));
        if (current.some(snapshot => snapshot.exists() && snapshot.data().status !== 'available')) throw new Error('occupied');
        transaction.set(doc(db, ORDER_COLLECTION, orderId), { orderId, buyer, phone, payment, ticketIds, numbers, firstTicketId: ticketIds[0], orderCount: numbers.length, orderTotal, createdAt });
        numbers.forEach((number, index) => transaction.set(refs[index], { number, status: 'reserved', orderId, updatedAt: createdAt }));
      });
      (event.currentTarget as HTMLFormElement).reset(); setSaved(`${numbers.length} boleto(s) registrado(s).`);
    } catch (caught) { setError(caught instanceof Error && caught.message === 'occupied' ? 'Uno o más números ya están tomados. No se sobrescribió ningún registro.' : 'No se pudo guardar el registro manual.'); }
  }

  async function saveCosts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(costInput);
    if (!Number.isFinite(amount) || amount < 0) { setError('Escribe un costo adicional válido.'); return; }
    try { await setDoc(doc(db, DRAW_COLLECTION, 'finance'), { additionalCosts: amount, updatedAt: new Date().toISOString() }); setSaved('Costos adicionales actualizados.'); }
    catch { setError('No se pudieron guardar los costos.'); }
  }

  function chooseFive(pool: Ticket[]) {
    const copy = [...pool], chosen: Ticket[] = [];
    while (chosen.length < 5) chosen.push(copy.splice(secureIndex(copy.length), 1)[0]);
    return chosen;
  }

  async function play(sequence: Ticket[]) {
    setSimulation(sequence); setRound(0); setWinner(false); setRunning(true);
    for (let index = 0; index < 5; index += 1) {
      setRound(index + 1);
      const endAt = Date.now() + (index === 4 ? 7000 : 4100);
      while (Date.now() < endAt) {
        setRolling(1 + secureIndex(TICKET_COUNT));
        await wait(95);
      }
      setRolling(sequence[index].number);
      if (index < 4) await wait(1900);
    }
    setRunning(false); setWinner(true);
  }

  async function runSimulation() {
    if (paid.length < 5 || running || draw || drawLocked) return;
    await play(chooseFive(paid));
  }

  async function runOfficialDraw() {
    if (draw || paid.length < 5 || running || !window.confirm(drawLocked ? 'Se encontró un sorteo oficial iniciado, sin resultado final. ¿Reanudar con la misma lista de boletos congelada?' : '¿Iniciar el sorteo OFICIAL e irreversible? Se cerrarán temporalmente los apartados para congelar la lista de pagados; se elegirán cinco distintos y solo el quinto será ganador.')) return;
    setError(''); setSaving(true);
    const drawRef = doc(db, DRAW_COLLECTION, DRAW_DOCUMENT);
    const lockRef = doc(db, DRAW_COLLECTION, 'draw-lock');
    try {
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(drawRef);
        const lock = await transaction.get(lockRef);
        if (existing.exists()) throw new Error('already-drawn');
        if (!lock.exists()) transaction.set(lockRef, { startedAt: new Date().toISOString(), startedBy: ADMIN_EMAIL });
      });
      setDrawLocked(true);
      const paidSnapshot = await getDocs(query(collection(db, TICKET_COLLECTION), where('status', '==', 'paid')));
      const eligible = paidSnapshot.docs.map(item => item.data() as Ticket).sort((a, b) => a.number - b.number);
      if (eligible.length < 5) {
        await deleteDoc(lockRef); setDrawLocked(false);
        throw new Error('fewer-than-five');
      }
      const candidates = chooseFive(eligible);
      const sequence = candidates.map(ticket => ticket.number);
      const timestamp = new Date().toISOString();
      const orderedEligible = eligible.map(ticket => ticket.number).sort((a, b) => a - b);
      const nonWinners = candidates.slice(0, 4).map(ticket => ({ number: ticket.number, buyer: orderBuyer(ticket.number) }));
      const result = { number: candidates[4].number, buyer: orderBuyer(candidates[4].number), timestamp, sequence, nonWinners, eligibleCount: eligible.length, eligibleNumbers: orderedEligible, algorithm: 'Web Crypto getRandomValues + rejection sampling; 5 sin reemplazo; gana el quinto' };
      const payload = JSON.stringify(result);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      const proof = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(drawRef);
        const lock = await transaction.get(lockRef);
        if (existing.exists()) throw new Error('already-drawn');
        if (!lock.exists()) throw new Error('draw-not-locked');
        const refs = sequence.map(number => doc(db, TICKET_COLLECTION, fmt(number)));
        const snapshots = [];
        for (const ref of refs) snapshots.push(await transaction.get(ref));
        if (snapshots.some(snapshot => !snapshot.exists() || snapshot.data().status !== 'paid')) throw new Error('changed-eligibility');
        transaction.set(drawRef, { ...result, proof });
      });
      setDraw({ ...result, proof });
      await play(candidates);
    } catch (caught) {
      if (caught instanceof Error && caught.message === 'fewer-than-five') setError('El sorteo se canceló: deben existir al menos cinco boletos pagados. Se reabrió la venta.');
      else if (caught instanceof Error && caught.message === 'already-drawn') setError('Ya existe un resultado oficial; no puede realizarse otro sorteo.');
      else setError('El sorteo no se completó. Si quedó bloqueado, reanúdalo aquí; se conservarán los boletos y no se sorteará otro resultado hasta guardar el primero.');
    } finally { setSaving(false); }
  }

  if (checking) return <main className="adminShell"><div className="adminCard">Verificando acceso…</div></main>;
  if (!firebaseConfigured) return <main className="adminShell"><section className="adminCard"><span className="eyebrow">CONFIGURACIÓN</span><h1>Panel administrativo</h1><p>Esta copia no tiene aún conexión a la base Firebase independiente. No se puede autenticar ni modificar boletos hasta configurar el nuevo proyecto.</p><Link href="/">Volver a la página principal</Link></section></main>;
  if (!authenticated) return <main className="adminShell"><form className="adminLogin" onSubmit={login}><Link href="/" className="backLink">← Rifas Adriana Yuniva</Link><span className="eyebrow">ÁREA RESTRINGIDA</span><h1>Panel administrador</h1><p>Acceso solo para la cuenta autorizada de esta rifa.</p><label>Correo<input name="email" type="email" required autoComplete="username"/></label><label>Contraseña<input name="password" type="password" required autoComplete="current-password"/></label>{error && <div className="adminError">{error}</div>}<button className="goldButton full">Iniciar sesión</button></form></main>;

  const visibleOrders = orderRows.filter(order => !filter || order.buyer.toLowerCase().includes(filter.toLowerCase()) || order.numbers.some(number => fmt(number).includes(filter)));
  const filteredRevenue = revenue.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });

  return <main className="adminShell"><div className="adminDashboard">
    <header className="adminHeader"><Link href="/" className="backLink">← Página de clientes</Link><div><span className="eyebrow">PANEL PRIVADO · SOLO ORGANIZADORA</span><h1>{RAFFLE_TITLE}</h1><p>{PRIZE_NAME} · {DRAW_DATE}</p></div><button className="ghostButton" onClick={() => signOut(auth)}>Cerrar sesión</button></header>
    {error && <div className="adminError" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}{saved && <div className="adminSaved" role="status">{saved}<button onClick={() => setSaved('')}>×</button></div>}
    <section className="adminMetrics"><article><b>{available.toLocaleString('es-MX')}</b><span>Disponibles</span></article><article><b>{reserved.length.toLocaleString('es-MX')}</b><span>Apartados</span></article><article><b>{paid.length.toLocaleString('es-MX')}</b><span>Pagados</span></article><article><b>{filteredRevenue}</b><span>Recaudado verificado</span></article></section>
    <section className="financeCard"><div><span className="eyebrow">RESUMEN FINANCIERO · SOLO ADMIN</span><h2>Control de inversión y meta</h2><p>La recaudación se calcula con pagos confirmados usando los importes reales de cada paquete. Los gastos legales adicionales están pendientes de documentación.</p></div><form onSubmit={saveCosts}><label>Inversión base estimada<input value={BASE_INVESTMENT} readOnly aria-label="Inversión base"/></label><label>Gastos adicionales confirmados<input value={costInput} onChange={event => setCostInput(event.target.value)} type="number" min="0" step="0.01"/></label><button className="goldButton">Guardar gastos</button></form><div className="financeFacts"><article><span>Meta bruta para utilidad de 2× inversión</span><b>{target.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 })}</b></article><article><span>Recaudación actual vs. meta</span><b>{target > 0 ? `${Math.min(100, Math.round(revenue / target * 100))}%` : '—'}</b></article><article><span>Escenario: 90 paquetes de 100</span><b>$36,000 MXN</b><small>Antes de costos adicionales; no garantiza alcanzar la meta.</small></article></div><small className="warningNote">El presupuesto de $14,984 no contempla todos los permisos y costos legales. La meta se recalcula al registrar esos gastos.</small></section>
    <section className="manualCard"><div><span className="eyebrow">REGISTRO ADMINISTRATIVO</span><h2>Agregar boleto manualmente</h2><p>Para ventas registradas por teléfono o en efectivo. No sobrescribe números ocupados.</p></div><form onSubmit={saveManual}><label>Números separados por coma<input name="numbers" required placeholder="Ej. 0241, 0312"/></label><label>Nombre completo<input name="buyer" required/></label><label>WhatsApp / teléfono<input name="phone" required inputMode="tel"/></label><label>Total de esta venta (MXN)<input name="total" required type="number" min="0" step="0.01" defaultValue="10"/></label><label>Forma de pago<select name="payment"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></select></label><button className="goldButton" disabled={Boolean(draw) || drawLocked}>Guardar como apartado</button></form></section>
    <section className="adminTicketSection"><div className="adminSectionTitle"><div><span className="eyebrow">ACTUALIZACIÓN EN VIVO</span><h2>Apartados y pagos</h2></div><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Buscar por número o nombre"/></div>{visibleOrders.length ? <div className="adminTicketList">{visibleOrders.map(order => <article key={order.orderId} className={order.status}><div className="adminNumber"><small>{order.currentTickets.length} BOLETO(S)</small><b>{order.numbers.map(fmt).join(', ')}</b></div><div className="adminBuyer"><strong>{order.buyer}</strong><span>{order.phone} · {order.payment}</span><small>{order.status === 'paid' ? 'PAGADO' : 'APARTADO'} · Total de orden: ${Number(order.orderTotal).toFixed(2)} MXN</small></div><div className="adminActions">{order.status === 'reserved' && <button disabled={Boolean(draw) || drawLocked} onClick={() => updateTicket(order.numbers[0], 'paid')}>Confirmar pago</button>}<button className="releaseButton" disabled={Boolean(draw) || drawLocked || order.currentTickets.some(ticket => ticket.status === 'paid')} onClick={() => updateTicket(order.numbers[0], 'available')}>Liberar orden</button></div></article>)}</div> : <div className="emptyState">Aún no hay boletos apartados. Las ventas nuevas aparecerán aquí automáticamente.</div>}</section>
    <section className="drawPanel"><div className="drawPanelHeading"><div><span className="eyebrow">RESULTADO ÚNICO · SOLO PAGADOS</span><h2>Sorteo oficial</h2><p>Se congelan las ventas y pagos; se eligen cinco boletos pagados distintos mediante Web Crypto. Los primeros cuatro no ganan; el quinto es el ganador.</p></div><div className="fifthMark">5.º<strong>GANA</strong></div></div>{drawLocked && !draw && <div className="adminSaved">Sorteo iniciado sin resultado guardado. La lista permanece congelada. Puedes reanudarlo; no se generará un segundo resultado.</div>}<div className="drawSequence">{Array.from({ length: 5 }, (_, index) => <article key={index} className={round > index ? (index === 4 ? 'winnerRound' : 'loserRound') : ''}><small>{round > index ? `SALIDA ${index + 1}` : `NÚMERO ${index + 1}`}</small><b>{simulation[index] ? fmt(round === index + 1 && rolling ? rolling : simulation[index].number) : '— — — —'}</b><span>{round > index ? (index === 4 ? 'GANADOR' : 'NO GANADOR') : 'PENDIENTE'}</span>{round > index && <strong>{orderBuyer(simulation[index].number)}</strong>}</article>)}</div><div className="drawControls"><button disabled={paid.length < 5 || running || Boolean(draw) || drawLocked} onClick={runSimulation}>{running && !saving ? 'Simulación…' : 'Simular (no guarda cambios)'}</button><button className="officialButton" disabled={paid.length < 5 || running || saving || Boolean(draw)} onClick={runOfficialDraw}>{draw ? `Resultado oficial · ${fmt(draw.number)}` : saving ? 'Guardando sorteo…' : drawLocked ? 'Reanudar sorteo oficial' : 'Realizar sorteo oficial'}</button></div>{paid.length < 5 && !drawLocked && <small className="warningNote">Para simular o sortear hacen falta al menos 5 boletos pagados. Actualmente: {paid.length}.</small>}{draw && <div className="auditReceipt"><span className="eyebrow">GANADOR OFICIAL · REGISTRO INMUTABLE</span><h3>{fmt(draw.number)} · {draw.buyer}</h3><p>{draw.eligibleCount} boletos pagados elegibles · {new Date(draw.timestamp).toLocaleString('es-MX')}</p><p>Secuencia: {draw.sequence.map(fmt).join(' → ')}</p><p>Salidas no ganadoras: {draw.nonWinners.map(item => `${fmt(item.number)} ${item.buyer}`).join(' · ')}</p><small>Algoritmo: {draw.algorithm}</small><code>SHA-256 · {draw.proof}</code><small>La huella permite comparar integridad del registro; por sí sola no equivale a una auditoría externa.</small></div>}</section>
    {winner && simulation[4] && <div className="winnerOverlay" role="dialog" aria-modal="true"><div className="confetti" aria-hidden="true">✦　✧　✦　✧　✦</div><span className="eyebrow">{draw ? 'SORTEO OFICIAL' : 'SIMULACIÓN · NO SE GUARDÓ'}</span><div className="trophy">🏆</div><h2>¡TENEMOS GANADOR!</h2><b>{fmt(simulation[4].number)}</b><strong>{orderBuyer(simulation[4].number)}</strong><p>{draw ? 'El resultado oficial quedó registrado y ya se muestra a clientes.' : 'Esta práctica no modificó los boletos ni el resultado oficial.'}</p><button onClick={() => setWinner(false)}>Cerrar resultado</button></div>}
  </div></main>;
}
