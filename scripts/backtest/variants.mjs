import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(new URL('../../.cache/backtest/rows.json', import.meta.url)));
const PTS = { 強: 3, 中: 2, 弱: 1 };
const actualOf = (pct, band) => (pct >= band ? 1 : pct <= -band ? -1 : 0);
// 與 scoring.mjs 相同的公式，可指定納入哪些因子與權重
function verdict(r, keys, w = {}, th = 0.12) {
  let score = 0, max = 0;
  for (const k of keys) {
    const s = r.sig[k];
    if (s == null) continue;
    const wk = w[k] ?? 1;
    max += 3 * wk;
    if (s !== 0) score += s * (PTS[r.str[k]] ?? 0) * wk;
  }
  const ratio = max ? score / max : 0;
  return ratio >= th ? 1 : ratio <= -th ? -1 : 0;
}
const ALL = Object.keys(rows[0].sig);
const OVER = ['txf', 'us_market', 'adr', 'asia', 'fx'];
const V = {
  '現行（全部因子）': [ALL],
  '只用隔夜因子': [OVER],
  '隔夜＋外資＋自營＋量能': [[...OVER, 'foreign', 'dealer', 'volume']],
  '隔夜×2＋外資＋自營＋量能': [[...OVER, 'foreign', 'dealer', 'volume'], { txf: 2, us_market: 2, adr: 2 }],
  '全部因子，隔夜×2': [ALL, { txf: 2, us_market: 2, adr: 2 }],
  '全部，但移除期貨未平倉（水位）': [ALL.filter((k) => k !== 'futures_oi')],
  '全部，移除無效因子（K線、均線、動能、投信、融資、營收、期貨未平倉）': [ALL.filter((k) => !['kline', 'ma', 'momentum', 'trust', 'margin', 'revenue', 'futures_oi'].includes(k))],
};
const split = [['前段 2023-11～2025-10', (r) => r.t < '2025-11'], ['後段 2025-11～2026-11（驗證）', (r) => r.t >= '2025-11'], ['全部', () => true]];
console.log('變體 | ' + split.map((s) => s[0]).join(' | ') + '  （收盤命中／開盤命中）');
for (const [name, [keys, w]] of Object.entries(V)) {
  const cells = split.map(([, f]) => {
    const xs = rows.filter(f);
    const c = xs.filter((r) => verdict(r, keys, w) === actualOf(r.closePct, r.band)).length;
    const o = xs.filter((r) => verdict(r, keys.filter((k) => OVER.includes(k)), w) === actualOf(r.openPct, r.oband)).length;
    return `${((c / xs.length) * 100).toFixed(1)}% / ${((o / xs.length) * 100).toFixed(1)}%`;
  });
  console.log(name, '|', cells.join(' | '));
}
// 期貨未平倉：水位 vs 變化
const oiRows = rows.filter((r) => r.raw.oi != null);
const byDate = {};
for (const r of oiRows) byDate[r.b] = r.raw.oi;
const dates = Object.keys(byDate).sort();
const prevOi = Object.fromEntries(dates.map((d, i) => [d, i ? byDate[dates[i - 1]] : null]));
const chg = oiRows.filter((r) => prevOi[r.b] != null).map((r) => ({ d: r.raw.oi - prevOi[r.b], c: r.closePct, o: r.openPct }));
const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
for (const th of [3000, 5000, 10000]) {
  const up = chg.filter((x) => x.d >= th), dn = chg.filter((x) => x.d <= -th);
  console.log(`外資期貨淨部位單日變化 ≥ ${th} 口：n ${up.length} 隔日收盤 ${avg(up.map((x) => x.c)).toFixed(2)}%｜≤ −${th}：n ${dn.length} 隔日收盤 ${avg(dn.map((x) => x.c)).toFixed(2)}%`);
}
console.log('外資期貨淨部位水位範圍', Math.min(...dates.map((d) => byDate[d])), '～', Math.max(...dates.map((d) => byDate[d])));
