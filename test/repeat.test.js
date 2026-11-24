// Tests for the repeat / date logic in src/store.js — run with: npm test
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
global.navigator = { language: 'nl' };
global.localStorage = { getItem: () => null, setItem: () => {} };
require('../src/store.js');
const { nextOccurrence, addMonths } = window.Klaar;

test('dagelijks', () => {
  assert.strictEqual(nextOccurrence('2026-11-24', { freq: 'daily', interval: 1 }), '2026-11-25');
  assert.strictEqual(nextOccurrence('2026-11-24', { freq: 'daily', interval: 3 }), '2026-11-27');
});

test('werkdagen slaat het weekend over', () => {
  assert.strictEqual(nextOccurrence('2026-11-27', { freq: 'weekdays' }), '2026-11-30');
});

test('wekelijks, ook met gekozen dagen en interval', () => {
  assert.strictEqual(nextOccurrence('2026-11-24', { freq: 'weekly', interval: 1 }), '2026-12-01');
  assert.strictEqual(nextOccurrence('2026-11-24', { freq: 'weekly', interval: 1, days: [2, 4] }), '2026-11-26');
  assert.strictEqual(nextOccurrence('2026-11-26', { freq: 'weekly', interval: 2, days: [2, 4] }), '2026-12-08');
  assert.strictEqual(nextOccurrence('2026-11-29', { freq: 'weekly', interval: 1, days: [0, 1] }), '2026-11-30');
});

test('maandelijks en jaarlijks lopen niet over in de volgende maand', () => {
  assert.strictEqual(nextOccurrence('2026-01-31', { freq: 'monthly', interval: 1 }), '2026-02-28');
  assert.strictEqual(nextOccurrence('2024-02-29', { freq: 'yearly', interval: 1 }), '2025-02-28');
  assert.strictEqual(addMonths('2026-12-15', 1), '2027-01-15');
});

test('afvinken van een herhalende taak maakt de volgende aan', () => {
  const { Store } = window.Klaar;
  Store.data.tasks = [];
  const t = Store.addTask({ title: 'Accu laden', due: '2026-11-24', repeat: { freq: 'daily', interval: 1 } });
  const next = Store.toggleDone(t.id);
  assert.ok(next, 'nieuwe taak aangemaakt');
  assert.strictEqual(next.due, '2026-11-25');
  assert.strictEqual(next.done, false);
  assert.strictEqual(Store.task(t.id).repeat, null);
});
