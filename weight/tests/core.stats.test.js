const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const R = (date, weight, waist) => ({ date, weight, waist, memo: '' });

test('linreg fits a perfect line', () => {
  const r = C.linreg([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]);
  near(r.slope, 2); near(r.intercept, 0); near(r.r, 1);
  assert.equal(r.n, 3);
});

test('linreg needs two points with spread in x', () => {
  assert.equal(C.linreg([{ x: 1, y: 2 }]), null);
  assert.equal(C.linreg([{ x: 1, y: 2 }, { x: 1, y: 3 }]), null);
});

test('pairs keeps days with both values on or after since', () => {
  const recs = [R('2025-01-01', 80, 85), R('2026-01-01', 78, null), R('2026-02-01', 77, 82)];
  assert.deepEqual(C.pairs(recs).map(p => p.x), [80, 77]);
  assert.deepEqual(C.pairs(recs, '2025-06-01'), [{ d: C.dn('2026-02-01'), x: 77, y: 82 }]);
});

test('bmi rounds to one decimal and needs height', () => {
  assert.equal(C.bmi(76.9, 171), 26.3);
  assert.equal(C.bmi(70, null), null);
  assert.equal(C.bmi(null, 171), null);
});

test('bmiClass follows the Korean obesity society cutoffs', () => {
  assert.equal(C.bmiClass(18.4), '저체중');
  assert.equal(C.bmiClass(22.9), '정상');
  assert.equal(C.bmiClass(23), '비만 전단계');
  assert.equal(C.bmiClass(26.3), '1단계 비만');
  assert.equal(C.bmiClass(30), '2단계 비만');
  assert.equal(C.bmiClass(35), '3단계 비만');
});

test('ageOn counts completed years', () => {
  assert.equal(C.ageOn('1986-12-06', '2026-11-26'), 39);
  assert.equal(C.ageOn('1986-11-26', '2026-11-26'), 40);
  assert.equal(C.ageOn('', '2026-11-26'), null);
});
