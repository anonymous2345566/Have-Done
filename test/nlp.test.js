// Tests for smart input (src/nlp.js) — run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../src/nlp.js');

const now = new Date(2026, 10, 25, 10, 0); // wednesday 25 nov 2026, 10:00
const p = (t, o = {}) => parse(t, { now, ...o });
const local = (iso) => { const d = new Date(iso); return `${d.getDate()}-${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('datum en tijd in het Nederlands', () => {
  const r = p('morgen om 9:00 accu laden');
  assert.strictEqual(r.title, 'accu laden');
  assert.strictEqual(r.due, '2026-11-26');
  assert.strictEqual(local(r.reminder), '26-11 9:00');
});

test('weekdagen, volgende week en overmorgen', () => {
  assert.strictEqual(p('vrijdag factuur sturen').due, '2026-11-27');
  assert.strictEqual(p('woensdag x').due, '2026-12-02');
  assert.strictEqual(p('volgende week planning').due, '2026-11-30');
  assert.strictEqual(p('overmorgen bellen').due, '2026-11-27');
  assert.strictEqual(p('over 3 dagen iets').due, '2026-11-28');
});

test('losse datums', () => {
  assert.strictEqual(p('12 dec offerte').due, '2026-12-12');
  assert.strictEqual(p('3 januari belasting').due, '2027-01-03');
  assert.strictEqual(p('deadline 5-12').due, '2026-12-05');
  assert.strictEqual(p('dec 24th presents').due, '2026-12-24');
});

test('alleen een tijd: herinnering vandaag, of morgen als hij al voorbij is', () => {
  assert.strictEqual(local(p('bellen 14:30').reminder), '25-11 14:30');
  assert.strictEqual(local(p('bellen om 8u').reminder), '26-11 8:00');
  assert.strictEqual(local(p('call mom at 7pm').reminder), '25-11 19:00');
  assert.strictEqual(p('bellen 14:30').due, undefined);
});

test('herhalen', () => {
  assert.deepStrictEqual(p('elke dag vitamines').repeat, { freq: 'daily', interval: 1 });
  assert.deepStrictEqual(p('werkdagen mail checken').repeat, { freq: 'weekdays', interval: 1 });
  assert.deepStrictEqual(p('elke 2 weken gras maaien').repeat, { freq: 'weekly', interval: 2 });
  const r = p('elke maandag en donderdag sporten');
  assert.deepStrictEqual(r.repeat, { freq: 'weekly', interval: 1, days: [1, 4] });
  assert.strictEqual(r.due, '2026-11-26');
  assert.strictEqual(r.title, 'sporten');
});

test('belangrijk, mijn dag, categorie en lijst', () => {
  const r = p('offerte makelaar ! * #blauw @opd', { lists: [{ id: 'L1', name: '🚁 Opdrachten' }] });
  assert.strictEqual(r.title, 'offerte makelaar');
  assert.strictEqual(r.important, true);
  assert.strictEqual(r.myDay, true);
  assert.deepStrictEqual(r.categories, ['blue']);
  assert.strictEqual(r.listId, 'L1');
});

test('gewone tekst blijft ongemoeid', () => {
  const r = p('Morgenster bekijken in de domtoren');
  assert.strictEqual(r.title, 'Morgenster bekijken in de domtoren');
  assert.strictEqual(r.due, undefined);
  assert.strictEqual(p('Wat te doen?').title, 'Wat te doen?');
});
