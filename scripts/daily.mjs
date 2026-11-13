#!/usr/bin/env node
// 每日排程：npm run daily -- predict｜verify｜postclose  （由 .github/workflows/daily.yml 自動執行，也可以手動執行）
//
// predict（開盤日 05:45 左右，只在 09:00 前）：
//   1. 今天不是交易日 → 什麼都不做（週末、國定假日）
//   2. 先補做還沒對答案的驗證
//   3. 對 watchlist 每一檔：抓快照 → 產生程式版報告（mode: auto）→ 驗收
//      已有 AI 完整版（mode: ai）的報告不覆寫
// verify：對答案，寫入 data/results.json
// postclose（開盤日 16:10 左右）：對答案＋抓下一個交易日的快照（只有數據，不產生預測），給盤後戰情頁與 AI 盤後分析使用
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import watchlist from '../src/data/watchlist.json' with { type: 'json' };
import { loadCalendar, isTradingDay, nextTradingDay, todayTpe } from './lib/calendar.mjs';
import { fetchSnapshot } from './lib/snapshot.mjs';
import { buildAutoReport } from './lib/autoreport.mjs';
import { validateReport, validateBody } from '../src/lib/validate.mjs';

const task = process.argv[2];
if (!['predict', 'verify', 'postclose'].includes(task)) {
  console.error('用法：npm run daily -- predict｜verify｜postclose');
  process.exit(1);
}

const today = todayTpe();
const cal = await loadCalendar();
if (cal.warning) console.log('⚠', cal.warning);

const verify = () => execFileSync(process.execPath, ['scripts/verify.mjs'], { stdio: 'inherit' });

if (task === 'verify') {
  verify();
  process.exit(0);
}

if (!isTradingDay(today)) {
  console.log(`📅 ${today} 休市，不產生預測。`);
  process.exit(0);
}

// ---------- postclose：收盤後只抓數據，不產生預測（CLAUDE.md §7.1） ----------
if (task === 'postclose') {
  verify();
  const next = nextTradingDay(today);
  let n = 0;
  for (const { code, name } of watchlist.stocks) {
    try { await fetchSnapshot(code, { target: next }); n++; console.log(`✔ ${code} ${name}：盤後數據`); }
    catch (e) { console.log(`✘ ${code} ${name}：${e.message}`); }
  }
  console.log(`盤後數據 ${n}/${watchlist.stocks.length} 檔（快照 data/snapshots/${next}/）`);
  process.exit(n ? 0 : 1);
}

// ---------- predict ----------

// 只在開盤前（09:00 以前）預測今天；09:00 之後不產生、不覆寫（排程可能延遲數小時；收盤後也不做預測，CLAUDE.md §7.1）
const hhmm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
const target = today;
verify(); // 補做先前漏掉的驗證
if (hhmm >= '09:00') {
  console.log(`⏰ 現在 ${hhmm}，已過 09:00，不產生或覆寫預測（盤前預測只在開盤前產生）。`);
  process.exit(0);
}
console.log(`▶ ${target} 盤前程式版預測：${watchlist.stocks.map((s) => `${s.code} ${s.name}`).join('、')}`);

const exists = (p) => access(p).then(() => true, () => false);
let ok = 0;
const failed = [];
for (const { code, name } of watchlist.stocks) {
  const file = `src/content/reports/${target}-${code}.md`;
  let fetched = false;
  try {
    if (await exists(file)) {
      const fm = parse((await readFile(file, 'utf8')).replace(/\r\n/g, '\n').split('---\n')[1]);
      const snap = await readFile(`data/snapshots/${target}/${code}.json`, 'utf8').then(JSON.parse, () => null);
      // 已有 AI 完整版：資料完整就不覆寫；前一晚做的（沒有隔夜資料）改回程式版重做，07:20 晨報會再升級（§4 允許開盤前重做）
      if ((fm.mode ?? 'ai') === 'ai' && snap?.meta?.timingOk) { console.log(`… ${code} ${name}：已有 AI 完整版，不覆寫`); ok++; continue; }
      if ((fm.mode ?? 'ai') === 'ai') console.log(`↻ ${code} ${name}：AI 完整版是前一晚做的（沒有隔夜資料），改用最新資料重做程式版`);
      // 備援排程：前一次排程已用完整資料（時序檢查通過）產生過，就不重做，避免和雲端晨報衝突
      else
      if (snap?.meta?.timingOk && Date.now() - new Date(snap.meta.fetchedAt) < 12 * 3600e3) { console.log(`… ${code} ${name}：今天已產生（時序檢查通過），不重做`); ok++; continue; }
    }
    const { snapshot } = await fetchSnapshot(code, { target });
    fetched = true;
    const md = buildAutoReport(snapshot);
    const [, fmText, body] = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const errors = [...validateReport(parse(fmText), snapshot), ...validateBody(body)];
    if (errors.length) throw new Error(`驗收未通過：${errors.join('；')}`);
    await writeFile(file, md);
    const fm = parse(fmText);
    console.log(`✔ ${code} ${name}：${fm.verdict}（信心度 ${fm.confidence}%）${snapshot.meta.timingOk ? '' : '｜⏰ 時序檢查未通過'}`);
    ok++;
  } catch (e) {
    // 快照已更新但報告產生失敗：刪掉舊的程式版報告，避免與新快照不一致而擋住其他股票的發布
    if (fetched) await rm(file, { force: true });
    failed.push(`${code} ${name}：${e.message}`);
    console.log(`✘ ${code} ${name}：${e.message}`);
  }
}

console.log(`\n完成 ${ok}/${watchlist.stocks.length} 檔`);
if (failed.length) {
  console.log('失敗：');
  failed.forEach((f) => console.log('  -', f));
  if (!ok) process.exit(1); // 全部失敗才讓排程顯示紅燈
}
