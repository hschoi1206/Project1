const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const W = (date, weight, waist = null) => ({ date, weight, waist, memo: '' });

test('date helpers use UTC day numbers', () => {
  assert.equal(C.dn('1970-01-01'), 0);
  assert.equal(C.isoOf(C.dn('2026-11-26')), '2026-11-26');
  assert.equal(C.dow(C.dn('2026-11-22')), 0); // Sunday
});

test('parseNum accepts comma decimals, blanks and rejects out-of-range', () => {
  assert.equal(C.parseNum('76,9', 'weight'), 76.9);
  assert.equal(C.parseNum('  ', 'weight'), null);
  assert.equal(C.parseNum('', 'waist'), null);
  assert.equal(C.parseNum('500', 'weight'), undefined);
  assert.equal(C.parseNum('30', 'waist'), undefined);
  assert.equal(C.parseNum('abc', 'weight'), undefined);
  assert.equal(C.parseNum('81.5', 'waist'), 81.5);
});

test('series skips nulls and sorts by date', () => {
  const s = C.series([W('2026-01-02', null, 80), W('2026-01-01', 77)], 'weight');
  assert.deepEqual(s, [{ d: C.dn('2026-01-01'), v: 77 }]);
  assert.deepEqual(C.series([W('2026-01-02', null, 80)], 'waist'), [{ d: C.dn('2026-01-02'), v: 80 }]);
});

test('rolling averages points inside the trailing calendar window', () => {
  const s = C.series([W('2026-01-01', 70), W('2026-01-05', 72), W('2026-01-09', 74)], 'weight');
  const r = C.rolling(s, 7);
  assert.equal(r.length, 3);
  near(r[2].v, 73);
  near(r[0].v, 70);
});

test('weekly buckets run Sunday to Saturday', () => {
  const s = C.series([W('2026-11-22', 70), W('2026-11-28', 72), W('2026-11-29', 80)], 'weight');
  const w = C.weekly(s);
  assert.equal(w.length, 2);
  assert.equal(w[0].v, 71);
  assert.equal(w[0].n, 2);
  assert.equal(w[0].d, C.dn('2026-11-28'));
  assert.equal(w[1].v, 80);
});

test('monthly buckets and sma skip empty months', () => {
  const s = C.series([W('2026-01-03', 70), W('2026-01-20', 72), W('2026-03-05', 80)], 'weight');
  const m = C.monthly(s);
  assert.equal(m.length, 2);
  assert.equal(m[0].v, 71);
  assert.equal(m[0].d, C.dn('2026-01-31'));
  const s2 = C.sma(m, 2);
  assert.equal(s2[1].v, 80);
  assert.equal(s2[1].d, m[1].d);
});

test('weekly sma averages the last k weeks', () => {
  const days = ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29'];
  const s = C.series(days.map((d, i) => W(d, 70 + i)), 'weight');
  const r = C.sma(C.weekly(s), 5);
  near(r[r.length - 1].v, 72);
  near(r[0].v, 70);
});

test('changeOver compares latest to nearest value at or before the window start', () => {
  const s = C.series([W('2026-11-18', 79), W('2026-11-19', 78.6), W('2026-11-26', 76.9)], 'weight');
  near(C.changeOver(s, 7), 76.9 - 78.6);
  assert.equal(C.changeOver(s, 365), null);
});

test('empty inputs return empty results', () => {
  assert.deepEqual(C.series([], 'weight'), []);
  assert.deepEqual(C.rolling([], 7), []);
  assert.deepEqual(C.weekly([]), []);
  assert.deepEqual(C.monthly([]), []);
  assert.deepEqual(C.sma([], 5), []);
  assert.equal(C.changeOver([], 7), null);
});

test('changeOver ignores comparison points far from the window start', () => {
  const s = C.series([W('2024-01-01', 80), W('2026-11-20', 75), W('2026-11-26', 74.5)], 'weight');
  assert.equal(C.changeOver(s, 7), null);
  assert.equal(C.changeOver(s, 30), null);
  const s2 = C.series([W('2026-11-17', 76), W('2026-11-26', 74.5)], 'weight');
  near(C.changeOver(s2, 7), -1.5); // 9일 전 값: 7일 기준 허용 범위(3일) 안
});
