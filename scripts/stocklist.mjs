#!/usr/bin/env node
// 股票代號對照表：npm run stocklist
// 從證交所與櫃買中心官方清單產生 data/stocklist.json（代號 → 名稱）。
// 「資料登錄」頁與官股匯入腳本用它把股名轉成代號，避免憑記憶填寫（CLAUDE.md §7.4）。
import { writeFile } from 'node:fs/promises';
import { getJSON, sleep } from './lib/http.mjs';

const stocks = {};
const tw = await getJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
for (const x of tw) stocks[x.Code.trim()] = x.Name.trim();
await sleep(1000);
const tp = await getJSON('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes');
for (const x of tp) {
  const code = x.SecuritiesCompanyCode.trim();
  stocks[code] ??= x.CompanyName.trim();
}
if (Object.keys(stocks).length < 1500) throw new Error(`對照表筆數異常（${Object.keys(stocks).length}），不覆寫`);
await writeFile('data/stocklist.json', JSON.stringify({ updatedAt: new Date().toISOString(), stocks }) + '\n');
console.log(`✔ data/stocklist.json：${Object.keys(stocks).length} 檔（上市 ${tw.length}、上櫃 ${tp.length}）`);
