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

  const weekKey = d => d - dow(d), weekEnd = k => k + 6;
  const monthKey = d => { const t = new Date(d * DAY); return t.getUTCFullYear() * 12 + t.getUTCMonth(); };
  const monthEnd = k => Date.UTC(Math.floor(k / 12), k % 12 + 1, 0) / DAY;
  const weekly = s => bucket(s, weekKey, weekEnd, 7);
  const monthly = s => bucket(s, monthKey, monthEnd, 1);

  // 캔들(시가·고가·저가·종가). 주·월: 구간의 첫/최고/최저/마지막 기록. 일: 전날 기록 → 오늘 기록.
  function candles(s, unit) {
    if (unit === 'day') return s.map((p, i) => {
      const o = i ? s[i - 1].v : p.v;
      return { d: p.d, o, h: Math.max(o, p.v), l: Math.min(o, p.v), c: p.v, n: 1 };
    });
    const [keyOf, endOf] = unit === 'week' ? [weekKey, weekEnd] : [monthKey, monthEnd];
    const out = [];
    for (const p of s) {
      const k = keyOf(p.d), last = out[out.length - 1];
      if (last && last.key === k) { last.h = Math.max(last.h, p.v); last.l = Math.min(last.l, p.v); last.c = p.v; last.n++; }
      else out.push({ key: k, o: p.v, h: p.v, l: p.v, c: p.v, n: 1 });
    }
    return out.map(({ key, o, h, l, c, n }) => ({ d: endOf(key), o, h, l, c, n }));
  }

  // 각 버킷에서 key가 최근 k칸 안인 버킷 평균. 칸 간격(step)은 주 7, 월 1.
  function sma(buckets, k) {
    let lo = 0;
    return buckets.map((b, i) => {
      while (buckets[lo].key <= b.key - k * b.step) lo++;
      const vs = buckets.slice(lo, i + 1).map(x => x.v);
      return { d: b.d, v: mean(vs) };
    });
  }

  // 비교 기준점은 목표일 이전의 가장 가까운 기록. 목표일에서 너무 멀면(7일 3일, 30일 7일, 365일 30일 초과) 비교하지 않는다.
  function changeOver(s, days) {
    if (!s.length) return null;
    const last = s[s.length - 1], target = last.d - days, tol = days <= 7 ? 3 : days <= 30 ? 7 : 30;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].d <= target) return target - s[i].d <= tol ? last.v - s[i].v : null;
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

  /* ===== 투약(GLP-1) 임상 비교 =====
   * [주차, 기준 대비 체중 변화율 %]. 첫 점 0, 마지막 점은 논문 본문 최종값(치료정책/치료방침 추정치).
   * 중간 주차 값은 모두 근사값이다(개발 환경에서 논문 원문 그림에 접근하지 못함).
   * - 위고비: STEP 1 시간별 그래프(사용자 제공 참고 그래프)를 판독한 값. 60주 최저점은 논문 서술과 일치.
   * - 마운자로: 72주 최종값과 24주 전체 용량 평균(약 −13~−15%, Horn 2025 Clin Obes)에 맞춘 근사 곡선.
   */
  const CLINICAL = {
    wegovy: {
      weeks: 68,
      source: 'STEP 1 (Wilding et al., NEJM 2021) · 68주 최종값은 논문 수치, 중간 주차는 그래프 판독 근사값',
      arms: [
        { key: 'sema24', label: '위고비 2.4mg', color: '#7aa7ff',
          pts: [[0, 0], [4, -1.9], [8, -4.3], [12, -6.8], [16, -8.5], [20, -10.0], [28, -12.3], [36, -13.8], [44, -14.6], [52, -15.1], [60, -15.3], [68, -14.9]] },
        { key: 'placebo', label: '위약', color: '#8c9ca4',
          pts: [[0, 0], [4, -0.6], [8, -0.9], [12, -1.3], [16, -1.6], [20, -1.8], [28, -2.0], [36, -2.3], [44, -2.4], [52, -2.5], [60, -2.5], [68, -2.4]] },
      ],
    },
    mounjaro: {
      weeks: 72,
      source: 'SURMOUNT-1 (Jastreboff et al., NEJM 2022) · 72주 최종값은 논문 수치, 중간 주차는 근사 추정값(원문 그림 미대조)',
      arms: [
        { key: 'tirz15', label: '마운자로 15mg (고용량)', color: '#7aa7ff',
          pts: [[0, 0], [4, -2.8], [8, -5.5], [12, -8.0], [16, -10.3], [20, -12.4], [24, -14.4], [36, -17.6], [48, -19.6], [60, -20.6], [72, -20.9]] },
        { key: 'tirz5', label: '마운자로 5mg (저용량)', color: '#b49cff',
          pts: [[0, 0], [4, -2.6], [8, -4.8], [12, -6.8], [16, -8.5], [20, -9.9], [24, -11.1], [36, -13.3], [48, -14.5], [60, -15.0], [72, -15.0]] },
        { key: 'placebo', label: '위약', color: '#8c9ca4',
          pts: [[0, 0], [4, -0.8], [8, -1.3], [12, -1.7], [16, -2.0], [20, -2.3], [24, -2.5], [36, -2.8], [48, -3.0], [60, -3.1], [72, -3.1]] },
      ],
    },
  };

  function interp(pts, week) {
    if (week < pts[0][0] || week > pts[pts.length - 1][0]) return null;
    for (let i = 1; i < pts.length; i++) {
      const [w0, v0] = pts[i - 1], [w1, v1] = pts[i];
      if (week <= w1) return v0 + (v1 - v0) * (week - w0) / (w1 - w0);
    }
    return null;
  }

  function baseline(records, startIso) {
    const s = dn(startIso);
    const c = series(records, 'weight').filter(p => p.d <= s && p.d >= s - 14);
    return c.length ? { d: c[c.length - 1].d, weight: c[c.length - 1].v } : null;
  }

  function glp1Series(records, startIso, todayIso) {
    const s = dn(startIso);
    if (s > dn(todayIso)) return { status: 'future', base: null, points: [] };
    const base = baseline(records, startIso);
    if (!base) return { status: 'noBaseline', base: null, points: [] };
    const points = series(records, 'weight').filter(p => p.d >= s)
      .map(p => ({ d: p.d, week: (p.d - s) / 7, pct: (p.v / base.weight - 1) * 100, weight: p.v }));
    return { status: points.some(p => p.d > s) ? 'ok' : 'noData', base, points };
  }

  /* ===== .databody 백업 (기존 앱 형식: gzip JSON) ===== */
  const WAIST_RE = /^\s*(\d{2,3}(?:\.\d+)?)\s*$/;
  const waistOk = v => v >= RANGE.waist[0] && v <= RANGE.waist[1]; // 입력 범위와 같게(왕복 동일성)

  function splitMemo(memo) {
    const t = memo ?? '';
    const m = t.match(WAIST_RE);
    if (m && waistOk(+m[1])) return { waist: +m[1], memo: '' };
    return { waist: null, memo: t };
  }

  const newId = () => crypto.randomUUID();
  const sortByDate = rs => rs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  function parseDatabody(obj) {
    if (!obj || obj.app !== 'databody' || !Array.isArray(obj.weights)) throw new Error('databody 형식이 아닙니다');
    const byDate = new Map();
    const stats = { weights: 0, waists: 0, memos: 0, skipped: 0, dupDropped: 0 };
    for (const w of obj.weights) {
      if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) { stats.skipped++; continue; }
      const { waist, memo } = splitMemo(w.memo);
      const weight = typeof w.weightInKg === 'number' ? w.weightInKg : null;
      if (weight == null && waist == null && !memo) { stats.skipped++; continue; }
      const rec = { id: w.id || newId(), date: w.date, weight, waist, memo, _u: w.updatedAt || 0 };
      const prev = byDate.get(w.date);
      if (prev) { stats.dupDropped++; if (prev._u >= rec._u) continue; }
      byDate.set(w.date, rec);
    }
    const records = sortByDate([...byDate.values()].map(({ _u, ...r }) => r));
    for (const r of records) { if (r.weight != null) stats.weights++; if (r.waist != null) stats.waists++; if (r.memo) stats.memos++; }
    const s = obj.settings || {}, profile = {};
    if (s.height_cm != null && !isNaN(parseFloat(s.height_cm))) profile.heightCm = parseFloat(s.height_cm);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s.birth_date || '')) profile.birthDate = s.birth_date;
    if (s.gender === 'male' || s.gender === 'female') profile.sex = s.gender;
    return { records, profile, stats };
  }

  // 같은 날짜는 칸별로 합친다: 파일에 값이 있는 칸은 파일 값, 없는 칸은 폰 값 유지.
  function mergeRecords(existing, incoming) {
    const m = new Map(existing.map(r => [r.date, { ...r }]));
    for (const r of incoming) {
      const cur = m.get(r.date);
      if (!cur) { m.set(r.date, { ...r }); continue; }
      if (r.weight != null) cur.weight = r.weight;
      if (r.waist != null) cur.waist = r.waist;
      if (r.memo) cur.memo = r.memo;
    }
    return sortByDate([...m.values()]);
  }

  async function pipeBytes(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  const gunzipToText = async bytes => new TextDecoder().decode(await pipeBytes(bytes, new DecompressionStream('gzip')));

  /* ===== 이 앱의 백업: CSV (date,weight_kg,waist_cm,memo) ===== */
  const CSV_HEAD = ['date', 'weight_kg', 'waist_cm', 'memo'];
  const csvCell = v => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  function toCsv(records) {
    const rows = records.map(r => [r.date, r.weight != null ? r.weight.toFixed(1) : '', r.waist != null ? r.waist.toFixed(1) : '', csvCell(r.memo || '')].join(','));
    return '\uFEFF' + [CSV_HEAD.join(','), ...rows].join('\r\n') + '\r\n';
  }
  function csvRows(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function parseCsv(text) {
    const rows = csvRows(String(text).replace(/^\uFEFF/, ''));
    if (!rows.length || rows[0].map(h => h.trim()).join(',') !== CSV_HEAD.join(',')) throw new Error('체중 기록 CSV 형식이 아닙니다');
    const byDate = new Map(), stats = { weights: 0, waists: 0, memos: 0, skipped: 0, dupDropped: 0 };
    for (const r of rows.slice(1)) {
      if (r.length === 1 && !r[0].trim()) continue;
      const date = (r[0] || '').trim(), weight = parseNum(r[1], 'weight'), waist = parseNum(r[2], 'waist'), memo = (r[3] || '').trim();
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && isoOf(dn(date)) === date;
      if (!valid || weight === undefined || waist === undefined || (weight == null && waist == null && !memo)) { stats.skipped++; continue; }
      if (byDate.has(date)) stats.dupDropped++;
      byDate.set(date, { id: newId(), date, weight, waist, memo });
    }
    const records = sortByDate([...byDate.values()]);
    for (const r of records) { if (r.weight != null) stats.weights++; if (r.waist != null) stats.waists++; if (r.memo) stats.memos++; }
    return { records, stats };
  }
  // 파일 내용으로 형식 판별: gzip이면 이전 앱(.databody), 아니면 이 앱 CSV
  async function readBackup(bytes) {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { kind: 'databody', ...parseDatabody(JSON.parse(await gunzipToText(bytes))) };
    return { kind: 'csv', profile: {}, ...parseCsv(new TextDecoder().decode(bytes)) };
  }

  /* ===== WHtR · 홈 입력 ===== */
  const whtr = (waist, h) => (waist && h ? Math.round(waist / h * 100) / 100 : null);
  const whtrClass = v => (v < 0.5 ? '정상 범위' : '주의 (복부비만 위험)');
  // replace=false: 빈 칸은 기존 값 유지(새 입력). replace=true: 입력한 그대로 바꿈(수정).
  function applyEntry(cur, e, replace, date) {
    const r = cur ? { ...cur } : { id: newId(), date, weight: null, waist: null, memo: '' };
    if (replace) return { ...r, weight: e.weight, waist: e.waist, memo: e.memo };
    if (e.weight != null) r.weight = e.weight;
    if (e.waist != null) r.waist = e.waist;
    if (e.memo) r.memo = e.memo;
    return r;
  }

  const WTCore = { dn, isoOf, dow, parseNum, series, rolling, weekly, monthly, sma, changeOver, candles,
    pairs, linreg, bmi, bmiClass, ageOn, CLINICAL, interp, baseline, glp1Series,
    splitMemo, parseDatabody, mergeRecords, gunzipToText, newId, toCsv, parseCsv, readBackup, whtr, whtrClass, applyEntry };
  if (typeof module !== 'undefined' && module.exports) module.exports = WTCore;
  else g.WTCore = WTCore;
})(typeof self !== 'undefined' ? self : globalThis);
