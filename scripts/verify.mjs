#!/usr/bin/env node
// 預測驗證：npm run verify
// 找出「預測交易日已收盤、但還沒對答案」的報告，抓證交所官方收盤價，寫入 data/results.json。
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { getJSON, num, round, ymd } from './lib/http.mjs';
import { judge } from '../src/lib/scoring.mjs';

const RESULTS = 'data/results.json';
const results = JSON.parse(await readFile(RESULTS, 'utf8'));
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const cache = new Map();

async function monthRows(code, date) {
  const key = `${code}-${date.slice(0, 7)}`;
  if (!cache.has(key)) {
    const j = await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ymd(date).slice(0, 6)}01&stockNo=${code}&response=json`, { delay: 1000 });
    cache.set(key, j.stat === 'OK' ? j.data.map((r) => {
      const [y, m, d] = r[0].split('/');
      return { date: `${Number(y) + 1911}-${m}-${d}`, open: num(r[3]), close: num(r[6]) };
    }) : []);
  }
  return cache.get(key);
}

let updated = 0;
for (const file of (await readdir('src/content/reports')).filter((f) => f.endsWith('.md')).sort()) {
  const id = file.replace(/\.md$/, '');
  if (results[id]) continue;
  const fm = parse((await readFile(`src/content/reports/${file}`, 'utf8')).replace(/\r\n/g, '\n').split('---\n')[1]);
  if (fm.target > today) { console.log(`… ${id}：預測日 ${fm.target} 尚未到`); continue; }

  const rows = await monthRows(fm.code, fm.target);
  const day = rows.find((r) => r.date === fm.target);
  if (!day) {
    const later = rows.some((r) => r.date > fm.target);
    console.log(later
      ? `⚠ ${id}：${fm.target} 不是交易日（休市），請人工確認後將報告 target 改為實際交易日`
      : `… ${id}：證交所尚未公布 ${fm.target} 收盤（通常 14:30 後）`);
    continue;
  }
  const prevRows = fm.basedOn.slice(0, 7) === fm.target.slice(0, 7) ? rows : await monthRows(fm.code, fm.basedOn);
  const prev = prevRows.find((r) => r.date === fm.basedOn);
  if (!prev) { console.log(`⚠ ${id}：找不到 ${fm.basedOn} 收盤價`); continue; }

  const changePct = round(((day.close - prev.close) / prev.close) * 100);
  const openPct = round(((day.open - prev.close) / prev.close) * 100);
  const { actual, hit } = judge(fm.verdict, changePct);
  results[id] = {
    code: fm.code, target: fm.target, verdict: fm.verdict, confidence: fm.confidence,
    prevClose: prev.close, open: day.open, close: day.close, openPct, changePct, actual, hit,
    verifiedAt: new Date().toISOString(),
  };
  updated++;
  console.log(`${hit ? '✔ 命中' : '✘ 未中'} ${id}：預測 ${fm.verdict}，實際 ${actual}（開盤 ${openPct}%、收盤 ${changePct}%）`);
}

await writeFile(RESULTS, JSON.stringify(Object.fromEntries(Object.entries(results).sort()), null, 2) + '\n');
const all = Object.values(results);
const hits = all.filter((r) => r.hit).length;
console.log(`\n本次新增 ${updated} 筆驗證；累計 ${all.length} 筆，命中 ${hits} 筆（${all.length ? round((hits / all.length) * 100, 1) : 0}%）`);
