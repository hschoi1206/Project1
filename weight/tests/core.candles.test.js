const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const W = (date, weight) => ({ date, weight, waist: null, memo: '' });
const s = recs => C.series(recs, 'weight');

test('weekly candles use first/last/max/min of each Sunday-Saturday week', () => {
  const c = C.candles(s([W('2026-11-22', 78), W('2026-11-24', 79.2), W('2026-11-25', 77.1), W('2026-11-28', 77.5), W('2026-11-29', 77.0)]), 'week');
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { d: C.dn('2026-11-28'), o: 78, h: 79.2, l: 77.1, c: 77.5, n: 4 });
  assert.deepEqual(c[1], { d: C.dn('2026-12-05'), o: 77, h: 77, l: 77, c: 77, n: 1 });
});

test('monthly candles end on the last day of the month', () => {
  const c = C.candles(s([W('2026-01-03', 80), W('2026-01-20', 79), W('2026-03-05', 78)]), 'month');
  assert.deepEqual(c.map(x => [C.isoOf(x.d), x.o, x.h, x.l, x.c, x.n]), [['2026-01-31', 80, 80, 79, 79, 2], ['2026-03-31', 78, 78, 78, 78, 1]]);
});

test('daily candles run from the previous record to today', () => {
  const c = C.candles(s([W('2026-11-24', 77.1), W('2026-11-25', 77.2), W('2026-11-26', 76.9)]), 'day');
  assert.deepEqual(c.map(x => [x.o, x.h, x.l, x.c]), [[77.1, 77.1, 77.1, 77.1], [77.1, 77.2, 77.1, 77.2], [77.2, 77.2, 76.9, 76.9]]);
  assert.equal(c[2].d, C.dn('2026-11-26'));
});

test('candles of an empty series are empty', () => {
  for (const u of ['day', 'week', 'month']) assert.deepEqual(C.candles([], u), []);
});
