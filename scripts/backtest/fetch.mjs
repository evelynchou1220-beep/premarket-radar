// npm run backtest 第 1 步（CLAUDE.md §8.7）。快取在 .cache/backtest/（不進 git），已下載的不重抓；要更新到最新請刪除快取。
// 回測資料下載：FinMind（台股日 K、法人、融資、月營收、台指期日夜盤、期貨法人）＋ Yahoo（國際指數、匯率、ADR）
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
const DIR = new URL('../../.cache/backtest/', import.meta.url);
mkdirSync(DIR, { recursive: true });
const START = '2023-06-01', END = '2026-11-12';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 backtest' } }); if (r.ok) return r.json(); console.log('HTTP', r.status, url); }
    catch (e) { console.log('ERR', e.message); }
    await sleep(3000 * (i + 1));
  }
  throw new Error('failed ' + url);
}
const save = (name, data) => writeFileSync(new URL(name + '.json', DIR), JSON.stringify(data));
const has = (name) => existsSync(new URL(name + '.json', DIR));

const FM = 'https://api.finmindtrade.com/api/v4/data';
const fm = async (dataset, id, s = START, e = END) => (await get(`${FM}?dataset=${dataset}&data_id=${id}&start_date=${s}&end_date=${e}`)).data;
const years = [['2023-06-01', '2023-12-31'], ['2024-01-01', '2024-12-31'], ['2025-01-01', '2025-12-31'], ['2026-01-01', END]];

for (const c of ['2330', '2454', '2317', '2308', '3711', '1303']) {
  for (const [ds, key] of [['TaiwanStockPrice', 'price'], ['TaiwanStockInstitutionalInvestorsBuySell', 'inst'], ['TaiwanStockMarginPurchaseShortSale', 'margin'], ['TaiwanStockMonthRevenue', 'rev']]) {
    const name = `${key}-${c}`;
    if (has(name)) continue;
    const rows = ds === 'TaiwanStockMonthRevenue' ? await fm(ds, c, '2022-01-01') : await fm(ds, c);
    save(name, rows); console.log(name, rows.length); await sleep(800);
  }
}
for (const [ds, key] of [['TaiwanFuturesDaily', 'txf'], ['TaiwanFuturesInstitutionalInvestors', 'txoi']]) {
  if (has(key)) continue;
  let all = [];
  for (const [s, e] of years) { const rows = await fm(ds, 'TX', s, e); all = all.concat(ds === 'TaiwanFuturesDaily' ? rows.filter((r) => /^\d{6}$/.test(r.contract_date)) : rows); console.log(key, s, rows.length); await sleep(800); }
  save(key, all);
}
const Y = { sox: '^SOX', nasdaq: '^IXIC', sp500: '^GSPC', nikkei: '^N225', kospi: '^KS11', usdtwd: 'TWD=X', tsm: 'TSM', twii: '^TWII' };
for (const [k, sym] of Object.entries(Y)) {
  if (has('y-' + k)) continue;
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1d`);
  const r = j.chart.result[0], q = r.indicators.quote[0];
  const tz = r.meta.gmtoffset;
  const rows = r.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), open: q.open[i], close: q.close[i] })).filter((x) => x.close != null);
  save('y-' + k, rows); console.log(k, rows.length); await sleep(500);
}
console.log('done');
