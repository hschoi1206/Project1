const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const C = require('../core.js');

const recs = [
  { id: 'a', date: '2026-01-01', weight: 77.1, waist: null, memo: '' },
  { id: 'b', date: '2026-01-02', weight: null, waist: 80.5, memo: '' },
  { id: 'c', date: '2026-01-03', weight: 76.9, waist: 81, memo: '팀회식, 2차' },
  { id: 'd', date: '2026-01-04', weight: 76.5, waist: null, memo: '따옴표 "있음"' },
];
const pick = rs => rs.map(({ date, weight, waist, memo }) => ({ date, weight, waist, memo }));
const enc = t => new TextEncoder().encode(t);

test('toCsv writes BOM, header and one row per day', () => {
  const csv = C.toCsv(recs);
  assert.ok(csv.startsWith('﻿date,weight_kg,waist_cm,memo\r\n'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[1], '2026-01-01,77.1,,');
  assert.equal(lines[2], '2026-01-02,,80.5,');
  assert.equal(lines[3], '2026-01-03,76.9,81.0,"팀회식, 2차"');
  assert.equal(lines[4], '2026-01-04,76.5,,"따옴표 ""있음"""');
});

test('parseCsv round-trips toCsv output', () => {
  const r = C.parseCsv(C.toCsv(recs));
  assert.deepEqual(pick(r.records), pick(recs));
  assert.deepEqual(r.stats, { weights: 3, waists: 2, memos: 2, skipped: 0, dupDropped: 0 });
  assert.ok(r.records.every(x => typeof x.id === 'string' && x.id.length > 10));
});

test('parseCsv accepts LF endings, no BOM, comma decimals in quotes and skips bad rows', () => {
  const t = 'date,weight_kg,waist_cm,memo\n2026-01-01,"76,9",,\n2026-13-40,70,,\n2026-01-02,500,,\n2026-01-03,,,\n2026-01-01,77,,중복\n';
  const r = C.parseCsv(t);
  assert.deepEqual(pick(r.records), [{ date: '2026-01-01', weight: 77, waist: null, memo: '중복' }]);
  assert.equal(r.stats.skipped, 3);
  assert.equal(r.stats.dupDropped, 1);
});

test('parseCsv rejects other CSV files', () => {
  assert.throws(() => C.parseCsv('a,b,c\n1,2,3\n'), /체중 기록 CSV 형식이 아닙니다/);
  assert.throws(() => C.parseCsv(''), /체중 기록 CSV 형식이 아닙니다/);
});

test('readBackup detects databody gzip and CSV by content', async () => {
  const db = { app: 'databody', weights: [{ id: 'x', date: '2026-01-01', weightInKg: 80, memo: '81', updatedAt: 1 }], settings: { height_cm: '171.0' } };
  const a = await C.readBackup(new Uint8Array(zlib.gzipSync(JSON.stringify(db))));
  assert.equal(a.kind, 'databody');
  assert.deepEqual(pick(a.records), [{ date: '2026-01-01', weight: 80, waist: 81, memo: '' }]);
  assert.equal(a.profile.heightCm, 171);
  const b = await C.readBackup(enc(C.toCsv(recs)));
  assert.equal(b.kind, 'csv');
  assert.deepEqual(pick(b.records), pick(recs));
  await assert.rejects(C.readBackup(enc('hello')), /체중 기록 CSV 형식이 아닙니다/);
  await assert.rejects(C.readBackup(new Uint8Array([0x1f, 0x8b, 1, 2])), /./);
});

test('whtr divides waist by height and flags 0.5 and above', () => {
  assert.equal(C.whtr(81, 171), 0.47);
  assert.equal(C.whtr(81, null), null);
  assert.equal(C.whtr(null, 171), null);
  assert.equal(C.whtrClass(0.47), '정상 범위');
  assert.equal(C.whtrClass(0.5), '주의 (복부비만 위험)');
});

test('applyEntry keeps existing values for blank fields unless replacing', () => {
  const cur = { id: 'a', date: '2026-01-01', weight: 77, waist: 81, memo: '아침' };
  assert.deepEqual(C.applyEntry(cur, { weight: null, waist: 80, memo: '' }, false), { ...cur, waist: 80 });
  assert.deepEqual(C.applyEntry(cur, { weight: 76, waist: null, memo: '' }, true), { ...cur, weight: 76, waist: null, memo: '' });
  const fresh = C.applyEntry(null, { weight: 76, waist: null, memo: '' }, false, '2026-01-05');
  assert.equal(fresh.date, '2026-01-05'); assert.equal(fresh.weight, 76); assert.ok(fresh.id);
});
