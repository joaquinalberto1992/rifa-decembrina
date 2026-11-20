import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceFor, TICKET_COUNT, BASE_INVESTMENT, WHATSAPP_NUMBER, PRIZE_NAME, PRIZE_ITEMS, TRANSFER_BENEFICIARY, MERCADO_PAGO_CLABE, OXXO_DEPOSIT_NUMBER, OXXO_VALIDATED } from './raffle-config.ts';

test('keeps the Decembrina raffle inventory, contact, and prize correct', () => {
  assert.equal(TICKET_COUNT, 9000);
  assert.equal(WHATSAPP_NUMBER, '524792293687');
  assert.equal(TRANSFER_BENEFICIARY, 'Adriana Yuniva Castro Gaxiola');
  assert.equal(MERCADO_PAGO_CLABE, '722969028917402451');
  assert.equal(OXXO_DEPOSIT_NUMBER, '5428780531194041');
  assert.equal(OXXO_VALIDATED, false);
  assert.match(PRIZE_NAME, /bebidas y accesorios/i);
  assert.match(PRIZE_NAME, /25,000 MXN/i);
  assert.ok(PRIZE_ITEMS.some(item => /hielera Igloo/i.test(item)));
  assert.ok(PRIZE_ITEMS.some(item => /Buchanan/i.test(item)));
});

test('uses the confirmed individual and bundle prices', () => {
  assert.equal(priceFor(1).total, 10);
  assert.equal(priceFor(10).total, 75);
  assert.equal(priceFor(20).total, 140);
  assert.equal(priceFor(100).total, 400);
});

test('combines only confirmed bundle sizes for intermediate quantities', () => {
  assert.equal(priceFor(11).total, 85);
  assert.equal(priceFor(30).total, 215);
  assert.equal(priceFor(110).total, 475);
});

test('documents the 9,000-ticket 100-pack scenario against the 2x-profit target', () => {
  const allInHundredTicketPacks = (TICKET_COUNT / 100) * priceFor(100).total;
  const grossTarget = BASE_INVESTMENT * 3;
  assert.equal(allInHundredTicketPacks, 36000);
  assert.equal(grossTarget, 44952);
  assert.equal(grossTarget - allInHundredTicketPacks, 8952);
});
