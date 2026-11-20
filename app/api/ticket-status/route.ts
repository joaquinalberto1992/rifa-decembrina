import { NextRequest, NextResponse } from 'next/server';
import { ORDER_COLLECTION, TICKET_COLLECTION, TICKET_COUNT, fmt } from '../../raffle-config';

export const dynamic = 'force-dynamic';
const digits = (value: string) => value.replace(/\D/g, '');
type FirestoreValue = { stringValue?: string; integerValue?: string; doubleValue?: number };
type FirestoreDocument = { fields?: Record<string, FirestoreValue> };
const field = (document: FirestoreDocument, key: string) => document.fields?.[key]?.stringValue ?? document.fields?.[key]?.integerValue ?? document.fields?.[key]?.doubleValue?.toString() ?? '';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawNumber = String(body.number || '').trim();
    const phone = digits(String(body.phone || ''));
    if (!/^\d{1,4}$/.test(rawNumber) || Number(rawNumber) < 1 || Number(rawNumber) > TICKET_COUNT || phone.length < 7 || phone.length > 15) {
      return NextResponse.json({ message: 'No encontrado.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const database = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || '(default)';
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!apiKey || !project || !email || !password) return NextResponse.json({ message: 'Consulta temporalmente no disponible.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });

    const identity = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }), cache: 'no-store',
    });
    if (!identity.ok) return NextResponse.json({ message: 'Consulta temporalmente no disponible.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const { idToken } = await identity.json() as { idToken: string };
    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/${encodeURIComponent(database)}/documents`;
    const number = fmt(Number(rawNumber));
    const ticketResponse = await fetch(`${base}/${TICKET_COLLECTION}/${number}`, { headers: { authorization: `Bearer ${idToken}` }, cache: 'no-store' });
    if (!ticketResponse.ok) return NextResponse.json({ message: 'No encontrado.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const ticket = await ticketResponse.json() as FirestoreDocument;
    const orderId = field(ticket, 'orderId');
    if (!orderId) return NextResponse.json({ message: 'No encontrado.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const orderResponse = await fetch(`${base}/${ORDER_COLLECTION}/${encodeURIComponent(orderId)}`, { headers: { authorization: `Bearer ${idToken}` }, cache: 'no-store' });
    if (!orderResponse.ok) return NextResponse.json({ message: 'No encontrado.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const order = await orderResponse.json() as FirestoreDocument;
    const storedPhone = digits(field(order, 'phone'));
    if (!storedPhone || storedPhone !== phone) return NextResponse.json({ message: 'No encontrado.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const maskedPhone = storedPhone.length > 4 ? `${'•'.repeat(Math.min(6, storedPhone.length - 4))} ${storedPhone.slice(-4)}` : '••••';
    return NextResponse.json({
      number,
      buyer: field(order, 'buyer'),
      phone: maskedPhone,
      payment: field(order, 'payment') || 'por confirmar',
      status: field(ticket, 'status'),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ message: 'Consulta temporalmente no disponible.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
