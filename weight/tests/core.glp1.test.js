const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const near = (a, b, e = 0.01) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const R = (date, weight) => ({ date, weight, waist: null, memo: '' });
const last = a => a[a.length - 1];

test('clinical arms start at zero and end at the published final values', () => {
  const ends = {
    wegovy: { sema24: [68, -14.9], placebo: [68, -2.4] },
    mounjaro: { tirz15: [72, -20.9], tirz5: [72, -15.0], placebo: [72, -3.1] },
  };
  for (const [drug, arms] of Object.entries(ends)) {
    const d = C.CLINICAL[drug];
    assert.deepEqual(d.arms.map(a => a.key), Object.keys(arms));
    for (const a of d.arms) {
      assert.deepEqual(a.pts[0], [0, 0]);
      assert.deepEqual(last(a.pts), arms[a.key]);
      assert.equal(last(a.pts)[0], d.weeks);
      assert.ok(a.label && a.color);
    }
    assert.ok(d.source.length > 0);
  }
});

test('interp is linear and null outside the trial', () => {
  const pts = [[0, 0], [4, -2], [8, -3]];
  assert.equal(C.interp(pts, 2), -1);
  assert.equal(C.interp(pts, 8), -3);
  assert.equal(C.interp(pts, -1), null);
  assert.equal(C.interp(pts, 999), null);
});

test('baseline prefers the start day, else the latest record within 14 days before', () => {
  assert.deepEqual(C.baseline([R('2026-09-26', 86), R('2026-09-27', 85.1)], '2026-09-27'), { d: C.dn('2026-09-27'), weight: 85.1 });
  assert.deepEqual(C.baseline([R('2026-09-14', 86)], '2026-09-27'), { d: C.dn('2026-09-14'), weight: 86 });
  assert.equal(C.baseline([R('2026-09-12', 86)], '2026-09-27'), null);
  assert.equal(C.baseline([R('2026-09-28', 86)], '2026-09-27'), null);
});

test('glp1Series computes percent change by week', () => {
  const recs = [R('2026-09-27', 85.1), R('2026-11-23', 77.4)];
  const s = C.glp1Series(recs, '2026-09-27', '2026-11-26');
  assert.equal(s.status, 'ok');
  assert.equal(s.base.weight, 85.1);
  const p = last(s.points);
  near(p.pct, -9.048);
  near(p.week, 57 / 7);
  assert.equal(p.weight, 77.4);
});

test('glp1Series reports future start, missing baseline and no data after start', () => {
  assert.equal(C.glp1Series([R('2026-09-27', 85)], '2026-12-01', '2026-11-26').status, 'future');
  assert.equal(C.glp1Series([R('2026-08-01', 85)], '2026-09-27', '2026-11-26').status, 'noBaseline');
  assert.equal(C.glp1Series([R('2026-09-20', 85)], '2026-09-27', '2026-11-26').status, 'noData');
  assert.equal(C.glp1Series([], '2026-09-27', '2026-11-26').status, 'noBaseline');
});
