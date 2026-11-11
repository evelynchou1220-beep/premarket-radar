#!/usr/bin/env node
// 官股資料匯入（命令列，AI 使用）：npm run govbanks -- <文字檔> [--date YYYY-MM-DD]
// 文字檔內容是從玩股網複製的表格（行庫合計、個股排行，或兩者都有）。
// 行庫合計會寫入每一個日期；個股排行寫入 --date（未指定時用行庫表最新一天）。已存在的檔案會合併更新。
import { readFile, writeFile, access } from 'node:fs/promises';
import { parseBankTable, parseRanking, invertStockList } from '../src/lib/govparse.mjs';
import { validateGovBank } from '../src/lib/validate.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a));
const dIdx = args.indexOf('--date');
if (!file) { console.error('用法：npm run govbanks -- <文字檔> [--date YYYY-MM-DD]'); process.exit(1); }

const text = await readFile(file, 'utf8');
const { stocks } = JSON.parse(await readFile('data/stocklist.json', 'utf8'));
const banks = parseBankTable(text);
const rank = parseRanking(text, invertStockList(stocks));
const SOURCE = '使用者提供（玩股網「八大公股銀行」複製文字）';
const exists = (p) => access(p).then(() => true, () => false);

const out = new Map(); // date → 物件
for (const d of banks.days) out.set(d.date, { date: d.date, source: SOURCE, url: 'https://www.wantgoo.com/stock/public-bank/trend', amountUnit: d.amountUnit, banks: d.banks, net: d.net });
if (rank.buy.length || rank.sell.length) {
  const date = dIdx >= 0 ? args[dIdx + 1] : [...out.keys()].sort().at(-1);
  if (!date) { console.error('有個股排行但不知道日期，請加上 --date YYYY-MM-DD'); process.exit(1); }
  const g = out.get(date) ?? { date, source: SOURCE };
  Object.assign(g, { unit: rank.unit, buy: rank.buy, sell: rank.sell });
  out.set(date, g);
}

let failed = 0;
for (const [date, g] of [...out].sort()) {
  const path = `data/govbanks/${date}.json`;
  const old = (await exists(path)) ? JSON.parse(await readFile(path, 'utf8')) : null;
  const merged = old ? { ...old, ...g, source: old.source.includes(g.source) ? old.source : `${old.source}；${g.source}` } : g;
  const errors = validateGovBank(merged, `${date}.json`);
  if (errors.length) { failed++; console.log(`✘ ${path}`); errors.forEach((e) => console.log('   -', e)); continue; }
  await writeFile(path, JSON.stringify(merged, null, 2) + '\n');
  console.log(`✔ ${path}${merged.net != null ? `｜合計 ${merged.net}` : ''}${merged.buy ? `｜買超 ${merged.buy.length} 檔、賣超 ${merged.sell.length} 檔` : ''}`);
}
if (banks.days.length || !(rank.buy.length || rank.sell.length)) banks.errors.forEach((e) => console.log('⚠', e));
if (rank.unknown.length) console.log(`⚠ 官方清單查不到代號，已略過：${rank.unknown.join('、')}`);
process.exit(failed ? 1 : 0);
