# 체중·허리둘레 기록 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android Chrome에 설치하는 오프라인 PWA로 체중·허리둘레를 기록하고, 추이·이동평균·상관도·투약 임상 비교 그래프를 보여 준다.

**Architecture:** `weight/core.js`는 DOM 없는 순수 계산 모듈(브라우저 `window.WTCore`, Node `module.exports`)이고 `node --test`로 검증한다. `weight/index.html`은 화면·SVG 그래프·이벤트를 담당하며 `cycle/index.html`의 `TimeZoom` 확대/이동 엔진을 이식한다. 데이터는 `localStorage`에만 저장한다.

**Tech Stack:** HTML, 바닐라 JS(ES2022), SVG, Service Worker, `CompressionStream`/`DecompressionStream`, Node 22 `node:test`, Playwright(검증 전용, 커밋하지 않음).

**Spec:** `docs/superpowers/specs/2026-11-26-weight-tracker-design.md`

## Global Constraints

- 외부 라이브러리·CDN·빌드 도구·분석/광고 코드 금지. 네트워크 요청은 같은 출처(정적 파일)만.
- 사용자 데이터·실제 백업 파일·생년월일 등 개인정보를 저장소에 커밋하지 않는다. 테스트는 합성 데이터만.
- `localStorage` 키: `weightTracker.v1`, 구조는 스펙 6.1 그대로.
- 날짜는 `YYYY-MM-DD` 문자열, 내부 계산은 UTC 일 번호(`dn`)로 한다(시간대 영향 없음). 내보내기 `timestamp`만 Asia/Seoul 00:00 ms.
- 주는 일요일~토요일. BMI 분류는 대한비만학회 기준(스펙 5.5).
- 화면 문구는 한국어. 어두운 테마 기본. 세로 휴대폰 화면(360~430px 폭) 기준.
- 배포 경로: `https://hschoi1206.github.io/Project1/weight/` → 모든 경로는 상대경로(`./`).

## Review Focus

1. **체중 없이 허리둘레만 있는 날(실제 98일 중 일부), 또는 그 반대** → 그래프는 `null`을 0으로 그리지 않고 건너뛴다. (Task 1 테스트)
2. **기록 0건인 새 사용자(친구)** → 모든 탭이 오류 없이 "기록이 없습니다"를 보여 준다. (Task 5·6 스모크)
3. **소수점을 쉼표로 입력(`76,9`)하거나 범위 밖 값(0, 500)** → 쉼표는 점으로 바꾸고, 체중 20–300kg·허리둘레 40–200cm 밖이면 저장하지 않고 안내한다. (Task 1 `parseNum`)
4. **투약 시작일이 미래이거나 시작일 이후 기록이 없음** → 비교 화면은 안내 문구만 보여 주고 오류가 나지 않는다. (Task 3 테스트)
5. **databody가 아닌 파일·깨진 파일 불러오기** → 오류 안내, 기존 데이터는 그대로. (Task 4 테스트)

---

### Task 1: core.js — 날짜·입력·집계

**Files:**
- Create: `weight/core.js`
- Test: `weight/tests/core.agg.test.js`

**Interfaces:**
- Produces (모두 `WTCore.*`):
  - `dn(iso: string) -> number`, `isoOf(n: number) -> string`, `dow(n) -> 0..6`(0=일)
  - `parseNum(text: string, kind: 'weight'|'waist') -> number|null|undefined` (빈 칸 `null`, 잘못된 값 `undefined`)
  - `series(records, field: 'weight'|'waist') -> {d:number, v:number}[]` (날짜순, null 제외)
  - `rolling(series, days: number) -> {d, v}[]` (각 점에서 `(d-days, d]` 구간 평균)
  - `weekly(series) -> {d, key, v, n}[]` (`d`=그 주 토요일 dn, `key`=일요일 dn)
  - `monthly(series) -> {d, key, v, n}[]` (`d`=그 달 말일 dn, `key`=`y*12+m`)
  - `sma(buckets, k: number) -> {d, v}[]` (각 버킷에서 `key`가 최근 k칸 안인 버킷들의 평균; 주는 key 간격 7, 월은 1)
  - `changeOver(series, days) -> number|null` (최신값 − `최신 d - days` 시점 이하 가장 가까운 값)

- [ ] **Step 1: 실패하는 테스트 작성** — `core.agg.test.js`:
  - `dn('1970-01-01')===0`, `isoOf(dn('2026-11-26'))==='2026-11-26'`, `dow(dn('2026-11-22'))===0`
  - `parseNum('76,9','weight')===76.9`, `parseNum('','weight')===null`, `parseNum('500','weight')===undefined`, `parseNum('30','waist')===undefined`
  - `series([{date:'2026-01-02',weight:null,waist:80},{date:'2026-01-01',weight:77,waist:null}],'weight')` → `[{d:dn('2026-01-01'),v:77}]` (Review Focus 1)
  - `rolling` 날짜 01-01=70, 01-05=72, 01-09=74, days=7 → 01-09 값 `73` (01-02 이전 제외)
  - `weekly`: 2026-11-22(일)=70, 11-28(토)=72, 11-29(일)=80 → 버킷 2개, 첫 버킷 `v=71, n=2, d=dn('2026-11-28')`
  - `monthly`: 1월 2건(70,72), 3월 1건(80) → 2개 버킷, `sma(monthly, 2)`의 3월 값은 `80` (2월 비어 1월은 범위 밖)
  - `sma(weekly, 5)`: 연속 5주 70,71,72,73,74 → 마지막 `72`
  - `changeOver`: 11-26=76.9, 11-19=78.6 → `changeOver(s,7)` ≈ `-1.7` (부동소수 비교는 `Math.abs(x-y)<1e-9`)
  - 빈 배열 입력 시 모든 함수가 `[]` 또는 `null`
- [ ] **Step 2:** `node --test weight/tests/` → FAIL (`Cannot find module`)
- [ ] **Step 3:** `weight/core.js` 구현. 모듈 래퍼: `(function(g){ const WTCore={...}; if(typeof module!=='undefined') module.exports=WTCore; else g.WTCore=WTCore; })(typeof self!=='undefined'?self:globalThis);` 일요일 시작 주: `key = n - dow(n)`, `dow(n) = (n+4)%7` (1970-01-01 목요일).
- [ ] **Step 4:** `node --test weight/tests/` → PASS
- [ ] **Step 5:** 커밋 `feat(weight): core date, input and aggregation functions`

### Task 2: core.js — 상관·BMI·나이

**Files:**
- Modify: `weight/core.js`
- Test: `weight/tests/core.stats.test.js`

**Interfaces:**
- Consumes: `dn`, `isoOf`
- Produces:
  - `pairs(records, sinceIso?: string) -> {d, x:weight, y:waist}[]` (둘 다 있는 날만)
  - `linreg(points) -> {slope, intercept, r, n}|null` (n<2 또는 x분산 0이면 null)
  - `bmi(weightKg, heightCm) -> number|null` (소수 1자리 반올림)
  - `bmiClass(b) -> '저체중'|'정상'|'비만 전단계'|'1단계 비만'|'2단계 비만'|'3단계 비만'`
  - `ageOn(birthIso, todayIso) -> number|null`

- [ ] **Step 1: 테스트 작성**: `linreg([{x:1,y:2},{x:2,y:4},{x:3,y:6}])` → `slope 2, intercept 0, r 1, n 3`; 점 1개 → `null`; `bmi(76.9,171)===26.3`; `bmiClass(26.3)==='1단계 비만'`, `bmiClass(22.9)==='정상'`, `bmiClass(23)==='비만 전단계'`, `bmiClass(18.4)==='저체중'`, `bmiClass(35)==='3단계 비만'`; `bmi(70,null)===null`; `ageOn('1986-12-06','2026-11-26')===39`, `ageOn('1986-11-26','2026-11-26')===40`; `pairs`는 sinceIso 이전과 한쪽만 있는 날 제외.
- [ ] **Step 2:** `node --test weight/tests/` → 새 테스트 FAIL
- [ ] **Step 3:** 구현 (피어슨 r, 최소제곱)
- [ ] **Step 4:** `node --test weight/tests/` → PASS
- [ ] **Step 5:** 커밋 `feat(weight): correlation, BMI and age`

### Task 3: core.js — 투약 비교와 임상 데이터

**Files:**
- Modify: `weight/core.js`
- Test: `weight/tests/core.glp1.test.js`

**Interfaces:**
- Consumes: `dn`, `series`
- Produces:
  - `CLINICAL: {wegovy:{weeks:68, source:string, arms:Arm[]}, mounjaro:{weeks:72, source:string, arms:Arm[]}}`, `Arm = {key, label, color, pts:[week,pct][]}`
    - wegovy arms: `sema24`('위고비 2.4mg'), `placebo`('위약')
    - mounjaro arms: `tirz15`('마운자로 15mg (고용량)'), `tirz5`('마운자로 5mg (저용량)'), `placebo`('위약')
  - `interp(pts, week) -> number|null` (선형 보간, 0 미만·마지막 주차 초과는 null)
  - `baseline(records, startIso) -> {d, weight}|null` (시작일, 없으면 이전 14일 내 최근)
  - `glp1Series(records, startIso, todayIso) -> {status:'ok'|'noBaseline'|'future'|'noData', base, points:{d, week, pct, weight}[]}`

- [ ] **Step 1: 임상 데이터 조사** — STEP 1(Wilding 2021 NEJM, 치료정책 추정치)과 SURMOUNT-1(Jastreboff 2022 NEJM, 치료 방침 추정치)의 주차별 평균 변화율을 논문·보충자료·FDA 허가문서(Wegovy, Zepbound 라벨)에서 찾는다. 최소 0주와 4주 간격 수준의 점을 확보하고, 마지막 점은 반드시 본문 최종값: sema24 `[68,-14.9]`, placebo `[68,-2.4]` / tirz15 `[72,-20.9]`, tirz5 `[72,-15.0]`, placebo `[72,-3.1]`. 읽은 출처(문서명·그림 번호)와 "근사값" 주석을 `source`와 코드 주석에 남긴다. 중간값을 찾지 못하면 그 사실을 보고하고 본문에 나온 시점 값만 쓴다.
- [ ] **Step 2: 테스트 작성**: 각 arm의 첫 점 `[0,0]`, 마지막 점이 위 최종값; `interp([[0,0],[4,-2]],2)===-1`, `interp(pts,-1)===null`, `interp(pts,999)===null`; `baseline`은 시작일 기록 우선, 없으면 13일 전 기록 사용, 15일 전만 있으면 `null`; 시작일이 오늘 이후면 `status:'future'`; 기준은 있으나 이후 기록이 없으면 `'noData'`(Review Focus 4); 정상 케이스 85.1→77.4 at 57일 → `pct ≈ -9.05`, `week ≈ 8.14`.
- [ ] **Step 3:** `node --test weight/tests/` → FAIL
- [ ] **Step 4:** 구현
- [ ] **Step 5:** `node --test weight/tests/` → PASS
- [ ] **Step 6:** 커밋 `feat(weight): GLP-1 comparison and clinical reference data`

### Task 4: core.js — .databody 불러오기/내보내기

**Files:**
- Modify: `weight/core.js`
- Test: `weight/tests/core.databody.test.js`
- Scratch(커밋 금지): `$SCRATCH/check-real.mjs`

**Interfaces:**
- Produces:
  - `splitMemo(memo) -> {waist:number|null, memo:string}` (규칙: 스펙 6.2 표)
  - `joinMemo(waist, memo) -> string|null` (스펙 6.3)
  - `parseDatabody(obj) -> {records, profile, stats:{weights, waists, memos, skipped, dupDropped}}` (형식 불일치 시 `throw new Error('databody 형식이 아닙니다')`)
  - `mergeRecords(existing, incoming, mode:'merge'|'replace') -> records` (merge: 칸별, 파일 값이 non-null일 때만 덮어씀)
  - `buildDatabody(records, profile, nowMs) -> object`
  - `gunzipToText(bytes: Uint8Array) -> Promise<string>`, `gzipText(text) -> Promise<Uint8Array>`
  - `newId() -> string` (`crypto.randomUUID()`)

- [ ] **Step 1: 테스트 작성** (합성 데이터):
  - `splitMemo('81')` → `{waist:81, memo:''}`; `'79.5'` → 79.5; `'81.0 / 혼술'` → `{waist:81, memo:'혼술'}`; `'77 5'` → `{waist:null, memo:'77 5'}`; `'혼술'` → memo 유지; `'200'`(범위 밖) → memo 유지
  - `joinMemo(81,'')==='81.0'`, `joinMemo(81,'혼술')==='81.0 / 혼술'`, `joinMemo(null,'혼술')==='혼술'`, `joinMemo(null,'')===null`
  - `parseDatabody`: `weightInKg:null`+memo `'81'` → `{weight:null, waist:81}`; 셋 다 없는 항목은 `skipped`; 같은 날짜 2건 → `updatedAt` 큰 쪽, `dupDropped:1`; `settings.height_cm:'171.0'`→`heightCm:171`, `gender:'male'`→`sex:'male'`, `birth_date` 복사; 식단 등 무시; `{}`나 `{app:'x'}` → throw (Review Focus 5)
  - `mergeRecords`: 기존 `{date:d, weight:77, waist:81}` + 파일 `{date:d, weight:76, waist:null}` → `{weight:76, waist:81}`; replace는 파일만 남김
  - 왕복: 합성 기록 5건(체중만/허리만/둘 다/메모 포함/텍스트 메모) → `buildDatabody` → `gzipText(JSON)` → `gunzipToText` → `parseDatabody` → 원래와 동일(`id` 포함)
  - `buildDatabody` 항목 필드: `unit` 체중 없으면 `null`, `timestamp === Date.UTC(y,m-1,d) - 9*3600e3`, `timeZoneId:'Asia/Seoul'`, 최상위 빈 배열 키 `diets, exercises, metricRecords, habitRecords, water, dailyActivities, metricDefinitions, habitDefinitions, nutrientDefinitions, foodLibrary, exerciseLibrary`
- [ ] **Step 2:** `node --test weight/tests/` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** `node --test weight/tests/` → PASS
- [ ] **Step 5: 실제 파일 확인** — 스크래치 스크립트로 업로드된 백업을 gunzip → `parseDatabody` → 기대값: 기간 `2020-05-05`~`2026-11-26`, weights 1654, waists 320, `dupDropped 0`; 내보내기 후 재불러오기 결과가 동일한지 비교. 출력만 확인하고 파일은 커밋하지 않는다.
- [ ] **Step 6:** 커밋 `feat(weight): databody import and export`

### Task 5: 앱 골격 — 저장·탭·홈·기록·내 정보·백업 화면

**Files:**
- Create: `weight/index.html`
- Scratch(커밋 금지): `$SCRATCH/smoke.mjs` (Playwright)

**Interfaces:**
- Consumes: Task 1–4의 `WTCore` 전부
- Produces (index.html 내부, Task 6·7이 사용): `state = {records, profile}`, `load()`, `save()`, `render()`(현재 탭 다시 그림), 탭 전환 함수 `show(tab: 'home'|'log'|'chart'|'glp'|'me')`, 차트 영역 컨테이너 `#chartView`, `#glpView`

- [ ] **Step 1:** 스모크 스크립트 작성: `python3 -m http.server 8765`(Project1 루트)로 띄우고 Playwright `devices['Pixel 7']`로 `/weight/` 열기 → (a) 빈 상태에서 5개 탭 순회하며 `pageerror` 0건, "기록이 없습니다" 표시 (b) 홈에서 체중 `76,9` 저장 → 기록 탭 첫 행 `76.9` (c) 체중 `500` → 저장 안 되고 안내 표시 (d) 메모에 `81`만 입력 → "허리둘레 칸에 입력하세요" 안내 (e) 각 탭 스크린샷 저장
- [ ] **Step 2:** 실행 → FAIL (파일 없음)
- [ ] **Step 3:** `index.html` 구현: 스펙 5.1(홈), 5.2(기록 목록·수정·삭제), 5.5(내 정보: 키·생년월일·성별, BMI·분류·나이, 투약 토글·약 선택·시작일, 불러오기[합치기/교체 확인]·내보내기·기존 앱 호환 안내), 하단 탭 5개(투약 비교는 토글 ON일 때만), 첫 실행 시 `navigator.storage?.persist?.()`. 불러오기 실패 시 기존 데이터 유지·오류 안내, 성공 시 건수 안내. 차트·투약 탭은 이 단계에서 자리만 둔다. `frontend-design` 스킬을 적용한다.
- [ ] **Step 4:** 스모크 실행 → PASS, 스크린샷 확인
- [ ] **Step 5:** 커밋 `feat(weight): app shell with entry, log, profile and backup`

### Task 6: 차트 탭 — 일간·주간·월간·상관

**Files:**
- Modify: `weight/index.html`
- Scratch: `$SCRATCH/smoke.mjs`에 차트 검사 추가

**Interfaces:**
- Consumes: `series, rolling, weekly, monthly, sma, pairs, linreg`; `cycle/index.html`의 `TimeZoom`(256–340행 부근)을 이식하고 `clamp`의 최소 폭을 옵션 `minSpan`(일간 10일, 주간 56일, 월간 180일)으로 바꾼다.

- [ ] **Step 1:** 스모크 확장: 합성 400일 데이터를 `localStorage`에 주입 → (a) 일간·주간·월간·상관 각 스크린샷, `pageerror` 0 (b) 일간에서 CDP `Input.dispatchTouchEvent`로 두 손가락 벌리기 → 축 첫·끝 날짜 라벨 간격이 줄어듦 (c) 두 번 탭 → 처음 기간 복귀 (d) 체중/허리둘레 전환 시 세로축 범위 바뀜 (e) 상관 화면에 `r =`, 기울기 `cm/kg`, 점 개수 표시
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현: 스펙 5.3 표 그대로(일간+7일, 주간+5주·20주, 월간+5개월·20개월), 기본 기간(일간 최근 90일, 주간 최근 365일, 월간 전체), 세로축 보이는 구간 자동 맞춤, 탭 시 값 표시. 상관: 가로 체중·세로 허리둘레, 날짜 색 그라데이션, 회귀선, 전체/최근 1년 버튼, 점 탭 시 날짜·값.
- [ ] **Step 4:** 실행 → PASS, 스크린샷 확인
- [ ] **Step 5:** 커밋 `feat(weight): trend charts with pinch zoom and correlation plot`

### Task 7: 투약 비교 탭

**Files:**
- Modify: `weight/index.html`

**Interfaces:**
- Consumes: `CLINICAL, interp, glp1Series`, Task 6의 SVG 그리기 도구

- [ ] **Step 1:** 스모크 확장: 위고비·시작일 2026-09-27·합성 데이터 → 카드 3장(나/위고비 2.4mg/위약), 범례 3개; 마운자로 → 카드 4장(나/15mg/5mg/위약); "전체 기간"↔"내 구간 확대" 전환 시 가로축 끝 라벨 변경; 시작일을 미래로 → 안내 문구만, `pageerror` 0
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현: 스펙 5.4(카드, 곡선, 보기 전환, 안내 문구 원문 그대로)
- [ ] **Step 4:** 실행 → PASS, 스크린샷 확인
- [ ] **Step 5:** 커밋 `feat(weight): GLP-1 clinical comparison view`

### Task 8: 설치·오프라인·문서

**Files:**
- Create: `weight/manifest.json`, `weight/sw.js`, `weight/icons/icon-192.png`, `weight/icons/icon-512.png`, `weight/icons/maskable-512.png`, `weight/README.md`
- Modify: `weight/index.html` (manifest 링크, SW 등록)

- [ ] **Step 1:** 스모크 확장: SW 등록 후 `context.setOffline(true)` → 새로고침해도 홈 표시; `manifest.json`의 `start_url`·`scope`가 `./`, `display:'standalone'`
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현: `sw.js`는 `cycle/sw.js` 방식(캐시 이름 `weight-tracker-v1`, 자산 목록에 `core.js` 포함). 아이콘은 스크립트로 생성(Playwright로 SVG 렌더 → PNG). README: 기능, 데이터는 폰에만 저장, 설치 방법, 백업, 임상 비교는 참고용.
- [ ] **Step 4:** 실행 → PASS
- [ ] **Step 5:** `node --test weight/tests/` 전체 PASS 확인 후 커밋 `feat(weight): PWA install, offline and README`
- [ ] **Step 6:** 브랜치 푸시. 사용자에게 PR 생성 여부를 묻고, 병합 후 할 일(Settings → Pages: `main` / root 활성화, 폰 설치, 내보낸 파일을 기존 앱에서 열어 보기)을 안내한다.
