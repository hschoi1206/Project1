/* 체중 기록 앱 계산 모듈: DOM 없이 순수 계산만 담는다. 브라우저(window.WTCore)와 Node(require) 공용. */
(function (g) {
  'use strict';
  const DAY = 864e5;

  /* ===== 날짜 (UTC 일 번호) ===== */
  const dn = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const isoOf = n => new Date(Math.round(n) * DAY).toISOString().slice(0, 10);
  const dow = n => ((Math.round(n) + 4) % 7 + 7) % 7; // 1970-01-01 = 목요일, 0 = 일요일

  /* ===== 입력 ===== */
  const RANGE = { weight: [20, 300], waist: [40, 200] };
  function parseNum(text, kind) {
    const t = String(text ?? '').trim().replace(',', '.');
    if (!t) return null;
    if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
    const v = Number(t), [lo, hi] = RANGE[kind];
    return v >= lo && v <= hi ? Math.round(v * 10) / 10 : undefined;
  }

  /* ===== 집계 ===== */
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

  function series(records, field) {
    return records
      .filter(r => r[field] != null)
      .map(r => ({ d: dn(r.date), v: r[field] }))
      .sort((a, b) => a.d - b.d);
  }

  function rolling(s, days) {
    let lo = 0, sum = 0;
    return s.map((p, i) => {
      sum += p.v;
      while (s[lo].d <= p.d - days) sum -= s[lo++].v;
      return { d: p.d, v: sum / (i - lo + 1) };
    });
  }

  function bucket(s, keyOf, endOf, step) {
    const m = new Map();
    for (const p of s) {
      const k = keyOf(p.d);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p.v);
    }
    return [...m].sort((a, b) => a[0] - b[0])
      .map(([key, vs]) => ({ d: endOf(key), key, v: mean(vs), n: vs.length, step }));
  }

  const weekly = s => bucket(s, d => d - dow(d), k => k + 6, 7);
  const monthly = s => bucket(
    s,
    d => { const t = new Date(d * DAY); return t.getUTCFullYear() * 12 + t.getUTCMonth(); },
    k => Date.UTC(Math.floor(k / 12), k % 12 + 1, 0) / DAY,
    1
  );

  // 각 버킷에서 key가 최근 k칸 안인 버킷 평균. 칸 간격(step)은 주 7, 월 1.
  function sma(buckets, k) {
    let lo = 0;
    return buckets.map((b, i) => {
      while (buckets[lo].key <= b.key - k * b.step) lo++;
      const vs = buckets.slice(lo, i + 1).map(x => x.v);
      return { d: b.d, v: mean(vs) };
    });
  }

  function changeOver(s, days) {
    if (!s.length) return null;
    const last = s[s.length - 1], target = last.d - days;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].d <= target) return last.v - s[i].v;
    return null;
  }

  /* ===== 상관 · BMI · 나이 ===== */
  function pairs(records, sinceIso) {
    const since = sinceIso ? dn(sinceIso) : -Infinity;
    return records
      .filter(r => r.weight != null && r.waist != null && dn(r.date) >= since)
      .map(r => ({ d: dn(r.date), x: r.weight, y: r.waist }))
      .sort((a, b) => a.d - b.d);
  }

  function linreg(pts) {
    const n = pts.length;
    if (n < 2) return null;
    const mx = mean(pts.map(p => p.x)), my = mean(pts.map(p => p.y));
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
    if (!sxx) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, r: syy ? sxy / Math.sqrt(sxx * syy) : 0, n };
  }

  const bmi = (w, h) => (w && h ? Math.round(w / (h / 100) ** 2 * 10) / 10 : null);
  // 대한비만학회 기준
  const bmiClass = b => b < 18.5 ? '저체중' : b < 23 ? '정상' : b < 25 ? '비만 전단계'
    : b < 30 ? '1단계 비만' : b < 35 ? '2단계 비만' : '3단계 비만';

  function ageOn(birthIso, todayIso) {
    if (!birthIso) return null;
    const [by, bm, bd] = birthIso.split('-').map(Number), [ty, tm, td] = todayIso.split('-').map(Number);
    return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  }

  const WTCore = { dn, isoOf, dow, parseNum, series, rolling, weekly, monthly, sma, changeOver,
    pairs, linreg, bmi, bmiClass, ageOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = WTCore;
  else g.WTCore = WTCore;
})(typeof self !== 'undefined' ? self : globalThis);
