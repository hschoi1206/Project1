const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const entry = (date, weightInKg, memo = null, extra = {}) => ({
  id: `id-${date}`, weight: weightInKg, unit: weightInKg == null ? null : 'kg', weightInKg,
  timestamp: 0, timeZoneId: 'Asia/Seoul', date, memo, source: 'manual',
  externalId: null, externalSourceApp: null, updatedAt: 1, ...extra,
});
const file = (weights, settings = {}) => ({ formatVersion: 1, app: 'databody', exportedAt: 1, weights, diets: [{ x: 1 }], settings });

test('splitMemo pulls waist from numeric memos only', () => {
  assert.deepEqual(C.splitMemo('81'), { waist: 81, memo: '' });
  assert.deepEqual(C.splitMemo('79.5'), { waist: 79.5, memo: '' });
  assert.deepEqual(C.splitMemo('77 5'), { waist: null, memo: '77 5' });
  assert.deepEqual(C.splitMemo('혼술'), { waist: null, memo: '혼술' });
  assert.deepEqual(C.splitMemo('250'), { waist: null, memo: '250' });
  assert.deepEqual(C.splitMemo(null), { waist: null, memo: '' });
});

test('parseDatabody maps weights, waists, memos and profile', () => {
  const r = C.parseDatabody(file([
    entry('2026-01-01', 80, '기상후'),
    entry('2026-01-02', null, '81'),
    entry('2026-01-03', null, null),
    entry('2026-01-04', 79.5, '82.5'),
  ], { height_cm: '171.0', birth_date: '1990-01-01', gender: 'male' }));
  assert.deepEqual(r.records.map(x => [x.date, x.weight, x.waist, x.memo]), [
    ['2026-01-01', 80, null, '기상후'],
    ['2026-01-02', null, 81, ''],
    ['2026-01-04', 79.5, 82.5, ''],
  ]);
  assert.equal(r.records[0].id, 'id-2026-01-01');
  assert.deepEqual(r.profile, { heightCm: 171, birthDate: '1990-01-01', sex: 'male' });
  assert.deepEqual(r.stats, { weights: 2, waists: 2, memos: 1, skipped: 1, dupDropped: 0 });
});

test('parseDatabody keeps the latest updatedAt on duplicate dates', () => {
  const r = C.parseDatabody(file([entry('2026-01-01', 80, null, { updatedAt: 1 }), entry('2026-01-01', 79, null, { updatedAt: 5, id: 'b' })]));
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].weight, 79);
  assert.equal(r.stats.dupDropped, 1);
});

test('parseDatabody rejects files that are not databody', () => {
  assert.throws(() => C.parseDatabody({}), /databody 형식이 아닙니다/);
  assert.throws(() => C.parseDatabody({ app: 'x', weights: [] }), /databody 형식이 아닙니다/);
  assert.throws(() => C.parseDatabody(null), /databody 형식이 아닙니다/);
});

test('mergeRecords lets file values win field by field and keeps phone-only fields', () => {
  const ex = [{ id: 'a', date: '2026-01-01', weight: 77, waist: 81, memo: '메모' }, { id: 'c', date: '2026-01-03', weight: 70, waist: null, memo: '' }];
  const inc = [{ id: 'b', date: '2026-01-01', weight: 76, waist: null, memo: '' }, { id: 'd', date: '2026-01-02', weight: 75, waist: null, memo: '' }];
  const m = C.mergeRecords(ex, inc);
  assert.deepEqual(m.map(x => [x.date, x.weight, x.waist, x.memo]), [
    ['2026-01-01', 76, 81, '메모'], ['2026-01-02', 75, null, ''], ['2026-01-03', 70, null, ''],
  ]);
  assert.equal(ex[0].weight, 77); // 원본은 바뀌지 않음
});

test('newId returns a uuid', () => {
  assert.match(C.newId(), /^[0-9a-f-]{36}$/);
});

test('numeric memos across the whole entry range become waist', () => {
  for (const w of [40, 45, 160, 200]) assert.deepEqual(C.splitMemo(String(w)), { waist: w, memo: '' });
});

test('gunzipToText reads a gzip databody file', async () => {
  const zlib = require('node:zlib');
  const gz = new Uint8Array(zlib.gzipSync(JSON.stringify({ app: 'databody', weights: [] })));
  assert.equal(JSON.parse(await C.gunzipToText(gz)).app, 'databody');
});
