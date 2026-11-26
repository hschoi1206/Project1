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
  assert.deepEqual(C.splitMemo('81.0 / 혼술'), { waist: 81, memo: '혼술' });
  assert.deepEqual(C.splitMemo('77 5'), { waist: null, memo: '77 5' });
  assert.deepEqual(C.splitMemo('혼술'), { waist: null, memo: '혼술' });
  assert.deepEqual(C.splitMemo('200'), { waist: null, memo: '200' });
  assert.deepEqual(C.splitMemo(null), { waist: null, memo: '' });
});

test('joinMemo writes waist first', () => {
  assert.equal(C.joinMemo(81, ''), '81.0');
  assert.equal(C.joinMemo(81, '혼술'), '81.0 / 혼술');
  assert.equal(C.joinMemo(null, '혼술'), '혼술');
  assert.equal(C.joinMemo(null, ''), null);
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

test('mergeRecords merges field by field; replace keeps only the file', () => {
  const ex = [{ id: 'a', date: '2026-01-01', weight: 77, waist: 81, memo: '메모' }, { id: 'c', date: '2026-01-03', weight: 70, waist: null, memo: '' }];
  const inc = [{ id: 'b', date: '2026-01-01', weight: 76, waist: null, memo: '' }, { id: 'd', date: '2026-01-02', weight: 75, waist: null, memo: '' }];
  const m = C.mergeRecords(ex, inc, 'merge');
  assert.deepEqual(m.map(x => [x.date, x.weight, x.waist, x.memo]), [
    ['2026-01-01', 76, 81, '메모'], ['2026-01-02', 75, null, ''], ['2026-01-03', 70, null, ''],
  ]);
  assert.deepEqual(C.mergeRecords(ex, inc, 'replace').map(x => x.date), ['2026-01-01', '2026-01-02']);
});

test('buildDatabody writes the databody shape', () => {
  const o = C.buildDatabody([{ id: 'x', date: '2020-05-05', weight: null, waist: 81, memo: '' }],
    { heightCm: 171, birthDate: '1990-01-01', sex: 'male' }, 1234);
  assert.equal(o.app, 'databody'); assert.equal(o.formatVersion, 1); assert.equal(o.exportedAt, 1234);
  for (const k of ['diets', 'exercises', 'metricRecords', 'habitRecords', 'water', 'dailyActivities', 'metricDefinitions', 'habitDefinitions', 'nutrientDefinitions', 'foodLibrary', 'exerciseLibrary']) assert.deepEqual(o[k], []);
  const w = o.weights[0];
  assert.equal(w.timestamp, 1588604400000);
  assert.equal(w.unit, null); assert.equal(w.weightInKg, null); assert.equal(w.memo, '81.0');
  assert.equal(w.timeZoneId, 'Asia/Seoul'); assert.equal(w.id, 'x');
  assert.equal(o.settings.height_cm, '171.0'); assert.equal(o.settings.gender, 'male'); assert.equal(o.settings.birth_date, '1990-01-01');
});

test('export then gzip then import round-trips the records', async () => {
  const recs = [
    { id: 'a', date: '2026-01-01', weight: 77.1, waist: null, memo: '' },
    { id: 'b', date: '2026-01-02', weight: null, waist: 80.5, memo: '' },
    { id: 'c', date: '2026-01-03', weight: 76.9, waist: 81, memo: '' },
    { id: 'd', date: '2026-01-04', weight: 76.5, waist: 79, memo: '혼술' },
    { id: 'e', date: '2026-01-05', weight: 76.4, waist: null, memo: '팀회식' },
  ];
  const gz = await C.gzipText(JSON.stringify(C.buildDatabody(recs, {}, 1)));
  assert.ok(gz instanceof Uint8Array);
  const back = C.parseDatabody(JSON.parse(await C.gunzipToText(gz))).records;
  assert.deepEqual(back.map(({ id, date, weight, waist, memo }) => ({ id, date, weight, waist, memo })), recs);
});

test('newId returns a uuid', () => {
  assert.match(C.newId(), /^[0-9a-f-]{36}$/);
});
