#!/usr/bin/env node
// 盤後分析用的資料摘要：npm run recap-data [-- YYYY-MM-DD]（CLAUDE.md §7.6）
// 從 16:10 排程抓的快照、data/results.json、data/govbanks/ 整理出今天的盤後數據，印成精簡文字給雲端 AI 撰寫盤後分析。
import { readFile, readdir } from 'node:fs/promises';
import watchlist from '../src/data/watchlist.json' with { type: 'json' };
import { loadCalendar, isTradingDay, todayTpe } from './lib/calendar.mjs';

const day = process.argv[2] ?? todayTpe();
await loadCalendar();
if (!isTradingDay(day)) { console.log(`📅 ${day} 休市，不需要盤後分析。`); process.exit(2); }

// 找 basedOn = day 的快照（16:10 排程抓的，目錄名稱是下一個交易日）
const snaps = [];
for (const dir of (await readdir('data/snapshots')).sort().reverse().slice(0, 3)) {
  for (const { code } of watchlist.stocks) {
    const s = await readFile(`data/snapshots/${dir}/${code}.json`, 'utf8').then(JSON.parse, () => null);
    if (s?.meta.basedOn === day && !snaps.some((x) => x.meta.code === code)) snaps.push(s);
  }
}
if (!snaps.length) {
  console.log(`⏳ 還沒有 ${day} 的盤後數據。先執行 npm run daily -- postclose（只用來讀資料，不要 commit 快照）。`);
  process.exit(3);
}

const s0 = snaps[0];
const p = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
const n = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('en-US')}`);
const out = [];
out.push(`# ${day} 盤後數據（資料時間 ${s0.meta.fetchedAt}）`);
const t = s0.global?.taiex;
if (t?.date === day) out.push(`加權指數 ${t.close}（${p(t.changePct)}）`);
const mi = s0.market.institutional;
if (mi?.date === day) out.push(`三大法人（億元）：外資 ${mi.foreign}、投信 ${mi.trust}、自營商自行買賣 ${mi.dealerSelf}、合計 ${mi.total}`);
const tx = s0.market.txf;
if (tx?.day?.session === day) out.push(`台指期日盤 ${tx.day.close}（${p(tx.day.changePct)}）`);
const oi = s0.market.foreignFuturesOI;
if (oi) out.push(`外資台指期淨部位 ${n(oi.net)} 口（${oi.date}）`);
const fl = s0.market.flows?.at(-1);
if (fl) out.push(`外資資金流向：${fl.date} 外資 ${fl.foreign} 億、美元兌台幣 ${fl.usdtwd}`);

out.push('', '## 0050 前六大（張）');
for (const s of snaps) {
  const i = s.institutional?.at(-1);
  const ok = i?.date === day;
  out.push(`${s.meta.code} ${s.meta.name}：收 ${s.indicators.close}（${p(s.indicators.changePct)}）量比 ${s.indicators.volumeRatio ?? '—'}｜外資 ${ok ? n(i.foreign) : '—'}、投信 ${ok ? n(i.trust) : '—'}、自營 ${ok ? n(i.dealerSelf) : '—'}｜MA20 ${s.indicators.ma20}、MA60 ${s.indicators.ma60}`);
}

const lev = s0.market.leveraged;
if (lev?.items?.length) {
  out.push('', '## 正2／反1（張）');
  for (const x of lev.items) out.push(`${x.name}：${p(x.changePct)}，外資 ${n(x.inst?.foreign)}、投信 ${n(x.inst?.trust)}、自營 ${n(x.inst?.dealerSelf)}、融資 ${n(x.marginChange)}`);
}

const results = await readFile('data/results.json', 'utf8').then(JSON.parse, () => ({}));
const res = Object.entries(results).filter(([k]) => k.startsWith(day + '-'));
if (res.length) {
  out.push('', '## 今天的預測對答案');
  for (const [k, r] of res) out.push(`${k.slice(11)}：預測 ${r.verdict ?? '—'} → 實際 ${r.actual}（${p(r.changePct)}）${r.hit ? '✔' : '✘'}｜開盤 ${r.openActual ?? '—'} ${r.openHit ? '✔' : '✘'}`);
}

const gov = await readFile(`data/govbanks/${day}.json`, 'utf8').then(JSON.parse, () => null);
if (gov?.net != null) out.push('', `八大官股合計 ${gov.net} ${gov.amountUnit}`);

out.push('', '## 13:30 後的大盤新聞標題（Google News，需查證）');
for (const x of (s0.news?.market ?? []).slice(0, 12)) out.push(`- ${x.tags.length ? '⚠ ' : ''}${x.title}（${x.source}）`);
console.log(out.join('\n'));
