#!/usr/bin/env node
// 每日排程：npm run daily -- predict｜verify  （由 .github/workflows/daily.yml 自動執行，也可以手動執行）
//
// predict（開盤日 06:40 左右）：
//   1. 今天不是交易日 → 什麼都不做（週末、國定假日）
//   2. 先補做還沒對答案的驗證
//   3. 對 watchlist 每一檔：抓快照 → 產生程式版報告（mode: auto）→ 驗收
//      已有 AI 完整版（mode: ai）的報告不覆寫
// verify（開盤日 16:10 左右）：對答案，寫入 data/results.json；排程接著執行 predict 產生下一個交易日初版
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import watchlist from '../src/data/watchlist.json' with { type: 'json' };
import { loadCalendar, isTradingDay, nextTradingDay, todayTpe } from './lib/calendar.mjs';
import { fetchSnapshot } from './lib/snapshot.mjs';
import { buildAutoReport } from './lib/autoreport.mjs';
import { validateReport, validateBody } from '../src/lib/validate.mjs';

const task = process.argv[2];
if (!['predict', 'verify'].includes(task)) {
  console.error('用法：npm run daily -- predict｜verify');
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

// ---------- predict ----------
if (!isTradingDay(today)) {
  console.log(`📅 ${today} 休市，不產生預測。`);
  process.exit(0);
}

// 13:30 收盤前執行 → 預測今天；收盤後執行（例如晚上手動補跑）→ 預測下一個交易日
const hhmm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
const target = hhmm < '13:30' ? today : nextTradingDay(today);
verify(); // 補做先前漏掉的驗證
// 09:00～13:30 已開盤：不可以再產生或覆寫今天的預測（GitHub 排程可能延遲數小時，CLAUDE.md §4、§7.1）
if (hhmm >= '09:00' && hhmm < '13:30') {
  console.log(`⏰ 現在 ${hhmm} 已開盤，不產生或覆寫 ${target} 的預測（排程延遲）。`);
  process.exit(0);
}
console.log(`▶ ${target} 盤前程式版預測：${watchlist.stocks.map((s) => `${s.code} ${s.name}`).join('、')}`);

const exists = (p) => access(p).then(() => true, () => false);
// 盤後初版的結論另外存一份（隔天 05:40 正式版會覆寫報告），戰績頁用來比較「盤後初版」與「盤前正式版」的命中率
const DRAFTS = 'data/drafts.json';
const drafts = await readFile(DRAFTS, 'utf8').then(JSON.parse, () => ({}));
let ok = 0;
const failed = [];
for (const { code, name } of watchlist.stocks) {
  const file = `src/content/reports/${target}-${code}.md`;
  let fetched = false;
  try {
    if (await exists(file)) {
      const fm = parse((await readFile(file, 'utf8')).replace(/\r\n/g, '\n').split('---\n')[1]);
      if ((fm.mode ?? 'ai') === 'ai') { console.log(`… ${code} ${name}：已有 AI 完整版，不覆寫`); ok++; continue; }
      // 備援排程：前一次排程已用完整資料（時序檢查通過）產生過，就不重做，避免和雲端晨報的 PR 衝突
      const snap = await readFile(`data/snapshots/${target}/${code}.json`, 'utf8').then(JSON.parse, () => null);
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
    if (fm.timingNote?.startsWith('初版')) drafts[`${target}-${code}`] = { verdict: fm.verdict, confidence: fm.confidence, createdAt: fm.createdAt };
    console.log(`✔ ${code} ${name}：${fm.verdict}（信心度 ${fm.confidence}%）${snapshot.meta.timingOk ? '' : '｜⏰ 時序檢查未通過'}`);
    ok++;
  } catch (e) {
    // 快照已更新但報告產生失敗：刪掉舊的程式版報告，避免與新快照不一致而擋住其他股票的發布
    if (fetched) await rm(file, { force: true });
    failed.push(`${code} ${name}：${e.message}`);
    console.log(`✘ ${code} ${name}：${e.message}`);
  }
}

await writeFile(DRAFTS, JSON.stringify(Object.fromEntries(Object.entries(drafts).sort()), null, 2) + '\n');
console.log(`\n完成 ${ok}/${watchlist.stocks.length} 檔`);
if (failed.length) {
  console.log('失敗：');
  failed.forEach((f) => console.log('  -', f));
  if (!ok) process.exit(1); // 全部失敗才讓排程顯示紅燈
}
