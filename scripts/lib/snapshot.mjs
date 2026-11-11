// 盤前資料抓取的核心：fetchSnapshot(code, { target })
// 產出 data/snapshots/<target>/<code>.json，內含走勢圖資料、指標、法人、期貨、國際行情與因子建議判定（hints）。
// 這支程式只負責「數字」；新聞類因子由 AI 依 CLAUDE.md §4 搜尋後填寫。
// 被 scripts/fetch.mjs（手動）與 scripts/daily.mjs（排程）共用。
import { mkdir, writeFile } from 'node:fs/promises';
import { getJSON, num, tpeDate, tpeTime, ymd, round, sleep } from './http.mjs';
import { ADR, GLOBAL } from './symbols.mjs';
import { computeIndicators } from './indicators.mjs';
import { buildHints } from './hints.mjs';
import { loadCalendar, nextTradingDay, closedDaysBetween } from './calendar.mjs';

const log = (...m) => console.log('  ·', ...m);

/** 同一次執行中多檔股票共用的大盤資料，只抓一次 */
const shared = new Map();
const once = (key, fn) => {
  if (!shared.has(key)) shared.set(key, fn());
  return shared.get(key);
};

// ---------- Yahoo Finance ----------
async function yahooChart(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const j = await getJSON(url);
  const r = j.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo 無資料：${symbol}`);
  const q = r.indicators.quote[0];
  const rows = r.timestamp.map((t, i) => ({
    ts: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0,
  })).filter((x) => x.close != null && x.open != null);
  return { meta: r.meta, rows };
}

async function yahooQuote(symbol) {
  const { meta, rows } = await yahooChart(symbol, '10d', '1d');
  const last = rows.at(-1), prev = rows.at(-2);
  return {
    symbol, date: tpeDate(last.ts - 8 * 3600 + (meta.gmtoffset ?? 0)), // 以交易所當地日期表示
    close: round(last.close), prevClose: round(prev.close),
    changePct: round(((last.close - prev.close) / prev.close) * 100),
  };
}

// ---------- 證交所 ----------
async function twseName(c) {
  const d = new Date();
  const j = await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${d.toISOString().slice(0, 8).replaceAll('-', '')}01&stockNo=${c}&response=json`);
  if (j.stat !== 'OK') throw new Error(`證交所查無 ${c}（目前僅支援上市股票）`);
  return j.title.replace(/^.*?\d{4,6}\s+/, '').replace(/\s+各日成交資訊.*$/, '').trim();
}

/** 證交所官方日成交資料，往回抓 months 個月。民國日期 115/11/09 → 2026-11-09 */
async function twseDaily(c, months) {
  const now = new Date();
  const rows = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const ym = d.toISOString().slice(0, 7).replace('-', '');
    const j = await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ym}01&stockNo=${c}&response=json`, { delay: 1000 });
    if (j.stat !== 'OK') continue;
    for (const r of j.data) {
      const [y, m, dd] = r[0].split('/');
      const open = num(r[3]);
      if (!open) continue; // 暫停交易日
      rows.push({
        date: `${Number(y) + 1911}-${m}-${dd}`,
        open, high: num(r[4]), low: num(r[5]), close: num(r[6]), volume: num(r[1]),
      });
    }
  }
  if (rows.length < 20) throw new Error('資料不足 20 日');
  return rows;
}

async function twseInstitutional(c, dates) {
  const out = [];
  for (const date of dates) {
    const j = await getJSON(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd(date)}&selectType=ALLBUT0999&response=json`, { delay: 1200 });
    if (j.stat !== 'OK') continue; // 尚未公布
    const row = j.data.find((r) => r[0].trim() === c);
    if (!row) continue;
    out.push({
      date,
      foreign: round((num(row[4]) + num(row[7])) / 1000, 0),
      trust: round(num(row[10]) / 1000, 0),
      dealer: round(num(row[11]) / 1000, 0),
    });
  }
  return out;
}

async function twseMargin(c, date) {
  const j = await getJSON(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${ymd(date)}&selectType=STOCK&response=json`, { delay: 1200 });
  if (j.stat !== 'OK') return null;
  const t = j.tables.find((t) => t.fields?.[0] === '代號');
  const r = t?.data.find((r) => r[0].trim() === c);
  if (!r) return null;
  return { date, marginPrev: num(r[5]), marginToday: num(r[6]), shortPrev: num(r[11]), shortToday: num(r[12]) };
}

async function twseMarketInstitutional(date) {
  const j = await getJSON(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=${ymd(date)}&response=json`, { delay: 1200 });
  if (j.stat !== 'OK') return null;
  const get = (name) => j.data.find((r) => r[0].startsWith(name));
  const yi = (r) => round(num(r[3]) / 1e8, 1);
  const dealer = j.data.filter((r) => r[0].startsWith('自營商')).reduce((a, r) => a + num(r[3]), 0);
  return {
    date,
    foreign: yi(get('外資及陸資')),
    trust: yi(get('投信')),
    dealer: round(dealer / 1e8, 1),
    total: yi(get('合計')),
  };
}

// ---------- 期交所 ----------
async function taifexQuote(marketType) {
  let j;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://mis.taifex.com.tw/futures/api/getQuoteList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ MarketType: marketType, SymbolType: 'F', KindID: '1', CID: 'TXF', ExpireMonth: '', RowSize: '全部', PageNo: '', SortColumn: '', AscDesc: 'A' }),
        signal: AbortSignal.timeout(20000),
      });
      j = await res.json();
      break;
    } catch (e) {
      if (attempt >= 3) throw e; // 期交所偶爾逾時，最多重試 3 次
      await sleep(3000 * attempt);
    }
  }
  const q = j.RtData?.QuoteList?.find((x) => /^TXF[A-Z]\d-/.test(x.SymbolID));
  if (!q || !q.CLastPrice) return null;
  const d = q.CDate;
  return {
    session: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`,
    contract: q.DispCName,
    close: num(q.CLastPrice), ref: num(q.CRefPrice), changePct: num(q.CDiffRate),
  };
}

async function taifexForeignOI() {
  const j = await getJSON('https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate');
  const r = j.find((x) => x.ContractCode === '臺股期貨' && x.Item.startsWith('外資'));
  if (!r) return null;
  return { date: `${r.Date.slice(0, 4)}-${r.Date.slice(4, 6)}-${r.Date.slice(6)}`, net: num(r['OpenInterest(Net)']) };
}

// ---------- 主流程 ----------
/**
 * @param {string} code 股票代號
 * @param {{ target?: string }} [opts] target 預設為最後收盤日的下一個交易日（依證交所休市日曆）
 * @returns {Promise<{ snapshot: any, path: string }>}
 */
export async function fetchSnapshot(code, opts = {}) {
let target = opts.target ?? null;
const sources = [];
const warnings = [];

console.log(`\n▶ 抓取 ${code} 盤前資料`);

const cal = await loadCalendar();
if (cal.warning) warnings.push(cal.warning);

const name = await twseName(code);
log(`股票名稱：${name}`);
sources.push({ name: '證交所 STOCK_DAY（股票名稱）', url: 'https://www.twse.com.tw/' });

let daily;
try {
  daily = await twseDaily(code, 7);
  sources.push({ name: '證交所 STOCK_DAY 個股日成交資訊（7 個月）', url: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html' });
} catch (e) {
  warnings.push(`證交所日成交資料取得失敗，改用 Yahoo（成交量可能與官方不同）：${e.message}`);
  const yDaily = await yahooChart(`${code}.TW`, '6mo', '1d');
  daily = yDaily.rows.map((r) => ({
    date: tpeDate(r.ts), open: round(r.open), high: round(r.high), low: round(r.low), close: round(r.close), volume: r.volume,
  }));
  sources.push({ name: `Yahoo Finance ${code}.TW 日 K（6 個月）`, url: `https://finance.yahoo.com/quote/${code}.TW` });
}
const basedOn = daily.at(-1).date;
target ??= nextTradingDay(basedOn);
if (target <= basedOn) throw new Error(`預測日 ${target} 必須晚於最後收盤日 ${basedOn}`);
// 週一或連假後：basedOn 收盤到 target 開盤之間的休市日，新聞要涵蓋整段期間（CLAUDE.md §4 步驟 3）
const closedDays = closedDaysBetween(basedOn, target);
log(`最後收盤日：${basedOn} → 預測交易日：${target}（日 K ${daily.length} 根）${closedDays.length ? `，中間休市 ${closedDays.length} 天` : ''}`);

const yIntra = await yahooChart(`${code}.TW`, '5d', '5m');
const intraday = yIntra.rows.filter((r) => tpeDate(r.ts) === basedOn).map((r) => ({
  time: tpeTime(r.ts), ts: r.ts, open: round(r.open), high: round(r.high), low: round(r.low), close: round(r.close), volume: r.volume,
}));
log(`${basedOn} 分時資料：${intraday.length} 筆（5 分鐘）`);

let isTech = false;
try {
  const s = await getJSON(`https://query1.finance.yahoo.com/v1/finance/search?q=${code}.TW&quotesCount=1&newsCount=0`);
  isTech = s.quotes?.[0]?.sector === 'Technology';
} catch { warnings.push('無法判斷產業別，預設為非科技股'); }

const instDates = daily.slice(-10).map((d) => d.date);
const institutional = await twseInstitutional(code, instDates);
log(`三大法人：${institutional.length}/10 日`);
if (institutional.at(-1)?.date !== basedOn) warnings.push(`證交所尚未公布 ${basedOn} 三大法人（通常 16:30 後公布）`);
sources.push({ name: '證交所 T86 三大法人買賣超日報', url: 'https://www.twse.com.tw/zh/trading/foreign/t86.html' });

const margin = await twseMargin(code, basedOn);
if (!margin) warnings.push(`證交所尚未公布 ${basedOn} 融資融券`);
sources.push({ name: '證交所 MI_MARGN 融資融券彙總', url: 'https://www.twse.com.tw/zh/trading/margin/mi-margn.html' });

const marketInst = await once(`bfi-${basedOn}`, () => twseMarketInstitutional(basedOn));
sources.push({ name: '證交所 BFI82U 三大法人買賣金額', url: 'https://www.twse.com.tw/zh/trading/foreign/bfi82u.html' });

const { global, globalWarnings } = await once('global', async () => {
  const global = {}, globalWarnings = [];
  for (const g of GLOBAL) {
    try { global[g.key] = { ...(await yahooQuote(g.symbol)), label: g.label }; }
    catch (e) { globalWarnings.push(`${g.label} 取得失敗：${e.message}`); }
    await sleep(200);
  }
  return { global, globalWarnings };
});
warnings.push(...globalWarnings);
log(`國際行情：${Object.keys(global).length}/${GLOBAL.length} 項`);
sources.push({ name: 'Yahoo Finance 國際指數與匯率', url: 'https://finance.yahoo.com/' });

let adr = null;
if (ADR[code]) {
  const a = ADR[code];
  const q = await yahooQuote(a.symbol);
  const impliedTwd = round((q.close * global.usdtwd.close) / a.ratio, 1);
  adr = { ...q, name: a.name, ratio: a.ratio, impliedTwd };
  log(`ADR ${a.symbol}：${q.close}（${q.changePct}%）`);
}

let txf = null, foreignFuturesOI = null;
try {
  const [day, night] = await once('txf', async () => [await taifexQuote('0'), await taifexQuote('1')]);
  if (day) txf = { date: day.session, contract: day.contract, day, night: night && night.session >= day.session ? night : null };
  if (txf && !txf.night) warnings.push('台指期夜盤尚無最新資料（夜盤 15:00 開盤、隔日 05:00 收盤）');
} catch (e) { warnings.push(`台指期取得失敗：${e.message}`); }
try { foreignFuturesOI = await once('oi', taifexForeignOI); } catch (e) { warnings.push(`外資期貨未平倉取得失敗：${e.message}`); }
sources.push({ name: '期交所即時行情（台指期日盤／夜盤）', url: 'https://mis.taifex.com.tw/futures/' });
sources.push({ name: '期交所 OpenAPI 三大法人期貨部位', url: 'https://openapi.taifex.com.tw/' });

// 時序檢查：盤前分析必須使用「台股最後收盤之後」才產生的國際資料，否則等於拿舊消息預測。
const stale = [];
if (global.sox && global.sox.date < basedOn) stale.push(`美股（${global.sox.date}）早於台股最後收盤日 ${basedOn}`);
if (adr && adr.date < basedOn) stale.push(`ADR（${adr.date}）早於台股最後收盤日 ${basedOn}`);
if (!txf?.night) stale.push(`尚無 ${basedOn} 晚間的台指期夜盤`);
if (stale.length) warnings.push(`⏰ 時序檢查未通過：${stale.join('；')}。請在台灣時間 05:00 之後（美股收盤、夜盤結束）再執行。`);

const snapshot = {
  meta: {
    code, name, target, basedOn, closedDays, isTech, fetchedAt: new Date().toISOString(),
    // 新聞搜尋範圍：最後收盤（13:30）之後到現在，週一會涵蓋整個週末
    newsSince: `${basedOn}T13:30+08:00`,
    timingOk: stale.length === 0, stale, warnings, sources,
  },
  indicators: computeIndicators(daily),
  daily,
  intraday,
  institutional,
  margin,
  market: { institutional: marketInst, txf, foreignFuturesOI },
  global,
  adr,
};
snapshot.hints = buildHints(snapshot);

const dir = `data/snapshots/${target}`;
const path = `${dir}/${code}.json`;
await mkdir(dir, { recursive: true });
await writeFile(path, JSON.stringify(snapshot, null, 1));
return { snapshot, path };
}
