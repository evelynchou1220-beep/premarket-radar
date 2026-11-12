// 三年回測：每個交易日 t，用 t 前一個交易日 b（含）以前的資料，重建「05:40 正式版快照」，
// 直接呼叫網站真正的 buildHints / programScore / openScore / flatBand / judge，再用 t 的實際開盤、收盤對答案。
// 輸出 rows.json（每筆預測）供 analyze.mjs 分析。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const P = new URL('../../', import.meta.url).href;
const { buildHints } = await import(P + 'scripts/lib/hints.mjs');
const { programScore, openScore, flatBand, judge } = await import(P + 'src/lib/scoring.mjs');
// 預設用「現在的公式」回測每一天；要看舊公式（所有因子都計分），設環境變數 FORMULA_TARGET=2026-01-01
const FORMULA_TARGET = process.env.FORMULA_TARGET ?? '2099-01-01';
const { computeIndicators } = await import(P + 'scripts/lib/indicators.mjs');
const C = (n) => JSON.parse(readFileSync(new URL(`../../.cache/backtest/${n}.json`, import.meta.url)));

// ASX（日月光 ADR）補抓
if (!existsSync(new URL('../../.cache/backtest/y-asx.json', import.meta.url))) {
  const j = await (await fetch('https://query1.finance.yahoo.com/v8/finance/chart/ASX?range=5y&interval=1d', { headers: { 'user-agent': 'Mozilla/5.0' } })).json();
  const r = j.chart.result[0], q = r.indicators.quote[0];
  writeFileSync(new URL('../../.cache/backtest/y-asx.json', import.meta.url), JSON.stringify(r.timestamp.map((t, i) => ({ date: new Date((t + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10), close: q.close[i] })).filter((x) => x.close != null)));
}

const STOCKS = { 2330: '台積電', 2454: '聯發科', 2317: '鴻海', 2308: '台達電', 3711: '日月光投控', 1303: '南亞' };
const ADR = { 2330: ['tsm', '台積電 ADR'], 3711: ['asx', '日月光投控 ADR'] };
const isTech = Object.fromEntries(Object.keys(STOCKS).map((c) => [c, JSON.parse(readFileSync(new URL(`../../data/snapshots/2026-11-12/${c}.json`, import.meta.url))).meta.isTech]));
const FROM = '2023-11-13';

// 國際序列：取日期 ≤ lim 的最新一筆，附漲跌幅
const Y = Object.fromEntries(['sox', 'nasdaq', 'sp500', 'nikkei', 'kospi', 'usdtwd', 'tsm', 'asx'].map((k) => [k, C('y-' + k)]));
function latest(series, lim) {
  let lo = 0, hi = series.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (series[m].date <= lim) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx < 1) return null;
  const x = series[idx], p = series[idx - 1];
  return { date: x.date, close: +x.close.toFixed(2), prevClose: p.close, changePct: +(((x.close - p.close) / p.close) * 100).toFixed(2) };
}
const dayBefore = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// 台指期：夜盤（FinMind after_market 日期＝夜盤結束的那天早上，也就是 t）與日盤（position，日期 b）
const txf = C('txf');
const txNight = {}, txDay = {};
for (const r of txf) {
  const m = r.trading_session === 'after_market' ? txNight : txDay;
  if (!m[r.date] || r.volume > m[r.date].volume) m[r.date] = r; // 成交量最大的合約＝近月
}
const txByKey = Object.fromEntries(txf.filter((r) => r.trading_session === 'position').map((r) => [`${r.date}|${r.contract_date}`, r]));
const oi = {};
for (const r of C('txoi')) if (r.institutional_investors === '外資') oi[r.date] = r.long_open_interest_balance_volume - r.short_open_interest_balance_volume;

const out = [];
for (const code of Object.keys(STOCKS)) {
  const daily = C('price-' + code).filter((r) => r.Trading_Volume > 0).map((r) => ({ date: r.date, open: r.open, high: r.max, low: r.min, close: r.close, volume: r.Trading_Volume }));
  const instBy = {};
  for (const r of C('inst-' + code)) {
    const o = (instBy[r.date] ??= { date: r.date, foreign: 0, trust: 0, dealerSelf: 0, dealerHedge: 0 });
    const v = Math.round((r.buy - r.sell) / 1000);
    if (r.name === 'Foreign_Investor') o.foreign += v;
    else if (r.name === 'Investment_Trust') o.trust += v;
    else if (r.name === 'Dealer_self') o.dealerSelf += v;
    else if (r.name === 'Dealer_Hedging') o.dealerHedge += v;
  }
  const inst = Object.values(instBy).sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ ...x, dealer: x.dealerSelf + x.dealerHedge }));
  const marginBy = Object.fromEntries(C('margin-' + code).map((r) => [r.date, { date: r.date, marginToday: r.MarginPurchaseTodayBalance, marginPrev: r.MarginPurchaseYesterdayBalance, shortToday: r.ShortSaleTodayBalance }]));
  const rev = C('rev-' + code).map((r) => ({ ...r, ym: `${r.revenue_year}-${String(r.revenue_month).padStart(2, '0')}` }));
  const revBy = Object.fromEntries(rev.map((r) => [r.ym, r]));

  for (let i = 1; i < daily.length; i++) {
    const t = daily[i].date, b = daily[i - 1].date;
    if (t < FROM) continue;
    const hist = daily.slice(Math.max(0, i - 260), i); // b（含）以前
    if (hist.length < 80) continue;
    const lim = dayBefore(t);
    // 月營收：最新一筆「公布日 ≤ b」（公布日用 create_time，缺時用次月 10 日）
    const pub = rev.filter((r) => (r.create_time || `${r.date.slice(0, 8)}10`) <= b).at(-1);
    let revenue = null;
    if (pub) {
      const [yy, mm] = pub.ym.split('-').map(Number);
      const ly = revBy[`${yy - 1}-${String(mm).padStart(2, '0')}`];
      const pm = revBy[mm === 1 ? `${yy - 1}-12` : `${yy}-${String(mm - 1).padStart(2, '0')}`];
      const nm = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, '0')}`;
      if (ly) revenue = { month: pub.ym, revenue: pub.revenue / 1000, yoyPct: +(((pub.revenue - ly.revenue) / ly.revenue) * 100).toFixed(2), momPct: pm ? +(((pub.revenue - pm.revenue) / pm.revenue) * 100).toFixed(2) : 0, deadline: `${nm}-10` };
    }
    const night = txNight[t];
    const dayRow = night && txByKey[`${b}|${night.contract_date}`];
    const txfObj = night && dayRow ? { contract: '台指期', day: { close: dayRow.close, changePct: 0 }, night: { close: night.close, ref: dayRow.close, session: t, changePct: +(((night.close - dayRow.close) / dayRow.close) * 100).toFixed(2) } } : null;
    const g = { sox: latest(Y.sox, lim), nasdaq: latest(Y.nasdaq, lim), sp500: latest(Y.sp500, lim), nikkei: latest(Y.nikkei, lim), kospi: latest(Y.kospi, lim), usdtwd: latest(Y.usdtwd, lim) };
    const adrSer = ADR[code];
    const adr = adrSer ? { ...latest(Y[adrSer[0]], lim), name: adrSer[1], symbol: adrSer[0].toUpperCase() } : null;
    const s = {
      meta: { code, basedOn: b, isTech: isTech[code] },
      daily: hist, indicators: computeIndicators(hist),
      institutional: inst.filter((x) => x.date <= b).slice(-10),
      margin: marginBy[b] ?? null, revenue,
      market: { txf: txfObj, foreignFuturesOI: oi[b] != null ? { net: oi[b], date: b } : null },
      global: g, adr,
    };
    const hints = buildHints(s);
    const factors = Object.entries(hints).map(([key, h]) => ({ key, ...h }));
    const prog = programScore(hints, FORMULA_TARGET), op = openScore(factors);
    const band = flatBand(hist, 'close'), oband = flatBand(hist, 'open');
    const bc = hist.at(-1).close, a = daily[i];
    const closePct = ((a.close - bc) / bc) * 100, openPct = ((a.open - bc) / bc) * 100;
    out.push({
      code, t, b, band, oband, closePct: +closePct.toFixed(3), openPct: +openPct.toFixed(3),
      prevPct: s.indicators.changePct,
      verdict: prog.verdict, ratio: prog.ratio, conf: prog.confidence, close: judge(prog.verdict, closePct, band),
      openVerdict: op.verdict, openRatio: op.ratio, open: judge(op.verdict, openPct, oband),
      sig: Object.fromEntries(factors.map((f) => [f.key, f.signal === '偏多' ? 1 : f.signal === '偏空' ? -1 : f.signal === '缺漏' ? null : 0])),
      str: Object.fromEntries(factors.map((f) => [f.key, f.strength])),
      raw: { sox: g.sox?.changePct, soxDate: g.sox?.date, adr: adr?.changePct, night: txfObj?.night.changePct, oi: oi[b] ?? null, fx: g.usdtwd ? -g.usdtwd.changePct : null },
    });
  }
}
writeFileSync(new URL('../../.cache/backtest/rows.json', import.meta.url), JSON.stringify(out));
console.log('rows', out.length, 'from', out.map((r) => r.t).sort()[0], 'to', out.map((r) => r.t).sort().at(-1));
