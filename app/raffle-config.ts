export const RAFFLE_TITLE = 'Rifa Decembrina 2026';
export const BRAND_NAME = 'Rifas de Adriana Yuniva';
export const TICKET_COUNT = 9000;
export const TICKET_PRICE = 10;
export const BASE_INVESTMENT = 14984;
export const WHATSAPP_NUMBER = '524792293687';
export const TICKET_COLLECTION = 'adrianaTickets';
export const ORDER_COLLECTION = 'adrianaOrders';
export const DRAW_COLLECTION = 'adrianaRaffle';
export const DRAW_DOCUMENT = 'decembrina-2026';
export const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || '';
export const PRIZE_NAME = process.env.NEXT_PUBLIC_RAFFLE_PRIZE || 'iPhone 18 Pro Max o $25,000 MXN en efectivo';
export const DRAW_DATE = process.env.NEXT_PUBLIC_DRAW_DATE || '24 de diciembre de 2026 · hora por confirmar';

// Only these bundle prices have been confirmed. Other quantities use the
// best-value combination of these bundles plus the $10 single-ticket price.
export const BUNDLES = [
  { tickets: 1, price: 10, label: 'Boleto individual' },
  { tickets: 10, price: 75, label: 'Paquete de 10' },
  { tickets: 20, price: 140, label: 'Paquete de 20' },
  { tickets: 100, price: 400, label: 'Paquete de 100' },
] as const;

export function priceFor(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) return { total: 0, breakdown: [] as Array<{ tickets: number; price: number }> };
  const best = Array.from({ length: quantity + 1 }, () => Number.POSITIVE_INFINITY);
  const previous = Array.from({ length: quantity + 1 }, () => 0);
  best[0] = 0;
  for (let count = 1; count <= quantity; count += 1) {
    for (const bundle of BUNDLES) {
      if (bundle.tickets <= count && best[count - bundle.tickets] + bundle.price < best[count]) {
        best[count] = best[count - bundle.tickets] + bundle.price;
        previous[count] = bundle.tickets;
      }
    }
  }
  const breakdown: Array<{ tickets: number; price: number }> = [];
  for (let remaining = quantity; remaining > 0;) {
    const size = previous[remaining];
    const bundle = BUNDLES.find(item => item.tickets === size)!;
    breakdown.push({ tickets: size, price: bundle.price });
    remaining -= size;
  }
  return { total: best[quantity], breakdown };
}

export const fmt = (number: number) => String(number).padStart(4, '0');
