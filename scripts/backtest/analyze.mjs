import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(new URL('../../.cache/backtest/rows.json', import.meta.url)));
const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const avg = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const f2 = (x) => (Number.isNaN(x) ? '—' : (x > 0 ? '+' : '') + x.toFixed(2));
const actualOf = (pct, band) => (pct >= band ? 1 : pct <= -band ? -1 : 0);
const V = { 偏多: 1, 偏空: -1, 盤整: 0 };

console.log('== 0. 11/12 抽查');
for (const r of rows.filter((r) => r.t === '2026-11-12')) console.log(r.code, r.verdict, r.openVerdict, 'open', r.openPct, 'close', r.closePct, JSON.stringify(r.raw));

console.log('\n== 1. 整體命中率（三年，6 檔）');
const hit = (xs, k) => xs.filter((r) => r[k].hit).length;
console.log('收盤', pc(hit(rows, 'close'), rows.length), '｜開盤', pc(hit(rows, 'open'), rows.length), '｜n', rows.length);
const dist = (k, bandK, pctK) => { const d = { 1: 0, 0: 0, '-1': 0 }; for (const r of rows) d[actualOf(r[pctK], r[bandK])]++; return d; };
const dc = dist('close', 'band', 'closePct'), dop = dist('open', 'oband', 'openPct');
console.log('實際收盤分布 多/盤/空', pc(dc[1], rows.length), pc(dc[0], rows.length), pc(dc[-1], rows.length));
console.log('實際開盤分布 高/平/低', pc(dop[1], rows.length), pc(dop[0], rows.length), pc(dop[-1], rows.length));
for (const y of ['2023-11', '2024', '2025', '2026']) {
  const xs = rows.filter((r) => (y === '2023-11' ? r.t < '2024' : r.t.startsWith(y)));
  console.log(' ', y, '收盤', pc(hit(xs, 'close'), xs.length), '開盤', pc(hit(xs, 'open'), xs.length), 'n', xs.length);
}
console.log('\n預測分布與各自命中（收盤）');
for (const v of ['偏多', '盤整', '偏空']) { const xs = rows.filter((r) => r.verdict === v); console.log(' ', v, 'n', xs.length, '命中', pc(hit(xs, 'close'), xs.length), '平均收盤', f2(avg(xs.map((r) => r.closePct)))); }
console.log('預測分布與各自命中（開盤）');
for (const v of ['偏多', '盤整', '偏空']) { const xs = rows.filter((r) => r.openVerdict === v); console.log(' ', v, 'n', xs.length, '命中', pc(hit(xs, 'open'), xs.length), '平均開盤', f2(avg(xs.map((r) => r.openPct)))); }
console.log('依信心度（收盤）');
for (const [lo, hi] of [[50, 55], [55, 60], [60, 65], [65, 90]]) { const xs = rows.filter((r) => r.conf >= lo && r.conf < hi); console.log(' ', `${lo}-${hi}`, 'n', xs.length, pc(hit(xs, 'close'), xs.length)); }

console.log('\n== 2. 各因子：訊號偏多 vs 偏空時，隔日平均漲跌（%）與方向正確率');
console.log('因子 | 偏多 n | 偏多時收盤 | 偏空 n | 偏空時收盤 | 收盤差 | 收盤方向對 | 偏多時開盤 | 偏空時開盤 | 開盤差 | 開盤方向對');
const keys = Object.keys(rows[0].sig);
for (const k of keys) {
  const bull = rows.filter((r) => r.sig[k] === 1), bear = rows.filter((r) => r.sig[k] === -1);
  const dirOk = (xs, pk) => xs.filter((r) => Math.sign(r[pk]) === r.sig[k]).length;
  const cBull = avg(bull.map((r) => r.closePct)), cBear = avg(bear.map((r) => r.closePct));
  const oBull = avg(bull.map((r) => r.openPct)), oBear = avg(bear.map((r) => r.openPct));
  console.log([k, bull.length, f2(cBull), bear.length, f2(cBear), f2(cBull - cBear), pc(dirOk([...bull, ...bear], 'closePct'), bull.length + bear.length), f2(oBull), f2(oBear), f2(oBull - oBear), pc(dirOk([...bull, ...bear], 'openPct'), bull.length + bear.length)].join(' | '));
}

console.log('\n== 3. 開盤 vs 收盤：開盤跳空之後，盤中延續還是回吐？');
const gapUp = rows.filter((r) => r.openPct >= r.oband), gapDn = rows.filter((r) => r.openPct <= -r.oband);
const intraday = (r) => r.closePct - r.openPct;
console.log('開高 n', gapUp.length, '平均開盤', f2(avg(gapUp.map((r) => r.openPct))), '開盤→收盤', f2(avg(gapUp.map(intraday))), '收盤低於開盤比例', pc(gapUp.filter((r) => intraday(r) < 0).length, gapUp.length));
console.log('開低 n', gapDn.length, '平均開盤', f2(avg(gapDn.map((r) => r.openPct))), '開盤→收盤', f2(avg(gapDn.map(intraday))), '收盤高於開盤比例', pc(gapDn.filter((r) => intraday(r) > 0).length, gapDn.length));

console.log('\n== 4. 類似 11/12 的盤況');
const show = (label, xs) => {
  if (!xs.length) return console.log(label, '無');
  const ca = xs.map((r) => actualOf(r.closePct, r.band)), oa = xs.map((r) => actualOf(r.openPct, r.oband));
  console.log(label, 'n', xs.length,
    '｜開盤 高/平/低', pc(oa.filter((x) => x === 1).length, xs.length), pc(oa.filter((x) => x === 0).length, xs.length), pc(oa.filter((x) => x === -1).length, xs.length), '平均', f2(avg(xs.map((r) => r.openPct))),
    '｜收盤 多/盤/空', pc(ca.filter((x) => x === 1).length, xs.length), pc(ca.filter((x) => x === 0).length, xs.length), pc(ca.filter((x) => x === -1).length, xs.length), '平均', f2(avg(xs.map((r) => r.closePct))),
    '｜開盤→收盤', f2(avg(xs.map(intraday))));
};
const tech = rows.filter((r) => ['2330', '2454', '2308', '3711'].includes(r.code));
show('A 費半 ≥ +3%（全部）', rows.filter((r) => r.raw.sox >= 3));
show('B 費半 ≥ +3% 且前一日個股已漲 ≥ 2%', rows.filter((r) => r.raw.sox >= 3 && r.prevPct >= 2));
show('C 費半 ≥ +3% 且前一日個股漲 < 2%', rows.filter((r) => r.raw.sox >= 3 && r.prevPct < 2));
show('D 夜盤 ≥ +1% 且前一日個股已漲 ≥ 2%', rows.filter((r) => r.raw.night >= 1 && r.prevPct >= 2));
show('E 夜盤 ≥ +1%（全部）', rows.filter((r) => r.raw.night >= 1));
show('F 夜盤 ≤ −1%（全部）', rows.filter((r) => r.raw.night <= -1));
show('G 前一日個股漲 ≥ 2%（不論美股）', rows.filter((r) => r.prevPct >= 2));
show('H 前一日個股跌 ≤ −2%', rows.filter((r) => r.prevPct <= -2));
console.log('B 的日期：', [...new Set(rows.filter((r) => r.raw.sox >= 3 && r.prevPct >= 2).map((r) => r.t))].join(', '));

console.log('\n== 5. 夜盤漲跌 vs 隔日開盤（夜盤是否就是開盤的答案）');
const withN = rows.filter((r) => r.raw.night != null);
const corr = (xs, ys) => { const mx = avg(xs), my = avg(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
console.log('相關係數 夜盤→開盤', corr(withN.map((r) => r.raw.night), withN.map((r) => r.openPct)).toFixed(3), '夜盤→收盤', corr(withN.map((r) => r.raw.night), withN.map((r) => r.closePct)).toFixed(3), 'n', withN.length);
const wS = rows.filter((r) => r.raw.sox != null && r.raw.soxDate >= r.b);
console.log('相關係數 費半→開盤', corr(wS.map((r) => r.raw.sox), wS.map((r) => r.openPct)).toFixed(3), '費半→收盤', corr(wS.map((r) => r.raw.sox), wS.map((r) => r.closePct)).toFixed(3));
const wA = rows.filter((r) => r.raw.adr != null && r.code === '2330');
console.log('相關係數 台積電ADR→開盤', corr(wA.map((r) => r.raw.adr), wA.map((r) => r.openPct)).toFixed(3), '→收盤', corr(wA.map((r) => r.raw.adr), wA.map((r) => r.closePct)).toFixed(3));
const wP = rows.filter((r) => r.prevPct != null);
console.log('相關係數 前一日漲跌→開盤', corr(wP.map((r) => r.prevPct), wP.map((r) => r.openPct)).toFixed(3), '→收盤', corr(wP.map((r) => r.prevPct), wP.map((r) => r.closePct)).toFixed(3), '→盤中（開到收）', corr(wP.map((r) => r.prevPct), wP.map(intraday)).toFixed(3));
console.log('相關係數 夜盤→盤中（開到收）', corr(withN.map((r) => r.raw.night), withN.map(intraday)).toFixed(3));
